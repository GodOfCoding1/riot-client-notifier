# Linux / cloud VM setup

The same watcher supports `RIOT_ENV=windows` (saved Windows login, DPAPI, desktop toast and optional email) and `RIOT_ENV=cloud` (exported encrypted session, email only). Defaults follow the OS. Cloud mode also works on Windows for verification. No Riot Client, PowerShell, desktop, inbound port, or GCloud-specific code is needed on the VM.

This setup targets a persistent Linux VM with systemd and Node.js 22+. Deployment to GCloud is a separate step. Riot uses private protocols: a successful local refresh does not guarantee a cloud IP will be accepted. Client-bound DPoP logins are unsupported; revoked authorization requires another export.

For the configured `automation-server` deployment, see [the GCloud operations runbook](deploy/GCLOUD.md) for SSH, status, logs, restart, and email-test commands.

An independent Linux health guard and Google Cloud uptime check provide failure/recovery alerts. See [HEALTH.md](deploy/HEALTH.md) for definitions, thresholds, and external monitoring setup.

## Export authorization on Windows

Sign into Riot Client with remember me enabled, then run in this repo:

```powershell
npm run export:cloud -- "$env:USERPROFILE\riot-cloud-export"
```

The output directory must be new. It contains `session.enc` and `session.key`; no tokens are printed. Transfer these over SSH/SCP to a private location on the VM. Keep the key separate from the session in service configuration. Windows mode continues using DPAPI. Do not copy `session.dpapi` to Linux. Filesystem modes do not enforce Windows ACLs: export into your private user directory.

The exporter prefers the latest rotated credential in the installed Windows notifier's DPAPI cache when it matches the current saved Riot login; otherwise it exports the native remember-me credential.

## Configure a VM

Install Node.js 22+ and Git, clone the repo into `/opt/riot-notifier`, and check `node --version`. No npm dependency installation is needed. Create a dedicated service account and directories:

```sh
sudo useradd --system --home-dir /var/lib/riot-notifier --shell /usr/sbin/nologin riot-notifier
sudo install -d -m 700 -o riot-notifier -g riot-notifier /var/lib/riot-notifier
sudo install -d -m 750 -o root -g riot-notifier /etc/riot-notifier
sudo install -m 600 -o riot-notifier -g riot-notifier /private/upload/session.enc /var/lib/riot-notifier/session.enc
sudo install -m 640 -o root -g riot-notifier /private/upload/session.key /etc/riot-notifier/session.key
sudo install -m 640 -o root -g riot-notifier /opt/riot-notifier/.env.example /etc/riot-notifier/notifier.env
sudoedit /etc/riot-notifier/notifier.env
```

Replace `/private/upload` with your secure upload directory. Fill the SMTP values in `notifier.env` (Gmail uses an app password). The SMTP implementation uses implicit TLS, normally port 465. Set these runtime values there too:

```dotenv
RIOT_ENV=cloud
RIOT_DATA_DIR=/var/lib/riot-notifier
RIOT_SESSION_KEY_FILE=/etc/riot-notifier/session.key
```

Resolve your accepted friends using the same runtime environment, then test email:

```sh
cd /opt/riot-notifier
sudo -u riot-notifier /usr/bin/node --env-file=/etc/riot-notifier/notifier.env resolve-friend.cjs 'FriendOne#TAG,FriendTwo#TAG'
sudo -u riot-notifier /usr/bin/node --env-file=/etc/riot-notifier/notifier.env notify/dispatch.cjs
npm test
```

Resolution creates `config.json` in the data directory. You can instead transfer the existing Windows `config.json` if its mode is `standalone`. Change friends with `resolve-friend.cjs --add 'Name#TAG'`, `--remove 'Name#TAG'`, or a bare list to replace, using the same `--env-file`. Changes apply next poll.

The VM needs outbound HTTPS, Riot XMPP TLS on port 5223, and SMTP TLS to your configured host. No inbound firewall rule is required.

## Run continuously

Check `/usr/bin/node` matches your Node installation; update `ExecStart` in the unit if necessary. Keep the code owned by your deployment user/root and readable by the service account. Runtime writes go into the separate data directory.

```sh
sudo install -m 644 deploy/riot-notifier.service /etc/systemd/system/riot-notifier.service
sudo systemctl daemon-reload
sudo systemctl enable --now riot-notifier
sudo systemctl status riot-notifier
sudo journalctl -u riot-notifier -f
sudo -u riot-notifier cat /var/lib/riot-notifier/status.json
```

Look for `chatConnected: true`, advancing `updatedAt`, and `email: ok`. Unknown observations during initial connection or outages are expected. This is a VM service; it does not need a web server.

Stop/start with `sudo systemctl stop/start riot-notifier`. SIGTERM closes chat, flushes completed polling state, and releases the process lock. Failed processes restart automatically. A stale lock with a dead PID is recovered; a lock without a valid PID requires checking processes before removing `/var/lib/riot-notifier/watcher.lock`. Keep one watcher per data directory and one deployment per exported login: rotated refresh tokens must persist in `session.enc`. Avoid concurrent Windows/cloud renewal of the same saved login.

For revoked authorization, stop the service, export again into a new Windows directory, securely replace both session files with the same ownership/modes, and restart. Stop before restoring session backups. Protect and back up the current encrypted session and key; both together grant access to the account. Remove temporary transfer copies when setup is complete.

For a manual foreground run, set the environment above and run `npm start`. Keep your data on persistent disk. `.env` may be in the repo or data directory for SMTP; supplied environment variables take precedence. `RIOT_*` settings are loaded from the repository `.env` or supplied environment, and from `--env-file` for CLI invocations. Cloud startup fails if session/key, friends, or email configuration is missing.
