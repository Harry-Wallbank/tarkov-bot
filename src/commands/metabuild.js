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
      pendingRequests.set(token, { weaponName, requirementsText, questName, partialProfile: {} });
      setTimeout(() => pendingRequests.delete(token), PENDING_TTL_MS);
      await interaction.showModal(buildProfileModal(0, token, profile));
      return;
    }

    await interaction.deferReply();
    await runBuild(interaction, weaponName, requirementsText, questName, profile);
  },

  async modalSubmit(interaction) {
    const match = interaction.customId.match(/^metabuild_profile(\d+):(.+)$/);
    if (!match) return;
    const page = Number(match[1]);
    const token = match[2];
    const pending = pendingRequests.get(token);

    if (!pending) {
      await interaction.reply({ content: 'That took too long — run `/metabuild` again.', ephemeral: true });
      return;
    }

    const chunk = TRADER_CHUNKS[page];
    if (page === 0) {
      const playerLevel = parseLevel(interaction.fields.getTextInputValue('playerLevel'), 1, 99);
      if (playerLevel === null) {
        pendingRequests.delete(token);
        await interaction.reply({ content: 'Player level must be a whole number between 1 and 99. Run `/metabuild` again.', ephemeral: true });
        return;
      }
      pending.partialProfile.playerLevel = playerLevel;
    }

    const traderLevels = pending.partialProfile.traderLevels || {};
    for (const trader of chunk) {
      const level = parseLevel(interaction.fields.getTextInputValue(trader.id), 1, profileStore.MAX_TRADER_LEVEL);
      if (level === null) {
        pendingRequests.delete(token);
        await interaction.reply({
          content: `${trader.name}'s level must be a whole number between 1 and ${profileStore.MAX_TRADER_LEVEL}. Run \`/metabuild\` again.`,
          ephemeral: true,
        });
        return;
      }
      traderLevels[trader.id] = level;
    }
    pending.partialProfile.traderLevels = traderLevels;

    if (page + 1 < TRADER_CHUNKS.length) {
      const existingProfile = profileStore.getProfile(interaction.user.id);
      await interaction.showModal(buildProfileModal(page + 1, token, existingProfile));
      return;
    }

    pendingRequests.delete(token);
    const profile = profileStore.setProfile(interaction.user.id, pending.partialProfile);

    await interaction.deferReply();
    await runBuild(interaction, pending.weaponName, pending.requirementsText, pending.questName, profile);
  },
};

// Discord modals cap at 5 text inputs, so the 8 traders + player level
// (9 fields total) are split across two chained modals: submitting page 0
// immediately shows page 1, then the profile is saved and the build runs.
const TRADER_CHUNKS = [profileStore.TRADERS.slice(0, 4), profileStore.TRADERS.slice(4)];

function parseLevel(rawValue, min, max) {
  const value = Number((rawValue || '').trim());
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function buildProfileModal(page, token, existingProfile) {
  const chunk = TRADER_CHUNKS[page];
  const rows = [];

  if (page === 0) {
    const playerLevelInput = new TextInputBuilder()
      .setCustomId('playerLevel')
      .setLabel('Your player level')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 25')
      .setMinLength(1)
      .setMaxLength(2)
      .setRequired(true);
    if (existingProfile) playerLevelInput.setValue(String(existingProfile.playerLevel));
    rows.push(new ActionRowBuilder().addComponents(playerLevelInput));
  }

  for (const trader of chunk) {
    const input = new TextInputBuilder()
      .setCustomId(trader.id)
      .setLabel(`${trader.name} level (1-${profileStore.MAX_TRADER_LEVEL})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 2')
      .setMinLength(1)
      .setMaxLength(1)
      .setRequired(true);
    const existingLevel = existingProfile?.traderLevels?.[trader.id];
    if (existingLevel) input.setValue(String(existingLevel));
    rows.push(new ActionRowBuilder().addComponents(input));
  }

  const title =
    TRADER_CHUNKS.length > 1
      ? `Tarkov profile (${page + 1}/${TRADER_CHUNKS.length})`
      : 'Set up your Tarkov profile';

  return new ModalBuilder().setCustomId(`metabuild_profile${page}:${token}`).setTitle(title).addComponents(...rows);
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
    const traderSummary = profileStore.TRADERS.map((t) => `${t.name} ${profile.traderLevels?.[t.id] ?? '?'}`).join(', ');
    lines.push(`Profile: Player Lvl ${profile.playerLevel} · ${traderSummary}`);
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
