// Normalizes an emoji (from a reaction or a raw user-typed string) into a
// stable string key: custom emoji use their snowflake id, unicode emoji use
// the character itself.
function emojiKey(emoji) {
  return emoji.id || emoji.name;
}

function parseEmojiInput(input) {
  const customMatch = input.match(/^<a?:\w+:(\d+)>$/);
  if (customMatch) return customMatch[1];
  return input;
}

module.exports = { emojiKey, parseEmojiInput };
