'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function key() {
  const value = fs.readFileSync(process.env.RIOT_SESSION_KEY_FILE, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid session key');
  return Buffer.from(value, 'hex');
}
function encrypt(data, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return JSON.stringify({version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), body: body.toString('base64')});
}
function decrypt(text, secret) {
  const data = JSON.parse(text);
  if (data.version !== 1) throw new Error('Invalid session format');
  const cipher = crypto.createDecipheriv('aes-256-gcm', secret, Buffer.from(data.iv, 'hex'));
  cipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data.body, 'base64')), cipher.final()]).toString('utf8'));
}
async function load(root) {
  try {return decrypt(fs.readFileSync(path.join(root, 'session.enc'), 'utf8'), key());}
  catch {throw new Error('Cloud session unavailable; check session.enc and RIOT_SESSION_KEY_FILE or export a new session');}
}
async function save(data, root) {
  const file = path.join(root, 'session.enc');
  fs.writeFileSync(file + '.tmp', encrypt(data, key()), {mode: 0o600});
  fs.renameSync(file + '.tmp', file);
}
module.exports = {load, save, encrypt, decrypt};
