const config = require('../config');

function hasTarkovAccess(member) {
  if (config.tarkovAccessUserIds.includes(member.id)) return true;
  if (!config.tarkovAccessRoleId) return false;
  return member.roles.cache.has(config.tarkovAccessRoleId);
}

module.exports = { hasTarkovAccess };
