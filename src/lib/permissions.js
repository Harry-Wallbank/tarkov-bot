const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const tarkovAccessStore = require('./tarkovAccessStore');

// Anyone who can manage roles (i.e. can already use /role and
// /reactionrole) automatically gets /tarkov access too. Beyond that, access
// comes from the static TARKOV_ACCESS_ROLE_ID / TARKOV_ACCESS_USER_IDS env
// vars, plus whatever's been granted dynamically via /role tarkov-access.
function hasTarkovAccess(member) {
  if (member.permissions.has(PermissionFlagsBits.ManageRoles)) return true;

  if (config.tarkovAccessUserIds.includes(member.id)) return true;
  if (config.tarkovAccessRoleId && member.roles.cache.has(config.tarkovAccessRoleId)) return true;

  const granted = tarkovAccessStore.getAll();
  if (granted.userIds.includes(member.id)) return true;
  if (granted.roleIds.some((roleId) => member.roles.cache.has(roleId))) return true;

  return false;
}

module.exports = { hasTarkovAccess };
