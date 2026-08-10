// Picks between the live GraphQL API and the static JSON fallback for the
// lookups that both sources can answer (items/ammo, weapon presets). Quest
// search has no reliable JSON-API equivalent (see tarkovJsonApi.js), so it
// only ever uses GraphQL.

const graphql = require('./tarkovApi');
const jsonApi = require('./tarkovJsonApi');

const SOURCE_GRAPHQL = 'Tarkov.dev';
const SOURCE_JSON = 'Tarkov.dev (cached dataset, GraphQL API is currently down)';

async function withFallback(graphqlFn, jsonFn) {
  try {
    const result = await graphqlFn();
    return { result, source: SOURCE_GRAPHQL };
  } catch (graphqlError) {
    console.error('Tarkov.dev GraphQL lookup failed, falling back to json.tarkov.dev:', graphqlError.message);
    const result = await jsonFn();
    return { result, source: SOURCE_JSON };
  }
}

async function searchItem(name, limit = 5) {
  return withFallback(
    () => graphql.searchItem(name, limit),
    () => jsonApi.searchItem(name, limit)
  );
}

async function getWeaponWithPresets(name) {
  return withFallback(
    () => graphql.getWeaponWithPresets(name),
    () => jsonApi.getWeaponWithPresets(name)
  );
}

async function searchTasks(name, limit = 5) {
  const result = await graphql.searchTasks(name, limit);
  return { result, source: SOURCE_GRAPHQL };
}

module.exports = { searchItem, searchTasks, getWeaponWithPresets };
