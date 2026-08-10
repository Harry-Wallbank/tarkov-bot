// Fallback data source for when api.tarkov.dev's GraphQL API is down (as
// tracked at https://github.com/the-hideout/tarkov-api/issues/474, where a
// maintainer noted `json.tarkov.dev` stayed up throughout the outage since
// it just serves static dataset dumps rather than live GraphQL).
//
// These dumps ship untranslated: `name`/`shortName` are literally
// "<id> Name" placeholders because locale packs aren't merged in. Every
// display name here is instead derived from `wikiLink` (best) or
// `normalizedName` (fallback), which are the two fields that are always
// real, readable text. Search matching also uses `normalizedName` for the
// same reason.
//
// Exports the same normalized shape as tarkovApi.js so callers don't need
// to know which source answered — see tarkovData.js.

const JSON_API_BASE = 'https://json.tarkov.dev/regular';
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

async function fetchDataset(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.value;

  const res = await fetch(`${JSON_API_BASE}/${path}`);
  if (!res.ok) {
    throw new Error(`json.tarkov.dev returned HTTP ${res.status} for ${path}`);
  }
  const value = await res.json();
  cache.set(path, { value, time: Date.now() });
  return value;
}

function displayName(entry) {
  if (entry.wikiLink) {
    const slug = entry.wikiLink.split('/wiki/')[1];
    if (slug) {
      try {
        return decodeURIComponent(slug).replace(/_/g, ' ');
      } catch {
        /* malformed URI, fall through to normalizedName */
      }
    }
  }
  if (entry.normalizedName) {
    return entry.normalizedName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return entry.id;
}

function compact(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function getItemsIndex() {
  const dump = await fetchDataset('items');
  return dump.data.items;
}

async function getTraderNameMap() {
  const dump = await fetchDataset('traders');
  const map = {};
  for (const [id, trader] of Object.entries(dump.data)) {
    map[id] = displayName(trader);
  }
  return map;
}

function normalizeItem(it, traderNames) {
  const bestSell = (it.sellToTrader || []).reduce(
    (best, cur) => (best === null || cur.priceRUB > best.priceRUB ? cur : best),
    null
  );
  const isAmmo = it.properties?.propertiesType === 'ItemPropertiesAmmo';

  return {
    name: displayName(it),
    wikiLink: it.wikiLink || null,
    imageUrl: it.gridImageLink || it.iconLink || null,
    basePrice: it.basePrice ?? null,
    avg24hPrice: it.avg24hPrice ?? null,
    bestSell: bestSell ? { price: bestSell.priceRUB, vendorName: traderNames[bestSell.trader] || null } : null,
    ammo: isAmmo
      ? {
          caliber: it.properties.caliber ?? null,
          damage: it.properties.damage ?? null,
          armorDamage: it.properties.armorDamage ?? null,
          penetrationPower: it.properties.penetrationPower ?? null,
        }
      : null,
  };
}

async function searchItem(name, limit = 5) {
  const [items, traderNames] = await Promise.all([getItemsIndex(), getTraderNameMap()]);
  const needle = compact(name);

  const matches = Object.values(items)
    .filter((it) => !it.types?.includes('preset'))
    .map((it) => ({ it, key: compact(it.normalizedName) }))
    .filter(({ key }) => key.includes(needle))
    .sort((a, b) => a.key.length - b.key.length)
    .slice(0, limit)
    .map(({ it }) => it);

  return matches.map((it) => normalizeItem(it, traderNames));
}

async function getWeaponWithPresets(name) {
  const items = await getItemsIndex();
  const needle = compact(name);

  const weapon = Object.values(items).find(
    (it) => it.properties?.propertiesType === 'ItemPropertiesWeapon' && compact(it.normalizedName).includes(needle)
  );
  if (!weapon) return null;

  const presetId = weapon.properties.defaultPreset || (weapon.properties.presets || [])[0] || null;
  const presetItem = presetId ? items[presetId] : null;

  const preset = presetItem
    ? {
        name: displayName(presetItem),
        ergonomics: presetItem.properties?.ergonomics ?? null,
        recoilVertical: presetItem.properties?.recoilVertical ?? null,
        recoilHorizontal: presetItem.properties?.recoilHorizontal ?? null,
        attachments: (presetItem.containsItems || [])
          .filter((ci) => ci.item !== weapon.id)
          .map((ci) => ({ name: displayName(items[ci.item] || { id: ci.item }), count: ci.count })),
      }
    : null;

  return {
    name: displayName(weapon),
    wikiLink: weapon.wikiLink || null,
    imageUrl: weapon.gridImageLink || weapon.iconLink || null,
    preset,
  };
}

module.exports = { searchItem, getWeaponWithPresets };
