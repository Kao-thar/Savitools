# Supported Browsers and Wallet Compatibility

SaviTools is a Next.js 15 / React 19 web console. This page states the browsers
we support, the wallet assumptions behind browser-wallet signing, and what keeps
working when a platform feature is missing (Savitura/Savitools#464).

**Last reviewed:** 2026-10-20

## Browser support

"Supported" means the release smoke test exercises the console in that browser
and we fix regressions there. "Best effort" means the core tools are expected to
work, but a feature that depends on a newer platform API may be unavailable.

| Browser                         | Supported versions       | Status      | Notes                                                                                |
| ------------------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------ |
| Chrome / Chromium (desktop)     | Latest 2 stable releases | Supported   | Primary target for Freighter.                                                        |
| Chrome (Android)                | Latest 2 stable releases | Supported   | Camera QR scanning depends on the device and site permission.                        |
| Microsoft Edge (desktop)        | Latest 2 stable releases | Supported   | Chromium-based Edge only.                                                            |
| Firefox (desktop)               | Latest 2 stable releases | Supported   | Freighter support depends on the installed extension version.                        |
| Safari (macOS)                  | Latest 2 stable releases | Supported   | Passkeys, clipboard and WebCrypto require a secure (HTTPS) origin.                   |
| Safari (iOS / iPadOS)           | Latest 2 stable releases | Supported   | Wallet extensions are generally unavailable; use secret-key signing or QR handoff.   |
| Chromium 90–110, Firefox 90–110 | No longer current        | Best effort | Core tools work, but older WebCrypto/WebAuthn/clipboard behaviour is not guaranteed. |
| Safari 15.4–16.3                | No longer current        | Best effort | Passkey support and some clipboard paths may be missing or behave differently.       |
| Internet Explorer, EdgeHTML     | Any                      | Unsupported | No ES2020 module/fetch/EventSource support.                                          |
| In-app webviews                 | Vendor-dependent         | Unsupported | Extension injection, storage and camera permissions are commonly unavailable.        |

A minimum of **Chrome/Edge 111, Firefox 111 or Safari 16.4** is recommended when
you need the full feature set. Older browsers may still render the app, but they
are outside the support window.

### Browser APIs the console relies on

| Capability                  | Used for                                                       | Requirement                                                               |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `fetch`, `EventSource`      | API calls and Ledger Monitor streams                           | Supported in all listed browsers                                          |
| WebSocket (Socket.IO)       | Live Ledger Monitor feed; Socket.IO falls back to HTTP polling | Supported in all listed browsers                                          |
| `localStorage`              | Preferences, recents, onboarding, theme, guest workspaces      | See [Browser Storage Policy](browser-storage-and-retention.md) for limits |
| Clipboard API               | Copy buttons across the tools                                  | Secure context; user permission may be required                           |
| WebCrypto (`crypto.subtle`) | Webhook signature preview, passkey flows                       | Secure context (HTTPS or localhost)                                       |
| WebAuthn / passkeys         | Passkey registration and login                                 | Secure context plus platform/roaming authenticator                        |
| `getUserMedia`              | QR Handoff camera scanning                                     | Secure context plus camera permission                                     |

## Wallet assumptions

Browser-wallet signing is implemented for the **Freighter extension** only.

- Freighter must inject `window.freighterApi` or `window.freighter` with both
  `requestAccess` and `signTransaction`. If either method is missing, the wallet
  is treated as unavailable.
- The connected wallet account must match the transaction's source account.
  SaviTools rejects a signature request when the wallet switches accounts.
- The wallet network must match the active network profile (testnet, futurenet
  or a local quickstart network). A mismatch is surfaced as a wallet network
  error. Mainnet signing is disabled; SaviTools is testnet-locked.
- The wallet signs locally. SaviTools receives only the public key and the
  signed XDR — never the secret key.
- Other extension wallets (xBull, Rabet, Lobstr, Hana, etc.), WalletConnect and
  mobile deep links are **not** integrated. They are not detected and the wallet
  option stays unavailable.
- Secret-key signing is the fallback: it runs in the browser, is testnet-only,
  and wipes the key material after signing. Never paste a mainnet seed.
- Extensions are usually unavailable in private windows, in-app webviews and
  mobile Safari. Use secret-key signing or move the unsigned XDR with QR Handoff.

## Degraded behavior without optional capabilities

| Missing capability                     | Behavior                                                                                                                                     | Workaround                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Storage (`localStorage` blocked/quota) | Preferences, recents, onboarding state, theme and guest workspaces reset on reload. Signed-in workspaces still load/save through the API.    | Sign in for server-backed workspaces, or export/import workspace files.        |
| Clipboard API                          | Copy buttons fail or show a browser-blocked message; values remain visible and selectable.                                                   | Select the text manually, download the CSV/XDR, or use QR Handoff download.    |
| WebCrypto (`crypto.subtle`)            | Webhook signature preview reports unsigned/unavailable instead of showing a wrong signature. Passkey registration and login are unavailable. | Password login still works; verify webhooks with a server-side implementation. |
| WebAuthn / passkeys                    | Passkey buttons cannot complete; the API rejects malformed assertions.                                                                       | Use email/password login and registration.                                     |
| Freighter extension                    | Browser-wallet mode reports that no wallet is detected; signing cannot proceed through a wallet.                                             | Use testnet secret-key signing, or export the unsigned XDR to another signer.  |
| Camera / `getUserMedia`                | QR Handoff camera scan is blocked or unavailable.                                                                                            | Paste the frames/text or import a file; outgoing QR codes still render.        |
| WebSocket blocked                      | The Ledger Monitor feed falls back to Socket.IO HTTP polling; the server may also mark a watch `polling`.                                    | No action required; live updates are delayed but continue.                     |
| Secure context (plain HTTP origin)     | Clipboard, WebCrypto and passkeys may be disabled by the browser.                                                                            | Serve SaviTools over HTTPS (or use `localhost` during development).            |

## Keeping this matrix current

This page is a release artifact, not static marketing copy. Update it when any
of the following happens:

1. **Every release:** run the release smoke on the latest two stable versions of
   Chrome, Edge, Firefox and Safari (desktop) plus iOS Safari, and update the
   `Last reviewed` date and status column if anything changed.
2. **Dependency baseline changes:** a Next.js major/minor upgrade that changes
   its supported-browser baseline, or a React major upgrade.
3. **Platform API changes:** a PR that adds, removes or changes use of
   `localStorage`, the Clipboard API, WebCrypto, WebAuthn, `getUserMedia`,
   `EventSource`, WebSocket or the CSP/`Permissions-Policy` headers.
4. **Wallet changes:** a new wallet adapter, a change to Freighter detection or
   signing options, or a change to the testnet/mainnet signing policy.

If a release changes the answer to "supported", "best effort" or "unsupported"
for any row, the same PR must update this file and the browser notes in the
release checklist.
