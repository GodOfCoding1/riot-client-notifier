'use strict';
const assert = require('node:assert/strict');
const {classify, Tracker} = require('./presence.cjs');
let passed = 0;
function test(name, fn) {fn(); passed++; console.log('PASS ' + name);}
function enter(t, start) {t.observe('valorant', start); return t.observe('valorant', start + 12000);}
function leave(t, start) {for (let n = 0; n < 4; n++) t.observe('other', start + n * 12000);}
test('live-shaped simultaneous launcher and Valorant dnd counts as Valorant', () => assert.equal(classify([{product:'riot_client',state:'chat'},{product:'valorant',state:'dnd'}]),'valorant'));
test('away is online; offline Valorant and other games are non-Valorant', () => {
  assert.equal(classify([{product:'valorant',state:'away'}]),'valorant');
  for (const rows of [[],[{product:'league_of_legends',state:'chat'}],[{product:'valorant',state:'offline'}]]) assert.equal(classify(rows),'other');
  assert.equal(classify([{product:'valorant',state:'new-unrecognized-state'}]),'unknown');
});
test('initial online waits for two polls and alerts once', () => {
  const t = new Tracker(); assert.equal(t.observe('valorant',1000),false); assert.equal(t.observe('valorant',13000),true);
  t.markNotified(13000); assert.equal(t.observe('valorant',25000),false);
});
test('offline or another game into Valorant alerts', () => {
  const t = new Tracker(); leave(t,1000); assert.equal(t.stable,'other'); assert.equal(enter(t,50000),true);
});
test('brief offline flicker and single online sample do not alert', () => {
  const t = new Tracker({stable:'valorant',lastAlertAt:1000}); t.observe('other',200000);t.observe('other',212000);
  assert.equal(enter(t,224000),false);
  const offline = new Tracker({stable:'other'}); offline.observe('valorant',1000); offline.observe('other',13000); assert.equal(offline.stable,'other');
});
test('failures and chat disconnection break debounce and preserve stable status', () => {
  const t = new Tracker({stable:'valorant',lastAlertAt:1000}); t.observe('other',200000);t.observe('other',212000);t.observe('unknown',224000);
  assert.equal(t.stable,'valorant');assert.equal(enter(t,500000),false);
  const offline = new Tracker({stable:'other'}); offline.observe('valorant',1000);offline.observe('unknown',13000);assert.equal(offline.observe('valorant',25000),false);
});
test('reconnection and process restart use saved state without duplicate', () => {
  const t = new Tracker(); enter(t,1000); t.markNotified(13000); t.observe('unknown',100000);
  assert.equal(enter(t,200000),false);const restarted = new Tracker(t.serialize());assert.equal(enter(restarted,400000),false);
});
test('confirmed departure re-arms; cooldown delays and deduplicates return', () => {
  const t = new Tracker({stable:'valorant',lastAlertAt:1000});leave(t,20000);assert.equal(enter(t,70000),false);
  assert.equal(t.observe('valorant',121000),true);t.markNotified(121000);assert.equal(t.observe('valorant',133000),false);
});
test('notification failure remains pending across restart for retry', () => {
  const t = new Tracker();assert.equal(enter(t,1000),true);const restarted = new Tracker(t.serialize());assert.equal(enter(restarted,25000),true);
});
test('read-only route allowlist blocks unrelated endpoints', () => assert.throws(() => require('./riot-api.cjs').get({},'/entitlements/v1/token')));
async function apiTests() {
  const {snapshot} = require('./riot-api.cjs');
  const connected = {state:'connected',loaded:true,puuid:'self'};
  function mock(responses, generations = ['a','a']) {
    return {readLockfile: () => ({generation:generations.shift()}), get:async()=>{const r=responses.shift();if(r instanceof Error)throw r;return r;}};
  }
  for (const [name, io] of [
    ['disconnected session',mock([{state:'disconnected',loaded:true}])],
    ['unloaded session',mock([{state:'connected',loaded:false}])],
    ['shutdown/request failure',mock([connected,new Error('failure')])],
    ['disconnection during read',mock([connected,{presences:[]},{state:'disconnected',loaded:true}])],
    ['restart during read',mock([connected,{presences:[]},connected],['a','b'])],
    ['malformed presence response',mock([connected,{},connected])]
  ]) {
    await assert.rejects(snapshot('target',io));passed++;console.log('PASS simulated API '+name+' stays unknown');
  }
  const healthy = await snapshot('target',mock([connected,{presences:[{puuid:'someone-else',product:'valorant',state:'chat'},{puuid:'target',product:'riot_client',state:'chat'}]},connected]));
  assert.equal(healthy.presences.length,1);assert.equal(classify(healthy.presences),'other');passed++;console.log('PASS stable PUUID filters other friends');
  const restarted = await snapshot('target',mock([connected,{presences:[{puuid:'target',product:'valorant',state:'chat'}]},connected],['new-port','new-port']));
  assert.equal(classify(restarted.presences),'valorant');passed++;console.log('PASS healthy new client generation reconnects');
  console.log(passed + ' simulated tests passed. These do not represent live friend transitions.');
}
apiTests().catch(e=>{console.error(e);process.exitCode=1;});
