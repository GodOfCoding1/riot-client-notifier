# Multi-friend update — 2026-10-07

* Passed 40 checks: 18 transition/API tests, 11 XMPP/health/encryption tests, and 11 multi-friend tests.
* Multi-friend tests cover simultaneous alerts, separate departure/re-entry and notification retry behavior, persisted deduplication, legacy migration, selection changes, outages/reconnects, shared XMPP resource isolation, loopback filtering, accepted roster resolution, and atomic configuration updates.
* The Windows management integration test runs `RemoveFriend` against a temporary installation with synthetic friends, checks comma-separated removal, and verifies that removing the final friend fails without changing configuration.
* PowerShell installer and management scripts passed syntax parsing. Live Riot friend transitions and the full installer were not exercised for this update. Earlier live evidence below predates these changes.

> Personal friend identifiers and local machine paths have been replaced with illustrative placeholders for publication. The recorded live-versus-simulated distinctions are preserved.

# Current verification — independent Riot login, 7 October 2026 (India time)

The loopback-only installation described below has been superseded. The installed default is now `mode: standalone`, using an independent Riot XMPP connection.

* At approximately 20:23 IST, a separate TLS XMPP connection authenticated using the running Riot Client's read-only login-token endpoint. It returned the roster and ExampleFriend's live Valorant presence.
* Riot Client UI processes, RiotClientServices, and its crash handler were then stopped. No Valorant process was running. The separate connection remained alive and received fresh target Valorant timestamps at 20:25:15 and 20:25:17, then a live `dnd` to `chat` change, removal of the Valorant product, and resource departure. This proves live launcher-off delivery, including the friend leaving Valorant.
* Riot's local cookie endpoint returned zero cookies, and its read-only refresh-token endpoint returned 404. The saved remember-me authorization in `RiotGamesPrivateSettings.yaml` provided a usable refresh login instead. The native Riot settings file is read only and is never modified by this watcher.
* At 20:25:31, direct renewal at Riot's token endpoint succeeded with all Riot processes stopped. The returned access token had a fresh expiry. Further renewals and fresh XMPP handshakes while the client remained closed succeeded, proving the watcher can start independently rather than merely retain an old open socket.
* The installed watcher uses Windows CurrentUser DPAPI for `session.dpapi`. A synthetic-data encryption/decryption test passed and confirmed the stored bytes contain no plaintext synthetic token. No password or browser cookies were requested or captured. Authentication secrets are not passed in shell command arguments or logged.
* Independent roster resolution of `ExampleFriend#TAG` succeeded with Riot Client closed; the stable PUUID remains `00000000-0000-4000-8000-000000000000`.
* The installed notifier submitted another test toast; Windows reported `Enabled` and history count 1. Visual banner appearance was not independently observed.
* The background watcher became healthy using `source: independent-xmpp` and committed the current non-Valorant state after debounce. Windows sign-in startup remained enabled.
* At approximately 20:34 IST, the installed watcher was stopped, its encrypted session was loaded, and a forced renewal succeeded while Riot remained off. Token expiry advanced from 22:32:09 to 22:34:21 IST. The actual Startup shortcut restarted the watcher independently using that renewed session.
* Final status verified: running, sign-in startup enabled, independent XMPP connected, current observed/stable state non-Valorant. No Riot Client or Valorant processes were present. ChangeFriend resolved the same target successfully with the client off. An audit confirmed the installed cache decrypts under this Windows user and its known tokens are absent from logs/config/status.
* 29 checks passed: the prior 18 deterministic transition/API tests and 11 XML, stream-health, expiry, and Windows encryption checks. Friend entry transitions and outage/expiry failures are simulated; forced successful renewal, fresh connections, live presence updates, and leaving Valorant are live verification.

No live non-Valorant-to-Valorant entry was observed during this upgrade. An hour-long natural token expiry, a Windows reboot/sign-in, and cloud hosting were not performed. Successful forced refresh exercises the same renewal method used before expiry. Indefinite session validity is not claimed; revoked/expired saved login requires signing into Riot again.

## Earlier loopback installation (superseded)

Live checks completed between approximately 20:00 and 20:11 IST.

* `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile` was read locally, without printing its secret. Only read-only HTTPS loopback Riot endpoints were queried with Basic username `riot`.
* GET `/chat/v4/friends` returned HTTP 200 with 31 friends. Exact Riot ID `ExampleFriend#TAG` resolved to PUUID `00000000-0000-4000-8000-000000000000`.
* GET `/chat/v4/presences` returned HTTP 200. This PUUID had simultaneous `valorant` / `dnd` and `riot_client` / `chat` rows. Decoded Valorant private data indicated `INGAME`.
* GET `/chat/v1/session` returned a loaded, connected chat session. Later reads checked connected/loaded before and after presence retrieval.
* Only Riot Client processes were present; no Valorant process was running. The friend's match score updated from 4–8 to 6–8, and the Valorant presence timestamp advanced from 1791383595483 to 1791383825566. This verifies fresh launcher-only presence on this installed client. Launching Valorant locally was unnecessary.
* The native Windows toast test was submitted successfully. Windows reported sender setting `Enabled`; its notification history contained the toast. The watcher subsequently submitted the initial already-online notification successfully. Visual banner appearance was not independently observed; Windows Do Not Disturb can affect it.
* Hidden background process and fresh status timestamps were verified. Start while running kept one watcher; Stop terminated it. The actual per-user Startup shortcut was launched and started a new hidden watcher. After repeated healthy online polls, no duplicate notification was logged, confirming persisted-state behavior across a real watcher restart. A future Windows sign-in itself was not performed.
* 18 deterministic simulated tests passed: online startup, other-game/offline entry, concurrent product rows, short fluctuations, unknown states, reconnection, saved-state restart, cooldown, failed notification retry, read-only route restriction, disconnected/unloaded chat, request failure, disconnection/restart during snapshot, invalid response, PUUID filtering, and new client generation recovery.

* During final verification the launcher processes disappeared, although RiotClientServices remained running. Requests became unavailable. The watcher observed `unknown` and retained stable `valorant`, with no extra alert. Launching the installed `<Riot installation>\RiotClientServices.exe` reopened the launcher and restored loaded/connected live presence; the match score was now 6–9. This was a real API outage and recovery, not a deliberately forced service restart. Keep the launcher open or minimized; the service alone was insufficient on this PC.
* The running watcher automatically recovered from `unknown` to `valorant` at 20:10:10 IST after the launcher reopened. Further polls confirmed healthy presence with no duplicate notification. Final status: watcher running, startup enabled, observed/stable state `valorant`.
* Startup removal was exercised and verified, then restored. The change-friend command safely preserved its existing configuration when invoked during the real API outage; after recovery it successfully resolved and saved ExampleFriend#TAG again.

No live offline-to-Valorant friend transition occurred during setup. Friend transition behavior was simulated, along with full service restart and disconnected-session edge cases. No WebSocket event support is claimed; this installation polls every 12 seconds.
# Cloud deployment verification — 2026-10-09

The cloud profile was deployed to `automation-server` in project `personalvm-511016`, zone `us-central1-a`, using Node 24.21.0. The Linux test suites passed; Windows DPAPI/manager integration were skipped. Exported authorization refreshed successfully from the VM and established Riot XMPP chat. All three existing monitored friends reached healthy presence observations. The VM submitted a test email and a real VALORANT presence alert through the configured SMTP channel; inbox receipt was not independently checked.

The system service `riot-notifier` is enabled at boot. A deliberate SIGKILL of its main process caused systemd to restart it after 15 seconds, recover the stale PID lock, and reconnect to Riot. Saved per-friend state retained the prior alert after restart. Runtime secrets use restricted permissions and the encrypted session lives on persistent disk. The existing example automation service was left in place. Windows notifier sign-in startup was disabled to prevent competing session renewal.

This verification does not include rebooting the VM or waiting for a natural one-hour token expiry. See [the deployment runbook](deploy/GCLOUD.md) for operations.
# Failure alert verification — 2026-10-09

Five deterministic health tests passed on Windows and Linux. They cover stale status, old-process status, a single unknown friend, healthy offline friends, grace periods, stopped services, pending email delivery, persisted incident deduplication, recovery after usable observations resume, crash notice throttling, and retrying failed health emails.

The independent `riot-notifier-health` system service and Google Cloud uptime alert policy were installed and enabled. A deliberate watcher crash was recovered by systemd and produced an unexpected-restart email verified in the recipient inbox. Six Google check locations first reported the health endpoint as passing. The health service was then deliberately stopped for four minutes with a systemd timer scheduled to restore it; the friend watcher continued running. All six external probes reported failure, and Google's independent outage email was verified in the recipient inbox. The timer restored the health service; both services were active and the endpoint returned HTTP 200 again.

The Google recovery email was also verified in the recipient inbox after all six probes resumed passing. This exercises the externally unreachable-endpoint path without shutting down the VM. The VM itself was not rebooted or stopped for this test. Unknown-friend and SMTP-failure thresholds were verified with synthetic cases; inbox delivery during a future outage still depends on the notification providers and recipient mailbox.
