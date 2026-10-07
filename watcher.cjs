'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {snapshot} = require('./riot-api.cjs');
const {classify, Tracker} = require('./presence.cjs');
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
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file('toast.ps1'), '-Title', 'Valorant friend online', '-Message', riotId + ' is online in Valorant.'],
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
  let config, tracker, configKey, lastHealth, generation;
  const standalone=new StandalonePresence(root,log);
  log('Watcher started.');
  for (;;) {
    if (fs.existsSync(file('stop.flag'))) break;
    const nextConfig = read('config.json', null);
    if (!nextConfig?.puuid) throw new Error('missing configuration');
    if (configKey !== nextConfig.puuid) {
      config = nextConfig; configKey = config.puuid;
      const saved = read('state.json', {});
      tracker = new Tracker(saved.puuid === config.puuid ? saved : {});
      generation = null;
    } else config = nextConfig;
    let value = 'unknown', currentGeneration;
    try {
      const result = config.mode === 'loopback' ? await snapshot(config.puuid) : await standalone.snapshot(config.puuid);
      currentGeneration = result.generation;
      value = classify(result.presences);
      // A new connection must have repeated healthy samples before committing absence.
      if (generation && generation !== currentGeneration) tracker.observe('unknown', Date.now());
      generation = currentGeneration;
    } catch {value = 'unknown';}
    if (value !== lastHealth) {log('Observed status: ' + value); lastHealth = value;}
    const now = Date.now();
    const alert = tracker.observe(value, now);
    if (alert && await notify(config.riotId)) tracker.markNotified(Date.now());
    write('state.json', {puuid: config.puuid, ...tracker.serialize()});
    write('status.json', {pid: process.pid, updatedAt: new Date().toISOString(), observed: value, stable: tracker.stable, friend: config.riotId, pollSeconds: 12,
      source:config.mode==='loopback'?'riot-loopback':'independent-xmpp',chatConnected:config.mode==='loopback'?value!=='unknown':standalone.chat?.connected===true,
      tokenExpiry:standalone.authExpiry?new Date(standalone.authExpiry).toISOString():undefined});
    await new Promise(resolve => setTimeout(resolve, 12000));
  }
  log('Watcher stopped by user.');
  standalone.close();
  try {fs.unlinkSync(file('watcher.pid'));} catch {}
  instance.close();
}
