'use strict';
const fs = require('node:fs');
const path = require('node:path');
function acquire(root) {
  const folder = path.join(root, 'watcher.lock');
  const pidFile = path.join(folder, 'pid');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {fs.mkdirSync(folder, {mode: 0o700});}
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Missing/invalid PID is treated as occupied: another process may be acquiring it.
      let pid;
      try {pid = Number(fs.readFileSync(pidFile, 'utf8'));} catch {throw new Error('Watcher lock exists without a PID; check processes before removing it');}
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid watcher lock');
      try {process.kill(pid, 0); throw new Error('Watcher is already running');}
      catch (probe) {if (probe.code !== 'ESRCH') throw probe;}
      // Rename atomically before removing a stale lock; competing starters cannot remove a new lock.
      const stale = folder + '.stale-' + process.pid;
      fs.renameSync(folder, stale);
      fs.unlinkSync(path.join(stale, 'pid')); fs.rmdirSync(stale);
      continue;
    }
    fs.writeFileSync(pidFile, String(process.pid), {mode: 0o600});
    return () => {fs.unlinkSync(pidFile); fs.rmdirSync(folder);};
  }
  throw new Error('Could not acquire watcher lock');
}
module.exports = {acquire};
