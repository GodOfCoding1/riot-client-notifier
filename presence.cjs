'use strict';
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
    }
    return this.pendingAlert && value === 'valorant' && (!this.lastAlertAt || now - this.lastAlertAt >= this.cooldownMs);
  }
  markNotified(now) {this.lastAlertAt = now; this.pendingAlert = false;}
  serialize() {return {stable: this.stable, lastAlertAt: this.lastAlertAt, pendingAlert: this.pendingAlert};}
}
module.exports = {classify, Tracker};
