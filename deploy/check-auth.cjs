'use strict';
const {initialize} = require('../runtime-config.cjs');
const {Credentials} = require('../standalone-auth.cjs');
const {root} = initialize();
new Credentials(root).get().then(auth => {
  console.log(JSON.stringify({authenticated:true, tokenExpiry:new Date(auth.expiry).toISOString()}));
}).catch(error => {
  const safe = /^(saved login refresh HTTP \d+ \([a-z_]+\)|remote HTTP \d+|chat entitlement unavailable|invalid chat configuration|Cloud session unavailable; check session.enc and RIOT_SESSION_KEY_FILE or export a new session)$/;
  console.error(safe.test(error.message) ? error.message : 'Riot authentication unavailable; secret details suppressed.');
  process.exitCode = 1;
});
