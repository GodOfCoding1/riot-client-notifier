const fs = require('node:fs');
const path = require('node:path');
const {resolveFriend} = require('./standalone-friends.cjs');
resolveFriend(process.argv[2] || '').then(friend => {
  fs.writeFileSync(path.join(__dirname, 'config.json.tmp'), JSON.stringify({...friend, pollSeconds: 12, mode:'standalone'}, null, 2));
  fs.renameSync(path.join(__dirname, 'config.json.tmp'), path.join(__dirname, 'config.json'));
  console.log('Now watching ' + friend.riotId + ' by PUUID.');
}).catch(e => {console.error(['Use Name#TAG','Friend not found uniquely in your Riot friends list','friends unavailable'].includes(e.message)?e.message:'Could not read your friends; check the saved Riot login and connection.'); process.exitCode = 1;});
