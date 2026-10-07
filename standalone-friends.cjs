'use strict';
const {Credentials}=require('./standalone-auth.cjs');
const {Chat,child}=require('./xmpp.cjs');
async function resolveFriends(riotIds) {
  if(!riotIds.length||riotIds.some(id=>typeof id!=='string'||!/^[^#]+#[^#]+$/.test(id)))throw new Error('Use Name#TAG');
  const chat=new Chat();
  try {
    const auth=await new Credentials().get();
    let rosterResolve;const roster=new Promise(resolve=>rosterResolve=resolve);
    chat.on('stanza',s=>{if(s.name==='iq'&&s.attrs.id==='roster')rosterResolve(s);});
    await chat.connect(auth);
    const response=await Promise.race([roster,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('friends unavailable')),10000);timer.unref();})]);
    return matchFriends(response,riotIds);
  } finally {chat.close();}
}
function matchFriends(response,riotIds) {
  if(response.attrs.type!=='result')throw new Error('friends unavailable');
  const query=child(response,'query');
  return riotIds.map(riotId=>{
    const split=riotId.lastIndexOf('#');
    const matches=(query?.children||[]).filter(item=>{
      const id=child(item,'id');return id?.attrs.name?.toLowerCase()===riotId.slice(0,split).toLowerCase()&&id?.attrs.tagline?.toLowerCase()===riotId.slice(split+1).toLowerCase()&&item.attrs.subscription==='both';
  });
    if(matches.length!==1||!matches[0].attrs.puuid)throw new Error('Friend not found uniquely in your Riot friends list');
    const id=child(matches[0],'id');return {riotId:id.attrs.name+'#'+id.attrs.tagline,puuid:matches[0].attrs.puuid};
    });
}
async function resolveFriend(riotId) {return (await resolveFriends([riotId]))[0];}
module.exports={resolveFriend,resolveFriends,matchFriends};
