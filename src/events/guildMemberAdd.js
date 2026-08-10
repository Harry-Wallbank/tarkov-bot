const config = require('../config');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    if (!config.autoRoleId) return;

    try {
      const role = await member.guild.roles.fetch(config.autoRoleId);
      if (!role) {
        console.warn(`AUTO_ROLE_ID ${config.autoRoleId} was not found in guild ${member.guild.id}`);
        return;
      }
      await member.roles.add(role, 'Auto-role on join');
    } catch (error) {
      console.error(`Failed to assign auto-role to ${member.user.tag}:`, error);
    }
  },
};
