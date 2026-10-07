const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const {readLockfile} = require('./riot-api.cjs');
const routes = ['/rso-auth/v1/authorization/access-token','/rso-auth/v1/authorization','/rso-auth/v1/session-credentials','/entitlements/v1/token','/rso-auth/v1/authentication/cookies'];
function localGet(route) {
  const lock = readLockfile();
  return new Promise((resolve,reject)=> {
    const req=https.get({hostname:'127.0.0.1',port:lock.port,path:route,rejectUnauthorized:false,headers:{Authorization:'Basic '+Buffer.from('riot:'+lock.secret).toString('base64')}},r=>{
      let body='';r.on('data',c=>body+=c);r.on('end',()=>{let data;try{data=JSON.parse(body)}catch{}resolve({status:r.statusCode,data});});
    });req.setTimeout(5000,()=>req.destroy());req.on('error',()=>reject(new Error('loopback unavailable')));
  });
}
async function main() {
  for (const route of routes) {
    const r=await localGet(route);const out={route,status:r.status,keys:r.data&&typeof r.data==='object'?Object.keys(r.data):[]};
    if(r.status===200) for(const key of ['expiry','expiration','expiresIn','tokenType']) if(r.data?.[key]!==undefined)out[key]=r.data[key];
    if(r.data?.accessToken) try {const c=JSON.parse(Buffer.from(r.data.accessToken.split('.')[1],'base64url'));out.tokenExpiry=c.exp?new Date(c.exp*1000).toISOString():undefined;}catch{}
    console.log(JSON.stringify(out));
  }
  const cfg=JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'Riot Games/Riot Client/Config/ClientConfiguration.json'),'utf8'));
  function find(o) {if(!o||typeof o!=='object')return;for(const [k,v]of Object.entries(o)){if(/^chat\.(affinities|affinity_domains|port)$/.test(k))console.log(JSON.stringify({configKey:k,value:v}));else if(typeof v==='object')find(v);}}
  find(cfg);
}
if(require.main===module)main().catch(()=>{console.log('Live login probe unavailable');process.exitCode=1;});
module.exports={localGet};
