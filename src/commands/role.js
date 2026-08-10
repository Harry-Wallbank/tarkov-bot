const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const tarkovAccessStore = require('../lib/tarkovAccessStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role from a member, or manage who can use /tarkov')
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
    )
    .addSubcommandGroup((group) =>
      group
        .setName('tarkov-access')
        .setDescription('Grant or revoke access to /tarkov (Manage Roles members always have access)')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Grant a role and/or user access to /tarkov')
            .addRoleOption((opt) => opt.setName('role').setDescription('Role to grant access to'))
            .addUserOption((opt) => opt.setName('user').setDescription('User to grant access to'))
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription("Revoke a role and/or user's access to /tarkov")
            .addRoleOption((opt) => opt.setName('role').setDescription('Role to revoke access from'))
            .addUserOption((opt) => opt.setName('user').setDescription('User to revoke access from'))
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List everyone granted /tarkov access'))
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommandGroup(false) === 'tarkov-access') {
      await handleTarkovAccess(interaction);
      return;
    }

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

async function handleTarkovAccess(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const { roleIds, userIds } = tarkovAccessStore.getAll();
    const roleMentions = roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(', ') : 'None';
    const userMentions = userIds.length ? userIds.map((id) => `<@${id}>`).join(', ') : 'None';
    await interaction.reply({
      content: `**Roles granted /tarkov access:** ${roleMentions}\n**Users granted /tarkov access:** ${userMentions}\n\n(Anyone with Manage Roles permission always has access, regardless of this list.)`,
      ephemeral: true,
    });
    return;
  }

  const role = interaction.options.getRole('role');
  const user = interaction.options.getUser('user');
  if (!role && !user) {
    await interaction.reply({ content: 'Specify a role and/or a user to grant or revoke.', ephemeral: true });
    return;
  }

  const targets = [role ? `${role}` : null, user ? `${user}` : null].filter(Boolean).join(' and ');

  if (sub === 'add') {
    if (role) tarkovAccessStore.addRole(role.id);
    if (user) tarkovAccessStore.addUser(user.id);
    await interaction.reply({ content: `Granted /tarkov access to ${targets}.`, ephemeral: true });
    return;
  }

  if (role) tarkovAccessStore.removeRole(role.id);
  if (user) tarkovAccessStore.removeUser(user.id);
  await interaction.reply({ content: `Revoked /tarkov access from ${targets}.`, ephemeral: true });
}
