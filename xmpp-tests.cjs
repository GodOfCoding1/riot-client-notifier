'use strict';
const assert=require('node:assert/strict');
const {Chat,targetView}=require('./xmpp.cjs');
const {StandalonePresence}=require('./standalone-presence.cjs');
const {classify}=require('./presence.cjs');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
const header='<stream:stream xmlns:stream="http://etherx.jabber.org/streams">';
const presence='<presence from="target@jp1.pvp.net/rc1"><games><keystone><st>chat</st><s.t>123</s.t></keystone><valorant><st>dnd</st><s.t>456</s.t><p>e30=</p></valorant></games></presence>';
test('XML is buffered across arbitrary fragments',()=>{
  const c=new Chat();c.parser();const found=[];c.on('stanza',s=>found.push(s));
  for(const char of header+presence)c.xml.write(char);
  assert.equal(found.length,1);const v=targetView(found[0],'target');assert.equal(classify(v.rows),'valorant');assert.equal(v.rows[1].time,456);
  assert.equal(targetView(found[0],'another'),null);
});
test('multiple stanzas and Unicode preserve roster attributes',()=>{
  const c=new Chat();c.parser();const found=[];c.on('stanza',s=>found.push(s));
  c.xml.write(header+'<iq id="roster"><query><item puuid="x"><id name="Mágé &amp; Mage" tagline="2003"/></item></query></iq>'+presence);
  assert.equal(found.length,2);assert.equal(found[0].children[0].children[0].children[0].attrs.name,'Mágé & Mage');
});
test('unavailable resource removes only that product session',()=>{
  const c=new Chat();c.parser();let v;c.on('stanza',s=>v=targetView(s,'target'));c.xml.write(header+'<presence type="unavailable" from="target@jp1.pvp.net/rc1"/>');assert.equal(v.unavailable,true);
  const resources=new Map([['target@jp1.pvp.net/rc1',[{product:'valorant',state:'dnd'}]],['target@jp1.pvp.net/rc2',[{product:'riot_client',state:'chat'}]]]);resources.delete(v.resource);assert.equal(classify([...resources.values()].flat()),'other');
});
test('unknown product state remains unknown',()=>assert.equal(classify([{product:'valorant',state:'unexpected'}]),'unknown'));
async function checks(){
  const s=new StandalonePresence(__dirname);s.puuid='target';s.chat={connected:true,close(){this.connected=false;}};s.authExpiry=Date.now()+3600000;s.lastReceive=Date.now();s.ready=false;
  await assert.rejects(s.snapshot('target'));passed++;console.log('PASS initial connection without roster is unknown');
  s.ready=true;s.readyAt=Date.now();await assert.rejects(s.snapshot('target'));passed++;console.log('PASS initial roster grace period is unknown');
  s.readyAt=Date.now()-13000;s.resources.set('rc1',[{product:'valorant',state:'dnd'}]);assert.equal(classify((await s.snapshot('target')).presences),'valorant');passed++;console.log('PASS established healthy stream reports target presence');
  s.chat.connected=false;s.nextAttempt=Date.now()+30000;await assert.rejects(s.snapshot('target'));passed++;console.log('PASS disconnected stream is unknown, never stale online/offline');
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'riot-notifier-test-'));
  try {
    const secure=require('./secure-session.cjs');const dummy={token:'synthetic-not-a-real-token',expiry:123};await secure.save(dummy,folder);
    assert.ok(!fs.readFileSync(path.join(folder,'session.dpapi'),'utf8').includes(dummy.token));assert.deepEqual(await secure.load(folder),dummy);
    passed++;console.log('PASS Windows user encryption round-trip stores no plaintext token');
  } finally {fs.unlinkSync(path.join(folder,'session.dpapi'));fs.rmdirSync(folder);}
  const expired=new StandalonePresence(__dirname);expired.puuid='target';expired.chat={connected:true,close(){this.connected=false;}};expired.authExpiry=Date.now()-1;expired.lastReceive=Date.now();
  let attempted=false;expired.connect=async()=>{attempted=true;assert.equal(expired.refreshNext,true);throw new Error('simulated renewal outage');};
  await assert.rejects(expired.snapshot('target'));assert.equal(attempted,true);assert.equal(expired.ready,false);passed++;console.log('PASS expiry triggers renewal; renewal outage remains unknown');
  const stale=new StandalonePresence(__dirname);stale.puuid='target';stale.chat={connected:true,close(){this.connected=false;}};stale.authExpiry=Date.now()+3600000;stale.lastReceive=Date.now()-160000;
  stale.connect=async()=>{throw new Error('simulated reconnect outage');};await assert.rejects(stale.snapshot('target'));passed++;console.log('PASS stale stream reconnect failure remains unknown');
  console.log(passed+' simulated XMPP tests passed.');
}
checks().catch(e=>{console.error(e);process.exitCode=1;});
