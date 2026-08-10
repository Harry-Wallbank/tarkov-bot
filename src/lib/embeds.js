const { EmbedBuilder } = require('discord.js');

const COLOR = 0xb5121b;

// One consistent shape for every /tarkov and /metabuild result: title + link,
// a short key-details description, an optional image, and a source footer.
function buildInfoEmbed({ title, url, description, imageUrl, footer }) {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(title);
  if (url) embed.setURL(url);
  if (description) embed.setDescription(description);
  if (imageUrl) embed.setImage(imageUrl);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const breakAt = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '));
  return (breakAt > max * 0.5 ? cut.slice(0, breakAt + 1) : cut).trim() + '…';
}

module.exports = { buildInfoEmbed, truncate };
