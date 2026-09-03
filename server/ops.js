// The ops shelf: backups that happen by themselves, and a delivery record
// for the Stripe webhook so a dead endpoint shows up on the dashboard
// instead of in a customer complaint.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// ----------------------------------------------------------------- backups --
// A copy a day, kept for a week. This guards against the file-level accident
// — a corrupt write, an over-eager admin — not a lost disk: the snapshots
// live on the same volume as the originals. Off-site is the download button.
const BACKUP_KEEP_DAYS = 7;
const BACKUP_FILES = ['social.json', 'ledger.json', 'stats.json', 'bans.json', 'audit.json'];

/** Server-local calendar date, the same shape the daily reward keys on. */
function dayStamp(when = Date.now()) {
  const d = new Date(when);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let lastBackup = null; // { at, dir, copied } — this boot's most recent run

/** Copy today's data files into backup/YYYY-MM-DD/ and drop week-old days. */
export function runBackup(dataDir) {
  const root = path.join(dataDir, 'backup');
  const dir = path.join(root, dayStamp());
  try {
    fs.mkdirSync(dir, { recursive: true });
    let copied = 0;
    for (const name of BACKUP_FILES) {
      const src = path.join(dataDir, name);
      if (!fs.existsSync(src)) continue; // not written yet — nothing to keep
      fs.copyFileSync(src, path.join(dir, name));
      copied++;
    }
    // Rotation: the folder names sort as dates, so "older than a week" is
    // simply "not among the last seven names".
    const days = fs.readdirSync(root)
      .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
      .sort();
    for (const stale of days.slice(0, Math.max(0, days.length - BACKUP_KEEP_DAYS))) {
      fs.rmSync(path.join(root, stale), { recursive: true, force: true });
    }
    lastBackup = { at: Date.now(), dir, copied };
  } catch (err) {
    console.warn('backup: failed —', err.message);
  }
  return lastBackup;
}

/** One snapshot at boot, then one a day. The timer never keeps us alive. */
export function startBackups(dataDir) {
  runBackup(dataDir);
  const timer = setInterval(() => runBackup(dataDir), 24 * 60 * 60 * 1000);
  timer.unref?.();
}

/** What the System panel shows: when the last snapshot ran and where. */
export const backupInfo = () => lastBackup;

// tar is on every Linux box we deploy to; asked once, remembered forever.
let tarAvailable = null;
function hasTar() {
  if (tarAvailable == null) {
    try {
      tarAvailable = spawnSync('tar', ['--version']).status === 0;
    } catch {
      tarAvailable = false;
    }
  }
  return tarAvailable;
}

/**
 * Stream the live data dir to the operator's browser: a .tar.gz where the
 * box has tar (Render does), a single JSON bundle of the same files where it
 * doesn't — the download button must never 500 over a missing binary.
 */
export function streamDataBackup(res, dataDir) {
  let files = [];
  try {
    files = fs.readdirSync(dataDir, { withFileTypes: true })
      .filter((f) => f.isFile() && !f.name.startsWith('.'))
      .map((f) => f.name);
  } catch (err) {
    return res.status(500).json({ error: `Could not read the data dir: ${err.message}` });
  }
  if (!files.length) return res.status(404).json({ error: 'Nothing to back up yet' });

  const stamp = dayStamp();
  if (hasTar()) {
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="moneymove-data-${stamp}.tar.gz"`);
    const tar = spawn('tar', ['-czf', '-', '-C', dataDir, ...files]);
    tar.stdout.pipe(res);
    tar.stderr.on('data', (d) => console.warn('backup tar:', String(d).trim()));
    tar.on('error', (err) => {
      console.warn('backup tar failed —', err.message);
      res.end();
    });
    return;
  }

  // Fallback: one JSON object, filename -> contents. Everything in the data
  // dir is text, so utf8 round-trips it faithfully.
  const bundle = {};
  for (const name of files) {
    try {
      bundle[name] = fs.readFileSync(path.join(dataDir, name), 'utf8');
    } catch { /* vanished mid-read — skip it, keep the rest */ }
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="moneymove-data-${stamp}.json"`);
  res.send(JSON.stringify(bundle));
}

// ---------------------------------------------------------- webhook health --
// Stripe only ever talks to us over the webhook, so its silence is invisible
// until someone pays and gets nothing. Remember the last time it worked and
// the last time it didn't; the dashboard turns the comparison into a red
// strip. In memory for speed, on disk so a restart doesn't play innocent.
let health = { lastSuccess: null, lastFailure: null };
let healthFile = null;

export function initWebhookHealth(dataDir) {
  healthFile = path.join(dataDir, 'webhook-health.json');
  try {
    const raw = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    health = {
      lastSuccess: Number(raw.lastSuccess) || null,
      lastFailure: raw.lastFailure?.at ? { at: raw.lastFailure.at, reason: String(raw.lastFailure.reason || '') } : null,
    };
  } catch { /* no deliveries recorded yet */ }
}

function saveHealth() {
  if (!healthFile) return;
  try {
    fs.mkdirSync(path.dirname(healthFile), { recursive: true });
    fs.writeFileSync(healthFile, JSON.stringify(health));
  } catch (err) {
    console.warn('webhook health: could not persist —', err.message);
  }
}

/** Called once per delivery, right where the webhook route answers Stripe. */
export function noteWebhook(ok, reason) {
  if (ok) health.lastSuccess = Date.now();
  else health.lastFailure = { at: Date.now(), reason: String(reason || 'unknown').slice(0, 200) };
  saveHealth();
}

/** The System panel's read: both timestamps plus the one-bit verdict. */
export function webhookHealth() {
  const failing = !!health.lastFailure
    && (!health.lastSuccess || health.lastFailure.at > health.lastSuccess);
  return { lastSuccess: health.lastSuccess, lastFailure: health.lastFailure, failing };
}
