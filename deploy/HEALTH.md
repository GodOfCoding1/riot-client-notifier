# Monitoring health and failure alerts

There are two independent layers on `automation-server`:

1. `riot-notifier-health.service` checks the watcher every 15 seconds and sends incident, recovery, and unexpected-restart emails through the existing SMTP settings.
2. Google Cloud Monitoring checks `GET /healthz` on port 8081 every minute from multiple locations. At least two checkers must fail continuously for two minutes to open an incident. Google sends outage and recovery emails through its own notification channel, independently of the VM and SMTP credentials.

The endpoint returns only `{"ok":true}` (HTTP 200) or `{"ok":false}` (HTTP 503). It exposes no friends or credentials. The GCloud firewall rule `riot-notifier-health-checkers` allows that port only from Google's documented uptime-check IPv4 addresses. The existing SSH rules and automation service remain separate.

## What counts as bad

| Condition | Local threshold |
| --- | --- |
| systemd automatically restarted the watcher | Email on detection; crash notices limited to one per 10 minutes |
| Watcher is stopped or not running | 30 seconds |
| Status file missing, invalid, or not updated | 90 seconds since the last update; missing/invalid fails immediately |
| Status file belongs to an old process | 90 seconds |
| Any configured friend has no usable observation | 2 continuous minutes |
| Riot chat disconnected / unavailable | 2 continuous minutes |
| Friend-alert emails keep failing and remain pending | 5 continuous minutes |
| A health-notification email cannot be delivered | 5 minutes; Google provides the independent notification path |
| Missing friend configuration or email configuration | Immediate |
| Health guard cannot read/write its state, hangs, or stops | External check fails; a guard response older than 60 seconds fails |
| VM stops, crashes, loses networking, or becomes unreachable | External check fails |

`other` is a healthy observation: the friend is offline or outside VALORANT. It isn't an outage. `unknown` means the watcher cannot reliably determine their state. Brief reconnects and initial roster loading have a two-minute grace period. Recovery is reported only after fresh usable observations return for every configured friend.

For sustained failures, expect the local email after the threshold plus up to 15 seconds and SMTP time. Google's external email adds a two-minute incident window, probe scheduling, and metric/notification processing latency; allow several minutes. These timings are not delivery guarantees. A short crash may produce only the direct restart email. During a sustained failure both layers can send an incident email; they provide separate paths for resilience.

The guard persists incident state and an email retry queue in `/var/lib/riot-notifier/health-state.json`. Repeated checks don't send repeated incident emails. Failed health emails retry with increasing waits, capped at 15 minutes. Crash notices are limited to one per 10 minutes; sustained inability to monitor is covered by the incident alert. Google sends when an incident opens and closes, without periodic reminder emails.

## Inspect health

```sh
sudo systemctl status riot-notifier riot-notifier-health --no-pager
sudo -u riot-notifier cat /var/lib/riot-notifier/health.json
sudo journalctl -u riot-notifier-health -n 50 --no-pager
curl -i http://127.0.0.1:8081/healthz
```

The Google policy is [Riot monitoring unavailable](https://console.cloud.google.com/monitoring/alerting/policies/13656200321771057937?project=personalvm-511016).

For planned maintenance, snooze the Google alert policy in Cloud Monitoring. Intentional prolonged stops otherwise count as downtime too. Stop the health guard during maintenance if you also want to suppress its direct emails; resume it afterward. No software can guarantee delivery if both SMTP and Google's notification service fail, or if the destination mailbox rejects messages.

## Reconfigure

From this repo on Windows, `deploy/configure-monitoring.ps1` creates/reuses the email channel, scoped firewall rule, uptime check, and alert policy using your GCloud login. It reads only the notification recipient from the existing `.env` for Cloud Monitoring; SMTP credentials remain on the VM. Re-run it to refresh the firewall's Google checker-IP allowlist. The uptime check targets the VM resource ID rather than hard-coding its ephemeral public IP.

Install the health service alongside the watcher using `deploy/riot-notifier-health.service`; adapt its Node executable path if needed. The guard is currently a Linux/systemd deployment component; the Windows desktop watcher continues using the shared presence and delivery code.
