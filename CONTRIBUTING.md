# Contributing

Use Windows and Node.js 22 or newer for the complete test suite. The XML parser is vendored, so dependency installation is unnecessary.

```powershell
node tests.cjs
node xmpp-tests.cjs
node multi-friend-tests.cjs
```

The second suite includes a Windows DPAPI round-trip using synthetic data. The third checks independent multi-friend tracking, shared XMPP presence, atomic selection updates, legacy migration, and Windows management command integration. Most tests simulate protocol and transition cases; mark live experiments separately when reporting results.

Before a contribution:

1. Keep credentials, personal Riot IDs/PUUIDs, caches, and raw presence logs out of commits.
2. Preserve unknown-state behavior during outages and deduplication across restarts.
3. Use certificate verification for remote Riot connections.
4. Describe the concrete behavior changed and the checks performed.
5. Update the README or technical guide when setup or protocol behavior changes.

Installation:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -RiotId 'YourFriend#TAG'
```

The installer maintains a separate per-user copy. Editing the checkout does not hot-reload the running installation. Do not run live authentication probes unless you intend to use your own authorized Riot session. See SECURITY.md before sharing debugging output.
