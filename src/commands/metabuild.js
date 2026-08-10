const { SlashCommandBuilder } = require('discord.js');
const { ensureTarkovAccess } = require('../lib/tarkovAccessGuard');
const tarkovData = require('../lib/tarkovData');
const { getWikiSummary } = require('../lib/tarkovWiki');
const { buildInfoEmbed } = require('../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('metabuild')
    .setDescription("Show a weapon's default/preset loadout and attachments")
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('weapon').setDescription('Weapon name, e.g. M4A1').setRequired(true)),

  async execute(interaction) {
    if (!(await ensureTarkovAccess(interaction))) return;

    await interaction.deferReply();
    const weaponName = interaction.options.getString('weapon', true);

    try {
      const { result: weapon, source } = await tarkovData.getWeaponWithPresets(weaponName);
      if (!weapon) {
        await interaction.editReply(`No weapon found matching "${weaponName}".`);
        return;
      }

      if (!weapon.preset) {
        const wikiSummary = await getWikiSummary(weaponName).catch(() => null);
        const wikiHint = wikiSummary ? `\nWiki page: ${wikiSummary.url}` : '';
        await interaction.editReply(`Found **${weapon.name}**, but no preset/build data is available for it right now.${wikiHint}`);
        return;
      }

      const attachments = weapon.preset.attachments.length
        ? weapon.preset.attachments.map((a) => `• ${a.name}${a.count > 1 ? ` x${a.count}` : ''}`).join('\n')
        : 'No attachment breakdown available.';

      const description = [
        `**Ergonomics:** ${weapon.preset.ergonomics ?? '?'}`,
        `**Recoil (V/H):** ${weapon.preset.recoilVertical ?? '?'} / ${weapon.preset.recoilHorizontal ?? '?'}`,
        '',
        '**Attachments:**',
        attachments,
      ]
        .join('\n')
        .slice(0, 3500);

      const embed = buildInfoEmbed({
        title: `${weapon.name} — ${weapon.preset.name || 'Default build'}`,
        url: weapon.wikiLink,
        description,
        imageUrl: weapon.preset.imageUrl || weapon.imageUrl,
        footer: `Source: ${source} (default preset, not a curated community meta ranking)`,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('/metabuild failed on both sources:', error);
      await interaction.editReply(`Couldn't fetch that right now (${error.message}). Try again shortly.`);
    }
  },
};
