require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: process.env.GUILD_ID || null,
  autoRoleId: process.env.AUTO_ROLE_ID || null,
  tarkovAccessRoleId: process.env.TARKOV_ACCESS_ROLE_ID || null,
  tarkovAccessUserIds: (process.env.TARKOV_ACCESS_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  autoUpdateEnabled: process.env.AUTO_UPDATE !== 'false',
};
