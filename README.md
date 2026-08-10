# Tarkov Discord Bot

A Discord bot (Node.js + discord.js v14) that:

- **Auto-roles** new members on join
- Lets admins **assign/remove roles** with `/role add` / `/role remove`
- Sets up **reaction-role** messages with `/reactionrole create` / `/reactionrole delete`
- Answers Escape from Tarkov questions with a single **`/tarkov <query>`** command
  (items, ammo, and quests, falling back to the wiki), pulling live data from
  the public [Tarkov.dev](https://tarkov.dev) GraphQL API and the
  [Escape from Tarkov Wiki](https://escapefromtarkov.fandom.com/) — restricted
  to members with *Manage Roles* permission, an allowed role, and/or an
  allowed list of user IDs (managed via `/role tarkov-access`)
- Runs a **`/metabuild <weapon>`** loadout optimizer, open to everyone with no
  access restriction
- **Auto-updates itself daily** from this git repo (fast-forward pull + restart) so
  self-hosted instances stay current without manual redeploys

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
- `TARKOV_ACCESS_ROLE_ID` and/or `TARKOV_ACCESS_USER_IDS` — optional baseline access for `/tarkov`. `TARKOV_ACCESS_ROLE_ID` is a single role ID (e.g. a `Tarkov-Access` role); `TARKOV_ACCESS_USER_IDS` is a comma-separated list of individual user IDs. Neither is required, since anyone with *Manage Roles* permission always has `/tarkov` access regardless — see [Managing `/tarkov` access](#managing-tarkov-access) below for granting it to others without editing `.env`. `/metabuild` has no access restriction at all.

## 3. Install and run

```bash
npm install
npm run deploy-commands   # registers the slash commands
npm start                 # logs the bot in
```

Re-run `deploy-commands` any time you add/change a command. If you remove `GUILD_ID` later for production, commands register globally and take up to ~1 hour to show up everywhere.

**Deploy via `git clone`, not a zip download** — the auto-updater (below) needs a real git checkout with an `origin` remote to work.

### Staying up to date automatically

Once a day, the bot fetches this repo, and if `origin`'s branch has moved,
it pulls (fast-forward only — it never touches local files, and refuses if
your checkout has conflicting local edits to a tracked file), reinstalls
dependencies if `package.json`/`package-lock.json` changed, then restarts
itself with the new code. See [`src/lib/autoUpdater.js`](src/lib/autoUpdater.js).

- Requires `git` on `PATH` and the working directory to be a real git clone with an `origin` remote — if it isn't, the check just logs a message and does nothing.
- Set `AUTO_UPDATE=false` in `.env` to disable it entirely (e.g. if you maintain a fork with local patches).
- If you run the bot under a process manager (pm2, a systemd service, Docker with `restart: always`, etc.), the self-respawn plays nicely with it. If you just run `npm start` in a terminal, the bot restarts itself in-place — no supervisor required.

## Usage

- **Auto-role**: happens automatically on join, no command needed.
- **`/role add user:@Name role:@Role`** / **`/role remove ...`** — restricted to members with the *Manage Roles* permission.
- **`/reactionrole create title:"Pick your role" emoji1:🔫 role1:@PMC emoji2:🩹 role2:@Scav`** — posts an embed in the current (or chosen) channel; reacting adds the role, un-reacting removes it. Supports up to 5 emoji/role pairs. `/reactionrole delete message_id:<id>` stops tracking a message (also restricted to *Manage Roles*).
- **`/tarkov query:M4A1`** — one command for items, ammo, and quests. It tries, in order: item/ammo match (price or damage/penetration stats, with the item's image) → quest match (map, keys required, with a map screenshot) → Escape from Tarkov Wiki summary (article excerpt + image) as a fallback. Every result renders as the same style of embed: title linked to the source, a short key-details block, and an image. Restricted — see [Managing `/tarkov` access](#managing-tarkov-access).
- **`/metabuild weapon:M4A1`** — a greedy per-slot loadout optimizer, not just the default preset, **open to all members with no access restriction**. For every mod slot on the weapon (recursing into whatever sub-slots the chosen mod itself exposes — e.g. a barrel's muzzle thread, then that muzzle device's own sub-slots), it picks whichever allowed part gives the best combined ergonomics + recoil-reduction score, then reports the full parts list, before/after ergonomics and recoil, total cost from traders, and a magazine pick balanced for capacity vs. reliability (not just "biggest mag wins"). Optic slots are skipped — scope choice is subjective and isn't meaningfully captured by ergo/recoil stats. See [`src/lib/metaBuildOptimizer.js`](src/lib/metaBuildOptimizer.js). This is **not** Tarkov.dev's own data or a community-curated meta ranking — it's this bot's own greedy heuristic over Tarkov.dev's item stats, which the embed footer says explicitly.
  - The `weapon` option **autocompletes** as you type (matches weapon names from the live item dataset), so you don't need the exact in-game name.
  - `requirements:"suppressor, foregrip"` — an optional comma-separated stipulation. Before the greedy pass runs, the optimizer forces in the first compatible part it finds matching each term (substring match against the item's name), then greedy-optimizes everything else normally. Forced parts are marked with 🔧, and a **Stipulations** section reports which terms were satisfied and which had no compatible slot on that weapon.
  - `quest:"Gunsmith - Part 1"` — also autocompletes, listing every quest with a weapon-build objective. Resolves the quest's required base weapon (errors out with the correct name if it doesn't match what you typed in `weapon`), forces in a part from its required attachment category the same way `requirements` does, and prints the quest's raw numeric thresholds (ergonomics/recoil/etc.) for you to check — those thresholds are **shown, not verified**, since the in-game pass/fail formula isn't something this data reliably exposes; see [`src/lib/tarkovJsonApi.js`](src/lib/tarkovJsonApi.js)'s `getQuestBuildRequirement`.

### Managing `/tarkov` access

Three things grant access to `/tarkov`, checked in this order by [`src/lib/permissions.js`](src/lib/permissions.js):

1. **Manage Roles permission** — anyone who can already use `/role` and `/reactionrole` automatically has `/tarkov` access too. This can't be revoked from within the bot; it follows the member's server permissions.
2. **The static `.env` config** — `TARKOV_ACCESS_ROLE_ID` and/or `TARKOV_ACCESS_USER_IDS`, set once and requiring a restart to change.
3. **Dynamic grants**, managed live with no restart needed:
   - `/role tarkov-access add role:@SomeRole` and/or `user:@SomeUser` — grants access (either or both in one call)
   - `/role tarkov-access remove role:@SomeRole` and/or `user:@SomeUser` — revokes it
   - `/role tarkov-access list` — shows everything currently granted this way

Dynamic grants are stored in `src/data/tarkovAccess.json` (created automatically, git-ignored — same pattern as the reaction-role store). All three `tarkov-access` subcommands are gated by the same *Manage Roles* permission as the rest of `/role`.

### Automatic fallback when Tarkov.dev's GraphQL API is down

`api.tarkov.dev`'s GraphQL endpoint has an active, ongoing outage (tracked at
[the-hideout/tarkov-api#474](https://github.com/the-hideout/tarkov-api/issues/474)).
Item/ammo lookups (`/tarkov`) automatically fall back to
[`json.tarkov.dev`](https://json.tarkov.dev), a static dataset dump that
stayed up throughout the outage, when the GraphQL call fails — see
[`src/lib/tarkovData.js`](src/lib/tarkovData.js). The embed footer says
which source actually answered.

Rather than retrying a known-dead API on every single command,
[`src/lib/tarkovApiHealth.js`](src/lib/tarkovApiHealth.js) checks GraphQL
once a day (and immediately the moment any live request fails) and caches
the result. Once GraphQL is marked down, every command skips straight to
the JSON fallback (or fails fast for quest search, which has no fallback)
for the rest of that day — it only tries GraphQL again on the next daily
check, not the instant the API might recover. That's a deliberate tradeoff
for simplicity: if `api.tarkov.dev` comes back mid-day, the bot won't
notice until the next check, up to 24h later.

Two caveats specific to the fallback:

- That dataset ships **untranslated** — raw item/task names are literal
  `"<id> Name"` placeholders. Display names are instead derived from each
  item's `wikiLink` or `normalizedName`, which are always real text
  ([`src/lib/tarkovJsonApi.js`](src/lib/tarkovJsonApi.js)).
- Search matching in the fallback is plain substring matching on
  `normalizedName` (no fuzzy ranking like the GraphQL API has), so an
  ambiguous single-word query can occasionally surface a weapon *part*
  ahead of the full weapon in `/tarkov`.

Quest search (`/tarkov` falling through to a quest match) has no JSON-API
equivalent — the static dump's task objectives/keys aren't cleanly
resolvable without the locale data GraphQL provides — so quest lookups only
use GraphQL and fall straight through to the wiki summary while the outage
persists.

`/metabuild`'s optimizer is a special case: it **only** uses the
`json.tarkov.dev` dataset, regardless of whether GraphQL is up. Recursively
walking nested mod slot trees needs a query shape nobody could verify while
`api.tarkov.dev` has been down for this project's entire build — rather than
ship an untested GraphQL query for something this involved, `/metabuild`
sticks to the one data source that's actually been exercised against real
responses.

## Notes / known limitations

- **I could not live-test the GraphQL query shapes against a healthy API** — `api.tarkov.dev` has been down for the entire time this bot was built (see the fallback section above). The GraphQL field names in [`src/lib/tarkovApi.js`](src/lib/tarkovApi.js) match the publicly documented schema, but if it's changed shape, you'll see the raw GraphQL error text in Discord (and in the console) rather than a silent failure — that error message tells you exactly which field to fix. The `json.tarkov.dev` fallback in [`src/lib/tarkovJsonApi.js`](src/lib/tarkovJsonApi.js), by contrast, **was** tested live against real responses.
- The Tarkov Wiki has no official API; `/tarkov wiki` uses Fandom's public MediaWiki search endpoint, which is unauthenticated and could change or rate-limit independently of Tarkov.dev.
- Reaction-role mappings (`src/data/reactionRoles.json`) and dynamic `/tarkov` access grants (`src/data/tarkovAccess.json`) are both created automatically and git-ignored. Back them up if you move hosts.
- This is a single-process bot with no database — fine for one server; if you need it across many large servers, swap the JSON store for a real database.
