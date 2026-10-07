# Security and authorization handling

This unofficial utility uses the account authorization already saved by your Riot Client. A refresh token is an account credential, including when its contents are opaque. Protect it like a password.

## Sensitive files

Keep Riot private settings, lockfiles, cookies, `.env` files, `*.dpapi` session caches, and generated diagnostics out of Git and public issue reports. The repository's `.gitignore` excludes known generated files, but review every change before publishing.

The installed session cache uses Windows CurrentUser DPAPI. It is not portable to Linux, and another process running as your Windows user may be able to decrypt it. No credentials are included in this repository.

## Reporting

Do not include tokens, authorization headers, complete Riot settings, raw chat logs, or decrypted caches in a public issue. For credential-disclosure vulnerabilities, contact the maintainer privately through an available GitHub profile contact channel before disclosing details publicly. If no private channel is available, ask for one in an issue without posting exploitation details or secrets.

## Implementation boundaries

- Remote HTTPS and XMPP TLS verify certificates normally.
- The optional local API certificate exception applies only to `127.0.0.1`.
- No passwords or browser cookies are collected.
- The saved Riot settings file is read, never rewritten by this utility.
- Gameplay, chat messages, and friend-list mutations are outside its functionality.
- Client-bound DPoP authorization is currently unsupported.
- Private authentication protocols can change; session renewal is not guaranteed indefinitely.
