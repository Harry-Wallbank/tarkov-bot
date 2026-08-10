// Looks up the official Escape from Tarkov Wiki (hosted on Fandom) via its
// public MediaWiki API. No API key required.

const WIKI_API = 'https://escapefromtarkov.fandom.com/api.php';
const WIKI_BASE = 'https://escapefromtarkov.fandom.com/wiki/';

function formatExtract(raw) {
  return raw
    .replace(/^==+\s*(.+?)\s*==+$/gm, '**$1**') // wikitext section headers -> bold
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Resolves `term` to the best-matching wiki page (following redirects, e.g.
// "M4A1" -> "Colt M4A1 5.56x45 assault rifle") and returns its text extract
// plus main image in a single request.
async function getWikiSummary(term) {
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', term);
  url.searchParams.set('gsrlimit', '1');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'extracts|pageimages');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('piprop', 'original');
  url.searchParams.set('format', 'json');

  const res = await fetch(url, { headers: { 'User-Agent': 'tarkov-discord-bot/1.0' } });
  if (!res.ok) {
    throw new Error(`Tarkov Wiki search returned HTTP ${res.status}`);
  }
  const json = await res.json();
  const pages = json?.query?.pages;
  if (!pages) return null;

  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;

  return {
    title: page.title,
    url: WIKI_BASE + encodeURIComponent(page.title.replace(/ /g, '_')),
    extract: page.extract ? formatExtract(page.extract) : null,
    imageUrl: page.original?.source || null,
  };
}

module.exports = { getWikiSummary };
