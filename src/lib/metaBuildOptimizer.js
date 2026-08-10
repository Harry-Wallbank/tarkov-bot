// Greedy per-slot loadout optimizer over the json.tarkov.dev item dump.
//
// For every mod slot on a weapon — recursing into whatever sub-slots the
// chosen mod itself exposes (e.g. a barrel's muzzle thread, then that
// muzzle device's own sub-slots) — picks whichever allowed item gives the
// best combined ergonomics + recoil-reduction score. Optic slots are
// skipped: scope choice is subjective and EFT's actual sight-radius/zeroing
// tradeoffs aren't captured by this item data anyway.
//
// Callers can force specific parts in ahead of the greedy pick via
// `options.keywords` (free-text stipulations like "suppressor, foregrip")
// and `options.categoryIds` (item category IDs, used for a quest's
// `containsCategory` requirement) — see optimizeSlots' forced-pick check.
// Anything not satisfied by any compatible slot is reported back so the
// caller can tell the user it couldn't be fit onto this weapon.
//
// This only runs against the JSON fallback dataset (see tarkovJsonApi.js),
// not GraphQL — recursing through nested mod slot trees needs a query shape
// nobody could verify while api.tarkov.dev has been down this entire build.

const SKIP_SLOT_PATTERN = /scope/i;
const MAGAZINE_SLOT_PATTERN = /magazine/i;
const MAX_DEPTH = 6;

const SLOT_LABEL_OVERRIDES = {
  sight_rear: 'Rear Sight',
  sight_front: 'Front Sight',
  pistol_grip: 'Pistol Grip',
  gas_block: 'Gas Block',
  charge: 'Charging Handle',
  reciever: 'Receiver',
};

function humanizeSlotName(nameId) {
  const key = nameId.replace(/^mod_/, '').replace(/_\d+$/, '');
  if (SLOT_LABEL_OVERRIDES[key]) return SLOT_LABEL_OVERRIDES[key];
  return key
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function bestPrice(item) {
  const prices = [];
  if (item.buyFromTrader?.length) prices.push(...item.buyFromTrader.map((b) => b.priceRUB));
  if (item.basePrice) prices.push(item.basePrice);
  return prices.length ? Math.min(...prices) : 0;
}

function scoreMod(properties) {
  const ergonomics = properties.ergonomics ?? 0;
  const recoilModifier = properties.recoilModifier ?? 0; // negative = reduction = good
  return ergonomics - recoilModifier * 100;
}

// Looks for a still-unsatisfied keyword/category requirement among this
// slot's candidates. Keyword matching is a simple substring check against
// the item's normalizedName (e.g. "suppressor" matches
// "ase-suppressor-762x51") since that field is always real text, unlike
// the placeholder `name`.
function findForcedCandidate(candidates, state) {
  for (const candidate of candidates) {
    const nameKey = (candidate.normalizedName || '').toLowerCase().replace(/-/g, ' ');
    for (const keyword of state.pendingKeywords) {
      if (nameKey.includes(keyword)) return { candidate, requirement: { type: 'keyword', value: keyword } };
    }
    for (const categoryId of state.pendingCategoryIds) {
      if (candidate.categories?.includes(categoryId)) {
        return { candidate, requirement: { type: 'category', value: categoryId } };
      }
    }
  }
  return null;
}

function optimizeSlots(slots, items, depth, parts, visited, displayName, state) {
  if (depth > MAX_DEPTH) return;

  for (const slot of slots || []) {
    if (SKIP_SLOT_PATTERN.test(slot.nameId) || MAGAZINE_SLOT_PATTERN.test(slot.nameId)) continue;

    const candidates = (slot.filters?.allowedItems || [])
      .map((id) => items[id])
      .filter((it) => it && it.properties && !visited.has(it.id));

    if (candidates.length === 0) continue;

    let chosen = null;
    let satisfiedRequirement = null;

    if (state.pendingKeywords.size > 0 || state.pendingCategoryIds.size > 0) {
      const forced = findForcedCandidate(candidates, state);
      if (forced) {
        chosen = forced.candidate;
        satisfiedRequirement = forced.requirement;
      }
    }

    if (!chosen) {
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        const score = scoreMod(candidate.properties);
        if (score > bestScore) {
          bestScore = score;
          chosen = candidate;
        }
      }
      if (!chosen) continue;
      if (!slot.required && bestScore <= 0) continue;
    }

    visited.add(chosen.id);
    if (satisfiedRequirement) {
      const pending = satisfiedRequirement.type === 'keyword' ? state.pendingKeywords : state.pendingCategoryIds;
      pending.delete(satisfiedRequirement.value);
      state.satisfied.push({ ...satisfiedRequirement, itemName: displayName(chosen), slotName: humanizeSlotName(slot.nameId) });
    }

    parts.push({
      slotName: humanizeSlotName(slot.nameId),
      name: displayName(chosen),
      ergonomics: chosen.properties.ergonomics ?? 0,
      recoilModifier: chosen.properties.recoilModifier ?? 0,
      price: bestPrice(chosen),
      forced: Boolean(satisfiedRequirement),
    });

    if (chosen.properties.slots?.length) {
      optimizeSlots(chosen.properties.slots, items, depth + 1, parts, visited, displayName, state);
    }
  }
}

// Balances capacity against reliability rather than blindly taking the
// biggest drum — a 100-round mag with a 45% malfunction chance is not
// "best" in any practical sense.
function scoreMagazine(properties) {
  const capacity = properties.capacity ?? 0;
  const malfunctionChance = properties.malfunctionChance ?? 0;
  const ergonomics = properties.ergonomics ?? 0;
  // Malfunction chance is weighted heavily: a few extra rounds of capacity
  // shouldn't outweigh a mag that jams constantly.
  return capacity - malfunctionChance * 300 - Math.abs(Math.min(ergonomics, 0));
}

function pickBestMagazine(weapon, items, displayName) {
  const magSlot = (weapon.properties.slots || []).find((s) => MAGAZINE_SLOT_PATTERN.test(s.nameId));
  if (!magSlot) return null;

  const candidates = (magSlot.filters?.allowedItems || [])
    .map((id) => items[id])
    .filter((it) => it?.properties?.capacity != null);
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) => (scoreMagazine(b.properties) > scoreMagazine(a.properties) ? b : a));
  return {
    name: displayName(best),
    capacity: best.properties.capacity,
    ergonomics: best.properties.ergonomics ?? 0,
    malfunctionChance: best.properties.malfunctionChance ?? null,
  };
}

// `displayName` is injected (rather than imported) so this module has no
// dependency on where the item index came from.
function optimizeWeapon(weapon, items, displayName, options = {}) {
  const parts = [];
  const visited = new Set([weapon.id]);
  const state = {
    pendingKeywords: new Set((options.keywords || []).map((k) => k.toLowerCase().trim()).filter(Boolean)),
    pendingCategoryIds: new Set(options.categoryIds || []),
    satisfied: [],
  };

  optimizeSlots(weapon.properties.slots, items, 0, parts, visited, displayName, state);

  const baseErgonomics = weapon.properties.ergonomics ?? 0;
  const baseRecoilVertical = weapon.properties.recoilVertical ?? 0;
  const baseRecoilHorizontal = weapon.properties.recoilHorizontal ?? 0;

  let ergonomics = baseErgonomics;
  let recoilVertical = baseRecoilVertical;
  let recoilHorizontal = baseRecoilHorizontal;
  let totalCost = 0;

  for (const part of parts) {
    ergonomics += part.ergonomics;
    recoilVertical *= 1 + part.recoilModifier;
    recoilHorizontal *= 1 + part.recoilModifier;
    totalCost += part.price;
  }

  return {
    baseErgonomics,
    baseRecoilVertical,
    baseRecoilHorizontal,
    ergonomics: Math.round(ergonomics * 10) / 10,
    recoilVertical: Math.round(recoilVertical),
    recoilHorizontal: Math.round(recoilHorizontal),
    totalCost: Math.round(totalCost),
    parts,
    magazine: pickBestMagazine(weapon, items, displayName),
    requirements: {
      satisfied: state.satisfied,
      unmetKeywords: [...state.pendingKeywords],
      unmetCategoryIds: [...state.pendingCategoryIds],
    },
  };
}

module.exports = { optimizeWeapon };
