// Greedy per-slot loadout optimizer over the json.tarkov.dev item dump.
//
// For every mod slot on a weapon — recursing into whatever sub-slots the
// chosen mod itself exposes (e.g. a barrel's muzzle thread, then that
// muzzle device's own sub-slots) — picks whichever allowed, non-conflicting
// item gives the best combined ergonomics + recoil-reduction score. Optic
// slots are skipped: scope choice is subjective and EFT's actual
// sight-radius/zeroing tradeoffs aren't captured by this item data anyway.
// Required slots always get filled. Optional slots are otherwise left
// empty — except a stock or foregrip, which are always added if the
// weapon has either available. Both are often nested behind an
// intermediate optional slot (e.g. an AK-to-M4 buffer tube adapter, which
// itself scores poorly on its own stats but unlocks a whole tree of M4
// stocks); that intermediate part is added when — and only when — it's the
// path to a stock or foregrip. See `candidateLeadsToAlwaysFillSlot`.
//
// Candidates aren't ranked by their own immediate ergonomics/recoil alone —
// that would always lose to a direct part for exactly the adapter case
// above. Instead each candidate is ranked by its best achievable subtree
// score: its own score, plus the best score recursively achievable through
// whatever slots it exposes. See `subtreeScore`.
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
//
// `options.profile` (`{ playerLevel, traderLevels }`, from
// tarkovProfileStore.js) restricts candidates to ones the user can actually
// buy right now: for each trader that sells the item, that specific
// trader's tracked level must meet the item's `minTraderLevel` at that
// trader (a trader the user was never asked about defaults to level 1,
// i.e. base access, rather than being treated as fully locked). For items
// no trader sells at all, `playerLevel` must be at least FLEA_UNLOCK_LEVEL
// (flea market access — an approximation, since the real threshold has
// changed between game updates and isn't in this data). If *nothing*
// available at the user's level fits a required/always-fill slot, the
// best overall part is used anyway and flagged `locked: true`
// rather than leaving the slot empty — see `isAvailableToProfile`.

const SKIP_SLOT_PATTERN = /scope/i;
const MAGAZINE_SLOT_PATTERN = /magazine/i;
const ALWAYS_FILL_SLOT_PATTERN = /foregrip|stock/i;
const MAX_DEPTH = 6;
const LOOKAHEAD_DEPTH = 4;
const FLEA_UNLOCK_LEVEL = 15;

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

function isAvailableToProfile(item, profile) {
  if (!profile) return true;
  const buys = item.buyFromTrader || [];
  if (buys.length === 0) return profile.playerLevel >= FLEA_UNLOCK_LEVEL;
  return buys.some((b) => {
    const required = b.minTraderLevel ?? 1;
    const owned = profile.traderLevels?.[b.trader] ?? 1;
    return required <= owned;
  });
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
// whatever it in turn best exposes) expose a stock or foregrip slot. Used
// to let an otherwise-skipped optional slot through only when it's the
// necessary path to one — e.g. an AK-to-M4 buffer tube adapter, which
// exposes an entirely different tree of M4-pattern stocks.
function candidateLeadsToAlwaysFillSlot(candidate, items, depth) {
  if (depth > LOOKAHEAD_DEPTH) return false;
  for (const childSlot of candidate.properties?.slots || []) {
    if (ALWAYS_FILL_SLOT_PATTERN.test(childSlot.nameId)) return true;
    for (const id of childSlot.filters?.allowedItems || []) {
      const child = items[id];
      if (child?.properties && candidateLeadsToAlwaysFillSlot(child, items, depth + 1)) return true;
    }
  }
  return false;
}

// Best cumulative score achievable by equipping `item`: its own
// ergonomics/recoil score, plus the best score recursively achievable
// through whatever required/always-fill/leads-to-always-fill slots it
// exposes. This is what candidates are actually ranked by — comparing raw
// own-score alone would always favor a mediocre direct part over an
// adapter that unlocks a much better subtree, since the adapter itself is
// typically ergonomically neutral or slightly negative.
function subtreeScore(item, items, depth) {
  if (!item.properties) return 0;
  let total = scoreMod(item.properties);
  if (depth > LOOKAHEAD_DEPTH) return total;

  for (const slot of item.properties.slots || []) {
    if (SKIP_SLOT_PATTERN.test(slot.nameId) || MAGAZINE_SLOT_PATTERN.test(slot.nameId)) continue;

    const candidateIds = slot.filters?.allowedItems || [];
    const candidates = candidateIds.map((id) => items[id]).filter((it) => it?.properties);
    if (candidates.length === 0) continue;

    const isAlwaysFill = ALWAYS_FILL_SLOT_PATTERN.test(slot.nameId);
    const eligible = slot.required || isAlwaysFill
      ? candidates
      : candidates.filter((c) => candidateLeadsToAlwaysFillSlot(c, items, depth + 1));
    if (eligible.length === 0) continue;

    let best = -Infinity;
    for (const candidate of eligible) {
      const s = subtreeScore(candidate, items, depth + 1);
      if (s > best) best = s;
    }
    total += best;
  }
  return total;
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

    const allCandidates = (slot.filters?.allowedItems || [])
      .map((id) => items[id])
      .filter((it) => it && it.properties && !visited.has(it.id) && !conflictsWithChosen(it, chosenItems));

    if (allCandidates.length === 0) continue;

    // Prefer parts the user can actually buy at their profile's levels; if
    // none of this slot's options are available to them, fall back to
    // ranking every option so the slot still gets filled (flagged locked).
    const affordable = state.profile ? allCandidates.filter((c) => isAvailableToProfile(c, state.profile)) : allCandidates;
    const candidates = affordable.length > 0 ? affordable : allCandidates;

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
      const isAlwaysFillSlot = ALWAYS_FILL_SLOT_PATTERN.test(slot.nameId);
      let eligible = candidates;

      // Skip optional slots entirely — except a stock or foregrip itself,
      // or an intermediate part that's the only path to reach one.
      if (!slot.required && !isAlwaysFillSlot) {
        eligible = candidates.filter((c) => candidateLeadsToAlwaysFillSlot(c, items, depth));
        if (eligible.length === 0) continue;
      }

      let bestScore = -Infinity;
      for (const candidate of eligible) {
        const score = subtreeScore(candidate, items, depth);
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
      locked: Boolean(state.profile) && !isAvailableToProfile(chosen, state.profile),
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

function pickBestMagazine(weapon, items, chosenItems, displayName, profile) {
  const magSlot = (weapon.properties.slots || []).find((s) => MAGAZINE_SLOT_PATTERN.test(s.nameId));
  if (!magSlot) return null;

  const allCandidates = (magSlot.filters?.allowedItems || [])
    .map((id) => items[id])
    .filter((it) => it?.properties?.capacity != null && !conflictsWithChosen(it, chosenItems));
  if (allCandidates.length === 0) return null;

  const affordable = profile ? allCandidates.filter((c) => isAvailableToProfile(c, profile)) : allCandidates;
  const candidates = affordable.length > 0 ? affordable : allCandidates;

  const best = candidates.reduce((a, b) => (scoreMagazine(b.properties) > scoreMagazine(a.properties) ? b : a));
  return {
    id: best.id,
    name: displayName(best),
    capacity: best.properties.capacity,
    ergonomics: best.properties.ergonomics ?? 0,
    malfunctionChance: best.properties.malfunctionChance ?? null,
    locked: Boolean(profile) && !isAvailableToProfile(best, profile),
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
    profile: options.profile || null,
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
    magazine: pickBestMagazine(weapon, items, chosenItems, displayName, state.profile),
    requirements: {
      satisfied: state.satisfied,
      unmetKeywords: [...state.pendingKeywords],
      unmetCategoryIds: [...state.pendingCategoryIds],
    },
  };
}

module.exports = { optimizeWeapon };
