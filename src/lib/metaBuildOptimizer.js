// Greedy per-slot loadout optimizer over the json.tarkov.dev item dump.
//
// For every mod slot on a weapon — recursing into whatever sub-slots the
// chosen mod itself exposes (e.g. a barrel's muzzle thread, then that
// muzzle device's own sub-slots) — picks whichever allowed, non-conflicting
// item gives the best combined ergonomics + recoil-reduction score. Optic
// slots are skipped: scope choice is subjective and EFT's actual
// sight-radius/zeroing tradeoffs aren't captured by this item data anyway.
// Required slots always get filled. Optional slots are otherwise left
// empty — except a foregrip, which is always added if the weapon has one
// available. On many weapons a foregrip slot is nested behind an optional
// rail-mount slot (e.g. a KeyMod section on the handguard); that
// intermediate mount is the one "extra" optional part that still gets
// added when — and only when — it's the path to a foregrip. See
// `candidateLeadsToForegrip`.
//
// Conflict avoidance: items carry top-level `conflictingItems` (specific
// item IDs) and `conflictingCategories` (category IDs) fields — e.g. one
// barrel can outright conflict with three specific handguards. A candidate
// is rejected if it conflicts with anything already chosen, or if anything
// already chosen conflicts with it (checked both directions since which
// side declares the conflict isn't consistent in the data).
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
const FOREGRIP_SLOT_PATTERN = /foregrip/i;
const MAX_DEPTH = 6;
const FOREGRIP_LOOKAHEAD_DEPTH = 4;

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

// Bidirectional: rejects a candidate if it conflicts with anything already
// chosen, OR if anything already chosen declares a conflict with it.
function conflictsWithChosen(candidate, chosenItems) {
  const candidateConflictItems = candidate.conflictingItems || [];
  const candidateConflictCategories = candidate.conflictingCategories || [];
  const candidateCategories = candidate.categories || [];

  for (const other of chosenItems) {
    if (candidateConflictItems.includes(other.id)) return true;
    if ((other.conflictingItems || []).includes(candidate.id)) return true;

    const otherCategories = other.categories || [];
    if (candidateConflictCategories.some((cat) => otherCategories.includes(cat))) return true;
    if ((other.conflictingCategories || []).some((cat) => candidateCategories.includes(cat))) return true;
  }
  return false;
}

// True if equipping `candidate` would (immediately, or after equipping
// whatever it in turn best exposes) expose a foregrip slot. Used to let an
// otherwise-skipped optional mount slot through only when it's the
// necessary path to a foregrip.
function candidateLeadsToForegrip(candidate, items, depth) {
  if (depth > FOREGRIP_LOOKAHEAD_DEPTH) return false;
  for (const childSlot of candidate.properties?.slots || []) {
    if (FOREGRIP_SLOT_PATTERN.test(childSlot.nameId)) return true;
    for (const id of childSlot.filters?.allowedItems || []) {
      const child = items[id];
      if (child?.properties && candidateLeadsToForegrip(child, items, depth + 1)) return true;
    }
  }
  return false;
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

function optimizeSlots(slots, items, depth, parts, visited, chosenItems, displayName, state) {
  if (depth > MAX_DEPTH) return;

  for (const slot of slots || []) {
    if (SKIP_SLOT_PATTERN.test(slot.nameId) || MAGAZINE_SLOT_PATTERN.test(slot.nameId)) continue;

    const candidates = (slot.filters?.allowedItems || [])
      .map((id) => items[id])
      .filter((it) => it && it.properties && !visited.has(it.id) && !conflictsWithChosen(it, chosenItems));

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
      const isForegripSlot = FOREGRIP_SLOT_PATTERN.test(slot.nameId);
      let eligible = candidates;

      // Skip optional slots entirely — except a foregrip itself, or a
      // mount that's the only path to reach one.
      if (!slot.required && !isForegripSlot) {
        eligible = candidates.filter((c) => candidateLeadsToForegrip(c, items, 0));
        if (eligible.length === 0) continue;
      }

      let bestScore = -Infinity;
      for (const candidate of eligible) {
        const score = scoreMod(candidate.properties);
        if (score > bestScore) {
          bestScore = score;
          chosen = candidate;
        }
      }
      if (!chosen) continue;
    }

    visited.add(chosen.id);
    chosenItems.push(chosen);
    if (satisfiedRequirement) {
      const pending = satisfiedRequirement.type === 'keyword' ? state.pendingKeywords : state.pendingCategoryIds;
      pending.delete(satisfiedRequirement.value);
      state.satisfied.push({ ...satisfiedRequirement, itemName: displayName(chosen), slotName: humanizeSlotName(slot.nameId) });
    }

    parts.push({
      id: chosen.id,
      slotName: humanizeSlotName(slot.nameId),
      name: displayName(chosen),
      ergonomics: chosen.properties.ergonomics ?? 0,
      recoilModifier: chosen.properties.recoilModifier ?? 0,
      price: bestPrice(chosen),
      forced: Boolean(satisfiedRequirement),
    });

    if (chosen.properties.slots?.length) {
      optimizeSlots(chosen.properties.slots, items, depth + 1, parts, visited, chosenItems, displayName, state);
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

function pickBestMagazine(weapon, items, chosenItems, displayName) {
  const magSlot = (weapon.properties.slots || []).find((s) => MAGAZINE_SLOT_PATTERN.test(s.nameId));
  if (!magSlot) return null;

  const candidates = (magSlot.filters?.allowedItems || [])
    .map((id) => items[id])
    .filter((it) => it?.properties?.capacity != null && !conflictsWithChosen(it, chosenItems));
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) => (scoreMagazine(b.properties) > scoreMagazine(a.properties) ? b : a));
  return {
    id: best.id,
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
  const chosenItems = [];
  const state = {
    pendingKeywords: new Set((options.keywords || []).map((k) => k.toLowerCase().trim()).filter(Boolean)),
    pendingCategoryIds: new Set(options.categoryIds || []),
    satisfied: [],
  };

  optimizeSlots(weapon.properties.slots, items, 0, parts, visited, chosenItems, displayName, state);

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
    magazine: pickBestMagazine(weapon, items, chosenItems, displayName),
    requirements: {
      satisfied: state.satisfied,
      unmetKeywords: [...state.pendingKeywords],
      unmetCategoryIds: [...state.pendingCategoryIds],
    },
  };
}

module.exports = { optimizeWeapon };
