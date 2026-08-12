const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'tarkovProfiles.json');

const RECONFIRM_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_TRADER_LEVEL = 4;
const MAX_RELEVANT_PLAYER_LEVEL = 30;

// The eight standard 1-4 loyalty-leveled traders (verified live against
// json.tarkov.dev/regular/traders). Excludes Fence (a 3-level reputation
// system, not player-purchased loyalty) and the always-level-1 vendors
// (Lightkeeper, Ref's static NPCs, etc.) that have nothing to ask about.
// IDs are stable, long-standing Tarkov trader IDs — safe to hardcode here
// rather than fetching them on every profile check.
const TRADERS = [
  { id: '54cb50c76803fa8b248b4571', name: 'Prapor' },
  { id: '54cb57776803fa99248b456e', name: 'Therapist' },
  { id: '58330581ace78e27b8b10cee', name: 'Skier' },
  { id: '5935c25fb3acc3127c3d8cd9', name: 'Peacekeeper' },
  { id: '5a7c2eca46aef81a7ca2145d', name: 'Mechanic' },
  { id: '5ac3b934156ae10c4430e83c', name: 'Ragman' },
  { id: '5c0647fdd443bc2504c2d371', name: 'Jaeger' },
  { id: '6617beeaa9cfa777ca915b7c', name: 'Ref' },
];

// Per-user player level and per-trader loyalty levels, used by /metabuild
// to only recommend attachments the user can actually buy right now.
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

// `traderLevels`: { [traderId]: 1-4 }
function setProfile(userId, { playerLevel, traderLevels }) {
  const data = load();
  data[userId] = { playerLevel, traderLevels, confirmedAt: Date.now() };
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

// True once a profile has nothing left to gain from reconfirming — every
// tracked trader at max loyalty level and player level 30+. Once true, the
// daily reconfirm prompt stops appearing for that user permanently.
function isMaxed(profile) {
  if (!profile || profile.playerLevel < MAX_RELEVANT_PLAYER_LEVEL) return false;
  return TRADERS.every((t) => (profile.traderLevels?.[t.id] ?? 0) >= MAX_TRADER_LEVEL);
}

// True if we should prompt: no profile yet, or profile isn't maxed and
// hasn't been confirmed in the last 24h.
function needsPrompt(profile) {
  if (!profile) return true;
  if (isMaxed(profile)) return false;
  return Date.now() - profile.confirmedAt > RECONFIRM_INTERVAL_MS;
}

module.exports = {
  getProfile,
  setProfile,
  deleteProfile,
  isMaxed,
  needsPrompt,
  TRADERS,
  MAX_TRADER_LEVEL,
  MAX_RELEVANT_PLAYER_LEVEL,
};
