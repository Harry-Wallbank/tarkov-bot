const { SlashCommandBuilder } = require('discord.js');
const {
  getWeaponMetaBuild,
  searchWeaponNames,
  searchBuildWeaponQuestNames,
  getQuestBuildRequirement,
} = require('../lib/tarkovJsonApi');
const { getWikiSummary } = require('../lib/tarkovWiki');
const { buildInfoEmbed, truncate } = require('../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('metabuild')
    .setDescription('Greedy per-slot ergonomics/recoil optimizer for a weapon')
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt.setName('weapon').setDescription('Weapon name, e.g. M4A1').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('requirements')
        .setDescription('Comma-separated parts to force in, e.g. "suppressor, foregrip"')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('quest')
        .setDescription('Build for a specific Gunsmith-style quest requirement')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = focused.value || '';

    const choices =
      focused.name === 'quest' ? await searchBuildWeaponQuestNames(query) : await searchWeaponNames(query);

    await interaction.respond(choices.slice(0, 25).map((name) => ({ name: name.slice(0, 100), value: name.slice(0, 100) })));
  },

  async execute(interaction) {
    await interaction.deferReply();
    const weaponName = interaction.options.getString('weapon', true);
    const requirementsText = interaction.options.getString('requirements');
    const questName = interaction.options.getString('quest');

    try {
      let keywords = requirementsText
        ? requirementsText.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      let categoryIds = [];
      let questRequirement = null;

      if (questName) {
        questRequirement = await getQuestBuildRequirement(questName);
        if (!questRequirement) {
          await interaction.editReply(`Couldn't find a weapon-build requirement for a quest matching "${questName}".`);
          return;
        }
        if (questRequirement.weaponName && !namesRoughlyMatch(questRequirement.weaponName, weaponName)) {
          await interaction.editReply(
            `**${questRequirement.questName}** requires building the **${questRequirement.weaponName}**, not "${weaponName}". Re-run with \`weapon:${questRequirement.weaponName}\`.`
          );
          return;
        }
        categoryIds = questRequirement.requiredCategoryIds;
      }

      const weapon = await getWeaponMetaBuild(weaponName, { keywords, categoryIds });
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
        description: truncate(formatBuild(weapon.build, questRequirement), 3800),
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

function namesRoughlyMatch(a, b) {
  const compact = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ca = compact(a);
  const cb = compact(b);
  return ca.includes(cb) || cb.includes(ca);
}

function pct(modifier) {
  const percent = Math.round(modifier * -1000) / 10; // modifier is negative for a reduction
  const sign = percent >= 0 ? '-' : '+';
  return `${sign}${Math.abs(percent)}%`;
}

function signed(value) {
  const rounded = Math.round(value * 10) / 10;
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

function pctChange(before, after) {
  if (!before) return '0%';
  const percent = Math.round(((after - before) / before) * 1000) / 10;
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

function formatBuild(build, questRequirement) {
  const lines = ['**Meta build — Maximum Ergonomics**', '', '**Parts**'];

  for (const part of build.parts) {
    const flag = part.forced ? ' 🔧' : '';
    lines.push(`**${part.slotName}**: ${part.name} (${signed(part.ergonomics)} ergo, ${pct(part.recoilModifier)} recoil)${flag}`);
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

  const categoryNames = {};
  if (questRequirement) {
    questRequirement.requiredCategoryIds.forEach((id, i) => {
      categoryNames[id] = questRequirement.requiredCategoryNames[i];
    });
  }

  const { satisfied, unmetKeywords, unmetCategoryIds } = build.requirements;
  if (satisfied.length > 0 || unmetKeywords.length > 0 || unmetCategoryIds.length > 0) {
    lines.push('', '**Stipulations**');
    for (const req of satisfied) {
      const label = req.type === 'category' ? categoryNames[req.value] || req.value : `"${req.value}"`;
      lines.push(`✅ ${label} → ${req.itemName} (${req.slotName})`);
    }
    for (const kw of unmetKeywords) {
      lines.push(`❌ "${kw}" — no compatible slot found on this weapon`);
    }
    for (const catId of unmetCategoryIds) {
      lines.push(`❌ ${categoryNames[catId] || catId} — no compatible slot found on this weapon`);
    }
  }

  if (questRequirement) {
    lines.push('', `**Quest requirement: ${questRequirement.questName}**`);
    if (questRequirement.requiredCategoryNames.length > 0) {
      lines.push(`Must include: ${questRequirement.requiredCategoryNames.join(', ')}`);
    }
    const attrs = questRequirement.buildAttributes;
    const attrLines = Object.entries(attrs)
      .filter(([, attr]) => attr.value)
      .map(([key, attr]) => `${key} ${attr.compareMethod} ${attr.value}`);
    if (attrLines.length > 0) {
      lines.push(`Thresholds (not auto-verified — check in-game): ${attrLines.join(', ')}`);
    }
  }

  return lines.join('\n');
}
