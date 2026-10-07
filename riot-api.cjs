'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const ROUTES = new Set(['/chat/v4/friends', '/chat/v4/presences', '/chat/v1/session']);
function readLockfile() {
  const fields = fs.readFileSync(path.join(process.env.LOCALAPPDATA, 'Riot Games', 'Riot Client', 'Config', 'lockfile'), 'utf8').trim().split(':');
  const port = Number(fields[2]);
  if (fields.length !== 5 || fields[4] !== 'https' || !Number.isInteger(port) || port < 1 || port > 65535 || !fields[3]) throw new Error('client unavailable');
  return {port, secret: fields[3], generation: fields[1] + ':' + fields[2]};
}
function get(lock, route) {
  if (!ROUTES.has(route)) throw new Error('unsupported read-only endpoint');
  return new Promise((resolve, reject) => {
    // Certificate exception applies ONLY to this fixed HTTPS loopback request.
    const req = https.get({hostname: '127.0.0.1', port: lock.port, path: route, method: 'GET', rejectUnauthorized: false,
      agent: false, headers: {Authorization: 'Basic ' + Buffer.from('riot:' + lock.secret).toString('base64')}}, res => {
      let body = '';
      res.on('data', chunk => {body += chunk; if (body.length > 8 * 1024 * 1024) req.destroy();});
      res.on('error', () => reject(new Error('client unavailable')));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('client unavailable'));
        try {resolve(JSON.parse(body));} catch {reject(new Error('invalid local response'));}
      });
    });
    req.setTimeout(5000, () => req.destroy());
    req.on('error', () => reject(new Error('client unavailable')));
  });
}
async function snapshot(puuid, io = {readLockfile, get}) {
  const lock = io.readLockfile(); // Re-read every poll, including after restarts.
  const before = await io.get(lock, '/chat/v1/session');
  if (before.state !== 'connected' || before.loaded !== true) throw new Error('chat unavailable');
  const data = await io.get(lock, '/chat/v4/presences');
  const after = await io.get(lock, '/chat/v1/session');
  if (after.state !== 'connected' || after.loaded !== true || before.puuid !== after.puuid || io.readLockfile().generation !== lock.generation) throw new Error('chat unavailable');
  if (!Array.isArray(data.presences)) throw new Error('invalid local response');
  return {presences: data.presences.filter(p => p.puuid === puuid), generation: lock.generation};
}
async function resolveFriend(riotId) {
  const split = riotId.lastIndexOf('#');
  if (split < 1 || split === riotId.length - 1) throw new Error('Use Name#TAG');
  const lock = readLockfile();
  const data = await get(lock, '/chat/v4/friends');
  if (!Array.isArray(data.friends)) throw new Error('friends unavailable');
  const matches = data.friends.filter(f => f.game_name?.toLowerCase() === riotId.slice(0, split).toLowerCase() && f.game_tag?.toLowerCase() === riotId.slice(split + 1).toLowerCase());
  if (matches.length !== 1 || !matches[0].puuid) throw new Error('Friend not found uniquely in your Riot friends list');
  return {riotId: matches[0].game_name + '#' + matches[0].game_tag, puuid: matches[0].puuid};
}
module.exports = {readLockfile, get, snapshot, resolveFriend};
