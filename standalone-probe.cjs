const fs=require('node:fs');
const {bootstrap}=require('./standalone-auth.cjs');
const {Chat,targetView,child}=require('./xmpp.cjs');
const path=require('node:path');
const configPath=path.join(process.env.LOCALAPPDATA,'RiotFriendNotifier/config.json');
const target=process.argv[2]||(fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')).puuid:null);
if(!target){console.log('Usage: node standalone-probe.cjs <friend-puuid>');process.exit(1);}
const chat=new Chat();
function say(message){console.log(new Date().toISOString()+' '+message);}
chat.on('stanza',s=>{
  if(s.name==='iq'&&s.attrs.id==='roster')say('Roster response: '+s.attrs.type);
  const v=targetView(s,target);if(!v)return;
  say('Target presence: '+JSON.stringify({...v,rows:v.rows?.map(p=>({product:p.product,state:p.state,time:p.time}))}));
});
chat.on('closed',()=>say('Independent chat connection closed'));
chat.on('error',()=>say('Independent chat connection error'));
(async()=>{
  const auth=await bootstrap();say('Existing login bootstrap successful; token expiry '+new Date(auth.expiry).toISOString());
  await chat.connect(auth);say('Independent XMPP authenticated; READY for launcher-off test');
  const timer=setInterval(()=>say('Independent chat connected='+chat.connected),15000);
  setTimeout(()=>{clearInterval(timer);chat.close();},180000);
})().catch(e=>{say(e.message);chat.close();process.exitCode=1;});
