# Deployed notifier: automation-server

Project: `personalvm-511016`; zone: `us-central1-a`. SSH uses IAP, so the ephemeral public IP is not needed.

From PowerShell:

```powershell
gcloud compute ssh automation-server --project=personalvm-511016 --zone=us-central1-a --tunnel-through-iap
```

Inside SSH:

```sh
# Running state and recent logs
sudo systemctl status riot-notifier --no-pager
sudo journalctl -u riot-notifier -n 50 --no-pager

# Follow logs (Ctrl+C exits the log view; monitoring keeps running)
sudo journalctl -u riot-notifier -f

# Current Riot connection, per-friend observations and email retry state
sudo -u riot-notifier cat /var/lib/riot-notifier/status.json

# Restart, stop, or start
sudo systemctl restart riot-notifier
sudo systemctl stop riot-notifier
sudo systemctl start riot-notifier

# Confirm boot startup
sudo systemctl is-enabled riot-notifier

# Independent health monitor and failure alerts
sudo systemctl status riot-notifier-health --no-pager
sudo -u riot-notifier cat /var/lib/riot-notifier/health.json

# Send a test email
sudo -u riot-notifier /usr/local/bin/node --env-file=/etc/riot-notifier/notifier.env /opt/riot-notifier/notify/dispatch.cjs
```

The service is a system service named `riot-notifier`; your existing `automation@example-monitor` remains separate. It runs under the restricted `riot-notifier` account with restart-on-failure. Code is in `/opt/riot-notifier`, state and the encrypted rotating Riot session in `/var/lib/riot-notifier`, and private SMTP configuration/key in `/etc/riot-notifier`. It monitors the three friends selected in the existing Windows installation.

Healthy status has an advancing `updatedAt`, `chatConnected: true`, and `email: ok`. Initial connection can briefly show `observed: unknown`; `other` means a healthy observation of no VALORANT activity. Network/authentication outages remain unknown rather than offline. Email status records successful SMTP submission, not inbox delivery confirmation.

The Windows notifier's sign-in startup is disabled during the cloud migration to avoid concurrent renewal of the same saved session. If you later move back to Windows, stop the cloud service first and re-enable the Windows notifier's startup through `manage.ps1`/`EnableStartup.cmd`.

To change friends while retaining state for the others:

```sh
sudo -u riot-notifier /usr/local/bin/node --env-file=/etc/riot-notifier/notifier.env /opt/riot-notifier/resolve-friend.cjs --add 'Name#TAG'
sudo -u riot-notifier /usr/local/bin/node --env-file=/etc/riot-notifier/notifier.env /opt/riot-notifier/resolve-friend.cjs --remove 'Name#TAG'
```

If Riot revokes authorization, a new Windows remember-me login/session export will be needed. See [CLOUD.md](../CLOUD.md) for secure session replacement. Never print the private environment file, key, or decrypted session in a terminal or issue report.

Failure and recovery alerts are configured through a separate health service and Google Cloud Monitoring. See [HEALTH.md](HEALTH.md) for thresholds, timing, and planned maintenance.
