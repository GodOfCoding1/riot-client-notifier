# Riot Client Friend Notifier — Windows Desktop Alerts

[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4)](#requirements) [![Node.js: 22+](https://img.shields.io/badge/Node.js-22%2B-339933)](#installation) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Get a Windows desktop notification when a Riot friend comes online in VALORANT—even with Riot Client and VALORANT closed.** This lightweight Node.js watcher connects directly to Riot's XMPP chat service, reuses your saved remember-me login, and tracks friends by their stable PUUID.

Built for people who want a VALORANT friend online alert without keeping the game or launcher open. Includes a detailed [technical guide to Riot authentication and friend presence](TECHNICAL-GUIDE.md).

## Features

- Windows desktop notifications for friends entering VALORANT.
- Standalone Riot XMPP presence connection; no running Riot Client required after login setup.
- Automatic token renewal from your existing saved Riot login.
- Stable PUUID tracking that survives Riot ID changes.
- Duplicate suppression, debounce, and saved notification state across restarts.
- Network/authentication failures handled as unknown rather than offline.
- Per-user Windows sign-in startup and simple start, stop, status, and friend-selection controls.
- Windows DPAPI encryption for the watcher's session cache; no passwords in configuration.
- Vendored streaming XML parser; no npm dependency installation required.

## Requirements

- Windows with Windows PowerShell and desktop notification support.
- [Node.js](https://nodejs.org/en/download) 22 or newer available as `node` in your terminal.
- Riot Client installed and previously signed in with **remember me** enabled under the same Windows user.
- The friend you monitor must be an accepted friend of that Riot account.
- Internet connectivity; Windows must be signed in and the PC awake for desktop alerts.

This uses Riot's private authentication/social protocols. It was verified on a Windows installation; compatibility with every client version, account, or future authentication change is not guaranteed. It is an unofficial project, unaffiliated with Riot Games.

## Installation

Clone or download this repository, then run from its folder:

```powershell
git clone https://github.com/GodOfCoding1/valorant-friend-notifier.git
cd valorant-friend-notifier
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -RiotId 'YourFriend#TAG'
```

Without `-RiotId`, the installer reuses an existing selection or prompts for `Name#TAG`. It copies Node and the application into `%LOCALAPPDATA%\RiotFriendNotifier`, resolves the friend, runs checks, submits a test notification, enables sign-in startup, and starts the hidden watcher. No administrator account is required.

After setup, Riot Client and VALORANT can both be closed. If Riot revokes the saved authorization, sign into Riot Client again with remember me enabled. The watcher retries automatically.

## Change the friend, start, stop, or check status

Open `%LOCALAPPDATA%\RiotFriendNotifier` and double-click:

| Control | Action |
| --- | --- |
| `ChangeFriend.cmd` | Enter a different Riot ID; resolves and stores its PUUID |
| `Start.cmd` / `Stop.cmd` | Start or stop the background process |
| `Status.cmd` | Check running state, connection, latest observation, and startup |
| `Test.cmd` | Submit a Windows test notification |
| `DisableStartup.cmd` / `EnableStartup.cmd` | Remove or restore sign-in startup |

PowerShell example:

```powershell
$manager = Join-Path $env:LOCALAPPDATA 'RiotFriendNotifier\manage.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action ChangeFriend -RiotId 'AnotherFriend#TAG'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action Status
```

Stop does not disable future sign-in startup. DisableStartup does not stop the currently running process. Use both to disable the application completely.

## How it works

```mermaid
flowchart LR
    A[Saved Riot login] --> B[OAuth token renewal]
    B --> C[Entitlement and PAS / chat routing]
    C --> D[TLS XMPP connection]
    D --> E[Friend roster and live presence]
    E --> F[PUUID tracking and debounce]
    F --> G[Windows desktop notification]
```

Presence events update a local cache; the watcher evaluates it every 12 seconds. Entering VALORANT requires two healthy observations at least 12 seconds apart. Leaving requires 36 seconds of healthy non-VALORANT presence; a two-minute cooldown further suppresses repeats. A first confirmed already-online observation can notify once, and persisted state prevents repeat alerts on reconnects.

Concurrent launcher/mobile and VALORANT sessions are tracked separately. `dnd` can mean in-game activity and counts as online. Disconnected or stale streams are unknown, never treated as a confirmed offline transition. Very short visits or transitions during outages may be missed.

The watcher publishes normal Riot chat presence to subscribe to friend updates, so **your account may appear online in Riot chat**. It sends no chat messages, friend requests, or gameplay commands.

## Credentials and privacy

| File | Purpose |
| --- | --- |
| `%LOCALAPPDATA%\Riot Games\Riot Client\Data\RiotGamesPrivateSettings.yaml` | Existing Riot saved authorization, read without modification |
| `%LOCALAPPDATA%\RiotFriendNotifier\session.dpapi` | Refreshed watcher session encrypted for the Windows user |
| `config.json` | Selected friend, PUUID, and mode; no login secrets |
| `state.json` | Notification deduplication state |
| `status.json` / `watcher.log` | Sanitized health and delivery diagnostics |

Passwords and browser cookies are not requested. Remote HTTPS/TLS verifies certificates. The optional older loopback implementation confines its certificate exception to `127.0.0.1`.

Never commit saved Riot settings, decrypted tokens, encrypted session caches, cookies, or logs. See [SECURITY.md](SECURITY.md) for credential handling and report guidance.

## Verify that monitoring is healthy

Status should show `Running: True`, `source: independent-xmpp`, `chatConnected: true`, and a timestamp that advances. `observed: other` means a healthy non-VALORANT result; persistent `unknown` means activity cannot currently be determined. Short loading/renewal periods are expected.

`Test.cmd` tests Windows notification submission, not Riot connectivity or an actual friend transition. Check notification settings and Do Not Disturb if a banner does not appear.

```powershell
node .\tests.cjs
node .\xmpp-tests.cjs
```

The project has 29 transition, protocol, health, and encryption checks. Read the [verification record](verification.md) for the distinction between live evidence and simulated checks. Networking recovery is automatic; unexpected Node process exits currently require Start or a new sign-in.

## Raspberry Pi, Linux, and cloud servers

The direct-chat design is suitable for a future always-on server, but **this installation is Windows-specific**. Linux migration requires replacing the saved-login-file provider, DPAPI storage, Windows notifications, named-pipe lock, and startup management. Copying the folder or encrypted cache is not sufficient.

A Linux Raspberry Pi or VPS is a practical target. A conventional Arduino microcontroller would need a separate firmware implementation. Receiving alerts while the Windows PC is off also requires a phone-accessible notification channel. See the [migration section](TECHNICAL-GUIDE.md#8-moving-to-an-always-on-device-or-server).

## Documentation and development

- [Technical guide](TECHNICAL-GUIDE.md): live protocol discovery, OAuth refresh, XMPP authentication, friend roster, health checks, and migration.
- [Verification record](verification.md): observed results, simulations, and untested scenarios.
- [Contributing](CONTRIBUTING.md): setup, checks, and contribution expectations.
- [Security](SECURITY.md): protecting authorization and reporting vulnerabilities.
- [Third-party notices](THIRD-PARTY-NOTICES.md): vendored XML parser attribution.

## Uninstall

Run `Stop.cmd`, then `DisableStartup.cmd`. Delete `%LOCALAPPDATA%\RiotFriendNotifier`, including its encrypted session cache. Optionally remove the sender registry key `HKCU\Software\Classes\AppUserModelId\Local.RiotFriendNotifier`.

## License and references

Project code is [MIT licensed](LICENSE). The vendored sax parser retains its own license. VALORANT and Riot Games names are used to describe compatibility and remain their respective owners' trademarks.

Protocol references: [Riot OpenID metadata](https://auth.riotgames.com/.well-known/openid-configuration), [VALORANT XMPP documentation](https://valapidocs.techchrism.me/endpoint/xmpp-connection), and [techchrism's XMPP watcher](https://github.com/techchrism/valorant-xmpp-watcher).
