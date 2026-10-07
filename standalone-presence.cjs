'use strict';
const {Chat,targetView}=require('./xmpp.cjs');
const {Credentials}=require('./standalone-auth.cjs');
class StandalonePresence {
  constructor(root,log=()=>{},io={}) {this.credentials=io.credentials||new Credentials(root);this.createChat=io.createChat||(()=>new Chat());this.log=log;this.chat=null;this.resources=new Map();this.ready=false;this.nextAttempt=0;this.authExpiry=0;this.generation=0;this.lastReceive=0;this.refreshNext=false;}
  async connect(now) {
    const auth=await this.credentials.get(this.refreshNext);this.refreshNext=false;
    this.authExpiry=auth.expiry;
    const chat=this.createChat();this.chat=chat;this.ready=false;this.resources.clear();this.generation++;
    chat.on('stanza',s=>{
      if(this.chat!==chat)return;
      this.lastReceive=Date.now();
      if(s.name==='iq'&&s.attrs.id==='roster'&&s.attrs.type==='result'){this.ready=true;this.readyAt=Date.now();}
      if(s.name==='stream:error'||s.name==='failure'){this.ready=false;chat.close();}
      const puuid=s.attrs.from?.split('@')[0];
      if(!puuid)return;
      const view=targetView(s,puuid);if(!view)return;
      if(view.unavailable)this.resources.delete(view.resource);else this.resources.set(view.resource,view.rows.map(row=>({...row,puuid})));
    });
    const failed=()=>{if(this.chat!==chat)return;this.ready=false;this.nextAttempt=Date.now()+15000;};
    chat.on('error',failed);chat.on('closed',failed);
    await chat.connect(auth);this.lastReceive=Date.now();
    this.log('Independent Riot chat connected.');
  }
  async snapshot(puuid) {
    const now=Date.now();
    if(this.chat?.connected && (now>this.authExpiry-60000||now-this.lastReceive>150000)){
      this.refreshNext=now>this.authExpiry-60000;this.close();this.nextAttempt=0;
    }
    if(!this.chat?.connected){
      if(now<this.nextAttempt)throw new Error('chat unavailable');
      try{await this.connect(now);}catch{this.close();this.nextAttempt=Date.now()+30000;throw new Error('independent chat unavailable');}
    }
    // Roster and initial presence arrive asynchronously. Never interpret an empty connection immediately as offline.
    if(!this.ready||Date.now()-this.readyAt<12000)throw new Error('initial presence loading');
    const targets=new Set(Array.isArray(puuid)?puuid:[puuid]);
    const rows=[...this.resources.values()].flat().filter(row=>targets.has(row.puuid));
    return {presences:rows,generation:'xmpp-'+this.generation,expiry:this.authExpiry};
  }
  close(){this.ready=false;this.chat?.close();this.chat=null;this.resources.clear();}
}
module.exports={StandalonePresence};
