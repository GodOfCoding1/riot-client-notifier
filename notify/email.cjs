'use strict';
const tls = require('node:tls');

function buildMessage({from, to, subject, text, date = new Date()}) {
  const header = value => String(value).replace(/[\r\n]+/g, ' ').trim();
  const body = String(text).replace(/\r?\n/g, '\r\n').split('\r\n')
    .map(line => (line.startsWith('.') ? '.' + line : line)).join('\r\n');
  return [
    'From: ' + header(from),
    'To: ' + header(to),
    'Date: ' + date.toUTCString(),
    'Subject: ' + header(subject),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n') + '\r\n';
}

// Completes one SMTP reply, including multiline 250- continuations. Leaves any
// following bytes in state.buffer for the next reply.
function takeReply(state) {
  let cursor = 0;
  const lines = [];
  while (cursor < state.buffer.length) {
    const end = state.buffer.indexOf('\n', cursor);
    if (end === -1) return null;
    const line = state.buffer.slice(cursor, end).replace(/\r$/, '');
    if (line === '' && lines.length === 0) {cursor = end + 1; continue;}
    if (!/^\d{3}[ -]/.test(line)) throw new Error('SMTP response was not understood');
    lines.push(line);
    cursor = end + 1;
    if (/^\d{3} /.test(line)) {
      state.buffer = state.buffer.slice(cursor);
      return {code: Number(line.slice(0, 3)), text: lines.join('\n')};
    }
  }
  return null;
}

function redact(message, secret) {
  const text = String(message || 'SMTP error');
  return secret ? text.split(secret).join('[redacted]') : text;
}

function sendEmail({host = 'smtp.gmail.com', port = 465, user, pass, from, to, subject, text, timeoutMs = 20000}) {
  if (!user || !pass || !from || !to) throw new Error('SMTP configuration is incomplete');
  const message = buildMessage({from, to, subject, text});
  return new Promise((resolve, reject) => {
    const socket = tls.connect({host, port: Number(port), servername: host});
    socket.setEncoding('utf8');
    const state = {buffer: ''};
    const waiters = [];
    let settled = false;
    const timer = setTimeout(() => finish(new Error('SMTP timeout')), timeoutMs);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const closeError = error || new Error('SMTP connection closed');
      while (waiters.length) waiters.shift().reject(closeError);
      socket.destroy();
      if (error) reject(new Error(redact(error.message, pass)));
      else resolve(value);
    }
    function pump() {
      try {
        while (waiters.length) {
          const reply = takeReply(state);
          if (!reply) return;
          waiters.shift().resolve(reply);
        }
      } catch (error) {finish(error);}
    }
    function readReply() {
      return new Promise((resolveReply, rejectReply) => {
        waiters.push({resolve: resolveReply, reject: rejectReply});
        pump();
      });
    }
    function writeLine(line) {socket.write(line + '\r\n');}
    async function expectCode(accepted) {
      const reply = await readReply();
      if (!accepted(reply.code)) throw new Error('SMTP ' + reply.code);
    }
    socket.on('data', chunk => {state.buffer += chunk; pump();});
    socket.on('error', error => finish(error));
    socket.on('end', () => finish(new Error('SMTP connection closed')));
    (async () => {
      await expectCode(code => code === 220);
      writeLine('EHLO localhost');
      await expectCode(code => code === 250);
      writeLine('AUTH LOGIN');
      await expectCode(code => code === 334);
      writeLine(Buffer.from(user, 'utf8').toString('base64'));
      await expectCode(code => code === 334);
      writeLine(Buffer.from(pass, 'utf8').toString('base64'));
      await expectCode(code => code === 235);
      writeLine('MAIL FROM:<' + from + '>');
      await expectCode(code => code === 250);
      writeLine('RCPT TO:<' + to + '>');
      await expectCode(code => code === 250 || code === 251);
      writeLine('DATA');
      await expectCode(code => code === 354);
      socket.write(message + '.\r\n');
      await expectCode(code => code === 250);
      writeLine('QUIT');
      try {await expectCode(code => code === 221);} catch {}
      finish(null, true);
    })().catch(error => finish(error));
  });
}

module.exports = {buildMessage, takeReply, sendEmail};
