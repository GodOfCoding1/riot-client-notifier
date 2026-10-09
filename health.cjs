'use strict';
function assess({status, config, service, previous = {}, now = Date.now()}) {
  const raw = [];
  const add = (key, message, delay = 0) => raw.push({key, message, delay});
  if (service.ActiveState !== 'active' || service.SubState !== 'running') add('process', 'Watcher process is not running', 30000);
  const timestamp = Date.parse(status?.updatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 30000 || now - timestamp > 90000) add('stale', 'No fresh status update for 90 seconds');
  if (service.ActiveState === 'active' && Number(service.MainPID) !== status?.pid) add('pid', 'Status belongs to an old watcher process', 90000);
  const expected = config?.friends ?? (config?.puuid ? [config] : []);
  if (!Array.isArray(expected) || !expected.length) add('config', 'Friend configuration is missing or invalid');
  else for (const friend of expected) {
    const row = status?.friends?.find(f => f.puuid === friend.puuid);
    if (!row || !['valorant', 'other'].includes(row.observed)) add('friend:' + friend.puuid, 'Cannot determine status for ' + friend.riotId, 120000);
  }
  if (status?.chatConnected !== true) add('chat', 'Riot chat is disconnected or unavailable', 120000);
  if (status?.email === 'pending') add('email', 'Friend alert emails have remained pending for 5 minutes', 300000);
  if (status?.email === 'unconfigured') add('email-config', 'Email delivery is not configured');
  const since = Object.fromEntries(raw.map(issue => [issue.key, previous.since?.[issue.key] ?? now]));
  const issues = raw.filter(issue => now - since[issue.key] >= issue.delay).map(({key, message}) => ({key, message}));
  return {ok: issues.length === 0, ready:raw.length === 0, checkedAt: new Date(now).toISOString(), since, issues};
}
class HealthEvents {
  constructor(saved = {}) {this.state = {queue:[], ...saved};}
  observe(assessment, service, now = Date.now()) {
    const state = this.state;
    const count = Number(service.NRestarts);
    if (Number.isFinite(count)) {
      if (Number.isFinite(state.restarts) && count > state.restarts && (!state.lastRestartAlertAt || now-state.lastRestartAlertAt>=600000)) {
        this.enqueue('restart:' + count + ':' + service.InvocationID,
          'Riot notifier restarted unexpectedly', 'The watcher crashed and systemd restarted it. Health checks will continue. Restart count: ' + count, now);
        state.lastRestartAlertAt = now;
      }
      state.restarts = count;
    }
    if (!assessment.ok && !state.incident) {
      state.incident = {id: String(now), notified:false};
      this.enqueue('failure:' + state.incident.id, 'Riot monitoring needs attention', assessment.issues.map(i=>i.message).join('\n'), now);
    } else if (assessment.ok && assessment.ready !== false && state.incident) {
      const incident = state.incident;
      // Keep a queued failure/recovery pair so a brief mail outage cannot hide the incident.
      this.enqueue('recovery:' + incident.id, 'Riot monitoring recovered', 'Fresh usable status checks have resumed for every configured friend.', now);
      state.incident = null;
    }
  }
  enqueue(id, subject, text, now) {
    if (!this.state.queue.some(event=>event.id===id)) this.state.queue.push({id, subject, text, createdAt:now, attempts:0, nextAt:now});
  }
  async deliver(send, now = Date.now()) {
    const event = this.state.queue[0];
    if (!event || now < event.nextAt) return false;
    try {await send(event); this.state.queue.shift(); return true;}
    catch {event.attempts++; event.nextAt = now + Math.min(15000 * 2 ** Math.min(event.attempts-1, 10), 900000); return false;}
  }
}
module.exports = {assess, HealthEvents};
