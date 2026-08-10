// Greedy per-slot loadout optimizer over the json.tarkov.dev item dump.
//
// For every mod slot on a weapon — recursing into whatever sub-slots the
// chosen mod itself exposes (e.g. a barrel's muzzle thread, then that
// muzzle device's own sub-slots) — picks whichever allowed item gives the
// best combined ergonomics + recoil-reduction score. Optic slots are
// skipped: scope choice is subjective and EFT's actual sight-radius/zeroing
// tradeoffs aren't captured by this item data anyway.
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

function optimizeSlots(slots, items, depth, parts, visited, displayName) {
  if (depth > MAX_DEPTH) return;

  for (const slot of slots || []) {
    if (SKIP_SLOT_PATTERN.test(slot.nameId) || MAGAZINE_SLOT_PATTERN.test(slot.nameId)) continue;

    const candidates = (slot.filters?.allowedItems || [])
      .map((id) => items[id])
      .filter((it) => it && it.properties && !visited.has(it.id));

    if (candidates.length === 0) continue;

    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const score = scoreMod(candidate.properties);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (!best) continue;
    if (!slot.required && bestScore <= 0) continue;

    visited.add(best.id);
    parts.push({
      slotName: humanizeSlotName(slot.nameId),
      name: displayName(best),
      ergonomics: best.properties.ergonomics ?? 0,
      recoilModifier: best.properties.recoilModifier ?? 0,
      price: bestPrice(best),
    });

    if (best.properties.slots?.length) {
      optimizeSlots(best.properties.slots, items, depth + 1, parts, visited, displayName);
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
function optimizeWeapon(weapon, items, displayName) {
  const parts = [];
  const visited = new Set([weapon.id]);
  optimizeSlots(weapon.properties.slots, items, 0, parts, visited, displayName);

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
  };
}

module.exports = { optimizeWeapon };
