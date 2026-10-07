'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Monitor, friendsFromConfig} = require('./monitor.cjs');
const {StandalonePresence} = require('./standalone-presence.cjs');
const {Chat} = require('./xmpp.cjs');
const {snapshot} = require('./riot-api.cjs');
const {updateFriends} = require('./resolve-friend.cjs');
const {matchFriends} = require('./standalone-friends.cjs');
const a = {puuid: 'friend-a', riotId: 'Alpha#TEST'};
const b = {puuid: 'friend-b', riotId: 'Beta#TEST'};
const config = {friends: [a, b]};
const row = friend => ({puuid: friend.puuid, product: 'valorant', state: 'dnd'});
let passed = 0;
async function test(name, fn) {await fn(); passed++; console.log('PASS ' + name);}
async function checks() {
  await test('legacy selection and state migrate without duplicate alerts', async () => {
    assert.deepEqual(friendsFromConfig(a), [a]);
    assert.throws(() => friendsFromConfig({friends: []}));
    const monitor = new Monitor({...a, stable: 'valorant', lastAlertAt: 1000});
    monitor.configure(a);
    const sample = async () => ({presences: [row(a)], generation: 'one'});
    const notify = async () => {assert.fail('duplicate notification');};
    await monitor.poll(sample, notify, () => 200000);
    await monitor.poll(sample, notify, () => 212000);
    assert.equal(monitor.serialize().friends[a.puuid].stable, 'valorant');
  });
  await test('simultaneous friends alert independently with one snapshot per poll', async () => {
    const monitor = new Monitor(); monitor.configure(config);
    const alerts = []; let reads = 0;
    const sample = async ids => {assert.deepEqual(ids, [a.puuid, b.puuid]); reads++; return {presences: [row(a), row(b), row({puuid: 'unselected'})], generation: 'one'};};
    const notify = async id => {alerts.push(id); return true;};
    await monitor.poll(sample, notify, () => 1000);
    assert.deepEqual(alerts, []);
    await monitor.poll(sample, notify, () => 13000);
    assert.deepEqual(alerts, [a.riotId, b.riotId]); assert.equal(reads, 2);
    const restarted = new Monitor(monitor.serialize()); restarted.configure(config);
    await restarted.poll(sample, notify, () => 25000);
    await restarted.poll(sample, notify, () => 37000);
    assert.equal(alerts.length, 2);
  });
  await test('notification failure retries only the affected friend after restart', async () => {
    const monitor = new Monitor(); monitor.configure(config);
    const sample = async () => ({presences: [row(a), row(b)], generation: 'one'});
    await monitor.poll(sample, async () => true, () => 1000);
    const delivered = [];
    await monitor.poll(sample, async id => {if (id === a.riotId) throw new Error('delivery failed'); delivered.push(id); return true;}, () => 13000);
    assert.deepEqual(delivered, [b.riotId]);
    const restarted = new Monitor(monitor.serialize()); restarted.configure(config);
    const retry = async id => {delivered.push(id); return true;};
    await restarted.poll(sample, retry, () => 25000);
    await restarted.poll(sample, retry, () => 37000);
    assert.deepEqual(delivered, [b.riotId, a.riotId]);
  });
  await test('selection changes preserve retained trackers and discard removed friends', async () => {
    const monitor = new Monitor(); monitor.configure({friends: [a]});
    const original = monitor.trackers.get(a.puuid);
    original.tracker.markNotified(123);
    monitor.configure(config); assert.equal(monitor.trackers.get(a.puuid), original);
    monitor.configure({friends: [{...a, riotId: 'Renamed#TEST'}]});
    assert.equal(monitor.trackers.get(a.puuid), original);
    assert.deepEqual(Object.keys(monitor.serialize().friends), [a.puuid]);
    monitor.configure({friends: [b]}); monitor.configure(config);
    assert.equal(monitor.trackers.get(a.puuid).tracker.lastAlertAt, 0);
  });
  await test('outages and reconnects reset debounce for every friend', async () => {
    const monitor = new Monitor(); monitor.configure(config);
    const sample = generation => async () => ({presences: [row(a), row(b)], generation});
    const alerts = []; const notify = async id => {alerts.push(id); return true;};
    await monitor.poll(sample('one'), notify, () => 1000);
    const statuses = await monitor.poll(async () => {throw new Error('outage');}, notify, () => 13000);
    assert.ok(statuses.every(s => s.observed === 'unknown'));
    await monitor.poll(sample('one'), notify, () => 25000);
    await monitor.poll(sample('two'), notify, () => 37000);
    assert.deepEqual(alerts, []);
    await monitor.poll(sample('two'), notify, () => 49000);
    assert.deepEqual(alerts, [a.riotId, b.riotId]);
  });
  await test('one friend leaving and returning does not re-alert another', async () => {
    const monitor = new Monitor({friends: {[a.puuid]: {stable: 'valorant', lastAlertAt: 1000}, [b.puuid]: {stable: 'valorant', lastAlertAt: 1000}}});
    monitor.configure(config);
    const alerts = []; const notify = async id => {alerts.push(id); return true;};
    for (const time of [200000, 212000, 224000, 236000]) await monitor.poll(async () => ({presences: [row(b)], generation: 'one'}), notify, () => time);
    for (const time of [248000, 260000]) await monitor.poll(async () => ({presences: [row(a), row(b)], generation: 'one'}), notify, () => time);
    assert.deepEqual(alerts, [a.riotId]);
  });
  await test('XMPP shares a connection and isolates friend resources through selection changes', async () => {
    let connections = 0;
    const chat = new Chat();
    chat.connect = async () => {connections++; chat.parser(); chat.connected = true; chat.xml.write('<stream:stream xmlns:stream="http://etherx.jabber.org/streams"><iq id="roster" type="result"/>');};
    const stream = new StandalonePresence(__dirname, () => {}, {credentials: {get: async () => ({expiry: Date.now() + 3600000})}, createChat: () => chat});
    try {
      await assert.rejects(stream.snapshot([a.puuid, b.puuid]), /initial presence loading/);
      const presence = (friend, resource, product) => `<presence from="${friend.puuid}@test.pvp.net/${resource}"><games><${product}><st>dnd</st></${product}></games></presence>`;
      chat.xml.write(presence(a, 'v', 'valorant') + presence(a, 'launcher', 'keystone') + presence(b, 'v', 'valorant') + presence({puuid: 'unselected'}, 'v', 'valorant'));
      stream.readyAt = Date.now() - 13000;
      assert.equal((await stream.snapshot([a.puuid, b.puuid])).presences.length, 3);
      chat.xml.write(`<presence type="unavailable" from="${a.puuid}@test.pvp.net/v"/>`);
      assert.deepEqual((await stream.snapshot(a.puuid)).presences.map(r => r.product), ['riot_client']);
      assert.equal((await stream.snapshot(b.puuid)).presences[0].product, 'valorant');
      assert.equal((await stream.snapshot('unselected')).presences.length, 1);
      assert.equal(connections, 1);
      stream.close(); assert.equal(stream.resources.size, 0);
      chat.emit('stanza', {name: 'presence', attrs: {from: a.puuid + '@test/v'}, children: []});
      assert.equal(stream.resources.size, 0);
    } finally {stream.close();}
  });
  await test('loopback fetch filters all selected PUUIDs in a single healthy snapshot', async () => {
    const session = {state: 'connected', loaded: true, puuid: 'self'};
    const responses = [session, {presences: [row(a), row(b), row({puuid: 'unselected'})]}, session];
    const result = await snapshot([a.puuid, b.puuid], {readLockfile: () => ({generation: 'one'}), get: async () => responses.shift()});
    assert.deepEqual(result.presences.map(r => r.puuid), [a.puuid, b.puuid]); assert.equal(responses.length, 0);
  });
  await test('roster resolves multiple accepted friends case-insensitively', () => {
    const chat = new Chat(); chat.parser(); let roster;
    chat.on('stanza', stanza => roster = stanza);
    chat.xml.write('<stream:stream xmlns:stream="http://etherx.jabber.org/streams"><iq type="result"><query>' + [a, b].map(f => `<item puuid="${f.puuid}" subscription="both"><id name="${f.riotId.split('#')[0]}" tagline="TEST"/></item>`).join('') + '</query></iq>');
    assert.deepEqual(matchFriends(roster, ['alpha#test', b.riotId]), [a, b]);
    assert.throws(() => matchFriends(roster, [a.riotId, 'Missing#TEST']));
    roster.children[0].children[1].attrs.subscription = 'to';
    assert.throws(() => matchFriends(roster, [b.riotId]));
  });
  await test('replace/add/remove are atomic, deduplicate PUUIDs and migrate legacy config', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-friends-test-'));
    const file = path.join(folder, 'config.json');
    const resolve = async ids => ids.map(id => {const friend = [a, b].find(f => f.riotId === id); if (!friend) throw new Error('missing'); return friend;});
    try {
      fs.writeFileSync(file, JSON.stringify({...a, mode: 'loopback'}));
      await updateFriends(folder, 'add', [b.riotId, a.riotId], resolve);
      assert.deepEqual(JSON.parse(fs.readFileSync(file)).friends, [a, b]);
      assert.equal(JSON.parse(fs.readFileSync(file)).mode, 'loopback');
      const before = fs.readFileSync(file, 'utf8');
      await assert.rejects(updateFriends(folder, 'replace', [a.riotId, 'Missing#TEST'], resolve));
      await assert.rejects(updateFriends(folder, 'remove', [a.riotId, b.riotId], resolve));
      await assert.rejects(updateFriends(folder, 'add', ['Invalid'], resolve));
      assert.equal(fs.readFileSync(file, 'utf8'), before);
      await updateFriends(folder, 'remove', [a.riotId.toLowerCase()], resolve);
      assert.deepEqual(JSON.parse(fs.readFileSync(file)).friends, [b]);
      await updateFriends(folder, 'replace', [a.riotId, a.riotId], resolve);
      assert.deepEqual(JSON.parse(fs.readFileSync(file)).friends, [a]);
    } finally {fs.unlinkSync(file); fs.rmdirSync(folder);}
  });
  await test('Windows manager dispatches comma-separated removals and preserves config on failure', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-manager-test-'));
    const copied = ['manage.ps1', 'resolve-friend.cjs', 'monitor.cjs', 'presence.cjs', 'standalone-friends.cjs', 'standalone-auth.cjs', 'saved-login.cjs', 'secure-session.cjs', 'xmpp.cjs', 'vendor/package/lib/sax.js'];
    const directories = ['runtime', 'vendor', 'vendor/package', 'vendor/package/lib'];
    const runtime = path.join(folder, 'runtime/node.exe');
    try {
      for (const dir of directories) fs.mkdirSync(path.join(folder, dir));
      for (const file of copied) fs.copyFileSync(path.join(__dirname, file), path.join(folder, file));
      fs.copyFileSync(process.execPath, runtime);
      const c = {puuid: 'friend-c', riotId: 'Gamma#TEST'};
      const configPath = path.join(folder, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({friends: [a, b, c]}));
      const run = id => require('node:child_process').spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(folder, 'manage.ps1'), '-Action', 'RemoveFriend', '-RiotId', id], {encoding: 'utf8', windowsHide: true, timeout: 15000});
      const result = run(a.riotId + ', ' + b.riotId);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(fs.readFileSync(configPath)).friends, [c]);
      assert.notEqual(run(c.riotId).status, 0);
      assert.deepEqual(JSON.parse(fs.readFileSync(configPath)).friends, [c]);
    } finally {
      for (const file of [...copied, 'runtime/node.exe', 'config.json']) if (fs.existsSync(path.join(folder, file))) fs.unlinkSync(path.join(folder, file));
      for (const dir of directories.reverse()) fs.rmdirSync(path.join(folder, dir));
      fs.rmdirSync(folder);
    }
  });
  console.log(passed + ' multi-friend tests passed.');
}
checks().catch(error => {console.error(error); process.exitCode = 1;});
