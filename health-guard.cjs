'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {execFile} = require('node:child_process');
const {initialize} = require('./runtime-config.cjs');
const {assess, HealthEvents} = require('./health.cjs');
const {loadEnv, smtpConfig} = require('./notify/dispatch.cjs');
const {sendEmail} = require('./notify/email.cjs');
const {root} = initialize();
const read = name => {try {return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));} catch {return null;}};
function write(name, data) {const file=path.join(root,name);fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);}
const state = read('health-state.json') || {};
const events = new HealthEvents(state.events);
let previous = state.assessment || {}, current = null, stopped = false, timer;
const smtp = smtpConfig(loadEnv(root));
function serviceState() {
  return new Promise(resolve=>execFile('systemctl',['show','riot-notifier.service','-p','ActiveState','-p','SubState','-p','MainPID','-p','NRestarts','-p','InvocationID'],{timeout:5000},(error,stdout)=>{
    if(error)return resolve({});
    resolve(Object.fromEntries(stdout.trim().split('\n').map(line=>{const split=line.indexOf('=');return [line.slice(0,split),line.slice(split+1)];})));
  }));
}
async function tick() {
  try {
    const service = await serviceState();
    current = assess({status:read('status.json'),config:read('config.json'),service,previous});
    if(events.state.queue.some(event=>event.attempts>0 && Date.now()-(event.createdAt??event.nextAt)>=300000)) {
      current.ok=false;current.ready=false;
      current.issues.push({key:'health-mail',message:'Health notification delivery has failed for 5 minutes'});
    }
    previous = current;
    events.observe(current,service);
    write('health.json',{...current,service:{active:service.ActiveState,restarts:Number(service.NRestarts)||0},pendingHealthEmails:events.state.queue.length});
    write('health-state.json',{assessment:current,events:events.state});
    const sent = await events.deliver(event=>sendEmail({host:smtp.host,port:smtp.port,user:smtp.user,pass:smtp.pass,from:smtp.from,to:smtp.to,
      subject:event.subject+' [automation-server]',text:event.text+'\n\nCheck: sudo systemctl status riot-notifier; sudo journalctl -u riot-notifier -n 50 --no-pager'}));
    if(sent)console.log('Health notification submitted.');
    write('health-state.json',{assessment:current,events:events.state});
  } catch {current={ok:false,checkedAt:new Date().toISOString(),issues:[{key:'guard',message:'Health guard cannot read or persist monitoring state'}]};console.error('Health guard check failed; secret details suppressed.');}
  if(!stopped)timer=setTimeout(tick,15000);
}
const server=http.createServer((request,response)=>{
  if(request.url!=='/healthz' || request.method!=='GET'){response.writeHead(404);response.end();return;}
  const ok = current?.ok === true && Date.now()-Date.parse(current.checkedAt)<60000;
  response.writeHead(ok?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});
  response.end(JSON.stringify({ok}));
});
server.requestTimeout=5000; server.headersTimeout=5000;
server.listen(Number(process.env.RIOT_HEALTH_PORT || 8081),'0.0.0.0',()=>{console.log('Health guard started.');tick();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;clearTimeout(timer);server.close();});
