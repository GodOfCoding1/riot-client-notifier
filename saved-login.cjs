'use strict';
const fs=require('node:fs');
const path=require('node:path');
function readSavedLogin() {
  const text=fs.readFileSync(path.join(process.env.LOCALAPPDATA,'Riot Games/Riot Client/Data/RiotGamesPrivateSettings.yaml'),'utf8');
  function field(key) {
    const line=text.split(/\r?\n/).find(l=>new RegExp('^\\s+'+key+':').test(l));
    if(!line)return undefined;
    let v=line.slice(line.indexOf(':')+1).trim();
    if(v.startsWith('"'))v=JSON.parse(v);else if(v.startsWith("'"))v=v.slice(1,-1).replace(/''/g,"'");
    return v;
  }
  const refreshToken=field('refresh_token');
  if(!refreshToken)throw new Error('no saved Riot login');
  return {refreshToken,idToken:field('id_token'),dpopBound:field('is_dpop_bound')==='true'};
}
async function refreshSavedLogin(login=readSavedLogin()) {
  if(login.dpopBound)throw new Error('saved login requires client-bound proof');
  const response=await fetch('https://auth.riotgames.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
    body:new URLSearchParams({grant_type:'refresh_token',client_id:'riot-client',refresh_token:login.refreshToken}),
    redirect:'error',signal:AbortSignal.timeout(10000)
  });
  let data;try{data=await response.json();}catch{}
  if(!response.ok || !data?.access_token) {
    const error=typeof data?.error==='string'&&/^[a-z_]+$/.test(data.error)?data.error:'unavailable';
    throw new Error('saved login refresh HTTP '+response.status+' ('+error+')');
  }
  return {token:data.access_token,idToken:data.id_token,refreshToken:data.refresh_token||login.refreshToken,expiry:Date.now()+Number(data.expires_in)*1000};
}
if(require.main===module)refreshSavedLogin().then(a=>console.log(JSON.stringify({savedLoginRefresh:true,expiry:new Date(a.expiry).toISOString(),hasRenewalToken:!!a.refreshToken}))).catch(e=>{console.log(/^saved login refresh HTTP \d+ \([a-z_]+\)$/.test(e.message)?e.message:'Saved login refresh unavailable; details suppressed.');process.exitCode=1;});
module.exports={readSavedLogin,refreshSavedLogin};
