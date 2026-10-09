'use strict';
const fs = require('node:fs');
const path = require('node:path');
function runtimeConfig(env = process.env, platform = process.platform) {
  const profile = env.RIOT_ENV || (platform === 'win32' ? 'windows' : 'cloud');
  if (!['windows', 'cloud'].includes(profile)) throw new Error('RIOT_ENV must be windows or cloud');
  if (profile === 'windows' && platform !== 'win32') throw new Error('Windows profile requires Windows');
  return {profile, root: path.resolve(env.RIOT_DATA_DIR || __dirname)};
}
function initialize() {
  // Deployment environment takes precedence over the optional repository .env.
  if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));
  return runtimeConfig();
}
module.exports = {runtimeConfig, initialize};
