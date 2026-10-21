# Browser Storage Limits & Data-Retention Policy

This document outlines how SaviTools utilizes browser-local storage, defines the
storage key taxonomy, details browser quota boundaries, specifies data-retention
lifecycles, and describes failure-handling strategies across the client console.

---

## 1. Storage Architecture Overview

SaviTools follows a **client-first, privacy-conscious storage model**:

- **Guest (Unauthenticated) Mode**: Workspaces, transient draft operations,
  deployed contract histories, and user interface preferences are maintained
  locally in the browser using the `localStorage` Web Storage API.
- **Authenticated Mode**: Workspace entities and operation sequences synchronize
  with the SaviTools server-side PostgreSQL database (`/api/workspaces`),
  reducing reliance on browser storage to local caching and UI preferences.
- **Client-Side Signers**: Private keys, secret seeds (`S...`), and passkey
  credentials are **never persisted** in browser storage. Ephemeral signing
  operations wipe key material from memory immediately after transaction signing.

---

## 2. Storage Key Taxonomy & Registry

All client-managed storage entries use explicit namespaces to avoid collisions
with other applications hosted on the same origin:

| Storage Key / Pattern                     | Type            | Scope        | Description                                                                                                          | Max Cap / Limit               |
| ----------------------------------------- | --------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `savitools:guest:${tool}`                 | JSON Object     | Guest Draft  | Active draft state for a specific tool (`composer`, `inspector`, `sandbox`, `federation`, `contracts`, `simulator`). | 1 active per tool             |
| `savitools:guest:workspaces:${tool}`      | JSON Array      | Guest List   | Index array of saved guest workspace metadata (`WorkspaceSummary[]`).                                                | Bounded by storage quota      |
| `savitools:guest:workspace:${tool}:${id}` | JSON Object     | Guest Item   | Full serialized workspace state (`WorkspaceState`) including composer operations and form states.                    | Bounded by storage quota      |
| `savitools_recent_items`                  | JSON Array      | User Recents | Command palette recent items history (`RecentItem[]`) across tools.                                                  | **10 entries** (LRU eviction) |
| `savitools_user_preferences`              | JSON Object     | User Config  | Global preferences: keyboard shortcuts enabled, command palette status.                                              | Single JSON record            |
| `savitools:profiles`                      | JSON Envelope   | Network      | Versioned envelope (`NetworkProfileStore`) containing custom Horizon/RPC endpoints.                                  | Migrated v0 to v1             |
| `savitools:active-profile-id`             | String          | Network      | Active custom network profile identifier or preset tag.                                                              | Single string                 |
| `savitools:network`                       | String          | Network      | Fallback network type selection (`testnet`, `futurenet`, `local`).                                                   | Single string                 |
| `savitools:theme`                         | String          | UI Display   | Color theme setting (`light`, `dark`, or `system`).                                                                  | Single string                 |
| `savitools:onboarding`                    | JSON Object     | Walkthrough  | Interactive walkthrough task completion progress map.                                                                | Single JSON record            |
| `savitools:onboarding:dismissed`          | String ('true') | Walkthrough  | Flag indicating user permanently dismissed onboarding modal.                                                         | Single boolean string         |
| `savitools:contracts:history`             | JSON Array      | Contracts    | History of Soroban contract addresses and deployment artifacts on testnet.                                           | **50 entries** (FIFO cap)     |
| `savitools:federation:counterparties`     | JSON Array      | Federation   | Saved counterparty federation addresses (`name*domain`).                                                             | **50 entries** (FIFO cap)     |
| `composer-workspaces`                     | JSON Array      | Legacy       | Deprecated pre-v1 composer workspace storage key. Maintained for read migration.                                     | Read-only legacy              |

---

## 3. Quota Limits Across Browsers

Modern browser engines allocate origin-level storage quotas for `localStorage`:

| Browser Engine                            | Desktop Quota             | Mobile Quota            | Private / Incognito Behavior                                          |
| ----------------------------------------- | ------------------------- | ----------------------- | --------------------------------------------------------------------- |
| **Chromium** (Chrome, Edge, Brave, Opera) | ~5 MB to 10 MB per origin | ~5 MB per origin        | Ephemeral storage cleared when all incognito windows close.           |
| **Gecko** (Firefox)                       | ~5 MB to 10 MB per origin | ~5 MB per origin        | Isolated per private session; discarded on session exit.              |
| **WebKit** (Safari macOS & iOS)           | ~5 MB per origin          | ~5 MB per origin        | Strict 5 MB ceiling; third-party cookie blocking may disable storage. |
| **Mobile WebViews**                       | Varies by host app        | Variable (often < 2 MB) | Highly volatile; storage may be purged upon OS memory pressure.       |

> **Note:** A standard SaviTools workspace file containing 5–10 operations consumes
> approximately **1.5 KB to 3 KB** of UTF-16 serialized JSON. A 5 MB quota can
> comfortably store several hundred workspaces before approaching capacity.

---

## 4. Data-Retention & Eviction Policies

### 4.1 Ephemeral vs. Persistent Lifecycles

1. **User Preferences & Theme**: Retained indefinitely until explicitly cleared
   by the user through browser settings or application reset.
2. **Command Palette Recents**: Governed by an LRU (Least Recently Used) policy
   enforced by `addRecentItem`:
   - Enforces a maximum limit of **10 items** (`RECENT_ITEMS_MAX_COUNT = 10`).
   - Deduplicates items with identical `id` or `href`.
   - Evicts the oldest item when capacity is exceeded.
3. **Contract Deployment History & Federation Counterparties**:
   - Automatically bounded to the **50 most recent items** to prevent unbounded
     array growth over extended testnet usage.
4. **Guest Workspaces**:
   - Persist across page reloads and browser restarts on the same origin.
   - Cleared automatically if the user executes `clearGuestStorage()`.
   - Independent across different browsers or devices (no cross-device sync
     without server authentication).

### 4.2 Account Transition & Migration

When a guest user logs in:

- The UI transitions workspace loading to the authenticated server API
  (`listComposerWorkspaces()`).
- Guest workspaces remain safe in local browser storage and can be manually
  exported as JSON files (`.json`) or imported into the server account via
  `importWorkspace()`.
- Logging out reverts the console to guest storage mode without destroying
  pre-existing local guest drafts.

---

## 5. Error Handling & Degradation Modes

SaviTools employs defensive wrapper utilities in `src/lib/browser-storage.ts`
to prevent storage exceptions from breaking user interfaces:

### 5.1 Quota Exceeded Handling (`QuotaExceededError`)

When browser storage is full:

- `safeSetItem()` detects `QuotaExceededError` (W3C code `22`),
  `NS_ERROR_DOM_QUOTA_REACHED` (Firefox code `1014`), and legacy quota exceptions.
- The function returns `{ success: false, quotaExceeded: true }` rather than
  throwing an unhandled exception.
- The workspace orchestrator surfaces an actionable error notification:
  > _"Browser storage limit reached. Please delete old workspaces or sign in to save."_
- Existing stored data remains untouched and uncorrupted.

### 5.2 Storage Access Restrictions (`SecurityError`)

In restricted contexts (e.g. Safari with strict tracking prevention, disabled
cookies, or restricted iframe embedding):

- `isStorageAvailable()` detects storage unavailability during initialization.
- Reads fall back gracefully to default in-memory configurations.
- Writes fail safely without crashing React render lifecycles.

### 5.3 Payload Corruption Resilience

- `safeGetItem()` wraps all `JSON.parse` operations in `try/catch` blocks.
- Corrupted keys return safe fallback structures (e.g., empty arrays `[]` or
  default preference objects) and log warnings rather than crashing the tool.

---

## 6. Security & Privacy Guarantees

1. **No Sensitive Key Material in LocalStorage**:
   - Secret keys (`S...`), seed phrases, and auth tokens are **strictly excluded**
     from browser storage.
   - Transaction signing occurs in-memory, and credentials are wiped immediately
     via `secure-memory.ts` after signature production.
2. **Origin Isolation**:
   - Storage keys are bound to the specific hosting origin protocol and domain.
   - Cross-origin iframes cannot access SaviTools localStorage.
3. **Export and Portability**:
   - Users maintain full custody of their data through the Workspace Export
     feature, generating versioned JSON files compliant with `workspace-format.ts`.
