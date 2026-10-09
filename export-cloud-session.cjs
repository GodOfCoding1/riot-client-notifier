'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {readSavedLogin} = require('./saved-login.cjs');
const {encrypt} = require('./cloud-session.cjs');
async function exportSession(destination) {
  if (process.platform !== 'win32') throw new Error('Export requires your Windows Riot Client saved login');
  if (!destination) throw new Error('Specify a new output directory');
  let login = readSavedLogin();
  if (login.dpopBound) throw new Error('Client-bound DPoP login is unsupported');
  // Prefer the latest rotated session when it belongs to the current saved login.
  const sourceHash = crypto.createHash('sha256').update(login.refreshToken).digest('hex');
  const cached = await require('./secure-session.cjs').load(path.join(process.env.LOCALAPPDATA, 'RiotFriendNotifier'));
  if (cached?.sourceHash === sourceHash && cached.refreshToken) login = {refreshToken:cached.refreshToken, dpopBound:false};
  const secret = crypto.randomBytes(32);
  // Refuse an existing directory so credentials cannot be overwritten accidentally.
  fs.mkdirSync(destination, {mode: 0o700});
  fs.writeFileSync(path.join(destination, 'session.key'), secret.toString('hex') + '\n', {mode: 0o600, flag: 'wx'});
  fs.writeFileSync(path.join(destination, 'session.enc'), encrypt(login, secret), {mode: 0o600, flag: 'wx'});
}
if (require.main === module) {
  exportSession(process.argv[2]).then(() => console.log('Encrypted session and key exported. Transfer securely and protect both files.'))
    .catch(() => {console.error('Export failed. Use a new directory and a Windows remember-me login without DPoP.'); process.exitCode = 1;});
}
module.exports = {exportSession};
