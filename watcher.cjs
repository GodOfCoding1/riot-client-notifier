'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {Monitor} = require('./monitor.cjs');
const {StandalonePresence} = require('./standalone-presence.cjs');
const {createNotifier} = require('./notify/dispatch.cjs');
const {acquire} = require('./instance-lock.cjs');
const {root, profile} = require('./runtime-config.cjs').initialize();
fs.mkdirSync(root, {recursive: true, mode: 0o700});
const file = name => path.join(root, name);
function read(name, fallback) {try {return JSON.parse(fs.readFileSync(file(name), 'utf8'));} catch {return fallback;}}
function write(name, data) {fs.writeFileSync(file(name + '.tmp'), JSON.stringify(data, null, 2), {mode:0o600}); fs.renameSync(file(name + '.tmp'), file(name));}
function log(message) {
  if (profile === 'cloud') console.log(new Date().toISOString() + ' ' + message);
  try {if (fs.existsSync(file('watcher.log')) && fs.statSync(file('watcher.log')).size > 256000) fs.renameSync(file('watcher.log'), file('watcher.previous.log'));
    fs.appendFileSync(file('watcher.log'), new Date().toISOString() + ' ' + message + '\n', {mode:0o600});} catch {}
}
let stopping = false, wake;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {stopping = true; wake?.();});
async function run() {
  const notifier = createNotifier({root, profile, log});
  if (profile === 'cloud' && !notifier.emailConfigured) throw new Error('Cloud profile requires SMTP email configuration');
  const initial = read('config.json', null);
  const monitor = new Monitor(read('state.json', {}));
  monitor.configure(initial);
  if (profile === 'cloud' && initial.mode === 'loopback') throw new Error('Cloud profile requires standalone mode');
  if (profile === 'cloud') await require('./cloud-session.cjs').load(root);
  const release = acquire(root);
  const standalone = new StandalonePresence(root, log);
  let lastHealth;
  try {
    fs.writeFileSync(file('watcher.pid'), String(process.pid), {mode:0o600});
    log('Watcher started (' + profile + ').');
    log(notifier.emailConfigured ? 'Email alerts enabled.' : 'Email alerts are not configured.');
    while (!stopping && !fs.existsSync(file('stop.flag'))) {
      const config = read('config.json', null);
      monitor.configure(config);
      if (profile === 'cloud' && config.mode === 'loopback') throw new Error('Cloud profile requires standalone mode');
      const statuses = await monitor.poll(puuids => config.mode === 'loopback' ? require('./riot-api.cjs').snapshot(puuids) : standalone.snapshot(puuids), riotId => notifier.notify(riotId), Date.now, notifier.delivery);
      const health = statuses.map(f => f.observed).join(', ');
      if (health !== lastHealth) {log('Observed friend statuses: ' + health); lastHealth = health;}
      write('state.json', monitor.serialize());
      write('status.json', {pid: process.pid, updatedAt: new Date().toISOString(), profile, friends: statuses, pollSeconds: 12,
        source:config.mode==='loopback'?'riot-loopback':'independent-xmpp',chatConnected:config.mode==='loopback'?statuses.every(f=>f.observed!=='unknown'):standalone.chat?.connected===true,
        tokenExpiry:standalone.authExpiry?new Date(standalone.authExpiry).toISOString():undefined,email:notifier.emailStatus(monitor)});
      if (!stopping) await new Promise(resolve => {const timer=setTimeout(done,12000); function done(){clearTimeout(timer);wake=null;resolve();} wake=done;});
    }
    log('Watcher stopped.');
  } finally {
    standalone.close();
    try {fs.unlinkSync(file('watcher.pid'));} catch {}
    release();
  }
}
run().catch(error => {
  const safe = ['Cloud profile requires SMTP email configuration', 'Cloud profile requires standalone mode', 'missing configuration', 'Watcher is already running', 'Cloud session unavailable; check session.enc and RIOT_SESSION_KEY_FILE or export a new session'];
  log(safe.includes(error.message) ? error.message : 'Watcher stopped unexpectedly; check runtime configuration, storage permissions, and instance lock.');
  process.exitCode = 1;
});
