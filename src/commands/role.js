const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role from a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a role to a member')
        .addUserOption((opt) => opt.setName('user').setDescription('Member to update').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to add').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a role from a member')
        .addUserOption((opt) => opt.setName('user').setDescription('Member to update').setRequired(true))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to remove').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);

    const guild = interaction.guild;
    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: 'That user is not a member of this server.', ephemeral: true });
      return;
    }

    const botMember = await guild.members.fetchMe();
    if (role.position >= botMember.roles.highest.position) {
      await interaction.reply({
        content: `I can't manage **${role.name}** because it's positioned at or above my highest role. Move my role above it in Server Settings > Roles.`,
        ephemeral: true,
      });
      return;
    }

    try {
      if (sub === 'add') {
        await member.roles.add(role, `Added by ${interaction.user.tag} via /role add`);
        await interaction.reply({ content: `Added **${role.name}** to ${targetUser}.`, ephemeral: true });
      } else {
        await member.roles.remove(role, `Removed by ${interaction.user.tag} via /role remove`);
        await interaction.reply({ content: `Removed **${role.name}** from ${targetUser}.`, ephemeral: true });
      }
    } catch (error) {
      console.error('Failed to update member role:', error);
      await interaction.reply({ content: 'Failed to update that role. Check my permissions and role position.', ephemeral: true });
    }
  },
};
