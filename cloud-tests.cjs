'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {runtimeConfig} = require('./runtime-config.cjs');
const {encrypt, decrypt, load, save} = require('./cloud-session.cjs');
const {Credentials} = require('./standalone-auth.cjs');
const {acquire} = require('./instance-lock.cjs');
const {createNotifier} = require('./notify/dispatch.cjs');
let passed = 0;
async function test(name, fn) {await fn(); passed++; console.log('PASS ' + name);}
async function checks() {
  await test('runtime defaults and explicit profiles validate platforms', () => {
    assert.equal(runtimeConfig({}, 'linux').profile, 'cloud');
    assert.equal(runtimeConfig({}, 'win32').profile, 'windows');
    assert.equal(runtimeConfig({RIOT_ENV:'cloud'}, 'win32').profile, 'cloud');
    assert.throws(() => runtimeConfig({RIOT_ENV:'windows'}, 'linux'));
    assert.throws(() => runtimeConfig({RIOT_ENV:'invalid'}, 'win32'));
  });
  await test('encrypted sessions round-trip and reject tampering and wrong keys', async () => {
    const key = crypto.randomBytes(32), data = {refreshToken:'test-secret'};
    const text = encrypt(data, key);
    assert.ok(!text.includes(data.refreshToken));
    assert.deepEqual(decrypt(text, key), data);
    assert.throws(() => decrypt(text, crypto.randomBytes(32)));
    const changed = JSON.parse(text); changed.tag = '00'.repeat(16);
    assert.throws(() => decrypt(JSON.stringify(changed), key));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riot-session-test-'));
    const previous = process.env.RIOT_SESSION_KEY_FILE;
    try {
      process.env.RIOT_SESSION_KEY_FILE = path.join(root,'session.key');
      fs.writeFileSync(process.env.RIOT_SESSION_KEY_FILE, key.toString('hex'));
      await save(data, root); assert.deepEqual(await load(root), data);
      fs.writeFileSync(process.env.RIOT_SESSION_KEY_FILE, 'invalid');
      await assert.rejects(load(root), /Cloud session unavailable/);
    } finally {
      if(previous===undefined)delete process.env.RIOT_SESSION_KEY_FILE;else process.env.RIOT_SESSION_KEY_FILE=previous;
      for(const name of fs.readdirSync(root)) fs.unlinkSync(path.join(root,name)); fs.rmdirSync(root);
    }
  });
  await test('cloud renews exported login, persists rotation and reuses session after restart', async () => {
    let stored={refreshToken:'initial'}, renewals=0;
    const io={profile:'cloud',store:{load:async()=>stored,save:async data=>{stored={...data};}},
      readLogin:()=>assert.fail('Windows settings read on cloud'),
      refresh:async login=>{assert.equal(login.refreshToken,'initial');renewals++;return {token:'access',refreshToken:'rotated',expiry:Date.now()+3600000};},
      fetch:async()=>({ok:true,json:async()=>({entitlements_token:'entitlement'})}),
      chatAuth:async(token,entitlement,expiry)=>({token,entitlement,expiry})};
    await new Credentials('unused',io).get();
    assert.equal(stored.refreshToken,'rotated');
    await new Credentials('unused',io).get(); assert.equal(renewals,1);
  });
  await test('rotated refresh token survives entitlement failure', async () => {
    let stored={refreshToken:'initial'};
    const io={profile:'cloud',store:{load:async()=>stored,save:async data=>{stored={...data};}},
      refresh:async()=>({refreshToken:'rotated',token:'access',expiry:Date.now()+3600000}),fetch:async()=>({ok:false})};
    await assert.rejects(new Credentials('unused',io).get(),/entitlement unavailable/);
    assert.equal(stored.refreshToken,'rotated');
  });
  await test('Windows credentials retain source-change and DPAPI provider behavior', async () => {
    let stored=null;
    const io={profile:'windows',store:{load:async()=>stored,save:async data=>{stored=data;}},readLogin:()=>({refreshToken:'windows'}),
      refresh:async login=>{assert.equal(login.refreshToken,'windows');return {refreshToken:'next',token:'access',expiry:Date.now()+3600000};},
      fetch:async()=>({ok:true,json:async()=>({entitlements_token:'e'})}),chatAuth:async()=>({ok:true})};
    assert.deepEqual(await new Credentials('unused',io).get(),{ok:true}); assert.ok(stored.sourceHash);
  });
  await test('cloud mode on Windows uses email gating and never sends a toast', () => {
    const notifier=createNotifier({profile:'cloud',platform:'win32',env:{SMTP_USER:'a',SMTP_PASS:'b',EMAIL_TO:'c'},sendToast:()=>assert.fail('toast')});
    assert.equal(notifier.delivery.emailGates,true); return notifier.notify('A#B').then(result=>assert.equal(result,false));
  });
  await test('process lock rejects a live instance and recovers a dead one', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'riot-lock-test-'));
    try {
      const release=acquire(root);assert.throws(()=>acquire(root),/already running/);release();
      fs.mkdirSync(path.join(root,'watcher.lock'));fs.writeFileSync(path.join(root,'watcher.lock/pid'),'2147483647');
      acquire(root)();assert.ok(!fs.existsSync(path.join(root,'watcher.lock')));
    } finally {fs.rmdirSync(root);}
  });
  await test('headless watcher publishes status and releases lock on platform shutdown', async () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'riot-watcher-test-'));
    const key=crypto.randomBytes(32);
    fs.writeFileSync(path.join(root,'session.key'),key.toString('hex'));
    fs.writeFileSync(path.join(root,'session.enc'),encrypt({refreshToken:'fake'},key));
    fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({friends:[{puuid:'test',riotId:'Test#TAG'}],mode:'standalone'}));
    // Preload replaces only the network provider. The actual watcher, storage and lock run unchanged.
    const stub=path.join(root,'stub.cjs');
    fs.writeFileSync(stub,`require(${JSON.stringify(require.resolve('./standalone-presence.cjs'))}).StandalonePresence = class {async snapshot(){return {presences:[],generation:'test'};} close(){}};`);
    const child=spawn(process.execPath,['--require',stub,path.join(__dirname,'watcher.cjs')],{env:{...process.env,RIOT_ENV:'cloud',RIOT_DATA_DIR:root,RIOT_SESSION_KEY_FILE:path.join(root,'session.key'),SMTP_USER:'fake',SMTP_PASS:'fake',EMAIL_TO:'fake'},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
    try {
      const deadline=Date.now()+10000;
      while(!fs.existsSync(path.join(root,'status.json'))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
      assert.ok(fs.existsSync(path.join(root,'status.json')),output);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root,'status.json'))).profile,'cloud');
      if(process.platform==='win32') {
        // Windows kill terminates rather than delivering a POSIX signal. Use the legacy stop flag.
        fs.writeFileSync(path.join(root,'stop.flag'),'stop');
      } else child.kill('SIGTERM');
      const result=await Promise.race([exited,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Shutdown timed out')),15000);timer.unref();})]);
      assert.equal(result.code,0,output);assert.ok(!fs.existsSync(path.join(root,'watcher.lock')));
    } finally {
      if(child.exitCode===null) {child.kill();await exited;}
      const lock=path.join(root,'watcher.lock');if(fs.existsSync(lock)){fs.unlinkSync(path.join(lock,'pid'));fs.rmdirSync(lock);}
      for(const name of fs.readdirSync(root))fs.unlinkSync(path.join(root,name));fs.rmdirSync(root);
    }
  });
  console.log(passed+' cloud/runtime tests passed. No live Riot or email requests were made.');
}
checks().catch(error=>{console.error(error);process.exitCode=1;});
