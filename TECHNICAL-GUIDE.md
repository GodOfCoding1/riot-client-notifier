# Riot Client Notifier: protocol discovery, operation, and migration

Written 7 October 2026. This guide describes the implementation installed on this PC, separates live evidence from assumptions, and explains how to study and extend it. Every token shown below is a placeholder. No actual login secrets are included.

## 1. What we discovered and what we reused

The working solution reuses your own Riot Client's saved remember-me authorization to obtain fresh tokens and open an independent connection to Riot chat. It needs neither the launcher nor Valorant running.

This was a combination of **live API inspection, existing open-source protocol research, and controlled experiments**. We did not disassemble the Riot executable, intercept your password, defeat MFA, decrypt Riot's opaque refresh token, or intercept TLS traffic. The XMPP authentication sequence was already described by community researchers. Our discovery specific to this PC was that its saved refresh authorization could renew successfully without any Riot Client process running.

Riot's published Valorant developer APIs list content, matches, rankings, and platform status; they do not provide the friend-presence endpoint needed here. This application uses the client's private authentication/social protocols rather than a public developer API key. [Official API documentation](https://developer.riotgames.com/docs/valorant).

### The investigation sequence

1. **Establish a known-good baseline.** With your client logged in, read its local lockfile and request friends, presences, and chat-session status. This established your friend's PUUID and the actual response shapes.
2. **Determine whether the game is necessary.** With Valorant absent, the launcher returned a changing match score and timestamps. Launcher-only presence was therefore live, but it stopped when the launcher/API disappeared.
3. **Inspect the running client's own schema.** GET `/swagger/v3/openapi.json` exposed endpoint names, supported HTTP methods, request types, and response fields. This is stronger evidence about this installed build than assuming an old online example is still accurate.
4. **Inspect authentication without printing secrets.** The access-token and entitlement endpoints worked. The cookie-jar endpoint returned an empty array; the refresh-token endpoint returned 404. We recorded status codes, key names, and expiry metadata only.
5. **Prove a separate connection.** Use the existing access token to obtain chat routing/authentication and connect directly to Riot XMPP. A successful handshake, roster, and real friend presence established that the watcher could be a separate client.
6. **Remove the original dependency.** Stop the launcher, RiotClientServices, and crash handler. The independent connection still received fresh friend updates, including their departure from Valorant.
7. **Prove renewal rather than just survival.** Inspect the structure of Riot's local private settings file. It contained a saved refresh authorization. Use it at Riot's token endpoint while Riot remained closed, then create a new XMPP connection with the renewed credentials.
8. **Install and exercise the real app.** Save its own session with Windows DPAPI, restart the watcher through its actual startup shortcut, resolve the friend independently, and verify health and notification submission.

A connection surviving shutdown does not prove it can start tomorrow. Steps 7 and 8 are what distinguish a standalone watcher from a temporary socket using a soon-to-expire launcher token.

## 2. The identities and credentials involved

These credentials have different jobs; treating them as interchangeable leads to confusing failures.

| Item | Purpose | Lifetime/storage in this implementation |
| --- | --- | --- |
| Lockfile password | Basic authentication to the running local Riot API | Temporary launcher secret; read into memory for the original loopback path |
| Refresh token | Obtain a fresh access token without re-entering the password | Riot's saved login; renewed copy protected in the watcher's DPAPI cache |
| Access token / RSO token | Authorize Riot HTTPS requests and the XMPP handshake | Short-lived; expiry provided by the token response |
| ID token | Identity claims from the login session | Retained in the encrypted cache; not the bearer credential used for chat |
| Entitlement token | Obtain authenticated client configuration in this implementation | Obtained from the entitlement service; encrypted cache |
| PAS token | Authorize chat and identify the account's chat affinity | Obtained for the current chat connection; memory only |
| PUUID | Stable identifier for your friend | Non-secret identifier in config and deduplication state |

The observed saved refresh token had five dot-separated segments, consistent with an encrypted JWT/JWE-style envelope. The watcher treats it as **opaque**: it sends the token back to Riot rather than attempting to decrypt it. An access/ID/PAS token may have readable claims, but decoding those claims does not verify the token or grant authorization.

### Where the credentials live

**Riot's saved authorization, read only by our code:**

```text
%LOCALAPPDATA%\Riot Games\Riot Client\Data\RiotGamesPrivateSettings.yaml
```

Fields read by `saved-login.cjs` are `refresh_token`, `id_token`, and `is_dpop_bound`. The file remains Riot's responsibility. Our code never rewrites it. The current extraction uses a small line-based parser; it assumes this observed layout and selects the first matching fields. Before generalizing to multiple accounts or a changed schema, use a proper YAML parser and explicitly select the `authorization` / `riot-client` section.

**The installed watcher's encrypted session:**

```text
%LOCALAPPDATA%\RiotFriendNotifier\session.dpapi
```

Its decrypted structure includes the access token, refreshed refresh token, ID token, entitlement, expiry, and a hash of the source refresh token. On disk, the entire structure is protected with Windows `ProtectedData` using `CurrentUser`, then Base64-encoded. Base64 is just the outer representation; **DPAPI supplies the protection**.

`secure-session.cjs` passes input/output to `protect-session.ps1` over child-process pipes. Tokens do not appear in the PowerShell command line. `protect-session.ps1` uses the application-specific entropy string `RiotFriendNotifier/session/v1`; that string is not a password or encryption key.

CurrentUser protection ties decryption to the Windows user's protection context. Do not expect this file to decrypt under another user or on a Linux host. Processes acting as your Windows user can use that user's DPAPI access, so the cache is still sensitive. [Microsoft DPAPI scope documentation](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dataprotectionscope).

**Original launcher-only credentials:**

```text
%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile
```

The lockfile has `name:pid:port:password:protocol`. Its password is not the Riot account password and cannot renew an account login. It is relevant only while the local API exists.

`config.json`, `state.json`, `status.json`, and `watcher.log` contain no authentication credentials. Tokens exist in memory while requests are made. Never publish the private Riot settings file, a decrypted cache, authorization headers, or full token responses.

## 3. The standalone authentication flow

```mermaid
sequenceDiagram
    participant W as Watcher
    participant D as Local saved login / DPAPI cache
    participant A as Riot token service
    participant E as Riot entitlement service
    participant P as Riot PAS service
    participant C as Riot configuration service
    participant X as Riot XMPP server
    W->>D: Read saved refresh authorization
    W->>A: POST refresh_token grant
    A-->>W: Access token, expiry, refreshed session
    W->>E: POST bearer access token
    E-->>W: Entitlement token
    W->>D: Persist renewed session with user protection
    W->>P: GET chat PAS with bearer token
    P-->>W: PAS token with chat affinity
    W->>C: GET configuration with bearer + entitlement
    C-->>W: Chat host/domain mappings
    W->>X: Verified TLS on port 5223; RSO/PAS authentication
    X-->>W: Roster and live presence updates
```

### 3.1 Renew the existing authorization

The HTTP exchange implemented in `saved-login.cjs` is:

```http
POST https://auth.riotgames.com/token
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=refresh_token&client_id=riot-client&refresh_token=<SAVED_REFRESH_TOKEN>
```

`client_id` identifies the client authorization being renewed; it is not a secret. The refresh token is the credential that authorizes renewal. There is no password in this exchange. Riot's OpenID metadata advertises the token endpoint and refresh-token grant; successful acceptance of this particular saved authorization was established by a live experiment. [Riot OpenID metadata](https://auth.riotgames.com/.well-known/openid-configuration).

The code reads `access_token`, `expires_in`, optional `id_token`, and optional `refresh_token` from the response. It computes expiry as `Date.now() + expires_in * 1000`. If Riot issues a replacement refresh token, the watcher keeps it in its own encrypted cache, leaving Riot's settings unchanged.

`Credentials.get()` first reads the native saved login, even when an encrypted cache exists. A SHA-256 fingerprint of that source refresh token detects a changed native login and invalidates the old cache. If the cached refreshed credential fails and differs from the native source, the code makes one attempt with that native source. It does not blindly retry an identical credential twice.

The implementation refuses a saved login marked `is_dpop_bound: true`. DPoP binds authorization to proof from a key, and a refresh token alone would be insufficient. We did not implement that proof flow. The observed authorization on this PC was not DPoP-bound.

### 3.2 Obtain the entitlement

```http
POST https://entitlements.auth.riotgames.com/api/token/v1
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{}
```

The response field used is `entitlements_token`. These POST requests establish/renew authentication; the watcher performs no game, friend-list, or messaging mutations.

### 3.3 Obtain PAS and determine chat routing

```http
GET https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat
Authorization: Bearer <ACCESS_TOKEN>
```

The PAS response is a token. Decode its payload in memory to read `affinity`. Then fetch configuration:

```http
GET https://clientconfig.rpg.riotgames.com/api/v1/config/player?app=Riot%20Client
Authorization: Bearer <ACCESS_TOKEN>
X-Riot-Entitlements-JWT: <ENTITLEMENT_TOKEN>
```

Select `chat.affinities[affinity]` for the host and `chat.affinity_domains[affinity]` for the domain prefix. On this account we observed `jp1.chat.si.riotgames.com` and `jp1.pvp.net`; the code obtains these from configuration rather than assuming all accounts use JP1.

The code restricts the returned host to a `.riotgames.com` suffix and validates the region syntax. Remote HTTP requests and the chat socket verify certificates normally. The certificate exception in the older loopback module is confined to requests to `127.0.0.1`.

### 3.4 Authenticate the XMPP stream

`xmpp.cjs` opens a verified TLS TCP socket to the selected host on port 5223. It then performs this sequence, waiting for the matching server response after each step:

1. Open an XML stream addressed to the chat domain.
2. Verify the advertised authentication features include `X-Riot-RSO-PAS`.
3. Send the access token and PAS token using that mechanism; require a success response.
4. Restart the XML stream and reset the XML parser after authentication.
5. Bind a unique resource, `RiotFriendNotifier-<random suffix>`; require an IQ result.
6. Establish the XMPP session; require an IQ result.
7. Request the roster and publish normal chat presence to subscribe to updates.

The authentication stanza, with placeholders, is:

```xml
<auth mechanism="X-Riot-RSO-PAS"
      xmlns="urn:ietf:params:xml:ns:xmpp-sasl">
  <rso_token>ACCESS_TOKEN</rso_token>
  <pas_token>PAS_TOKEN</pas_token>
</auth>
```

This sequence came from existing protocol research and was validated against the live server. It was not invented by guessing token names. [Reference implementation](https://github.com/techchrism/valorant-xmpp-watcher/blob/trunk/src/XMPPManager.ts).

TLS transports a stream of bytes, not complete XML messages. One stanza may arrive in several packets; one packet may contain several stanzas. `StringDecoder` preserves fragmented UTF-8 characters, and the SAX parser assembles stanza trees incrementally. Parsing occurs under the intentionally open `stream:stream` root. The parser limits nesting depth and accumulated text size and closes the socket on malformed XML.

## 4. Friends roster versus active friends

The roster is **all accepted friends**, not a list of players currently playing Valorant. Presence is the separate, changing information needed to determine activity.

The request is:

```xml
<iq type="get" id="roster">
  <query xmlns="jabber:iq:riotgames:roster" last_state="true"/>
</iq>
<presence/>
```

An observed roster item for the selected friend had this structure:

```xml
<item jid="00000000-0000-4000-8000-000000000000@jp1.pvp.net"
      subscription="both"
      puuid="00000000-0000-4000-8000-000000000000">
  <id name="ExampleFriend" tagline="TAG"/>
</item>
```

`standalone-friends.cjs` resolves all requested IDs from one roster. It matches `id.name` and `id.tagline` case-insensitively, requires `subscription="both"`, and requires one unique match per ID. `resolve-friend.cjs` atomically saves a `friends` array containing each PUUID and canonical display ID. Failed resolution of any ID preserves the existing configuration; duplicate PUUIDs are collapsed. Future presence monitoring matches the PUUID, so a name change does not stop monitoring.

`monitor.cjs` accepts both this array and the legacy single-friend configuration. It maintains one tracker per selected PUUID, migrates legacy saved state, and persists tracker state in `state.json` under `friends[puuid]`. Selection changes keep existing trackers for retained friends and discard removed friends. Each tracker has its own debounce, cooldown, and pending notification retry. `status.json` contains a `friends` array with each friend's observed and stable state.

Publishing `<presence/>` subscribes to incoming friend updates and also advertises your own normal chat availability. Your account can therefore appear online in Riot chat while the watcher runs. The watcher does not claim to be playing Valorant and sends no chat messages.

### Presence has multiple resources and products

A simplified incoming stanza is:

```xml
<presence from="FRIEND_PUUID@jp1.pvp.net/RC-123">
  <games>
    <keystone><st>chat</st><s.t>1791380000000</s.t></keystone>
    <valorant><st>dnd</st><s.t>1791380005000</s.t><p>BASE64_JSON</p></valorant>
  </games>
</presence>
```

The part after `/` is a **resource**, representing a distinct chat session. A friend can have launcher/mobile and Valorant resources simultaneously. One `StandalonePresence` connection caches incoming presence for friends by the full `from` address, tags rows with their PUUID, and filters snapshots to the selected PUUIDs. Changing the selection does not reconnect or lose initial presence. `type="unavailable"` removes only the resource that left, not every session for that friend. The loopback mode also reads all selected friends in a single healthy snapshot per poll.

`targetView()` filters the selected PUUID and normalizes `keystone` to `riot_client`. `presence.cjs` considers Valorant states `chat`, `away`, `dnd`, `mobile`, and `online` active. In particular, `dnd` is not offline; it was the live in-match status we observed. An active Valorant row wins over other products. Unknown Valorant status strings produce `unknown`; otherwise the result is `other`, meaning **not currently in Valorant**, not necessarily entirely offline.

The `<p>` data can be decoded from Base64 to JSON in memory to inspect game-specific details. Earlier probes used match state, score, and timestamps to prove freshness. The production notification decision does not require parsing match details.

### Extending this into a complete active-friends list

The installed monitor keeps presence for **one target**, not an exported live list for every friend. To build a full list, generalize the cache:

```javascript
// Architecture sketch: not an installed command.
rosterByPuuid = Map<PUUID, {name, tagline}>
presenceByPuuid = Map<PUUID, Map<resourceJid, productRows>>

onPresence(stanza):
    puuid = parsePuuidFromJid(stanza.from)
    if puuid is not in rosterByPuuid: return
    if stanza.type == "unavailable":
        delete only presenceByPuuid[puuid][stanza.from]
    else:
        replace presenceByPuuid[puuid][stanza.from] with parsed games

activeValorantFriends():
    require a healthy connection and completed initial roster/load
    return friends with any active Valorant product across their resources
```

Keep generic chat-online and Valorant-online as separate filters. A mobile chat session should not imply Valorant activity. On disconnect, mark the entire view unknown; do not present the old cache as a fresh active list. Also define a timestamp policy if duplicate or out-of-order updates appear. The current code replaces resource rows on arrival and does not implement a general timestamp conflict resolver.

## 5. Notification state and connection health

XMPP events update the cache immediately. The outer watcher evaluates that cache every 12 seconds after each completed cycle; it is not repeatedly downloading an online-friends list over HTTP.

| Mechanism | Actual behavior |
| --- | --- |
| Initial load | Require roster success, then wait at least 12 seconds before treating absence as meaningful |
| Enter Valorant | Two healthy observations at least 12 seconds apart |
| Leave Valorant | Healthy non-Valorant observations spanning at least 36 seconds |
| Cooldown | Two minutes since the last successful notification; pending entry can notify after the cooldown if still active |
| Unknown | Clear the debounce candidate; preserve the committed state and deduplication |
| Persisted state | Save stable status, last successful alert time, and pending-alert flag by PUUID |
| Delivery failure | Leave notification pending and retry while the friend remains active |
| Chat keepalive | Send XMPP ping every 60 seconds |
| Stale stream | Replace a connection after 150 seconds without incoming stanzas |
| Renewal | Begin reconnection/renewal around 60 seconds before access-token expiry; credential reuse requires more than 90 seconds remaining |
| Retry | A close/error records a 15-second delay; a failed connection attempt records a 30-second delay, evaluated on subsequent watcher cycles |

These controls deliberately miss very short game visits and cannot reconstruct transitions that happened entirely during an outage. `state.json` does not prove current health; it exists to preserve notification behavior.

The named pipe in `watcher.cjs` provides a per-installation single-instance lock. `manage.ps1` also checks the exact Node executable and watcher command line before starting/stopping. This is not a process supervisor: automatic reconnect handles networking failures, but an unexpected Node process exit will not restart itself until you run Start or sign in again.

## 6. Day-to-day controls

The running files are in `%LOCALAPPDATA%\RiotFriendNotifier`. The source files in `<checkout-directory>` are separate; editing source alone does not change the currently running installation.

Double-click the corresponding `.cmd` file in the installation folder:

| Task | File |
| --- | --- |
| Start | Start.cmd |
| Stop immediately | Stop.cmd |
| Replace monitored friends interactively | ChangeFriends.cmd (ChangeFriend.cmd remains supported) |
| Add friends to the selection | AddFriend.cmd |
| Remove friends from the selection | RemoveFriend.cmd |
| Check process, startup, and last status | Status.cmd |
| Test Windows notification delivery | Test.cmd |
| Remove future sign-in startup | DisableStartup.cmd |
| Restore sign-in startup | EnableStartup.cmd |

PowerShell alternatives:

```powershell
$notifierDir = Join-Path $env:LOCALAPPDATA 'RiotFriendNotifier'
$manager = Join-Path $notifierDir 'manage.ps1'

powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action Test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action ChangeFriends -RiotId 'FriendOne#TAG,FriendTwo#TAG'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action AddFriend -RiotId 'DifferentName#TAG'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action RemoveFriend -RiotId 'FriendOne#TAG'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $manager -Action DisableStartup
```

ChangeFriends, ChangeFriend, and AddFriend work with Riot closed provided the saved login is valid and the account can retrieve its roster. Pass comma-separated IDs for multiple friends. A failed resolution preserves the old config. RemoveFriend uses stored IDs without a connection and rejects removal of the last friend; use Stop to pause monitoring. Do not change only a display label in `config.json`: the PUUID is what actually selects the friend.

Stop does not remove the startup shortcut; DisableStartup does not stop the current process. Use both when disabling the application completely. The shortcut is under your account's Startup folder:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Riot Client Notifier.lnk
```

The setup script accepts `-RiotId 'Name#TAG,Another#TAG'` (one ID also works), otherwise reuses all existing selections or prompts. Re-running it submits a test notification and reinstalls the watcher. It does not delete `state.json`.

## 7. How to know it is really working

Check three different layers: process, data source, and delivery. None by itself proves all three.

### A. Process and fresh status

Status should show `Running: True`, `source: independent-xmpp`, and normally `chatConnected: true`. `updatedAt` should keep advancing about every 12 seconds, allowing extra time for requests and renewal. Its timestamp is UTC (`Z`); India time is UTC + 05:30.

This check reports file age without reading any secrets:

```powershell
$notifierDir = Join-Path $env:LOCALAPPDATA 'RiotFriendNotifier'
$status = Get-Content -LiteralPath (Join-Path $notifierDir 'status.json') -Raw | ConvertFrom-Json
$ageSeconds = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($status.updatedAt)).TotalSeconds
[pscustomobject]@{
    AgeSeconds = [math]::Round($ageSeconds)
    Source = $status.source
    ChatConnected = $status.chatConnected
    Friends = $status.friends
}
```

An age over roughly 90 seconds merits checking Status and the logs; it is a troubleshooting threshold, not a guarantee. The status file can remain after Stop or a crash, so a fresh-looking filename or recorded PID alone is insufficient.

### B. Healthy presence

Each entry in `status.friends` has its own observation. `observed: valorant` means that friend is currently represented by an active Valorant row. `observed: other` is a healthy non-Valorant result. `observed: unknown` means the monitor cannot currently determine the answer; short initial loading/renewal periods are expected. If it stays unknown, inspect:

```powershell
Get-Content -LiteralPath "$env:LOCALAPPDATA\RiotFriendNotifier\watcher.log" -Tail 30
```

Logs intentionally suppress token responses and detailed authentication failures. Check internet/DNS, time synchronization, valid remember-me login, and ability to reach Riot HTTPS and chat. To repair an invalid saved authorization, sign into Riot Client with remember me, then close it. A Stop/Start forces the watcher to establish a new connection promptly.

`tokenExpiry` is the current access token's expiry, not a deadline to reopen Riot every hour. It should advance on successful renewal. `chatConnected: true` alone does not certify that the initial roster has loaded; also check `observed` and freshness.

### C. Notification delivery

Run Test.cmd. `submitted: true` confirms the helper submitted a toast; `setting: Enabled` and notification history are stronger delivery evidence. Banner/sound visibility still depends on Windows notification settings and Do Not Disturb. Test.cmd does not test the friend's transition or Riot connectivity.

The end-to-end live test is: obtain a healthy non-Valorant state, have the selected friend actually enter Valorant, wait for debounce, and check the resulting alert/log. Do not force this by deleting state or injecting fake presence unless you clearly label the test as simulated.

### D. Repeat the deterministic checks

```powershell
$notifierDir = Join-Path $env:LOCALAPPDATA 'RiotFriendNotifier'
& (Join-Path $notifierDir 'runtime\node.exe') (Join-Path $notifierDir 'tests.cjs')
& (Join-Path $notifierDir 'runtime\node.exe') (Join-Path $notifierDir 'xmpp-tests.cjs')
& (Join-Path $notifierDir 'runtime\node.exe') (Join-Path $notifierDir 'multi-friend-tests.cjs')
```

Together these run 48 checks. Most simulate state/protocol/health cases; one exercises Windows DPAPI with synthetic data, and another runs Windows management commands in a temporary installation. The multi-friend suite checks simultaneous independent alerts, separate departure/re-entry and retry behavior, restart deduplication, outage handling, shared resource isolation, roster resolution, atomic configuration changes, and legacy migration. The notification suite checks Gmail message formatting, toast-success with email retry, and Linux email gating. These do not prove live friend transitions.

As last checked for this documentation, the installed process was running, sign-in startup was enabled, chat was connected through independent XMPP, and the target was in the healthy `other` state. That is a point-in-time observation; use Status for current information.

## 8. Moving to an always-on device or server

### Choose the execution platform

For this JavaScript implementation, a **Raspberry Pi running Linux**, another small Linux computer, or a VPS is the practical route. Raspberry Pi OS Lite provides a headless Linux environment; choose a Node runtime that matches the device architecture. [Raspberry Pi OS documentation](https://www.raspberrypi.com/documentation/computers/os.html).

An ordinary Arduino UNO R3 is a microcontroller board rather than a Node/Linux computer. UNO R4 WiFi adds networking and a programmable ESP32-S3, but the main MCU still has constrained memory. Running this Node/PowerShell application directly on those boards is not an option; implementing authentication, certificate-validating TLS, streaming XML, refresh persistence, and notification delivery there would require a separate firmware implementation. This engineering assessment follows their documented hardware capabilities. [UNO R3](https://docs.arduino.cc/hardware/uno-rev3/), [UNO R4 WiFi](https://docs.arduino.cc/hardware/uno-r4-wifi/).

Some Arduino-branded devices have Linux-capable hardware, so the exact model matters. If you already have a microcontroller, a simpler role for it is receiving a compact notification from the server and blinking an LED/buzzer; leave Riot credentials and XMPP on the server.

### Concrete portability blockers in the current code

| Component | Current dependency | Required change |
| --- | --- | --- |
| Native login source | `saved-login.cjs` reads Windows LOCALAPPDATA and Riot's private YAML; **`Credentials.get()` reads this on every call, even with a valid cache** | Introduce a credential-source interface and explicitly provision renewable authorization on the server |
| Session protection | Windows PowerShell + CurrentUser DPAPI | Use the server's secret store or encrypted state with a separately provisioned key; persist rotated tokens atomically |
| Runtime | Bundled Windows `node.exe` | Install compatible Linux/ARM or Linux/x64 Node with the required modern APIs |
| Notifications | Windows toast in `notify/windows.cjs`; Gmail SMTP in `notify/email.cjs` | On Linux, do not load the Windows adapter. The same dispatcher treats configured email as the gating channel. SMTP settings stay in `.env`. |
| Single-instance lock | Windows named-pipe path | Use a Linux-compatible lock/socket or rely on one supervised service instance |
| Startup/control | `.cmd`, `manage.ps1`, user Startup shortcut | Use a boot service such as systemd with restart-on-failure |
| State and paths | Relative to installation directory | Separate immutable code from writable state and secrets |
| Tests | DPAPI integration test is Windows-specific | Keep platform-neutral tests and replace the platform-storage integration test |

Copying the source folder or the existing DPAPI file is **not sufficient**. Even a theoretically usable cached access token would be short-lived, and the current unconditional native-file read would fail on Linux first.

### Migration sequence

1. Refactor authentication into `getToken()/refresh()` backed by a server credential store rather than Riot's Windows YAML. Keep private authorization out of source control and console output.
2. Provision an authorized renewable session over a secure transfer/login path. Do not copy the entire Riot private-settings file or paste tokens into shell history. Confirm independently that renewal works from the new host. Windows DPAPI ciphertext cannot serve as the Linux credential source.
3. Keep the existing XMPP framing, roster resolution, resource cache, classification, and debounce logic where possible. Install the vendored parser and a compatible runtime.
4. Keep `notify/email.cjs` as the server alert channel and do not load Windows toast delivery. A powered-off Windows PC cannot display a desktop toast.
5. Run one credential writer/service instance. Multiple hosts sharing a rotating refresh session can introduce races; all combinations of concurrent Riot launcher and multiple watchers have not been verified.
6. Configure a non-root service account, writable state directory, boot startup, process crash restart, and sanitized health logs. Keep deduplication state across restarts. A service supervisor must not treat network unknown as friend offline.
7. Ensure outbound DNS, HTTPS/TCP 443 to the authentication/configuration services, and TLS/TCP 5223 to the configured chat host. No public inbound listener or router port forwarding is needed for Riot monitoring itself. Use correct system time and a valid CA trust store.
8. Test a server reboot, network outage, fresh authentication renewal, actual live friend entry, notification delivery, and a sustained soak across multiple real token renewals with the Windows PC off.

Cloud IPs, different regions, session revocation, authentication changes, DPoP-bound logins, and future protocol changes remain possible blockers. This Windows run does not prove that the same session will work from every cloud IP or indefinitely. A separate account would see only its own accepted friends and would require its own authorized login/roster setup.

## 9. Code reading map and lessons to reuse

Start with `presence.cjs`, then follow the dependency chain below. Each source file has a matching installed copy except the exploratory/audit tools.

| File in `<checkout-directory>` | What to study |
| --- | --- |
| presence.cjs | Pure classification, debounce, cooldown, pending delivery, saved state |
| saved-login.cjs | Native saved authorization extraction and OAuth refresh exchange |
| standalone-auth.cjs | Cached credentials, source fingerprint, entitlement/PAS/configuration flow |
| secure-session.cjs / protect-session.ps1 | Process pipes and Windows user-protected persistence |
| xmpp.cjs | TLS, incremental XML, authentication handshake, resource binding, ping, target normalization |
| standalone-friends.cjs | Roster request and Name#TAG to PUUID resolution |
| standalone-presence.cjs | Live resource cache, load grace, connection health, renewal/reconnect |
| watcher.cjs | Single instance, configuration reload, notification delivery, state/status/log files |
| notify/dispatch.cjs | Windows toast and Gmail channels, which channel gates dedupe, and email retry |
| manage.ps1 / install.ps1 | Exact process selection, per-user startup, installation layout |
| login-probe.cjs / standalone-probe.cjs | Exploratory metadata-only login and direct connection experiments |
| audit-secrets.cjs | Check known installed-session tokens against diagnostic files without printing them |
| tests.cjs / xmpp-tests.cjs | Reproducible failure and transition cases |
| verification.md | Live evidence, simulated checks, and tests not performed |

For similar projects, first identify who owns the authoritative data, then discover the actual interface, distinguish short-lived from renewable authorization, understand message framing and identity, and design unknown-state recovery before notifications. Use controlled experiments that remove one dependency at a time. Record what was observed, what was inferred, and what remains untested. Suppress secrets at the point where diagnostic data is collected rather than trying to redact them after logging.

## 10. What remains unverified

We observed live presence and friend departure with Riot off, renewed the saved login directly, created fresh connections, restarted the installed watcher, submitted Windows toasts, and passed 29 checks. We have not observed a live friend entering Valorant during these sessions, waited through a natural hour-long token expiry in a soak test, performed a Windows reboot/sign-in, deployed to Linux/cloud/microcontroller hardware, or demonstrated indefinite session renewal. These are useful next validation steps, not results already achieved.
