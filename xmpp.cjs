'use strict';
const tls = require('node:tls');
const {EventEmitter} = require('node:events');
const {StringDecoder} = require('node:string_decoder');
const sax = require('./vendor/package/lib/sax.js');
class Chat extends EventEmitter {
  constructor() {super();this.on('error',()=>{});this.queue=[];this.connected=false;this.decoder=new StringDecoder('utf8');}
  parser() {
    const parser=sax.parser(true,{trim:false});let stack=[];let stanzaSize=0;
    parser.onopentag=tag=>{if(stack.length===1)stanzaSize=0;if(stack.length>64)throw new Error('chat XML depth exceeded');const n={name:tag.name,attrs:tag.attributes,text:'',children:[]};if(stack.length)stack.at(-1).children.push(n);stack.push(n);};
    parser.ontext=text=>{stanzaSize+=text.length;if(stanzaSize>4*1024*1024)throw new Error('chat stanza too large');if(stack.length)stack.at(-1).text+=text;};
    parser.oncdata=parser.ontext;
    parser.onclosetag=()=>{const n=stack.pop();if(stack.length===1){stack[0].children=[];this.queue.push(n);if(this.queue.length>100)this.queue.shift();this.emit('stanza',n);}};
    parser.onerror=()=>{this.emit('error',new Error('invalid chat XML'));this.socket?.destroy();};
    this.xml=parser;
  }
  wait(predicate,send) {
    return new Promise((resolve,reject)=>{
      const clean=()=>{clearTimeout(timer);this.off('stanza',listener);this.off('error',failed);this.off('closed',closed);};
      const listener=n=>{if(n.name==='failure'||n.name==='stream:error'){clean();reject(new Error('chat authentication rejected'));return;}if(predicate(n)){clean();resolve(n);}};
      const failed=()=>{clean();reject(new Error('chat connection failed'));};
      const closed=()=>{clean();reject(new Error('chat closed'));};
      const timer=setTimeout(()=>{clean();reject(new Error('chat handshake timeout'));},15000);
      this.on('stanza',listener);this.on('error',failed);this.on('closed',closed);
      if(send)this.socket.write(send);
    });
  }
  async connect(auth) {
    this.auth=auth;this.decoder=new StringDecoder('utf8');this.parser();
    this.socket=tls.connect({host:auth.host,port:5223,servername:auth.host,rejectUnauthorized:true});
    this.socket.on('data',data=>{try{this.xml.write(this.decoder.write(data));}catch{this.socket.destroy();}});
    this.socket.on('error',()=>this.emit('error',new Error('chat connection failed')));
    this.socket.on('close',()=>{this.connected=false;clearInterval(this.keepAlive);this.emit('closed');});
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.socket.destroy();reject(new Error('TLS timeout'));},10000);this.socket.once('secureConnect',()=>{clearTimeout(timeout);resolve();});this.socket.once('error',()=>{clearTimeout(timeout);reject(new Error('TLS failed'));});});
    const stream=`<?xml version="1.0"?><stream:stream to="${auth.domain}" version="1.0" xmlns:stream="http://etherx.jabber.org/streams">`;
    const f=await this.wait(n=>n.name==='stream:features',stream);
    if(!JSON.stringify(f).includes('X-Riot-RSO-PAS'))throw new Error('chat login mechanism unavailable');
    await this.wait(n=>n.name==='success',`<auth mechanism="X-Riot-RSO-PAS" xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><rso_token>${auth.token}</rso_token><pas_token>${auth.pas}</pas_token></auth>`);
    this.parser();
    await this.wait(n=>n.name==='stream:features',stream);
    const resource='RiotFriendNotifier-'+require('node:crypto').randomBytes(8).toString('hex');
    const bound=await this.wait(n=>n.name==='iq'&&n.attrs.id==='bind', `<iq id="bind" type="set"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><resource>${resource}</resource></bind></iq>`);
    if(bound.attrs.type!=='result')throw new Error('chat binding rejected');
    const session=await this.wait(n=>n.name==='iq'&&n.attrs.id==='session','<iq id="session" type="set"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>');
    if(session.attrs.type!=='result')throw new Error('chat session rejected');
    this.connected=true;
    this.socket.write('<iq type="get" id="roster"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq><presence/>');
    this.keepAlive=setInterval(()=>{if(this.connected)this.socket.write('<iq type="get" id="ping"><ping xmlns="urn:xmpp:ping"/></iq>');},60000);
  }
  close(){this.connected=false;clearInterval(this.keepAlive);this.socket?.destroy();}
}
function child(n,name){return n?.children.find(c=>c.name===name);}
function targetView(stanza,puuid) {
  if(stanza.name!=='presence'||!stanza.attrs.from?.startsWith(puuid+'@'))return null;
  if(stanza.attrs.type==='unavailable')return {resource:stanza.attrs.from,unavailable:true};
  const games=child(stanza,'games');
  const rows=(games?.children||[]).map(g=>({product:g.name==='keystone'?'riot_client':g.name,state:child(g,'st')?.text,time:Number(child(g,'s.t')?.text)||undefined,private:child(g,'p')?.text}));
  return {resource:stanza.attrs.from,rows};
}
module.exports={Chat,targetView,child};
