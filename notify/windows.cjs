'use strict';
const path = require('node:path');
const {execFile} = require('node:child_process');

function sendWindowsToast(root, riotId, log = () => {}) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const message = riotId + ' is online in VALORANT.';
  return new Promise(resolve => execFile(powershell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'toast.ps1'), '-Title', 'Riot Client Notifier', '-Message', message],
    {windowsHide: true, timeout: 15000}, (error, stdout) => {
      if (error) {log('Notification delivery failed; retrying later.'); return resolve(false);}
      try {
        const result = JSON.parse(stdout.trim());
        log('Notification submitted; Windows setting=' + result.setting + '; history=' + result.historyCount);
        resolve(result.submitted && result.setting === 'Enabled');
      } catch {resolve(false);}
    }));
}

module.exports = {sendWindowsToast};
