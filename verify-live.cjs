const fs = require('node:fs');
const {snapshot} = require('./riot-api.cjs');
const {classify} = require('./presence.cjs');
const path = require('node:path');
const configPath = path.join(process.env.LOCALAPPDATA,'RiotFriendNotifier/config.json');
const puuid = process.argv[2] || (fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath,'utf8')).puuid : null);
if(!puuid){console.log('Usage: node verify-live.cjs <friend-puuid> (requires running Riot Client)');process.exit(1);}
function decode(s) {try {return JSON.parse(Buffer.from(s,'base64').toString('utf8'));}catch{return {};}}
snapshot(puuid).then(result => {
  const output = {checkedAt: new Date().toISOString(), classification: classify(result.presences), rows: result.presences.map(p => {
    const details = decode(p.private || '');
    return {product:p.product, state:p.state, presenceTime:p.time, gameState:details.matchPresenceData?.sessionLoopState,
      score:details.partyOwnerMatchScoreAllyTeam !== undefined ? [details.partyOwnerMatchScoreAllyTeam,details.partyOwnerMatchScoreEnemyTeam] : undefined};
  })};
  console.log(JSON.stringify(output,null,2));
}).catch(()=>{console.log('Live chat/presence unavailable');process.exitCode=1;});
