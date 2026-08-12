const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'tarkovProfiles.json');

const RECONFIRM_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_TRADER_LEVEL = 4;
const MAX_RELEVANT_PLAYER_LEVEL = 30;

// Per-user player level / trader level, used by /metabuild to only
// recommend attachments the user can actually buy right now. `traderLevel`
// is a single 1-4 value applied uniformly across traders (not tracked
// per-trader) — a deliberate simplification; see README.
function load() {
  if (!fs.existsSync(storePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch (error) {
    console.error('Failed to read tarkovProfiles.json, starting fresh:', error);
    return {};
  }
}

function save(data) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

function getProfile(userId) {
  return load()[userId] || null;
}

function setProfile(userId, { playerLevel, traderLevel }) {
  const data = load();
  data[userId] = { playerLevel, traderLevel, confirmedAt: Date.now() };
  save(data);
  return data[userId];
}

// Used by /wipe: clears one user's saved profile (their own only) so their
// next /metabuild prompts fresh — for a game wipe/prestige, where their
// actual player and trader levels reset to 1.
function deleteProfile(userId) {
  const data = load();
  const existed = userId in data;
  delete data[userId];
  save(data);
  return existed;
}

// True once a profile has nothing left to gain from reconfirming — max
// trader level and player level 30+. Once true, the daily reconfirm prompt
// stops appearing for that user permanently (until they run /metabuild
// again after further leveling, there's nothing more that could unlock).
function isMaxed(profile) {
  return Boolean(profile) && profile.traderLevel >= MAX_TRADER_LEVEL && profile.playerLevel >= MAX_RELEVANT_PLAYER_LEVEL;
}

// True if we should prompt: no profile yet, or profile isn't maxed and
// hasn't been confirmed in the last 24h.
function needsPrompt(profile) {
  if (!profile) return true;
  if (isMaxed(profile)) return false;
  return Date.now() - profile.confirmedAt > RECONFIRM_INTERVAL_MS;
}

module.exports = { getProfile, setProfile, deleteProfile, isMaxed, needsPrompt, MAX_TRADER_LEVEL, MAX_RELEVANT_PLAYER_LEVEL };
