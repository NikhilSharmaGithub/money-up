// Writing and reading the JSON files that hold everything that outlives a
// process: wallets, the ledger, the cups, the bans.
//
// Two rules, both learned the expensive way elsewhere (appleid.js has always
// written its queue like this):
//
// A file is written beside itself and renamed into place. writeFileSync
// truncates first and writes second, so a process killed in between — a
// deploy's SIGTERM, the OOM killer, a full disk — left an empty or half
// written file where every wallet used to be. A rename is all or nothing.
//
// A file that is there but cannot be read is not a first run. Treating it as
// one started the server with nobody's coins, and the very next save wrote
// that emptiness over the only copy anyone had. So the broken file is set
// aside under a name nothing will overwrite, said out loud in the log, and
// the newest copy in the daily backups that does parse is put back in its
// place — on disk, not only in memory.

import fs from 'node:fs';
import path from 'node:path';

/** Write `text` to `file` so that a reader only ever sees the old or the new. */
export function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** The newest backup/<day>/<name> that parses, newest day first. */
function newestBackup(file) {
  const root = path.join(path.dirname(file), 'backup');
  const name = path.basename(file);
  let days = [];
  try {
    days = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  } catch { return null; }
  for (const day of days) {
    const from = path.join(root, day, name);
    try {
      return { from, data: JSON.parse(fs.readFileSync(from, 'utf8')) };
    } catch { /* missing or broken too — try the day before */ }
  }
  return null;
}

/**
 * Put the newest good backup back in `file`'s place, on disk as well as in
 * memory: a restore held only in memory is undone by a restart before the
 * first save, which finds no file, reads that as a first run, and starts
 * every wallet at nothing.
 */
function restoreFromBackup(file) {
  const name = path.basename(file);
  const backup = newestBackup(file);
  if (!backup) {
    console.error(`storage: no readable backup of ${name} — starting it empty`);
    return null;
  }
  try {
    writeFileAtomic(file, fs.readFileSync(backup.from));
    console.error(`storage: restored ${name} from ${backup.from}`);
  } catch (err) {
    console.error(`storage: using ${backup.from} for ${name}, but could not write it back (${err.code || err.message})`);
  }
  return backup.data;
}

/**
 * Read a JSON store. Null when there is nothing to read — a first run, or a
 * file that is broken with no good backup behind it. A broken file is never
 * left where the next save would overwrite it.
 */
export function readJsonStore(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    // It may be a good file, newer than any backup, that could not be opened
    // just now. Set aside like a broken one, so no save renames over it; if
    // even that fails, refuse to start rather than run on older wallets.
    const aside = `${file}.unreadable-${Date.now()}`;
    try {
      fs.renameSync(file, aside);
    } catch (e) {
      throw new Error(`storage: ${path.basename(file)} could not be opened (${err.code || err.message}) nor set aside (${e.code || e.message})`);
    }
    console.error(`storage: ${path.basename(file)} could not be opened (${err.code || err.message}) — kept as ${path.basename(aside)}`);
    return restoreFromBackup(file);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const aside = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, aside); } catch { /* set aside or not, it is not read again */ }
    console.error(`storage: ${path.basename(file)} is unreadable (${err.message}) — kept as ${path.basename(aside)}`);
    return restoreFromBackup(file);
  }
}
