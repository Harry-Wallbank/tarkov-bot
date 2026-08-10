const { getMessageRoles } = require('../lib/reactionRoleStore');
const { emojiKey } = require('../lib/emoji');

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (user.bot) return;

    try {
      if (reaction.partial) await reaction.fetch();
    } catch (error) {
      console.error('Failed to fetch partial reaction:', error);
      return;
    }

    const mapping = getMessageRoles(reaction.message.id);
    if (!mapping) return;

    const roleId = mapping[emojiKey(reaction.emoji)];
    if (!roleId) return;

    try {
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id);
      const role = await guild.roles.fetch(roleId);
      if (!role) return;
      await member.roles.add(role, 'Reaction role');
    } catch (error) {
      console.error('Failed to add reaction role:', error);
    }
  },
};
