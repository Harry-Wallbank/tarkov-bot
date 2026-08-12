const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const {
  getWeaponMetaBuild,
  searchWeaponNames,
  searchBuildWeaponQuestNames,
  getQuestBuildRequirement,
} = require('../lib/tarkovJsonApi');
const { getWikiSummary } = require('../lib/tarkovWiki');
const { buildInfoEmbed, truncate } = require('../lib/embeds');
const profileStore = require('../lib/tarkovProfileStore');

// Command args stashed here while a profile modal is open, keyed by a
// short-lived token embedded in the modal's customId. In-memory only —
// if the bot restarts before someone submits the modal, they just get a
// "run /metabuild again" message, which is an acceptable trade-off for not
// persisting throwaway state to disk.
const pendingRequests = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

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
    const weaponName = interaction.options.getString('weapon', true);
    const requirementsText = interaction.options.getString('requirements');
    const questName = interaction.options.getString('quest');

    const profile = profileStore.getProfile(interaction.user.id);
    if (profileStore.needsPrompt(profile)) {
      const token = `${interaction.user.id}-${Date.now()}`;
      pendingRequests.set(token, { weaponName, requirementsText, questName });
      setTimeout(() => pendingRequests.delete(token), PENDING_TTL_MS);
      await interaction.showModal(buildProfileModal(token, profile));
      return;
    }

    await interaction.deferReply();
    await runBuild(interaction, weaponName, requirementsText, questName, profile);
  },

  async modalSubmit(interaction) {
    if (!interaction.customId.startsWith('metabuild_profile:')) return;
    const token = interaction.customId.slice('metabuild_profile:'.length);
    const pending = pendingRequests.get(token);
    pendingRequests.delete(token);

    if (!pending) {
      await interaction.reply({ content: 'That took too long — run `/metabuild` again.', ephemeral: true });
      return;
    }

    const playerLevel = Number(interaction.fields.getTextInputValue('playerLevel').trim());
    const traderLevel = Number(interaction.fields.getTextInputValue('traderLevel').trim());

    if (!Number.isInteger(playerLevel) || playerLevel < 1 || playerLevel > 99) {
      await interaction.reply({ content: 'Player level must be a whole number between 1 and 99.', ephemeral: true });
      return;
    }
    if (!Number.isInteger(traderLevel) || traderLevel < 1 || traderLevel > profileStore.MAX_TRADER_LEVEL) {
      await interaction.reply({ content: `Trader level must be a whole number between 1 and ${profileStore.MAX_TRADER_LEVEL}.`, ephemeral: true });
      return;
    }

    const profile = profileStore.setProfile(interaction.user.id, { playerLevel, traderLevel });

    await interaction.deferReply();
    await runBuild(interaction, pending.weaponName, pending.requirementsText, pending.questName, profile);
  },
};

function buildProfileModal(token, existingProfile) {
  const playerLevelInput = new TextInputBuilder()
    .setCustomId('playerLevel')
    .setLabel('Your player level')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 25')
    .setMinLength(1)
    .setMaxLength(2)
    .setRequired(true);
  const traderLevelInput = new TextInputBuilder()
    .setCustomId('traderLevel')
    .setLabel(`Your overall trader level (1-${profileStore.MAX_TRADER_LEVEL})`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. 2')
    .setMinLength(1)
    .setMaxLength(1)
    .setRequired(true);

  if (existingProfile) {
    playerLevelInput.setValue(String(existingProfile.playerLevel));
    traderLevelInput.setValue(String(existingProfile.traderLevel));
  }

  return new ModalBuilder()
    .setCustomId(`metabuild_profile:${token}`)
    .setTitle(existingProfile ? 'Confirm your Tarkov profile' : 'Set up your Tarkov profile')
    .addComponents(
      new ActionRowBuilder().addComponents(playerLevelInput),
      new ActionRowBuilder().addComponents(traderLevelInput)
    );
}

async function runBuild(interaction, weaponName, requirementsText, questName, profile) {
  try {
    const keywords = requirementsText ? requirementsText.split(',').map((s) => s.trim()).filter(Boolean) : [];
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

    const weapon = await getWeaponMetaBuild(weaponName, { keywords, categoryIds, profile });
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
      description: truncate(formatBuild(weapon.build, questRequirement, profile), 3800),
      imageUrl: weapon.imageUrl,
      footer: 'Greedy per-slot optimizer over Tarkov.dev data. Required slots + stock/foregrip only. 🔒 = not yet available at your levels. Image is the closest existing preset match, not a custom render.',
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('/metabuild failed:', error);
    await interaction.editReply(`Couldn't fetch that right now (${error.message}). Try again shortly.`);
  }
}

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

function formatBuild(build, questRequirement, profile) {
  const lines = ['**Meta build — Maximum Ergonomics**'];
  if (profile) {
    lines.push(`Profile: Player Lvl ${profile.playerLevel} · Trader Lvl ${profile.traderLevel}`);
  }
  lines.push('', '**Parts**');

  for (const part of build.parts) {
    const flags = `${part.forced ? ' 🔧' : ''}${part.locked ? ' 🔒' : ''}`;
    lines.push(`**${part.slotName}**: ${part.name} (${signed(part.ergonomics)} ergo, ${pct(part.recoilModifier)} recoil)${flags}`);
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
    const lockedFlag = build.magazine.locked ? ' 🔒' : '';
    lines.push('', '**Best Magazine**', `${build.magazine.name}${lockedFlag}`, `${build.magazine.capacity} rnd, ${signed(build.magazine.ergonomics)} ergo${jam}`);
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
