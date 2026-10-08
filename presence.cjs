'use strict';
function emailBackoffMs(attempts) {
  return Math.min(12000 * 2 ** (Math.max(1, attempts) - 1), 15 * 60 * 1000);
}
function classify(rows) {
  const online = new Set(['chat', 'away', 'dnd', 'mobile', 'online']);
  if (rows.some(p => p.product === 'valorant' && online.has(p.state))) return 'valorant';
  if (rows.some(p => p.product === 'valorant' && !['offline', 'unavailable'].includes(p.state))) return 'unknown';
  return 'other'; // Absence means non-Valorant only in a connected, loaded snapshot.
}
class Tracker {
  constructor(saved = {}, options = {}) {
    this.stable = saved.stable || null;
    this.lastAlertAt = saved.lastAlertAt || 0;
    this.pendingAlert = saved.pendingAlert === true;
    this.needsEmail = saved.needsEmail === true;
    this.pendingEmail = saved.pendingEmail === true;
    this.emailAttempts = Number(saved.emailAttempts) || 0;
    this.emailNextAt = Number(saved.emailNextAt) || 0;
    this.candidate = null;
    this.since = 0;
    this.samples = 0;
    this.enterMs = options.enterMs ?? 12000;
    this.leaveMs = options.leaveMs ?? 36000;
    this.cooldownMs = options.cooldownMs ?? 120000;
  }
  observe(value, now) {
    if (value === 'unknown') {this.candidate = null; this.samples = 0; return false;}
    if (value !== this.candidate) {this.candidate = value; this.since = now; this.samples = 1;}
    else this.samples++;
    const delay = value === 'valorant' ? this.enterMs : this.leaveMs;
    if (this.samples < 2 || now - this.since < delay) return false;
    if (value !== this.stable) {
      this.stable = value;
      this.pendingAlert = value === 'valorant';
      if (value === 'valorant') this.needsEmail = true;
    }
    return this.pendingAlert && value === 'valorant' && (!this.lastAlertAt || now - this.lastAlertAt >= this.cooldownMs);
  }
  armEmail() {
    if (!this.needsEmail) return;
    this.needsEmail = false;
    this.pendingEmail = true;
    this.emailAttempts = 0;
    this.emailNextAt = 0;
  }
  noteEmail(ok, now) {
    if (ok) {this.pendingEmail = false; this.emailAttempts = 0; this.emailNextAt = 0; return 0;}
    this.emailAttempts += 1;
    this.emailNextAt = now + emailBackoffMs(this.emailAttempts);
    return this.emailNextAt;
  }
  markNotified(now) {this.lastAlertAt = now; this.pendingAlert = false;}
  serialize() {
    const state = {stable: this.stable, lastAlertAt: this.lastAlertAt, pendingAlert: this.pendingAlert};
    if (this.needsEmail) state.needsEmail = true;
    if (this.pendingEmail) {state.pendingEmail = true; state.emailAttempts = this.emailAttempts; state.emailNextAt = this.emailNextAt;}
    return state;
  }
}
module.exports = {classify, Tracker, emailBackoffMs};
