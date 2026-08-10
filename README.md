# Tarkov Discord Bot

A Discord bot (Node.js + discord.js v14) that:

- **Auto-roles** new members on join
- Lets admins **assign/remove roles** with `/role add` / `/role remove`
- Sets up **reaction-role** messages with `/reactionrole create` / `/reactionrole delete`
- Answers Escape from Tarkov questions with a single **`/tarkov <query>`** command
  (items, ammo, and quests, falling back to the wiki) plus a dedicated
  **`/metabuild <weapon>`** command, pulling live data from the public
  [Tarkov.dev](https://tarkov.dev) GraphQL API and the
  [Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com/) — but
  **only for an allowed role and/or an allowed list of user IDs** you designate

## 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy it (this is `DISCORD_TOKEN`). Never share it or commit it.
3. On the same **Bot** tab, enable the **Server Members Intent** (required for auto-role and `/role`). You do not need the Message Content intent.
4. **OAuth2 → General** → copy the **Application ID** (this is `CLIENT_ID`).
5. **OAuth2 → URL Generator**: scopes = `bot`, `applications.commands`. Bot permissions: `Manage Roles`, `Send Messages`, `Embed Links`, `Add Reactions`, `Read Message History`, `View Channels`. Open the generated URL and invite the bot to your server.
6. In Server Settings → Roles, drag the bot's role **above** every role you want it to manage (Discord requires this).

## 2. Configure

```bash
cp .env.example .env
```

Fill in:

- `DISCORD_TOKEN`, `CLIENT_ID` — from step 1
- `GUILD_ID` — your server's ID (right-click server icon → Copy Server ID, with Developer Mode on in Discord settings). Recommended during setup/testing so slash commands appear instantly instead of taking up to an hour to propagate globally.
- `AUTO_ROLE_ID` — role ID to grant automatically on join (optional; leave blank to disable)
- `TARKOV_ACCESS_ROLE_ID` and/or `TARKOV_ACCESS_USER_IDS` — **at least one is required for `/tarkov` and `/metabuild` to work at all.** `TARKOV_ACCESS_ROLE_ID` is a single role ID (e.g. a `Tarkov-Access` role); `TARKOV_ACCESS_USER_IDS` is a comma-separated list of individual user IDs who can always use the commands regardless of role. Everyone else gets a polite refusal. Leave both blank and the commands tell users they aren't configured yet.

## 3. Install and run

```bash
npm install
npm run deploy-commands   # registers the slash commands
npm start                 # logs the bot in
```

Re-run `deploy-commands` any time you add/change a command. If you remove `GUILD_ID` later for production, commands register globally and take up to ~1 hour to show up everywhere.

## Usage

- **Auto-role**: happens automatically on join, no command needed.
- **`/role add user:@Name role:@Role`** / **`/role remove ...`** — restricted to members with the *Manage Roles* permission.
- **`/reactionrole create title:"Pick your role" emoji1:🔫 role1:@PMC emoji2:🩹 role2:@Scav`** — posts an embed in the current (or chosen) channel; reacting adds the role, un-reacting removes it. Supports up to 5 emoji/role pairs. `/reactionrole delete message_id:<id>` stops tracking a message (also restricted to *Manage Roles*).
- **`/tarkov query:M4A1`** — one command for items, ammo, and quests. It tries, in order: item/ammo match (price or damage/penetration stats, with the item's image) → quest match (map, keys required, with a map screenshot) → Escape from Tarkov Wiki summary (article excerpt + image) as a fallback. Every result renders as the same style of embed: title linked to the source, a short key-details block, and an image.
- **`/metabuild weapon:M4A1`** — shows the weapon's default preset and its attachments/ergonomics/recoil, sourced from Tarkov.dev's preset data (this is the game's default/documented build, not a curated "meta" ranking — Tarkov.dev doesn't publish a meta tier list).

### Automatic fallback when Tarkov.dev's GraphQL API is down

`api.tarkov.dev`'s GraphQL endpoint has an active, ongoing outage (tracked at
[the-hideout/tarkov-api#474](https://github.com/the-hideout/tarkov-api/issues/474)).
Item/ammo lookups (`/tarkov`) and weapon presets (`/metabuild`) automatically
fall back to [`json.tarkov.dev`](https://json.tarkov.dev), a static dataset
dump that stayed up throughout the outage, when the GraphQL call fails —
see [`src/lib/tarkovData.js`](src/lib/tarkovData.js). The embed footer says
which source actually answered. Two caveats specific to the fallback:

- That dataset ships **untranslated** — raw item/task names are literal
  `"<id> Name"` placeholders. Display names are instead derived from each
  item's `wikiLink` or `normalizedName`, which are always real text
  ([`src/lib/tarkovJsonApi.js`](src/lib/tarkovJsonApi.js)).
- Search matching in the fallback is plain substring matching on
  `normalizedName` (no fuzzy ranking like the GraphQL API has), so an
  ambiguous single-word query can occasionally surface a weapon *part*
  ahead of the full weapon in `/tarkov` — `/metabuild` isn't affected since
  it filters specifically for weapons.

Quest search (`/tarkov` falling through to a quest match) has no JSON-API
equivalent — the static dump's task objectives/keys aren't cleanly
resolvable without the locale data GraphQL provides — so quest lookups only
use GraphQL and fall straight through to the wiki summary while the outage
persists.

## Notes / known limitations

- **I could not live-test the GraphQL query shapes against a healthy API** — `api.tarkov.dev` has been down for the entire time this bot was built (see the fallback section above). The GraphQL field names in [`src/lib/tarkovApi.js`](src/lib/tarkovApi.js) match the publicly documented schema, but if it's changed shape, you'll see the raw GraphQL error text in Discord (and in the console) rather than a silent failure — that error message tells you exactly which field to fix. The `json.tarkov.dev` fallback in [`src/lib/tarkovJsonApi.js`](src/lib/tarkovJsonApi.js), by contrast, **was** tested live against real responses.
- The Tarkov Wiki has no official API; `/tarkov wiki` uses Fandom's public MediaWiki search endpoint, which is unauthenticated and could change or rate-limit independently of Tarkov.dev.
- Reaction-role mappings are stored in `src/data/reactionRoles.json` (created automatically, git-ignored). Back it up if you move hosts.
- This is a single-process bot with no database — fine for one server; if you need it across many large servers, swap the JSON store for a real database.
