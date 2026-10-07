'use strict';
const {readSavedLogin,refreshSavedLogin}=require('./saved-login.cjs');
const secure=require('./secure-session.cjs');
const crypto=require('node:crypto');
async function remote(url, headers, json=true) {
  const response = await fetch(url, {headers, redirect:'error', signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error('remote HTTP '+response.status);
  return json ? response.json() : response.text();
}
async function bootstrap() {
  const {localGet}=require('./login-probe.cjs');
  const [access, entitlement] = await Promise.all([localGet('/rso-auth/v1/authorization/access-token'),localGet('/entitlements/v1/token')]);
  if(access.status!==200 || entitlement.status!==200 || !access.data?.token || !entitlement.data?.token) throw new Error('existing login unavailable');
  const token=access.data.token;
  const pas=await remote('https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat',{Authorization:'Bearer '+token},false);
  let claims;try {claims=JSON.parse(Buffer.from(pas.split('.')[1],'base64url'));}catch {throw new Error('invalid PAS response');}
  const config=await remote('https://clientconfig.rpg.riotgames.com/api/v1/config/player?app=Riot%20Client',{Authorization:'Bearer '+token,'X-Riot-Entitlements-JWT':entitlement.data.token});
  const host=config['chat.affinities']?.[claims.affinity];
  const region=config['chat.affinity_domains']?.[claims.affinity];
  if(typeof host!=='string'||!host.endsWith('.riotgames.com')||typeof region!=='string'||!/^[a-z0-9]+$/i.test(region)) throw new Error('invalid chat configuration');
  return {token,pas,entitlement:entitlement.data.token,host,domain:region+'.pvp.net',expiry:access.data.expiry*1000};
}
async function chatAuth(token,entitlement,expiry) {
  const pas=await remote('https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat',{Authorization:'Bearer '+token},false);
  let claims;try{claims=JSON.parse(Buffer.from(pas.split('.')[1],'base64url'));}catch{throw new Error('invalid chat authorization');}
  const config=await remote('https://clientconfig.rpg.riotgames.com/api/v1/config/player?app=Riot%20Client',{Authorization:'Bearer '+token,'X-Riot-Entitlements-JWT':entitlement});
  const host=config['chat.affinities']?.[claims.affinity],region=config['chat.affinity_domains']?.[claims.affinity];
  if(typeof host!=='string'||!host.endsWith('.riotgames.com')||typeof region!=='string'||!/^[a-z0-9]+$/i.test(region))throw new Error('invalid chat configuration');
  return {token,pas,entitlement,host,domain:region+'.pvp.net',expiry};
}
class Credentials {
  constructor(root=__dirname){this.root=root;this.session=null;this.loaded=false;this.auth=null;}
  async get(forceRefresh=false) {
    const saved=readSavedLogin();
    const sourceHash=crypto.createHash('sha256').update(saved.refreshToken).digest('hex');
    if(!this.loaded){this.session=await secure.load(this.root);this.loaded=true;}
    if(this.session?.sourceHash!==sourceHash){this.session={...saved,sourceHash};this.auth=null;}
    if(forceRefresh||!this.session.token||!this.session.entitlement||this.session.expiry<Date.now()+90000){
      let renewed;
      try {renewed=await refreshSavedLogin(this.session);}catch(error){if(this.session.refreshToken===saved.refreshToken)throw error;renewed=await refreshSavedLogin(saved);}
      const response=await fetch('https://entitlements.auth.riotgames.com/api/token/v1',{method:'POST',headers:{Authorization:'Bearer '+renewed.token,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
      const entitlement=response.ok?await response.json():null;
      if(!entitlement?.entitlements_token)throw new Error('chat entitlement unavailable');
      this.session={...renewed,entitlement:entitlement.entitlements_token,sourceHash,dpopBound:false};
      await secure.save(this.session,this.root);this.auth=null;
    }
    if(!this.auth)this.auth=await chatAuth(this.session.token,this.session.entitlement,this.session.expiry);
    return this.auth;
  }
}
module.exports={bootstrap,Credentials,chatAuth};
