const { hasTarkovAccess } = require('./permissions');

// Used by /tarkov (not /metabuild, which is open to everyone). Replies and
// returns false if the caller isn't allowed; otherwise returns true
// untouched. See permissions.js for who counts as allowed.
async function ensureTarkovAccess(interaction) {
  if (hasTarkovAccess(interaction.member)) return true;

  await interaction.reply({
    content: "You don't have permission to use this command. Ask a server admin to grant you access with `/role tarkov-access add`.",
    ephemeral: true,
  });
  return false;
}

module.exports = { ensureTarkovAccess };
