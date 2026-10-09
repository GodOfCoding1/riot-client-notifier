'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {resolveFriends} = require('./standalone-friends.cjs');
const {friendsFromConfig} = require('./monitor.cjs');
async function updateFriends(root, action, riotIds, resolve = resolveFriends) {
  if (!['replace', 'add', 'remove'].includes(action)) throw new Error('Invalid action');
  riotIds = riotIds.map(id => id.trim());
  if (!riotIds.length || riotIds.some(id => !/^[^#]+#[^#]+$/.test(id))) throw new Error('Use Name#TAG');
  const configPath = path.join(root, 'config.json');
  let config = {};
  if (action !== 'replace' && fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const existing = action === 'replace' ? [] : (Object.keys(config).length ? friendsFromConfig(config) : []);
  let friends;
  if (action === 'remove') {
    const ids = new Set(riotIds.map(id => id.toLowerCase()));
    if (riotIds.some(id => !existing.some(f => f.riotId.toLowerCase() === id.toLowerCase()))) throw new Error('Friend is not monitored');
    friends = existing.filter(f => !ids.has(f.riotId.toLowerCase()));
    if (!friends.length) throw new Error('Keep at least one monitored friend; use Stop to pause monitoring');
  } else {
    const resolved = await resolve(riotIds, root);
    friends = [...new Map([...existing, ...resolved].map(f => [f.puuid, f])).values()];
  }
  const updated = {friends, pollSeconds: 12, mode: action === 'replace' ? 'standalone' : (config.mode || 'standalone')};
  fs.writeFileSync(configPath + '.tmp', JSON.stringify(updated, null, 2));
  fs.renameSync(configPath + '.tmp', configPath);
  return friends;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0]?.startsWith('--') ? args.shift().slice(2) : 'replace';
  const {root} = require('./runtime-config.cjs').initialize();
  fs.mkdirSync(root, {recursive:true, mode:0o700});
  updateFriends(root, action, args.flatMap(arg => arg.split(','))).then(friends => {
    console.log('Now watching ' + friends.map(f => f.riotId).join(', ') + ' by PUUID.');
  }).catch(e => {
    const safe = ['Use Name#TAG', 'Invalid action', 'Friend not found uniquely in your Riot friends list', 'friends unavailable', 'Friend is not monitored', 'Keep at least one monitored friend; use Stop to pause monitoring'];
    console.error(safe.includes(e.message) ? e.message : 'Could not update friends; check the saved Riot login, configuration, and connection.');
    process.exitCode = 1;
  });
}
module.exports = {updateFriends};
