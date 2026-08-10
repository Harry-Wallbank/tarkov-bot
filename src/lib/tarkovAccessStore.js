const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'tarkovAccess.json');

// Dynamic grants added via /role tarkov-access, on top of the static
// TARKOV_ACCESS_ROLE_ID / TARKOV_ACCESS_USER_IDS env vars — see
// permissions.js, which merges both. Anyone with Manage Roles always has
// access regardless of what's stored here.
function load() {
  if (!fs.existsSync(storePath)) return { roleIds: [], userIds: [] };
  try {
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return { roleIds: data.roleIds || [], userIds: data.userIds || [] };
  } catch (error) {
    console.error('Failed to read tarkovAccess.json, starting fresh:', error);
    return { roleIds: [], userIds: [] };
  }
}

function save(data) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

function addRole(roleId) {
  const data = load();
  if (!data.roleIds.includes(roleId)) data.roleIds.push(roleId);
  save(data);
}

function removeRole(roleId) {
  const data = load();
  data.roleIds = data.roleIds.filter((id) => id !== roleId);
  save(data);
}

function addUser(userId) {
  const data = load();
  if (!data.userIds.includes(userId)) data.userIds.push(userId);
  save(data);
}

function removeUser(userId) {
  const data = load();
  data.userIds = data.userIds.filter((id) => id !== userId);
  save(data);
}

function getAll() {
  return load();
}

module.exports = { addRole, removeRole, addUser, removeUser, getAll };
