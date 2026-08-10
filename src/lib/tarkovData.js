// Picks between the live GraphQL API and the static JSON fallback for the
// lookups both sources can answer (items/ammo). Quest search has no
// reliable JSON-API equivalent (see tarkovJsonApi.js), so it only ever uses
// GraphQL. Both paths consult tarkovApiHealth.js first: if a daily check or
// an earlier request already found GraphQL down, we skip straight to the
// JSON fallback (or fail fast for quests) instead of waiting out another
// failed call to a known-dead API.

const graphql = require('./tarkovApi');
const jsonApi = require('./tarkovJsonApi');
const { isHealthy, markUnhealthy } = require('./tarkovApiHealth');

const SOURCE_GRAPHQL = 'Tarkov.dev';
const SOURCE_JSON = 'Tarkov.dev (cached dataset, GraphQL API is currently down)';

async function withFallback(graphqlFn, jsonFn) {
  if (!isHealthy()) {
    const result = await jsonFn();
    return { result, source: SOURCE_JSON };
  }

  try {
    const result = await graphqlFn();
    return { result, source: SOURCE_GRAPHQL };
  } catch (graphqlError) {
    console.error('Tarkov.dev GraphQL lookup failed, falling back to json.tarkov.dev:', graphqlError.message);
    markUnhealthy(graphqlError.message);
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

async function searchTasks(name, limit = 5) {
  if (!isHealthy()) {
    throw new Error('Tarkov.dev GraphQL API is marked down (cached from the daily health check); quest search unavailable until the next check.');
  }

  try {
    const result = await graphql.searchTasks(name, limit);
    return { result, source: SOURCE_GRAPHQL };
  } catch (error) {
    markUnhealthy(error.message);
    throw error;
  }
}

module.exports = { searchItem, searchTasks };
