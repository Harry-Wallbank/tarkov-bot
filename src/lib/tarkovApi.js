// Thin client for the public Tarkov.dev GraphQL API (https://api.tarkov.dev).
// No API key required. Field names follow the schema documented at
// https://github.com/the-hideout/tarkov-api as of writing; that API has
// changed shape before, so every query result is validated and any GraphQL
// error is surfaced verbatim to make it obvious what to fix if it drifts.
//
// Every exported function returns the same normalized shape regardless of
// source, matching src/lib/tarkovJsonApi.js — see tarkovData.js, which picks
// between the two.

const API_URL = 'https://api.tarkov.dev/graphql';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function query(gql, variables) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables }),
  });

  // Tarkov.dev's Cloudflare Worker returns a JSON body with an `errors`
  // array on failed requests too (e.g. its own "GraphQL server unavailable"
  // outage message), so read the body before deciding how to fail.
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Tarkov.dev API returned HTTP ${res.status} with a non-JSON response`);
  }

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Tarkov.dev API error: ${json.errors.map((e) => e.message || e).join('; ')}`);
  }

  if (!res.ok) {
    throw new Error(`Tarkov.dev API returned HTTP ${res.status}`);
  }

  return json.data;
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.value;
  const value = await fn();
  cache.set(key, { value, time: Date.now() });
  return value;
}

function normalizeItem(item) {
  const isAmmo = item.properties && item.properties.caliber !== undefined;
  const bestSell = item.sellFor?.length
    ? item.sellFor.reduce((best, cur) => (cur.price > best.price ? cur : best))
    : null;

  return {
    name: item.name,
    wikiLink: item.wikiLink || null,
    imageUrl: item.gridImageLink || item.iconLink || null,
    basePrice: item.basePrice ?? null,
    avg24hPrice: item.avg24hPrice ?? null,
    bestSell: bestSell ? { price: bestSell.price, vendorName: bestSell.vendor.name } : null,
    ammo: isAmmo
      ? {
          caliber: item.properties.caliber ?? null,
          damage: item.properties.damage ?? null,
          armorDamage: item.properties.armorDamage ?? null,
          penetrationPower: item.properties.penetrationPower ?? null,
        }
      : null,
  };
}

async function searchItem(name, limit = 5) {
  const data = await query(
    `query Items($name: String!, $limit: Int) {
      items(name: $name, limit: $limit) {
        id
        name
        wikiLink
        iconLink
        gridImageLink
        avg24hPrice
        basePrice
        sellFor { price vendor { name } }
        properties {
          ... on ItemPropertiesAmmo {
            caliber
            damage
            armorDamage
            penetrationPower
          }
        }
      }
    }`,
    { name, limit }
  );
  return data.items.map(normalizeItem);
}

async function getAllTasks() {
  return cached('tasks', async () => {
    const data = await query(
      `query Tasks {
        tasks {
          id
          name
          wikiLink
          map { name }
          neededKeys { keys { name } map { name } }
        }
      }`
    );
    return data.tasks;
  });
}

function normalizeTask(task) {
  const keyNames = new Set();
  for (const nk of task.neededKeys || []) {
    for (const key of nk.keys || []) keyNames.add(key.name);
  }
  return {
    name: task.name,
    wikiLink: task.wikiLink || null,
    map: task.map?.name || null,
    keysRequired: [...keyNames],
  };
}

async function searchTasks(name, limit = 5) {
  const tasks = await getAllTasks();
  const needle = name.toLowerCase();
  return tasks
    .filter((t) => t.name.toLowerCase().includes(needle))
    .slice(0, limit)
    .map(normalizeTask);
}

// Minimal, cheap query used only to check whether the API is up —
// see tarkovApiHealth.js.
async function ping() {
  await query('query Ping { items(limit: 1) { id } }');
}

module.exports = { searchItem, searchTasks, ping };
