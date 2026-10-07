'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {snapshot} = require('./riot-api.cjs');
const {Monitor} = require('./monitor.cjs');
const {StandalonePresence} = require('./standalone-presence.cjs');
const root = __dirname;
const file = name => path.join(root, name);
function read(name, fallback) {try {return JSON.parse(fs.readFileSync(file(name), 'utf8'));} catch {return fallback;}}
function write(name, data) {fs.writeFileSync(file(name + '.tmp'), JSON.stringify(data, null, 2)); fs.renameSync(file(name + '.tmp'), file(name));}
function log(message) {
  try {if (fs.existsSync(file('watcher.log')) && fs.statSync(file('watcher.log')).size > 256000) fs.renameSync(file('watcher.log'), file('watcher.previous.log'));
    fs.appendFileSync(file('watcher.log'), new Date().toISOString() + ' ' + message + '\n');} catch {}
}
function notify(riotId) {
  return new Promise(resolve => execFile(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file('toast.ps1'), '-Title', 'Riot Client Notifier', '-Message', riotId + ' is online in VALORANT.'],
    {windowsHide: true, timeout: 15000}, (error, stdout) => {
      if (error) {log('Notification delivery failed; retrying later.'); return resolve(false);}
      try {const result = JSON.parse(stdout.trim()); log('Notification submitted; Windows setting=' + result.setting + '; history=' + result.historyCount); resolve(result.submitted && result.setting === 'Enabled');} catch {resolve(false);}
    }));
}
// Local single-instance pipe, scoped to this installation/user. No network listener.
const net = require('node:net');
const pipeName = '\\\\.\\pipe\\riot-friend-' + require('node:crypto').createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 20);
const instance = net.createServer(s => s.end());
instance.on('error', () => process.exit(0));
instance.listen(pipeName, () => run().catch(() => {log('Watcher stopped unexpectedly.'); process.exit(1);}));
async function run() {
  fs.writeFileSync(file('watcher.pid'), String(process.pid));
  const monitor = new Monitor(read('state.json', {}));
  let lastHealth;
  const standalone=new StandalonePresence(root,log);
  log('Watcher started.');
  for (;;) {
    if (fs.existsSync(file('stop.flag'))) break;
    const config = read('config.json', null);
    monitor.configure(config);
    const statuses = await monitor.poll(puuids => config.mode === 'loopback' ? snapshot(puuids) : standalone.snapshot(puuids), notify);
    const health = statuses.map(f => f.observed).join(', ');
    if (health !== lastHealth) {log('Observed friend statuses: ' + health); lastHealth = health;}
    write('state.json', monitor.serialize());
    write('status.json', {pid: process.pid, updatedAt: new Date().toISOString(), friends: statuses, pollSeconds: 12,
      source:config.mode==='loopback'?'riot-loopback':'independent-xmpp',chatConnected:config.mode==='loopback'?statuses.every(f=>f.observed!=='unknown'):standalone.chat?.connected===true,
      tokenExpiry:standalone.authExpiry?new Date(standalone.authExpiry).toISOString():undefined});
    await new Promise(resolve => setTimeout(resolve, 12000));
  }
  log('Watcher stopped by user.');
  standalone.close();
  try {fs.unlinkSync(file('watcher.pid'));} catch {}
  instance.close();
}
