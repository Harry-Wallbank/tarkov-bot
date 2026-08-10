const { SlashCommandBuilder } = require('discord.js');
const { ensureTarkovAccess } = require('../lib/tarkovAccessGuard');
const { getWeaponMetaBuild } = require('../lib/tarkovJsonApi');
const { getWikiSummary } = require('../lib/tarkovWiki');
const { buildInfoEmbed, truncate } = require('../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('metabuild')
    .setDescription('Greedy per-slot ergonomics/recoil optimizer for a weapon')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('weapon').setDescription('Weapon name, e.g. M4A1').setRequired(true)),

  async execute(interaction) {
    if (!(await ensureTarkovAccess(interaction))) return;

    await interaction.deferReply();
    const weaponName = interaction.options.getString('weapon', true);

    try {
      const weapon = await getWeaponMetaBuild(weaponName);
      if (!weapon) {
        await interaction.editReply(`No weapon found matching "${weaponName}".`);
        return;
      }

      if (weapon.build.parts.length === 0) {
        const wikiSummary = await getWikiSummary(weaponName).catch(() => null);
        const wikiHint = wikiSummary ? `\nWiki page: ${wikiSummary.url}` : '';
        await interaction.editReply(`Found **${weapon.name}**, but no mod slot data is available to build a loadout right now.${wikiHint}`);
        return;
      }

      const embed = buildInfoEmbed({
        title: weapon.name,
        url: weapon.wikiLink,
        description: truncate(formatBuild(weapon.build), 3800),
        imageUrl: weapon.imageUrl,
        footer: 'Greedy per-slot optimizer over Tarkov.dev data. Optics omitted.',
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('/metabuild failed:', error);
      await interaction.editReply(`Couldn't fetch that right now (${error.message}). Try again shortly.`);
    }
  },
};

function pct(modifier) {
  const percent = Math.round(modifier * -1000) / 10; // modifier is negative for a reduction
  const sign = percent >= 0 ? '-' : '+';
  return `${sign}${Math.abs(percent)}%`;
}

function signed(value) {
  const rounded = Math.round(value * 10) / 10;
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

function formatBuild(build) {
  const lines = ['**Meta build — Maximum Ergonomics**', '', '**Parts**'];

  for (const part of build.parts) {
    lines.push(`**${part.slotName}**: ${part.name} (${signed(part.ergonomics)} ergo, ${pct(part.recoilModifier)} recoil)`);
  }

  lines.push(
    '',
    `**Ergonomics**\n${build.baseErgonomics} ➜ **${build.ergonomics}**`,
    '',
    `**Vertical Recoil**\n${build.baseRecoilVertical} ➜ **${build.recoilVertical}** (${pctChange(build.baseRecoilVertical, build.recoilVertical)})`,
    '',
    `**Horizontal Recoil**\n${build.baseRecoilHorizontal} ➜ **${build.recoilHorizontal}** (${pctChange(build.baseRecoilHorizontal, build.recoilHorizontal)})`,
    '',
    '**Estimated Cost (parts)**',
    `₽${build.totalCost.toLocaleString()} from traders`
  );

  if (build.magazine) {
    const jam = build.magazine.malfunctionChance != null ? `, ${Math.round(build.magazine.malfunctionChance * 100)}% jam` : '';
    lines.push('', '**Best Magazine**', `${build.magazine.name}`, `${build.magazine.capacity} rnd, ${signed(build.magazine.ergonomics)} ergo${jam}`);
  }

  return lines.join('\n');
}

function pctChange(before, after) {
  if (!before) return '0%';
  const percent = Math.round(((after - before) / before) * 1000) / 10;
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}
