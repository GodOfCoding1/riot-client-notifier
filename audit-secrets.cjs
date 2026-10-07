'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(process.env.LOCALAPPDATA,'RiotFriendNotifier');
(async()=>{
  const session=await require(path.join(root,'secure-session.cjs')).load(root);
  if(!session?.token)throw new Error('protected session missing');
  const secrets=[session.token,session.entitlement,session.refreshToken,session.idToken].filter(Boolean);
  for(const name of ['config.json','state.json','status.json','watcher.log','watcher.previous.log']) {
    const file=path.join(root,name);if(!fs.existsSync(file))continue;
    const body=fs.readFileSync(file,'utf8');
    if(secrets.some(secret=>body.includes(secret)))throw new Error('secret in diagnostics');
  }
  if(process.argv.includes('--staged')) {
    const {spawnSync}=require('node:child_process');
    const result=spawnSync('git',['ls-files','-z'],{encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw new Error('git index unavailable');
    for(const file of result.stdout.split('\0').filter(Boolean)) {
      if(/\.dpapi(?:\.tmp)?$|(?:^|\/)\.env(?:\.|$)|RiotGamesPrivateSettings\.yaml$/.test(file))throw new Error('credential file staged');
      const content=spawnSync('git',['show',':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
      if(content.status!==0||secrets.some(secret=>content.stdout.includes(secret)))throw new Error('staged content audit failed');
    }
    console.log('Staged files contain no known installed-session tokens or credential files.');
  }
  console.log('Protected session verified; known tokens absent from logs, config, and status.');
})().catch(()=>{console.log('Storage verification failed; all secret values suppressed.');process.exitCode=1;});
