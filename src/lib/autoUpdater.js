// Polls the git remote every few minutes; if there are new commits, pulls
// them (fast-forward only — never touches local changes) and respawns the
// bot under the updated code. Requires the bot to actually be a git clone
// with an `origin` remote; if it isn't, checks are skipped with a log
// message rather than failing.
//
// `git fetch` against a small private repo is cheap enough that a 5-minute
// interval is no real load on either end — this is the sole update
// mechanism (no webhook), so the interval doubles as the worst-case deploy
// latency after a push.

const { execFile } = require('node:child_process');
const path = require('node:path');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REPO_ROOT = path.join(__dirname, '..', '..');
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: REPO_ROOT }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr?.trim() || error.message));
      resolve(stdout.trim());
    });
  });
}

async function isGitCheckoutWithRemote() {
  try {
    await run('git', ['rev-parse', '--is-inside-work-tree']);
    await run('git', ['remote', 'get-url', 'origin']);
    return true;
  } catch {
    return false;
  }
}

// Returns true if an update was pulled (caller should restart), false if
// already up to date.
async function checkAndPull() {
  await run('git', ['fetch', '--quiet', 'origin']);
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const local = await run('git', ['rev-parse', 'HEAD']);
  const remote = await run('git', ['rev-parse', `origin/${branch}`]);

  if (local === remote) {
    console.log('[auto-update] Already up to date.');
    return false;
  }

  console.log(`[auto-update] Update available (${local.slice(0, 7)} -> ${remote.slice(0, 7)}). Pulling...`);
  const changedFiles = (await run('git', ['diff', '--name-only', `${local}..${remote}`]))
    .split('\n')
    .filter(Boolean);

  await run('git', ['pull', '--ff-only', 'origin', branch]);

  if (changedFiles.includes('package.json') || changedFiles.includes('package-lock.json')) {
    console.log('[auto-update] Dependency manifest changed, running npm install...');
    await run(NPM_BIN, ['install']);
  }

  return true;
}

// Under systemd (which sets INVOCATION_ID for every unit it starts), don't
// self-spawn — a detached manual child would fall outside systemd's
// tracking entirely: a clean exit(0) under `Restart=on-failure` means
// systemd won't bring anything back, leaving an orphaned, unsupervised
// process running, and a later `systemctl restart` would then start a
// second instance alongside it (two bots on the same Discord token). The
// unit's `Restart=always` instead brings the *same* supervised process
// back after a plain exit, so just exit and let systemd do it.
//
// On hosts with no such supervisor (Railway, Wispbyte, manual `node`),
// nothing else would restart the process, so it still has to fork its own
// replacement before exiting.
function respawnSelf() {
  console.log('[auto-update] Restarting with updated code...');
  if (process.env.INVOCATION_ID) {
    process.exit(0);
  }
  const { spawn } = require('node:child_process');
  const child = spawn(process.argv[0], process.argv.slice(1), {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'inherit',
  });
  child.unref();
  process.exit(0);
}

// `onUpdateFound` is awaited before the process restarts, so callers can
// disconnect cleanly (e.g. destroy the Discord client) first.
function startAutoUpdateSchedule(onUpdateFound) {
  async function tick() {
    try {
      if (!(await isGitCheckoutWithRemote())) {
        console.log('[auto-update] Not a git checkout with an "origin" remote, skipping.');
        return;
      }
      const updated = await checkAndPull();
      if (updated) {
        await onUpdateFound();
        respawnSelf();
      }
    } catch (error) {
      console.error('[auto-update] Update check failed:', error.message);
    }
  }

  tick();
  return setInterval(tick, CHECK_INTERVAL_MS);
}

module.exports = { startAutoUpdateSchedule };
