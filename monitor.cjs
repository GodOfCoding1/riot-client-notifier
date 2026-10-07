'use strict';
const {classify, Tracker} = require('./presence.cjs');

function friendsFromConfig(config) {
  const friends = config?.friends ?? (config?.puuid ? [config] : []);
  if (!Array.isArray(friends) || !friends.length || friends.some(f =>
    !f || typeof f.puuid !== 'string' || !f.puuid || typeof f.riotId !== 'string' || !f.riotId)) {
    throw new Error('missing configuration');
  }
  return [...new Map(friends.map(f => [f.puuid, {puuid: f.puuid, riotId: f.riotId}])).values()];
}

class Monitor {
  constructor(saved = {}) {
    this.saved = saved.friends ?? (saved.puuid ? {[saved.puuid]: saved} : {});
    this.trackers = new Map();
  }
  configure(config) {
    this.friends = friendsFromConfig(config);
    const next = new Map();
    for (const friend of this.friends) next.set(friend.puuid,
      this.trackers.get(friend.puuid) ?? {tracker: new Tracker(this.saved[friend.puuid]), generation: null});
    this.trackers = next;
    // Removed friends must not retain stale state if selected again later.
    this.saved = {};
  }
  async poll(snapshot, notify, now = Date.now) {
    let result;
    try {result = await snapshot(this.friends.map(f => f.puuid));} catch {}
    const statuses = [];
    for (const friend of this.friends) {
      const entry = this.trackers.get(friend.puuid);
      const rows = result?.presences?.filter(p => p.puuid === friend.puuid);
      const value = rows ? classify(rows) : 'unknown';
      if (entry.generation && entry.generation !== result?.generation) entry.tracker.observe('unknown', now());
      if (result) entry.generation = result.generation;
      if (entry.tracker.observe(value, now())) {
        // A failed delivery for one friend must not block the remaining friends.
        try {if (await notify(friend.riotId)) entry.tracker.markNotified(now());} catch {}
      }
      statuses.push({...friend, observed: value, stable: entry.tracker.stable});
    }
    return statuses;
  }
  serialize() {
    return {friends: Object.fromEntries([...this.trackers].map(([puuid, entry]) => [puuid, entry.tracker.serialize()]))};
  }
}
module.exports = {friendsFromConfig, Monitor};
