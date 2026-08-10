// Tracks whether api.tarkov.dev's GraphQL API is currently reachable, so
// tarkovData.js doesn't have to pay the latency of a failed GraphQL call on
// every single command while a known outage is ongoing (it's been down for
// this project's entire build — see https://github.com/the-hideout/tarkov-api/issues/474).
//
// Checked once a day and also the instant any real request fails, so a
// single bad call is enough to switch the rest of that day's traffic to the
// json.tarkov.dev fallback rather than retrying a dead API repeatedly.
// Recovery is only re-checked on the next daily cycle, per design — not
// the moment the API comes back — to keep behavior simple and predictable.

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let healthy = true; // optimistic until the first check proves otherwise

async function checkNow() {
  const graphql = require('./tarkovApi');
  try {
    await graphql.ping();
    if (!healthy) console.log('[graphql-health] Tarkov.dev GraphQL API is back up.');
    healthy = true;
  } catch (error) {
    if (healthy) {
      console.warn(
        `[graphql-health] Tarkov.dev GraphQL API check failed (${error.message}); using json.tarkov.dev until the next daily check.`
      );
    }
    healthy = false;
  }
}

function isHealthy() {
  return healthy;
}

// Called by tarkovData.js the moment a live request fails, so we don't wait
// for the next scheduled check to stop hammering a dead API.
function markUnhealthy(reason) {
  if (healthy) {
    console.warn(`[graphql-health] Tarkov.dev GraphQL request failed (${reason}); switching to json.tarkov.dev until the next daily check.`);
  }
  healthy = false;
}

function startDailyHealthCheck() {
  checkNow();
  return setInterval(checkNow, CHECK_INTERVAL_MS);
}

module.exports = { isHealthy, markUnhealthy, startDailyHealthCheck };
