# VaultGuard: Software Requirements Specification (SRS)

Version 1.0 · Format follows IEEE 830 structure, trimmed for builders.
Keywords **shall / should / may** follow RFC 2119. Priorities: **P0** must, **P1** v1, **P2** optional/later.

---

## 1. Introduction

### 1.1 Purpose
Defines what VaultGuard must do and the constraints it must respect. `project.md` says how it is structured; `PRD.md` says why and for whom; `skill.md` says how code must be written.

### 1.2 Scope
A zero-knowledge, web-based password security platform: strength evaluation, encrypted credential vault, strong-password recommendation, reuse and breach detection, and MFA-protected account recovery. **Out of scope for v1:** browser-extension autofill, native mobile apps, team/org vaults, SSO, push notifications, "remember this device" for MFA, passkey-as-primary-login.

### 1.3 Definitions
See `project.md` §14. **Item** = one encrypted vault entry. **Session** = server-side refresh-token record. **Locked** = session valid but vaultKey absent from memory.

### 1.4 References
RFC 6238 (TOTP), RFC 2119, NIST SP 800-63B, OWASP ASVS 4.0 (L2 target), OWASP Password Storage Cheat Sheet, W3C WebAuthn L2, WCAG 2.2 AA, Have I Been Pwned Pwned Passwords range API.

---

## 2. Overall description

### 2.1 Product perspective
Standalone MERN web application: React SPA, Express 5 API, MongoDB. External services: SMTP (email), HIBP range API (client-side calls only).

### 2.2 User classes
| Class | Description |
|---|---|
| End user | Stores credentials, wants a better security posture |
| Recipient | Opens a Secure Send link; no account |
| Admin (P2) | Sees aggregate stats, disables accounts; **cannot** read vault data |

### 2.3 Operating environment
Latest two versions of Chrome, Edge, Firefox, Safari (Web Crypto, `<dialog>`, WebAuthn required). Node.js ≥ 22. MongoDB ≥ 7. Linux containers.

### 2.4 Constraints
- C1: Master password and vaultKey never leave the browser.
- C2: Dependencies limited to the allowlist in `skill.md` §5.
- C3: Plain JavaScript (ESM). No server build step.
- C4: No third-party analytics, fonts, or favicon requests (privacy).
- C5: All secrets in env; app refuses to boot in production with weak or missing secrets.

### 2.5 Assumptions
Users have a modern browser and an email inbox. Users accept that losing both master password and recovery key means vault loss. Default choices made by the builder are logged in `docs/ASSUMPTIONS.md`.

---

## 3. Functional requirements

Each row is testable. "Shall" = acceptance criterion. The builder maintains `docs/TRACEABILITY.md` mapping every ID to code and a test.

### 3.1 Authentication and sessions (AUTH)

| ID | Requirement | Pri |
|---|---|---|
| AUTH-01 | User can register with email + master password. All key derivation happens in the browser; the request contains `authKey`, KDF params, wrapped keys, and recovery verifier, and **no** master password or vaultKey. | P0 |
| AUTH-02 | Master password policy enforced client-side: ≥ 12 characters, zxcvbn score ≥ 3, not found in HIBP. Violations block submit with an actionable message. The server additionally validates formats and rejects malformed key material. | P0 |
| AUTH-03 | Registration response is an identical generic 202 whether or not the email exists. If it exists, the owner receives an informational email instead. | P0 |
| AUTH-04 | Email must be verified (token: 32 random bytes, stored as SHA-256, 24 h TTL, single use) before login succeeds. Resend limited to 3/hour. | P0 |
| AUTH-05 | `prelogin` returns KDF params; for unknown emails it returns deterministic decoy params derived via HMAC(`DECOY_SECRET`, email). | P0 |
| AUTH-06 | Login verifies `authKey` with scrypt + `timingSafeEqual`. Any failure returns the same 401 `AUTH_INVALID` body. Unverified-email and locked states are only revealed **after** correct credentials. | P0 |
| AUTH-07 | After 5 consecutive failures an account is locked 15 min; each further lock doubles (max 24 h). Reset on success. The owner is emailed on lock. | P0 |
| AUTH-08 | Access token: JWT HS256, 10 min, `iss`/`aud` checked, algorithm pinned. Held in memory only. | P0 |
| AUTH-09 | Refresh token: opaque 32 random bytes in an `HttpOnly; SameSite=Strict; Path=/api/v1/auth` cookie (`Secure` in production); stored hashed; rotated on every use; absolute lifetime 30 days, idle lifetime 7 days. | P0 |
| AUTH-10 | Refresh **reuse detection**: presenting a rotated token revokes the entire family, writes an audit event, and emails the owner. | P0 |
| AUTH-11 | Refresh endpoint requires header `X-Requested-With: vaultguard` and an allowed `Origin`. | P0 |
| AUTH-12 | Vault lock: vaultKey exists only as a non-extractable CryptoKey in memory. Auto-lock after idle timeout (default 5 min; options 1/5/15/30/60; no "never"); lock on logout, on `Ctrl/Cmd+L`, and when the tab is hidden longer than the timeout. A page reload yields the **locked** state (session restored via refresh, key absent). | P0 |
| AUTH-13 | Unlock requires only the master password; verification is local (successful unwrap). | P0 |
| AUTH-14 | Logout revokes the current session; "log out everywhere" revokes all. | P0 |
| AUTH-15 | Change master password: requires step-up (AUTH-16); the client re-derives keys and re-wraps vaultKey; server replaces `authHash` and `wrappedVaultKey`; all other sessions are revoked; owner is emailed. No item is re-encrypted. | P0 |
| AUTH-16 | **Step-up**: sensitive actions (change password, export, disable MFA, regenerate backup codes, rotate recovery key, delete account, create/remove passkey) require a fresh `authKey` check plus MFA if enabled, producing a 5-minute single-purpose step-up token. | P0 |
| AUTH-17 | New-device sign-in (unseen device fingerprint = hash of UA + coarse IP prefix) sends an alert email. | P1 |
| AUTH-18 | Account deletion (after step-up and typed confirmation) removes all user data and revokes sessions. | P1 |
| AUTH-19 | If the server's current KDF iteration count exceeds the user's, the client silently re-derives and updates `kdf`, `authKey`, `wrappedVaultKey` after a successful login. | P1 |

### 3.2 Multi-factor authentication (MFA)

| ID | Requirement | Pri |
|---|---|---|
| MFA-01 | TOTP (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step). Setup shows a QR code (`otpauth://`) and the manual secret; TOTP is enabled only after a valid code. Secret is stored AES-256-GCM encrypted with `SERVER_ENCRYPTION_KEY`. A code can't be reused (store last accepted step). | P0 |
| MFA-02 | 10 backup codes (10 chars, Crockford Base32), shown once, stored as SHA-256, single-use, regenerable (step-up). | P0 |
| MFA-03 | Email OTP: 6 digits, 10 min TTL, max 5 attempts, 60 s resend cooldown, stored hashed; usable as a second factor. | P0 |
| MFA-04 | Passkeys via WebAuthn as a **second factor** (multiple allowed, nameable, deletable; signature counter checked). | P1 |
| MFA-05 | When MFA is enabled, `login` returns `{mfaRequired:true, mfaToken, methods}`. `mfaToken` is a 5-minute single-use JWT with scope `mfa`. No access/refresh token is issued until `mfa/verify` succeeds. | P0 |
| MFA-06 | Disabling TOTP/passkeys requires step-up and sends an alert; at least one MFA method must remain if the user has chosen "require MFA". | P0 |
| MFA-07 | All MFA verification endpoints are rate limited and write audit events on failure. | P0 |

### 3.3 Account recovery (REC)

| ID | Requirement | Pri |
|---|---|---|
| REC-01 | At registration the client generates a 160-bit **recovery key** (grouped Base32, e.g. `ABCD-EFGH-…`). The UI shows it once, offers a `.txt` download, and requires the user to re-type its last group to confirm. | P0 |
| REC-02 | `recovery/start` always returns 202. When the account exists, an email link (32 random bytes, SHA-256 stored, 15 min, single use) is sent. | P0 |
| REC-03 | `recovery/verify` takes the link token plus an MFA proof (TOTP/backup/passkey/email OTP) if MFA is enabled, and returns `recoveryWrappedVaultKey` + KDF params. | P0 |
| REC-04 | The client unwraps vaultKey with the recovery key, the user sets a **new master password**, the client creates a **new recovery key**, and `recovery/complete` stores the new material. All sessions are revoked; an alert is emailed. | P0 |
| REC-05 | Lost recovery key: `recovery/reset-account` (email link + MFA + typed confirmation `DELETE MY VAULT`) wipes items and folders, keeps the account, and issues new key material through a fresh setup. UI warns clearly beforehand. | P0 |
| REC-06 | The recovery verifier is compared with scrypt + `timingSafeEqual`; max 5 attempts per link, then the link dies. | P0 |
| REC-07 | Recovery key rotation from Settings (step-up). | P1 |

### 3.4 Vault (VLT)

| ID | Requirement | Pri |
|---|---|---|
| VLT-01 | Item types: `login`, `secureNote`, `card`, `apiKey`. Type and all fields live inside the encrypted blob. | P0 |
| VLT-02 | Items encrypted client-side with AES-256-GCM: random 96-bit IV per write, AAD `userId:itemId`. Server rejects blobs over 64 KB or malformed `iv`/`ct`. | P0 |
| VLT-03 | CRUD with optimistic concurrency: `PUT` requires `If-Match: <rev>`; mismatch returns 409 `CONFLICT` with the current server copy. UI offers "keep mine / keep theirs". | P0 |
| VLT-04 | Soft delete to Trash (`deletedAt`, `purgeAt = +30 d`, TTL purge); restore; permanent delete. | P0 |
| VLT-05 | Folders (name encrypted), favorites, tags (inside blob). | P0 |
| VLT-06 | `GET /vault/sync?since=<ISO>` returns changed/deleted items and folders; first sync returns all. Per-user cap: 5,000 items (configurable). | P0 |
| VLT-07 | Search, filter (type, folder, tag, favorite, issue-type), and sort run client-side over decrypted data. | P0 |
| VLT-08 | Secrets are masked by default; reveal is explicit; copy clears the clipboard after 30 s (configurable) on a best-effort basis; UI says so. | P0 |
| VLT-09 | If decryption of an item fails (tamper, corruption), the list still renders; the item shows a "can't be decrypted" warning and an audit-worthy console-free notice. | P0 |
| VLT-10 | Password history: keep the last 5 previous passwords per login with timestamps; `passwordChangedAt` updates only when the password changes. | P1 |
| VLT-11 | Built-in authenticator: a login may store a TOTP seed (or `otpauth://` URI); the UI shows the live code with countdown (client-side HMAC via Web Crypto) and a copy button. | P1 |
| VLT-12 | Import CSV (Chrome/Edge, Bitwarden, LastPass, generic with column mapping): client-side parse (papaparse), preview, duplicate detection on (uri, username), bulk upload ≤ 500/request. Row-level error report; nothing imported silently wrong. | P1 |
| VLT-13 | Export: (a) encrypted JSON (user-chosen export passphrase → PBKDF2 + AES-GCM) default; (b) plaintext CSV after step-up and a warning dialog. Both audit-logged. | P1 |

### 3.5 Password strength evaluation (STR)

| ID | Requirement | Pri |
|---|---|---|
| STR-01 | Real-time meter (debounced ≤ 150 ms) using zxcvbn-ts with user inputs (email, item name, URI) penalized. Shows score 0–4, label, estimated bits, crack-time (offline fast hash assumption) and one actionable tip. | P0 |
| STR-02 | The meter is accessible: `aria-live="polite"`, text label, never color alone. | P0 |
| STR-03 | Estimated bits = `guesses_log10 × log2(10)`; displayed as "≈ N bits". A note clarifies this is an estimate, not a guarantee. | P0 |
| STR-04 | Local checks (zxcvbn dictionaries for common passwords, sequences, repeats, keyboard patterns, dates) always run; the HIBP check (BRE-xx) is the online layer. | P0 |
| STR-05 | Strength is computed client-side only; passwords are never sent to the server or logged. | P0 |
| STR-06 | Lazy-load zxcvbn dictionaries (not in the initial bundle). | P0 |

### 3.6 Password generation and recommendations (GEN)

| ID | Requirement | Pri |
|---|---|---|
| GEN-01 | Random generator: length 8–128 (default 20), toggles for lower/upper/digits/symbols, exclude ambiguous (`O0Il1|`), minimum count per class. CSPRNG with rejection sampling; guarantees class coverage; Fisher–Yates shuffle with CSPRNG. | P0 |
| GEN-02 | Passphrase: 3–10 words (default 6) from the bundled EFF short wordlist (1296 words), separator choice, capitalize, optional number. Entropy shown = `words × log2(listLength)`. | P0 |
| GEN-03 | PIN generator: 4–12 digits. | P1 |
| GEN-04 | Generated value shows meter, bits, regenerate, copy (with clear). | P0 |
| GEN-05 | Generator embedded in the item editor and available as a page. Options persist in localStorage (non-secret only). | P0 |
| GEN-06 | **Smart recommendations**: when a password is weak, reused, breached, or old, the UI proposes a replacement with a strength preview and a short explanation of why. | P0 |

### 3.7 Reuse, breach, and health detection (HLT)

| ID | Requirement | Pri |
|---|---|---|
| BRE-01 | HIBP check uses SHA-1 locally, sends **only the first 5 hex chars** to `/range/{prefix}` with header `Add-Padding: true`, matches the suffix locally. The full hash or password never leaves the browser. | P0 |
| BRE-02 | On-demand check in the editor (on blur, debounced) and bulk check in Security Center (concurrency 4, per-session prefix cache). Network failure shows **"couldn't check"**, never "safe". | P0 |
| BRE-03 | Auto-scan on unlock at most once per 24 h (user can disable). | P1 |
| HLT-01 | **Reuse**: identical passwords across ≥ 2 login items are grouped ("used on N sites"), computed in memory after unlock. | P0 |
| HLT-02 | **Similar**: same normalized base (case-fold, leet-normalize, strip trailing digits/symbols, length ≥ 8). | P1 |
| HLT-03 | **Old**: password unchanged for > 180 days. | P0 |
| HLT-04 | **Weak**: zxcvbn score < 3. Items with no password are ignored. | P0 |
| HLT-05 | **Master-equal**: item password equals the master password (checked once at unlock). | P1 |
| HLT-06 | **Fix wizard**: step through flagged items, show reason, offer a generated replacement, open the item editor with the new password pre-filled (user updates the site, then saves). Saving writes history. | P0 |

### 3.8 Security score and dashboard (SCR)

| ID | Requirement | Pri |
|---|---|---|
| SCR-01 | Security Score per Appendix B formula, rendered as a ring with breakdown (weak, reused, breached, old, similar) and counts. | P0 |
| SCR-02 | Account hygiene checklist: email verified, MFA on, backup codes saved, recovery key confirmed, passkey added, auto-lock ≤ 15 min, master password strength. Each item links to the fix. | P0 |
| SCR-03 | Trend: opt-in snapshots (`score` + counts only) saved at most daily; chart on the dashboard (lazy-loaded recharts). | P1 |

### 3.9 Secure Send (SND)

| ID | Requirement | Pri |
|---|---|---|
| SND-01 | Create a send: client encrypts text (≤ 100 KB) with a random 256-bit key; URL is `/s/<id>#<key>`. Expiry options 1 h / 24 h / 7 d (max 30 d); max views 1–20. | P1 |
| SND-02 | Recipient access is `POST /send/:id/access` (never GET, so link previews/prefetch don't consume views). View increment is atomic (`findOneAndUpdate` with `views < maxViews`). Exhausted/expired returns 410 `GONE`. | P1 |
| SND-03 | Owner can list and revoke sends. Expired sends are TTL-deleted. | P1 |
| SND-04 | The fragment is never sent to or logged by the server; recipient page sets `Referrer-Policy: no-referrer`. | P1 |

### 3.10 Sessions, audit, notifications, settings (OPS)

| ID | Requirement | Pri |
|---|---|---|
| SES-01 | List active sessions (device label, coarse location/IP prefix, created, last used, "this device"); revoke one or all others. | P0 |
| AUD-01 | Audit events: `register`, `login.ok/fail`, `mfa.ok/fail`, `logout`, `refresh.reuse`, `password.change`, `mfa.enable/disable`, `passkey.add/remove`, `recovery.start/complete/reset`, `export`, `import`, `send.create/revoke`, `session.revoke`, `account.delete`, `lock.trigger`. Fields: event, time, IP prefix (/24 or /48), UA, safe meta. **No secrets.** User-visible, paginated, TTL 365 d. | P0 |
| AUD-02 | High-risk events send an email: new device, lockout, refresh reuse, password change, MFA change, recovery, export. | P1 |
| SET-01 | Settings: auto-lock timeout, clipboard clear time, theme, breach auto-scan, snapshot opt-in, generator defaults. | P0 |
| SET-02 | Server-side settings contain only non-sensitive values. | P0 |

### 3.11 Admin and extras (P2)

| ID | Requirement | Pri |
|---|---|---|
| ADM-01 | Admin console: totals (users, verified, MFA-enabled %), user list (email, status, MFA flag, last login), enable/disable. No vault or key data exposed. Admin = role `admin`, assigned by `ADMIN_EMAIL` at registration. | P2 |
| PWA-01 | Installable PWA (manifest + service worker caching static assets only, **never** `/api` responses). | P2 |
| EMG-01 | Emergency access: grantor invites a registered contact with a wait period (1–30 d); contact requests access; grantor can reject during the wait; on approval the vaultKey is delivered wrapped to the contact's public key. Requires a per-user asymmetric keypair created at next unlock (private key wrapped by vaultKey). | P2 |
| E2E-01 | One Playwright smoke test: register → add item → lock → unlock. | P2 |

### 3.12 UX requirements (UX), secondary goal

| ID | Requirement | Pri |
|---|---|---|
| UX-01 | Responsive from 360 px up; sidebar on desktop, bottom nav on mobile. | P0 |
| UX-02 | Light/dark theme following `prefers-color-scheme` with manual override. | P0 |
| UX-03 | Every page has loading, empty, and error states; destructive actions confirm via `<dialog>`. | P0 |
| UX-04 | Progress feedback during KDF; the UI never appears frozen. | P0 |
| UX-05 | Keyboard shortcuts: `Ctrl/Cmd+K` search, `N` new, `/` focus search, `Esc` close, `Ctrl/Cmd+L` lock. | P1 |
| UX-06 | WCAG 2.2 AA: labels, focus visibility, contrast, `prefers-reduced-motion`, no color-only signals. | P0 |
| UX-07 | Plain-language microcopy; security details in `<details>` disclosures. | P0 |

---

## 4. External interface requirements

### 4.1 REST API (prefix `/api/v1`, JSON, `Cache-Control: no-store`)

Auth header: `Authorization: Bearer <accessToken>` unless marked public. Error shape: `{ "error": { "code": "...", "message": "...", "details"?: {} } }`.

| Method & path | Auth | Purpose |
|---|---|---|
| GET `/health` | public | liveness |
| POST `/auth/prelogin` | public | KDF params (decoy for unknown) |
| POST `/auth/register` | public | create account (generic 202) |
| POST `/auth/verify-email` | public | verify token |
| POST `/auth/resend-verification` | public | resend (generic 202) |
| POST `/auth/login` | public | authKey login → tokens or mfa challenge |
| POST `/auth/mfa/email/send` | mfaToken | send email OTP |
| POST `/auth/mfa/passkey/options` | mfaToken | WebAuthn assertion options |
| POST `/auth/mfa/verify` | mfaToken | complete login with TOTP/backup/email/passkey |
| POST `/auth/refresh` | cookie | rotate refresh, return access (+ wrappedVaultKey) |
| POST `/auth/logout` · `/auth/logout-all` | token | revoke |
| POST `/auth/step-up` | token | authKey (+MFA) → stepUpToken |
| POST `/auth/recovery/start` | public | generic 202 |
| POST `/auth/recovery/verify` | public | token + MFA → recovery blob |
| POST `/auth/recovery/complete` | recoveryToken | new keys |
| POST `/auth/recovery/reset-account` | recoveryToken | wipe vault |
| GET `/me` | token | profile, mfa flags, settings, hygiene inputs |
| PATCH `/me/settings` | token | non-sensitive settings |
| POST `/me/password` | stepUp | change master password |
| POST `/me/recovery-key/rotate` | stepUp | new recovery material |
| GET `/me/sessions` · DELETE `/me/sessions/:id` | token | sessions |
| GET `/me/audit?cursor=` | token | audit log |
| GET/POST `/me/snapshots` | token | trend (opt-in) |
| DELETE `/me` | stepUp | delete account |
| POST `/mfa/totp/setup` · `/mfa/totp/enable` · DELETE `/mfa/totp` | token / stepUp | TOTP |
| POST `/mfa/backup-codes/regenerate` | stepUp | new codes |
| POST `/mfa/email/enable` · `/mfa/email/disable` | token / stepUp | email OTP |
| POST `/mfa/passkeys/register/options` · `/register/verify` | stepUp | add passkey |
| GET `/mfa/passkeys` · DELETE `/mfa/passkeys/:id` | token / stepUp | manage |
| GET `/vault/sync?since=` | token | items + folders |
| POST `/vault/items` · PUT `/vault/items/:id` (If-Match) | token | write |
| DELETE `/vault/items/:id` | token | soft delete |
| POST `/vault/items/:id/restore` · DELETE `/vault/items/:id/permanent` | token | trash |
| POST `/vault/items/bulk` | token | import (≤ 500) |
| GET/POST/PUT/DELETE `/vault/folders[/:id]` | token | folders |
| POST `/send` · GET `/send` · DELETE `/send/:id` | token | sends |
| POST `/send/:id/access` | public | consume a view, return ciphertext |
| GET `/admin/stats` · GET `/admin/users` · PATCH `/admin/users/:id` | admin | P2 |

### 4.2 External services
- **SMTP** via `SMTP_URL`; when empty (dev) emails are printed to the console as structured log lines **without** tokens in production mode.
- **HIBP range API**: called **from the browser only**. CSP `connect-src` allows exactly `'self'` and `https://api.pwnedpasswords.com`.

### 4.3 User interface
Pages per `project.md` §8; design rules per `skill.md` §11 and `PRD.md` §8.

---

## 5. Data requirements

Field-level schema (Mongoose); every collection has `createdAt/updatedAt` unless noted.

**users**: `email` (lowercase, unique), `emailVerified`, `kdf {algo:'pbkdf2-sha256', iterations, salt(b64)}`, `authHash {salt, hash}` (scrypt of authKey), `wrappedVaultKey {iv, ct}`, `recoveryWrappedVaultKey {iv, ct}`, `recoveryVerifierHash {salt, hash}`, `recoveryKeyConfirmed`, `mfa {totp {secretEnc, enabled, lastStep}, emailOtp {enabled}, backupCodes [{hash, usedAt}], passkeys [{credentialId, publicKey, counter, transports, name, createdAt}]}`, `lockout {failed, lockedUntil, lockCount}`, `knownDevices [hash]`, `settings {autoLockMin, clipboardSec, breachAutoScan, snapshots, theme}`, `role`, `status ('active'|'disabled')`, `lastLoginAt`.
**items**: `userId`, `iv`, `ct`, `rev`, `deletedAt?`, `purgeAt?`.
**folders**: `userId`, `iv`, `ct`, `rev`.
**sessions**: `userId`, `tokenHash`, `familyId`, `device {ua, ipPrefix, label}`, `lastUsedAt`, `expiresAt`, `revokedAt?`, `replacedBy?`.
**audit**: `userId`, `event`, `ipPrefix`, `ua`, `meta`, `at`.
**sends**: `ownerId`, `iv`, `ct`, `maxViews`, `views`, `expiresAt`.
**challenges**: `userId`, `purpose ('verify-email'|'recovery'|'email-otp'|'stepup')`, `codeHash`, `attempts`, `expiresAt`, `usedAt?`.
**snapshots**: `userId`, `at`, `score`, `counts`.

Retention: audit 365 d; trash 30 d; challenges and sends by TTL; sessions by `expiresAt`. Deleting an account removes all of the user's documents.

---

## 6. Non-functional requirements

### 6.1 Security (maps to OWASP ASVS L2)
- NFR-S1: TLS only in production; HSTS; `Secure` cookies.
- NFR-S2: Helmet with CSP: `default-src 'self'; script-src 'self'; connect-src 'self' https://api.pwnedpasswords.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`. (`// ponytail: 'unsafe-inline' for styles only because React/recharts set style attributes; scripts stay strict.`)
- NFR-S3: `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` denying camera/mic/geolocation.
- NFR-S4: Rate limits per Appendix C. Body size limit 1 MB (bulk import 4 MB).
- NFR-S5: zod validation on every route; unknown keys stripped; strings stay strings.
- NFR-S6: Logs never contain secrets (pino `redact`); IPs truncated to prefix in audit.
- NFR-S7: `npm audit` in CI; lockfile committed; only allowlisted dependencies.
- NFR-S8: CORS: exact origin allowlist; disabled when same-origin in production.
- NFR-S9: Constant-time comparison for all secrets; CSPRNG only.

### 6.2 Performance
- KDF (600k PBKDF2) completes in ≤ 1.5 s on a mid-range laptop; UI shows progress and stays responsive (no main-thread freeze; PBKDF2 via `crypto.subtle` is async).
- API p95 ≤ 200 ms for item CRUD with 5,000 items per user on a single small instance.
- `vault/sync` for 1,000 items ≤ 1 MB gzip.
- Initial JS ≤ 250 KB gzip; zxcvbn dictionaries, recharts, QR, and passkey code lazy-loaded.
- Bulk HIBP scan of 500 passwords ≤ 60 s on a normal connection (concurrency 4, prefix cache).

### 6.3 Reliability and operations
- Graceful shutdown (`SIGTERM`: stop accepting, drain, close Mongo). Health endpoint. Config fail-fast. Idempotent index creation at boot.
- Backups are an operator concern; documented in README.

### 6.4 Usability and accessibility
WCAG 2.2 AA; keyboard-only operable; screen-reader labels; reduced-motion respected; Lighthouse accessibility ≥ 95; Lighthouse performance ≥ 85 on the login page.

### 6.5 Maintainability
Plain JS + JSDoc; fewest files; every risky module has its test; `docs/DEBT.md` kept current; traceability matrix complete.

### 6.6 Privacy
Zero third-party trackers. No analytics. Only the HIBP request leaves the browser (5-char prefix). Account data export and deletion supported. Server stores no plaintext vault data, passwords, or recovery keys.

---

## 7. Threat-to-control matrix

See `project.md` §7. Additionally each of the following has an automated test: refresh reuse, lockout, IDOR, NoSQL operator rejection, tamper detection, decoy prelogin parity, rate-limit trigger, send view atomicity.

---

## 8. Acceptance test matrix

| ID | Scenario | Expected |
|---|---|---|
| AT-01 | Register with a weak master password | Blocked client-side with tips |
| AT-02 | Register with a breached master password | Blocked with breach message |
| AT-03 | Register twice with the same email | Both get identical 202; owner gets a notice |
| AT-04 | Login before email verification (right password) | `EMAIL_NOT_VERIFIED` |
| AT-05 | Login wrong password ×5 | 6th returns locked after correct creds only; lock email sent |
| AT-06 | Prelogin for unknown vs known email | Same shape, similar timing |
| AT-07 | Enable TOTP, log out, log in | Requires code; code reuse rejected |
| AT-08 | Use a backup code twice | Second use rejected |
| AT-09 | Reuse an old refresh token | Family revoked; audit + email |
| AT-10 | Reload the page while logged in | Session restored, vault **locked**, unlock works offline-verified |
| AT-11 | Idle past timeout | Auto-lock; decrypted state cleared |
| AT-12 | Create item, read raw DB document | Only `iv`/`ct`/metadata; no plaintext |
| AT-13 | User B requests user A's item id | 404 |
| AT-14 | Flip a byte in `ct` | Item shows decrypt warning; list still renders |
| AT-15 | Concurrent edit from two tabs | Second save gets 409; UI offers resolution |
| AT-16 | Same password on 3 logins | One reuse group "used on 3 sites" |
| AT-17 | HIBP check | Network log shows only a 5-char prefix request |
| AT-18 | HIBP offline | "Couldn't check", not "safe" |
| AT-19 | Generator 10,000 samples | Class coverage 100%, no char frequency outlier beyond tolerance |
| AT-20 | Fix wizard on a weak item | Replacement proposed; saving updates history |
| AT-21 | Forgot password with MFA | Link + MFA + recovery key → new password; old sessions dead |
| AT-22 | Forgot password, no recovery key | Reset-account wipes vault after typed confirmation |
| AT-23 | Change master password | Items still decrypt; other sessions revoked |
| AT-24 | Export plaintext CSV | Requires step-up; audit event written |
| AT-25 | Import Chrome CSV with 3 bad rows | Row-level report; good rows imported |
| AT-26 | Secure Send with maxViews 1, two parallel accesses | Exactly one succeeds, other 410 |
| AT-27 | Send link fragment | Absent from server logs |
| AT-28 | Keyboard-only run of register → add item → lock | Fully operable, visible focus |
| AT-29 | `{"email":{"$ne":null}}` on login | 400 `VALIDATION` |
| AT-30 | Score on a 10-item sample vault | Matches Appendix B |

---

## 9. Traceability to the problem statement

| Problem clause | Requirements |
|---|---|
| Weak passwords | STR-01…06, AUTH-02, BRE-01…03, HLT-04, GEN-06 |
| Reuse of credentials | HLT-01, HLT-02, HLT-05, HLT-06, SCR-01 |
| Securely stores encrypted credentials | VLT-01…13, AUTH-01, AUTH-12, §6.1 |
| Recommends strong passwords | GEN-01…06, HLT-06 |
| Secure recovery | REC-01…07 |
| MFA support | MFA-01…07, AUTH-16 |

---

## Appendix A: Cryptographic parameters

| Item | Parameter |
|---|---|
| Client KDF | PBKDF2-HMAC-SHA256, 600,000 iterations, 16-byte random `kdfSalt`, 256-bit output. `// ponytail: PBKDF2 because it's native; move to Argon2id WASM if native support lands or threat model demands.` |
| Key separation | HKDF-SHA256 with `info` = `vg-auth` / `vg-enc` / `vg-recovery` / `vg-recovery-verify` |
| Data cipher | AES-256-GCM, 96-bit IV, 128-bit tag, AAD `userId:itemId` |
| Server authKey hash | scrypt N=16384, r=8, p=1, 16-byte salt, 32-byte output |
| Token/OTP/backup hashes | SHA-256 |
| TOTP secret at rest | AES-256-GCM, key = `SERVER_ENCRYPTION_KEY` |
| Recovery key | 160 random bits, Base32 (RFC 4648, no padding), grouped by 4 |
| Secure Send key | 256 random bits, base64url in fragment |
| JWT | HS256, 10 min access, 5 min mfa/step-up, `iss=vaultguard`, `aud=vaultguard-web` |

## Appendix B: Security Score

Per **login** item with a password, the item penalty is the **maximum** applicable:
`breached = 100`, `reused = 70`, `master-equal = 100`, `weak = 60`, `similar = 40`, `old = 30`, else `0`.

`vaultScore = 100 − average(itemPenalty)` over login items with a password (100 if none).
`accountPenalty = 0`, plus `10` if MFA is not enabled, plus `5` if recovery key not confirmed.
`Score = clamp(round(vaultScore − accountPenalty), 0, 100)`.
Bands: 0–49 Poor, 50–74 Fair, 75–89 Good, 90–100 Excellent.

## Appendix C: Rate limits (memory store, per IP unless noted)

| Route group | Limit |
|---|---|
| Global `/api` | 300 / 15 min |
| `auth/login`, `auth/prelogin` | 10 / 15 min per IP **and** 5 / 15 min per email |
| `auth/register`, `auth/resend-verification`, `auth/recovery/*` | 5 / hour |
| MFA verify, email OTP send | 10 / 15 min per mfaToken/user; OTP resend ≥ 60 s |
| `send/:id/access` | 30 / 15 min |
| `vault/*` | 600 / 15 min per user |

## Appendix D: Error codes
`VALIDATION` 400 · `AUTH_INVALID` 401 · `TOKEN_EXPIRED` 401 · `MFA_REQUIRED` 401 · `MFA_INVALID` 401 · `STEP_UP_REQUIRED` 403 · `EMAIL_NOT_VERIFIED` 403 · `ACCOUNT_LOCKED` 423 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `GONE` 410 · `PAYLOAD_TOO_LARGE` 413 · `RATE_LIMITED` 429 · `INTERNAL` 500.
