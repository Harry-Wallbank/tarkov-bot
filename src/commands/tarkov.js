const { SlashCommandBuilder } = require('discord.js');
const { ensureTarkovAccess } = require('../lib/tarkovAccessGuard');
const tarkovData = require('../lib/tarkovData');
const { getWikiSummary } = require('../lib/tarkovWiki');
const { buildInfoEmbed, truncate } = require('../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tarkov')
    .setDescription('Look up an EFT item, ammo, or quest (falls back to the wiki)')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('query').setDescription('Item, ammo, or quest name').setRequired(true)),

  async execute(interaction) {
    if (!(await ensureTarkovAccess(interaction))) return;

    await interaction.deferReply();
    const query = interaction.options.getString('query', true);

    try {
      const embed = await resolveQuery(query);
      if (!embed) {
        await interaction.editReply(`Couldn't find an item, ammo, quest, or wiki page matching "${query}".`);
        return;
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('/tarkov failed:', error);
      await interaction.editReply(`Something went wrong looking that up (${error.message}). Try again shortly.`);
    }
  },
};

async function resolveQuery(query) {
  const items = await tarkovData.searchItem(query).catch((error) => {
    console.error('/tarkov item search failed on both sources:', error);
    return { result: [], source: null };
  });
  if (items.result.length > 0) return buildItemEmbed(items.result[0], items.source);

  const tasks = await tarkovData.searchTasks(query).catch((error) => {
    console.error('/tarkov task search failed:', error);
    return { result: [], source: null };
  });
  if (tasks.result.length > 0) return buildQuestEmbed(tasks.result[0], tasks.source);

  const wiki = await getWikiSummary(query).catch((error) => {
    console.error('/tarkov wiki search failed:', error);
    return null;
  });
  if (wiki) return buildWikiEmbed(wiki);

  return null;
}

function buildItemEmbed(item, source) {
  const description = item.ammo
    ? [
        `**Caliber:** ${item.ammo.caliber ?? 'Unknown'}`,
        `**Damage:** ${item.ammo.damage ?? 'Unknown'}`,
        `**Penetration:** ${item.ammo.penetrationPower ?? 'Unknown'}`,
        `**Armor damage:** ${item.ammo.armorDamage != null ? `${item.ammo.armorDamage}%` : 'Unknown'}`,
      ].join('\n')
    : [
        `**Base price:** ${item.basePrice != null ? `${item.basePrice}₽` : 'Unknown'}`,
        `**Flea avg (24h):** ${item.avg24hPrice != null ? `${item.avg24hPrice}₽` : 'N/A'}`,
        `**Best trader sell:** ${item.bestSell ? `${item.bestSell.price}₽${item.bestSell.vendorName ? ` (${item.bestSell.vendorName})` : ''}` : 'N/A'}`,
      ].join('\n');

  return buildInfoEmbed({
    title: item.name,
    url: item.wikiLink,
    description,
    imageUrl: item.imageUrl,
    footer: `Source: ${source}`,
  });
}

async function buildQuestEmbed(task, source) {
  const keysRequired = task.keysRequired.length > 0 ? task.keysRequired.join(', ') : 'None';
  const description = [`**Map:** ${task.map ?? 'Any'}`, `**Keys required:** ${keysRequired}`].join('\n');

  const mapImage = task.map
    ? await getWikiSummary(task.map).then((w) => w?.imageUrl || null).catch(() => null)
    : null;

  return buildInfoEmbed({
    title: task.name,
    url: task.wikiLink,
    description,
    imageUrl: mapImage,
    footer: `Source: ${source}`,
  });
}

function buildWikiEmbed(wiki) {
  return buildInfoEmbed({
    title: wiki.title,
    url: wiki.url,
    description: wiki.extract ? truncate(wiki.extract, 1800) : 'No summary available for this page.',
    imageUrl: wiki.imageUrl,
    footer: 'Source: Escape from Tarkov Wiki (Fandom)',
  });
}
