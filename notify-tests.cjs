'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Monitor} = require('./monitor.cjs');
const {emailBackoffMs} = require('./presence.cjs');
const {buildMessage, takeReply} = require('./notify/email.cjs');
const {createNotifier, loadEnv} = require('./notify/dispatch.cjs');
const friend = {puuid: 'friend-a', riotId: 'Alpha#TEST'};
const config = {friends: [friend]};
const sample = async () => ({presences: [{puuid: friend.puuid, product: 'valorant', state: 'dnd'}], generation: 'one'});
const mailEnv = {SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'app-password', EMAIL_FROM: 'sender@gmail.com', EMAIL_TO: 'sender@gmail.com'};
let passed = 0;
async function test(name, fn) {await fn(); passed++; console.log('PASS ' + name);}
async function checks() {
  await test('message quotes headers and dot-stuffs the body', () => {
    const raw = buildMessage({from: 'a@gmail.com', to: 'b@gmail.com', subject: 'Hello\nBcc: x', text: 'Line\n.hidden', date: new Date('2026-01-01T00:00:00Z')});
    assert.match(raw, /From: a@gmail.com\r\nTo: b@gmail.com\r\n/);
    assert.match(raw, /Subject: Hello Bcc: x\r\n/);
    assert.ok(raw.includes('\r\n..hidden\r\n'));
  });
  await test('SMTP replies can span lines and leave the next reply buffered', () => {
    const state = {buffer: '250-PIPELINING\r\n250 AUTH PLAIN\r\n334 '};
    const reply = takeReply(state);
    assert.equal(reply.code, 250);
    assert.match(reply.text, /PIPELINING/);
    assert.equal(state.buffer, '334 ');
    assert.equal(takeReply(state), null);
    state.buffer += 'ready\r\n';
    assert.equal(takeReply(state).code, 334);
    assert.equal(state.buffer, '');
  });
  await test('email backoff starts at one poll and caps at 15 minutes', () => {
    assert.equal(emailBackoffMs(1), 12000);
    assert.equal(emailBackoffMs(2), 24000);
    assert.equal(emailBackoffMs(20), 15 * 60 * 1000);
  });
  await test('toast success with email failure retries only email after restart', async () => {
    const toasts = []; const mails = [];
    let failMail = true;
    const notifier = createNotifier({platform: 'win32', env: mailEnv,
      sendToast: async id => {toasts.push(id); return true;},
      sendMail: async id => {mails.push(id); if (failMail) return false;}});
    const monitor = new Monitor(); monitor.configure(config);
    const notify = id => notifier.notify(id);
    await monitor.poll(sample, notify, () => 1000, notifier.delivery);
    await monitor.poll(sample, notify, () => 13000, notifier.delivery);
    assert.deepEqual(toasts, [friend.riotId]);
    assert.deepEqual(mails, [friend.riotId]);
    const saved = monitor.serialize().friends[friend.puuid];
    assert.equal(saved.pendingEmail, true);
    assert.equal(saved.pendingAlert, false);
    assert.equal(saved.emailNextAt, 25000);
    assert.equal(notifier.emailStatus(monitor), 'pending');
    await monitor.poll(sample, notify, () => 20000, notifier.delivery);
    assert.equal(mails.length, 1);
    assert.equal(toasts.length, 1);
    const restarted = new Monitor(monitor.serialize()); restarted.configure(config);
    failMail = false;
    await restarted.poll(sample, notify, () => 25000, notifier.delivery);
    assert.equal(toasts.length, 1);
    assert.equal(mails.length, 2);
    assert.equal(restarted.serialize().friends[friend.puuid].pendingEmail, undefined);
    assert.equal(notifier.emailStatus(restarted), 'ok');
  });
  await test('linux email success gates the alert and does not load windows', async () => {
    const mails = [];
    const notifier = createNotifier({platform: 'linux', env: mailEnv,
      sendToast: async () => {throw new Error('windows channel loaded');},
      sendMail: async id => {mails.push(id);}});
    assert.equal(notifier.delivery.emailGates, true);
    const monitor = new Monitor(); monitor.configure(config);
    const notify = id => notifier.notify(id);
    await monitor.poll(sample, notify, () => 1000, notifier.delivery);
    await monitor.poll(sample, notify, () => 13000, notifier.delivery);
    assert.deepEqual(mails, [friend.riotId]);
    assert.equal(monitor.serialize().friends[friend.puuid].pendingAlert, false);
    await monitor.poll(sample, notify, () => 25000, notifier.delivery);
    await monitor.poll(sample, notify, () => 37000, notifier.delivery);
    assert.equal(mails.length, 1);
  });
  await test('linux email failure keeps the alert pending', async () => {
    const notifier = createNotifier({platform: 'linux', env: mailEnv,
      sendToast: async () => false,
      sendMail: async () => false});
    const monitor = new Monitor(); monitor.configure(config);
    await monitor.poll(sample, id => notifier.notify(id), () => 1000, notifier.delivery);
    await monitor.poll(sample, id => notifier.notify(id), () => 13000, notifier.delivery);
    const saved = monitor.serialize().friends[friend.puuid];
    assert.equal(saved.pendingAlert, true);
    assert.equal(saved.pendingEmail, true);
  });
  await test('missing SMTP settings leave windows alerts unchanged', async () => {
    const toasts = [];
    const notifier = createNotifier({platform: 'win32', env: {},
      sendToast: async id => {toasts.push(id); return true;},
      sendMail: async () => {throw new Error('should not send');}});
    assert.equal(notifier.delivery, null);
    const monitor = new Monitor(); monitor.configure(config);
    await monitor.poll(sample, id => notifier.notify(id), () => 1000, notifier.delivery);
    await monitor.poll(sample, id => notifier.notify(id), () => 13000, notifier.delivery);
    assert.deepEqual(toasts, [friend.riotId]);
    assert.equal(monitor.serialize().friends[friend.puuid].pendingEmail, undefined);
    assert.equal(notifier.emailStatus(monitor), 'unconfigured');
  });
  await test('loadEnv reads SMTP keys and does not leave them in the process environment', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-env-test-'));
    const passBefore = process.env.SMTP_PASS;
    const userBefore = process.env.SMTP_USER;
    try {
      fs.writeFileSync(path.join(folder, '.env'), 'SMTP_HOST=smtp.gmail.com\nSMTP_PORT=465\nSMTP_USER=a@gmail.com\nSMTP_PASS="secret value"\nEMAIL_FROM=a@gmail.com\nEMAIL_TO=b@gmail.com\n');
      const env = loadEnv(folder);
      assert.equal(env.SMTP_USER, 'a@gmail.com');
      assert.equal(env.SMTP_PASS, 'secret value');
      assert.equal(env.EMAIL_TO, 'b@gmail.com');
      assert.equal(process.env.SMTP_PASS, passBefore);
      assert.equal(process.env.SMTP_USER, userBefore);
    } finally {
      fs.rmSync(folder, {recursive: true, force: true});
      if (passBefore === undefined) delete process.env.SMTP_PASS; else process.env.SMTP_PASS = passBefore;
      if (userBefore === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = userBefore;
    }
  });
  console.log(passed + ' notification tests passed.');
}
checks().catch(error => {console.error(error); process.exitCode = 1;});
