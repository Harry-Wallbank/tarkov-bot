// Shared modal-building/parsing logic for collecting a Tarkov profile
// (player level + per-trader levels) — used by both /metabuild's setup
// prompt and /updatetrader's on-demand update, so the two stay consistent.
//
// Discord modals cap at 5 text inputs, and player level + all 8 tracked
// traders is 9 fields, so the flow is two chained modals: submitting page 0
// (player level + first 4 traders) immediately shows page 1 (remaining 4).

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const profileStore = require('./tarkovProfileStore');

const TRADER_CHUNKS = [profileStore.TRADERS.slice(0, 4), profileStore.TRADERS.slice(4)];

function parseLevel(rawValue, min, max) {
  const value = Number((rawValue || '').trim());
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

// `commandName` becomes the modal's customId prefix (e.g. "metabuild" or
// "updatetrader") so interactionCreate.js's generic `${command.data.name}_`
// dispatch routes the submission back to the right command.
function buildProfileModal(commandName, page, token, existingProfile) {
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

  const title = TRADER_CHUNKS.length > 1 ? `Tarkov profile (${page + 1}/${TRADER_CHUNKS.length})` : 'Set up your Tarkov profile';

  return new ModalBuilder().setCustomId(`${commandName}_profile${page}:${token}`).setTitle(title).addComponents(...rows);
}

module.exports = { TRADER_CHUNKS, parseLevel, buildProfileModal };
