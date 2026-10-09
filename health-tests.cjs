'use strict';
const assert=require('node:assert/strict');
const {assess,HealthEvents}=require('./health.cjs');
const config={friends:[{puuid:'a',riotId:'A#TEST'},{puuid:'b',riotId:'B#TEST'}]};
const service={ActiveState:'active',SubState:'running',MainPID:'123',NRestarts:'0',InvocationID:'first'};
const status=now=>({pid:123,updatedAt:new Date(now).toISOString(),chatConnected:true,email:'ok',friends:config.friends.map(f=>({...f,observed:'other'}))});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
async function checks(){
  await test('healthy offline friends are healthy; stale or old-process status fails',()=>{
    assert.equal(assess({config,service,status:status(100000),now:100000}).ok,true);
    assert.equal(assess({config,service,status:status(0),now:100000}).ok,false);
    let previous=assess({config,service,status:{...status(0),pid:1},now:0});
    assert.equal(assess({config,service,status:{...status(91000),pid:1},previous,now:91000}).ok,false);
  });
  await test('one unknown friend alerts after two minutes; recovery clears its timer',()=>{
    const sample=now=>({...status(now),friends:[{...config.friends[0],observed:'unknown'},{...config.friends[1],observed:'other'}]});
    let previous=assess({config,service,status:sample(0),now:0});assert.equal(previous.ok,true);
    previous=assess({config,service,status:sample(119000),previous,now:119000});assert.equal(previous.ok,true);
    previous=assess({config,service,status:sample(120000),previous,now:120000});assert.equal(previous.ok,false);
    previous=assess({config,service,status:status(130000),previous,now:130000});assert.equal(previous.ok,true);
    assert.equal(assess({config,service,status:sample(140000),previous,now:140000}).ok,true);
  });
  await test('stopped service alerts after 30 seconds; reconnect and pending-email grace apply',()=>{
    const down={...service,ActiveState:'inactive',SubState:'dead'};
    const previous=assess({config,service:down,status:status(0),now:0});
    assert.equal(assess({config,service:down,status:status(31000),previous,now:31000}).ok,false);
    const pending=now=>({...status(now),email:'pending'});
    let p=assess({config,service,status:pending(0),now:0});assert.equal(p.ok,true);
    assert.equal(assess({config,service,status:pending(300000),previous:p,now:300000}).ok,false);
  });
  await test('failure and recovery each queue once and persist across guard restart',async()=>{
    let events=new HealthEvents();events.observe({ok:false,issues:[{message:'Disconnected'}]},service,1);
    events.observe({ok:false,issues:[{message:'Disconnected'}]},service,2);assert.equal(events.state.queue.length,1);
    events=new HealthEvents(JSON.parse(JSON.stringify(events.state)));
    events.observe({ok:true,ready:false},service,3);assert.equal(events.state.queue.length,1);
    events.observe({ok:true},service,3);events.observe({ok:true},service,4);assert.equal(events.state.queue.length,2);
    const subjects=[];await events.deliver(async e=>subjects.push(e.subject),4);await events.deliver(async e=>subjects.push(e.subject),4);
    assert.deepEqual(subjects,['Riot monitoring needs attention','Riot monitoring recovered']);
  });
  await test('unexpected restart is reported once; SMTP failure retries without dropping event',async()=>{
    const events=new HealthEvents();events.observe({ok:true},service,0);
    const restarted={...service,NRestarts:'1',InvocationID:'second'};
    events.observe({ok:true},restarted,1);events.observe({ok:true},restarted,2);assert.equal(events.state.queue.length,1);
    await events.deliver(async()=>{throw new Error('synthetic');},2);assert.equal(events.state.queue[0].nextAt,15002);
    assert.equal(await events.deliver(async()=>assert.fail('early retry'),3),false);
    assert.equal(await events.deliver(async()=>{},15002),true);assert.equal(events.state.queue.length,0);
    events.observe({ok:true},{...restarted,NRestarts:'2'},20000);assert.equal(events.state.queue.length,0);
  });
  console.log(passed+' health tests passed.');
}
checks().catch(error=>{console.error(error);process.exitCode=1;});
