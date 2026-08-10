const { hasTarkovAccess } = require('./permissions');
const config = require('../config');

// Shared by /tarkov and /metabuild. Replies and returns false if the caller
// isn't allowed to use Tarkov lookups; otherwise returns true untouched.
async function ensureTarkovAccess(interaction) {
  if (hasTarkovAccess(interaction.member)) return true;

  if (!config.tarkovAccessRoleId && config.tarkovAccessUserIds.length === 0) {
    await interaction.reply({
      content: 'The Tarkov lookup feature is not configured yet. An admin needs to set `TARKOV_ACCESS_ROLE_ID` or `TARKOV_ACCESS_USER_IDS` and restart the bot.',
      ephemeral: true,
    });
  } else {
    await interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
  }
  return false;
}

module.exports = { ensureTarkovAccess };
