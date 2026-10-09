'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {sendEmail} = require('./email.cjs');

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_TO'];

function loadEnv(root) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return {...process.env};
  const snapshot = {...process.env};
  try {
    process.loadEnvFile(file);
    const picked = {};
    for (const key of SMTP_KEYS) if (process.env[key]) picked[key] = process.env[key];
    return picked;
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(snapshot)) process.env[key] = value;
  }
}

function smtpConfig(env = {}) {
  const pass = String(env.SMTP_PASS || '').replace(/\s+/g, '');
  const user = String(env.SMTP_USER || '').trim();
  const from = String(env.EMAIL_FROM || user).trim();
  const to = String(env.EMAIL_TO || '').trim();
  const host = String(env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(env.SMTP_PORT || 465);
  return {user, pass, from, to, host, port, configured: Boolean(user && pass && from && to && host && port)};
}

function alertText(riotId) {return riotId + ' is online in VALORANT.';}

function createNotifier({root, log = () => {}, platform = process.platform, profile, env, sendToast, sendMail} = {}) {
  const smtp = smtpConfig(env || (root ? loadEnv(root) : {}));
  const windows = platform === 'win32' && profile !== 'cloud';
  // Windows toast gates dedupe. Where that channel does not exist, configured email does.
  const emailGates = !windows && smtp.configured;
  let lastEmailError = 'SMTP error';
  const mail = sendMail || (async riotId => sendEmail({
    host: smtp.host, port: smtp.port, user: smtp.user, pass: smtp.pass, from: smtp.from, to: smtp.to,
    subject: 'Riot Client Notifier', text: alertText(riotId),
  }));
  const toast = sendToast || (riotId => require('./windows.cjs').sendWindowsToast(path.join(__dirname, '..'), riotId, log));
  const delivery = smtp.configured ? {
    emailGates,
    email: async riotId => {
      try {return await mail(riotId, smtp) !== false;}
      catch (error) {lastEmailError = String(error.message || 'SMTP error').slice(0, 160); return false;}
    },
    onEmailSent: riotId => log('Email sent for ' + riotId + '.'),
    onEmailFailed: (riotId, nextAt) => log('Email delivery failed for ' + riotId + ' (' + lastEmailError + '); retrying at ' + new Date(nextAt).toISOString() + '.'),
  } : null;
  return {
    delivery,
    emailConfigured: smtp.configured,
    async notify(riotId) {
      if (!windows) return !smtp.configured;
      return toast(riotId);
    },
    emailStatus(monitor) {
      if (!smtp.configured) return 'unconfigured';
      for (const entry of monitor.trackers.values()) if (entry.tracker.pendingEmail) return 'pending';
      return 'ok';
    },
  };
}

async function sendTestEmail(root) {
  const smtp = smtpConfig(loadEnv(root));
  if (!smtp.configured) {
    const error = new Error('Email is not configured.');
    error.code = 'UNCONFIGURED';
    throw error;
  }
  await sendEmail({
    host: smtp.host, port: smtp.port, user: smtp.user, pass: smtp.pass, from: smtp.from, to: smtp.to,
    subject: 'Riot Client Notifier', text: 'Test notification: your notifier is ready.',
  });
}

if (require.main === module) {
  sendTestEmail(require('../runtime-config.cjs').initialize().root).then(() => {console.log('Test email submitted.');})
    .catch(error => {
      console.error(error.message);
      process.exitCode = error.code === 'UNCONFIGURED' ? 2 : 1;
    });
}

module.exports = {loadEnv, smtpConfig, createNotifier, sendTestEmail};
