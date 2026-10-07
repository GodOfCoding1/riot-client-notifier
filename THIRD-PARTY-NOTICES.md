# Third-party notices

## sax 1.6.1

The streaming XML parser in `vendor/package/lib/sax.js` is vendored from the npm sax package. Its original copyright and license are retained in [vendor/package/LICENSE.md](vendor/package/LICENSE.md).

Source: https://github.com/isaacs/sax-js

Archive: https://registry.npmjs.org/sax/-/sax-1.6.1.tgz

The downloaded archive was checked against npm's published SHA-512 integrity:

```text
sha512-42tBVwLWnaQvW5zc4HbZrTuWccECCZfBi92FDuwtqxasH+JbPB3/FOKb1m222K42R4WxuxzzMsTswfzgtSu64Q==
```

## Protocol research

The Riot XMPP handshake was informed by [techchrism/valorant-xmpp-watcher](https://github.com/techchrism/valorant-xmpp-watcher), [CrossPlatformPlaying's Riot protocol notes](https://github.com/giorgi-o/CrossPlatformPlaying/wiki/Riot-Games), and [VALORANT API Docs](https://valapidocs.techchrism.me/endpoint/xmpp-connection), then verified against a logged-in local client and Riot chat. This repository implements its own watcher and does not distribute their source files.
