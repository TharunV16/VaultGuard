# VaultGuard: project.md

> **Zero-knowledge password security platform** (MERN).
> Evaluates password strength, stores credentials encrypted so even the server can't read them, recommends strong passwords, detects reuse and breaches, and recovers accounts safely with MFA.

Read order for any builder (human or AI): `skill.md` → `project.md` → `SRS.md` → `PRD.md`.

---

## 1. Problem statement (verbatim)

> Users frequently create weak passwords and reuse credentials across multiple services, increasing cybersecurity risks. This platform evaluates password strength, securely stores encrypted credentials, recommends strong passwords, and enables secure password recovery with MFA support.

### How the platform answers each clause

| Clause | Answer |
|---|---|
| Weak passwords | Real-time strength engine (zxcvbn-ts), entropy and crack-time display, breach check (HIBP k-anonymity), strict master-password policy |
| Reused credentials | In-memory reuse and similar-password detection, Security Score, guided "Fix" wizard |
| Securely stores encrypted credentials | Client-side AES-256-GCM vault; the server stores only opaque ciphertext |
| Recommends strong passwords | CSPRNG generator, passphrases, PINs, smart suggestions on weak/reused items |
| Secure recovery with MFA | Recovery key + email link + TOTP/backup code/passkey; destructive-reset fallback |

---

## 2. Feature catalogue

Priority: **P0** = must ship, **P1** = ships in v1, **P2** = after everything else is green. Full requirements and IDs live in `SRS.md`.

**Account and access**
- Zero-knowledge registration and login (P0)
- Email verification (P0)
- Access + rotating refresh tokens with reuse detection (P0)
- Brute-force protection: rate limits plus progressive lockout (P0)
- Idle auto-lock, lock on reload, `Ctrl/Cmd+L` lock (P0)
- Step-up authentication for sensitive actions (P0)
- Change master password (re-wrap, no data loss) (P0)
- New-device alerts, account deletion, KDF auto-upgrade (P1)

**Multi-factor authentication**
- TOTP (authenticator app) with QR (P0)
- 10 single-use backup codes (P0)
- Email OTP fallback (P0)
- Passkeys / WebAuthn as second factor (P1)

**Recovery**
- Recovery key generated client-side, shown once (P0)
- Forgot-password flow: email link + MFA + recovery key (P0)
- Lost recovery key: destructive account reset (P0)
- Recovery key rotation (P1)

**Vault**
- Item types: login, secure note, card, API key (P0)
- Folders, favorites, tags (P0)
- Trash with 30-day purge, restore (P0)
- Client-side search/filter/sort (P0)
- Optimistic concurrency, tamper detection (P0)
- Password history (last 5) (P1)
- Built-in authenticator: store a TOTP seed on a login and show live codes (P1)
- Import CSV: Chrome/Edge, Bitwarden, LastPass, generic (P1)
- Export: encrypted JSON or plaintext CSV with step-up (P1)

**Password intelligence**
- Strength meter: score, label, bits, crack time, actionable tips (P0)
- Generator: random, passphrase (P0), PIN (P1)
- Breach check via HIBP k-anonymity, on-demand and bulk (P0), auto-scan on unlock (P1)
- Reuse detection (P0); similar-password detection (P1); old-password detection (P0); "item equals master password" (P1)
- Security Score 0–100 with breakdown (P0), trend chart (P1)
- Fix wizard: one-click strong replacement per flagged item (P0)

**Sharing and monitoring**
- Secure Send: E2E-encrypted one-time/expiring links, key in the URL fragment (P1)
- Session manager (list/revoke) (P0)
- Audit log (user-visible) (P0)
- Security email notifications (P1)

**P2 (only after all P0/P1 are green)**
- Admin console (aggregate stats, disable users; no vault access)
- Installable PWA
- Emergency access (trusted contact with wait period)
- Playwright smoke test

---

## 3. Architecture

```
┌───────────────────────── Browser (React SPA) ─────────────────────────┐
│  UI ── lib/crypto (Web Crypto) ── lib/strength ── lib/generator       │
│        lib/hibp ── lib/import ── lib/totp ── lib/score               │
│  Memory only: vaultKey (non-extractable CryptoKey), accessToken,      │
│               decrypted items. Cleared on lock/logout.                │
└───────────────┬───────────────────────────────────────┬───────────────┘
                │ HTTPS  /api/v1  (ciphertext only)     │ HTTPS (5-char prefix)
                ▼                                       ▼
┌──────────── Express 5 API ────────────┐     api.pwnedpasswords.com
│ helmet · cors · rate-limit · zod      │
│ routes: auth, mfa, me, vault, send    │
│ lib: crypto(scrypt, AES-GCM) totp     │
│      tokens mail audit webauthn       │
└───────────────┬───────────────────────┘
                ▼
        MongoDB (users, items, folders, sessions, audit, sends, challenges)
```

In production Express serves the built client (one deployable). In development Vite proxies `/api` to the API.

### 3.1 Zero-knowledge key hierarchy

```
masterPassword + kdfSalt ──PBKDF2-SHA256 (600k)──► masterKey (256-bit, in memory only)
   masterKey ──HKDF(info="vg-auth")──► authKey   ──► sent to server (server scrypt-hashes it)
   masterKey ──HKDF(info="vg-enc") ──► wrapKey   ──► wraps vaultKey (AES-GCM)

vaultKey  = random 256-bit, generated in the browser at registration
   stored on server ONLY as wrappedVaultKey = AES-GCM(wrapKey, vaultKey)
   used (as a non-extractable CryptoKey) to encrypt every item and folder name

recoveryKey = random 160-bit, shown ONCE as grouped Base32
   recoveryWrapKey = HKDF(recoveryKey, info="vg-recovery")
   stored on server as recoveryWrappedVaultKey = AES-GCM(recoveryWrapKey, vaultKey)
   recoveryVerifier = HKDF(recoveryKey, info="vg-recovery-verify") → server scrypt-hashes it
```

Consequences: the server can never decrypt a vault. A database leak gives attackers wrapped keys plus ciphertext, and the work factor of PBKDF2(600k) plus a strong master password still protects them. Forgetting the master password is survivable **only** with the recovery key, and that is stated plainly in the UI.

### 3.2 Item encryption

- Server stores per item: `{ _id, userId, iv, ct, rev, createdAt, updatedAt, deletedAt?, purgeAt? }`. **Item type, folder, favorite, tags, name, and everything else live inside the encrypted blob**, so the server learns almost nothing.
- Cipher: AES-256-GCM, 96-bit random IV per write, **AAD = `${userId}:${itemId}`**, so a ciphertext can't be swapped between records or users.
- Decrypted blob schema (v1): `{ v, type, name, folderId, favorite, tags[], notes, uris[], username, password, passwordChangedAt, history[{password, changedAt}], totpSeed, card{}, apiKey{}, custom[], createdAt, updatedAt }`.

### 3.3 Core flows

**Register**
1. Client checks master password (≥12 chars, zxcvbn ≥ 3, not in HIBP). 
2. Client generates `kdfSalt`, derives `masterKey` → `authKey`, `wrapKey`; generates `vaultKey` and `recoveryKey`; builds the two wrapped keys and the recovery verifier.
3. `POST /auth/register` with `{email, authKey, kdf, wrappedVaultKey, recoveryWrappedVaultKey, recoveryVerifier}`. Response is always a generic 202 (no enumeration; if the email exists, the owner gets a notice instead).
4. User must confirm the recovery key (download + re-type last group) before the flow completes. Verification email is sent.

**Login (with MFA)**
1. `POST /auth/prelogin {email}` returns `kdf` (decoy values for unknown emails).
2. Client derives `authKey`; `POST /auth/login`. Server checks lockout, scrypt-verifies, and returns either tokens or `{mfaRequired, mfaToken, methods}`.
3. `POST /auth/mfa/verify {mfaToken, method, code|assertion}` returns tokens.
4. Response carries `wrappedVaultKey`; client unwraps with `wrapKey` into a non-extractable key. Items are synced and decrypted into memory.

**Lock / unlock**
Lock clears vaultKey and all decrypted state but keeps the session. Unlock asks only for the master password (derive → unwrap; success proves it's correct, no network needed). On page reload the access token is re-obtained from the refresh cookie and the app starts **locked**.

**Recovery**
1. `POST /auth/recovery/start {email}` is always 202. If the account exists, an email link (15 min, single-use) is sent.
2. `POST /auth/recovery/verify {token, mfa?}` after the MFA check returns `recoveryWrappedVaultKey` + `kdf`.
3. Client asks for the recovery key, unwraps `vaultKey`, user chooses a **new master password**; client re-wraps and generates a **new recovery key**.
4. `POST /auth/recovery/complete` stores new `authKey`, `wrappedVaultKey`, recovery fields; revokes all sessions; emails an alert.
5. No recovery key? `POST /auth/recovery/reset-account` (email link + MFA + typed confirmation) deletes all vault data and lets the user start fresh.

**Secure Send**
Client makes a random 256-bit key, encrypts the payload, uploads `{iv, ct, expiresAt, maxViews}`, and builds `https://host/s/<id>#<key>`. The fragment never reaches the server. The recipient page does `POST /send/:id/access` (atomic view count), then decrypts in the browser.

---

## 4. Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js ≥ 22 LTS |
| API | Express 5, plain JS (ESM) + JSDoc |
| DB | MongoDB 7+, Mongoose |
| Validation | zod |
| Auth tokens | `jsonwebtoken` (HS256, pinned alg, iss/aud) for access; opaque random for refresh |
| Passkeys | `@simplewebauthn/server` and `/browser` |
| Mail | `nodemailer` (dev: console transport; prod: `SMTP_URL`) |
| Security middleware | helmet, cors, express-rate-limit, cookie-parser |
| Logging | pino + pino-http with redaction |
| Client | React 18+, Vite, React Router, Tailwind CSS |
| Strength | `@zxcvbn-ts/*` |
| Charts / QR / CSV | recharts, qrcode.react, papaparse |
| Tests | `node:test` (server), `vitest` (client), `mongodb-memory-server` |
| Ops | Docker multi-stage + docker-compose, GitHub Actions CI |

Dependency policy and the full ladder decisions are in `skill.md` §5. Do not add anything outside that allowlist without a justification row in `docs/DEBT.md`.

---

## 5. Repository layout

```
vaultguard/
├─ AGENTS.md                 # copy of skill.md (always-on rules for coding agents)
├─ skill.md  project.md  SRS.md  PRD.md   → moved into docs/ after setup, AGENTS.md stays in root
├─ README.md  .env.example  docker-compose.yml  Dockerfile  .gitignore
├─ .github/workflows/ci.yml
├─ docs/
│  ├─ DEBT.md  ASSUMPTIONS.md  TRACEABILITY.md  API.md (generated list of routes)
├─ scripts/smoke.mjs         # end-to-end smoke test against a running server
├─ server/
│  ├─ package.json
│  ├─ src/
│  │  ├─ server.js           # boot: config, db, listen, graceful shutdown
│  │  ├─ app.js              # express app factory (used by tests)
│  │  ├─ config.js           # zod-validated env, fail fast
│  │  ├─ models/             # User, Item, Folder, Session, Audit, Send, Challenge
│  │  ├─ routes/             # auth, mfa, me, vault, send, admin(P2)
│  │  ├─ middleware/         # auth (verify JWT), stepUp, rateLimit, validate, error
│  │  └─ lib/                # crypto.js, totp.js, tokens.js, mail.js, audit.js, webauthn.js
│  └─ test/                  # *.test.js (node:test)
└─ client/
   ├─ package.json  vite.config.js  index.html
   └─ src/
      ├─ main.jsx  App.jsx  routes.jsx
      ├─ lib/                # crypto.js, strength.js, generator.js, hibp.js, import.js,
      │                      # totp.js, score.js, api.js, wordlist.js, clipboard.js
      ├─ context/            # AuthContext (session+lock), VaultContext (items), ToastContext
      ├─ hooks/              # useApi, useIdleLock, useDebounce
      ├─ pages/              # Landing, Register, Login, Unlock, Recover, VerifyEmail, Dashboard,
      │                      # Vault, Generator, SecurityCenter, Send, SendView, Settings, Audit, Admin(P2)
      ├─ components/         # Layout, StrengthMeter, PasswordField, ItemEditor, ItemCard,
      │                      # ConfirmDialog, MfaSetup, RecoveryKeyStep, ScoreRing, Empty, Skeleton
      └─ test/               # *.test.js (vitest)
```

---

## 6. Data model (summary; full fields in SRS §5)

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | email, emailVerified, kdf{algo,iterations,salt}, authHash{salt,hash}, wrappedVaultKey, recoveryWrappedVaultKey, recoveryVerifierHash, mfa{totp, emailOtp, backupCodes[], passkeys[]}, lockout, settings, role, status | unique(email) |
| `items` | userId, iv, ct, rev, createdAt, updatedAt, deletedAt, purgeAt | (userId, updatedAt); TTL(purgeAt) |
| `folders` | userId, iv, ct, rev | (userId) |
| `sessions` | userId, tokenHash, familyId, device{ua,ipPrefix,label}, lastUsedAt, expiresAt, revokedAt | unique(tokenHash); TTL(expiresAt); (userId) |
| `audit` | userId, event, ipPrefix, ua, meta, at | (userId, at desc); TTL(at, 365d) |
| `sends` | ownerId, iv, ct, maxViews, views, expiresAt | TTL(expiresAt); (ownerId) |
| `challenges` | userId, purpose, codeHash, attempts, expiresAt, usedAt | TTL(expiresAt); (userId, purpose) |
| `snapshots` | userId, at, score, counts{weak,reused,breached,old,total} | (userId, at); opt-in |

---

## 7. Security architecture (summary)

| Threat | Control |
|---|---|
| Database leak | Vault is ciphertext; keys are wrapped; authKey is scrypt-hashed; TOTP secrets AES-GCM at rest; tokens stored as SHA-256 |
| Server compromise / malicious operator | Zero-knowledge: no decryption keys server-side |
| XSS | Strict CSP (no inline scripts), React escaping, no `dangerouslySetInnerHTML`, keys non-extractable, tokens in memory |
| CSRF | Access token in `Authorization` header; refresh cookie `HttpOnly; SameSite=Strict; Path=/api/v1/auth` plus custom header and Origin check |
| Token theft | 10-min access token; rotating refresh with family reuse detection; session list/revoke |
| Brute force / stuffing | express-rate-limit, per-account progressive lockout, scrypt, HIBP-blocked master passwords |
| User enumeration | Decoy prelogin, uniform responses and timing on register/login/recovery |
| Recovery abuse | Email link + MFA + rate limits + alerts + all sessions revoked after |
| Replay | TOTP last-used-step; single-use challenges and mfaToken |
| IDOR | Every query scoped by `userId` from the token; tested |
| NoSQL injection | zod strings at every boundary |
| Ciphertext swapping/tampering | AES-GCM AAD (`userId:itemId`), auth tag verification |
| Supply chain | Allowlisted deps, lockfile committed, `npm audit` in CI |
| Clickjacking / leakage | `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `/api` |

---

## 8. Frontend routes

| Path | Page | Auth |
|---|---|---|
| `/` | Landing | public |
| `/register`, `/login`, `/recover`, `/verify-email` | Auth flows | public |
| `/unlock` | Unlock vault (session alive, key missing) | session |
| `/app` | Dashboard (score, issues, hygiene checklist) | unlocked |
| `/app/vault` | Vault list and editor | unlocked |
| `/app/generator` | Generator | unlocked |
| `/app/security` | Security Center (weak/reused/breached/old/similar) | unlocked |
| `/app/send` | Secure Send manager | unlocked |
| `/app/settings` | Account, MFA, passkeys, sessions, recovery key, import/export | unlocked |
| `/app/audit` | Audit log | unlocked |
| `/s/:id` | Secure Send receiver (key in `#fragment`) | public |
| `/admin` | Admin console (P2) | admin |

---

## 9. Environment variables (`.env.example`)

```
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/vaultguard
CLIENT_ORIGIN=http://localhost:5173
JWT_ACCESS_SECRET=<64+ random chars>
SERVER_ENCRYPTION_KEY=<base64 of 32 random bytes>
DECOY_SECRET=<32+ random chars>            # deterministic fake KDF params for unknown emails
RP_ID=localhost                            # WebAuthn relying party id
RP_NAME=VaultGuard
SMTP_URL=                                  # empty = print emails to the console (dev)
MAIL_FROM="VaultGuard <no-reply@vaultguard.local>"
ADMIN_EMAIL=                               # optional: this email becomes admin on register (P2)
```

`config.js` validates with zod and **refuses to boot** in production if a secret is missing, short, or equals a placeholder.

---

## 10. Scripts

Root `package.json` (npm workspaces: `server`, `client`):

| Script | Does |
|---|---|
| `npm run dev` | API (`node --watch --env-file=.env`) and Vite concurrently (use a two-line shell `&`/`concurrently` only if already allowed; otherwise two terminals and document it) |
| `npm test` | server `node --test` and client `vitest run` |
| `npm run build` | Vite build into `client/dist` |
| `npm start` | production server serving `client/dist` |
| `npm run smoke` | `scripts/smoke.mjs` end-to-end flow against `BASE_URL` |
| `docker compose up --build` | Mongo + app |

---

## 11. Testing strategy

- **Unit (risky logic only):** crypto round trips, AAD mismatch, TOTP vectors, generator, strength cases, HIBP prefix-only, import parsers, score formula.
- **API (node:test + memory Mongo):** the full auth, MFA, recovery, vault, and send flows; IDOR; injection; rate limit; refresh reuse.
- **Smoke (`scripts/smoke.mjs`):** register → verify (reads the console-mail log or a test hook) → login → TOTP enable → login with MFA → create item → sync → lock/unlock logic is client-only so it's covered by vitest → recovery.
- **Manual a11y pass:** keyboard-only run of register → add item → generator → lock; screen-reader labels on all controls.
- CI: install, `npm audit --omit=dev` (report, don't hard-fail on moderate), test, build.

---

## 12. Build phases and exit criteria

Execute strictly in order. After each phase: run its checks, run the self-review gate (`skill.md` §9), update `docs/TRACEABILITY.md` and `docs/DEBT.md`, commit, print the Phase Report.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 Foundation** | Workspaces, `config.js`, `app.js` factory, error handler, pino, Mongo connect, `/health`, helmet/CSP/cors, Vite+Tailwind shell with layout and theme, Docker, CI, `.env.example` | `npm run dev` boots both; `/api/v1/health` 200; headers verified; CI file valid |
| **1 Crypto core** | `client/lib/crypto.js` (PBKDF2, HKDF, wrap/unwrap, encrypt/decrypt with AAD, recovery key encode/decode); `server/lib/{crypto,totp,tokens}.js` | All crypto tests pass incl. RFC 6238 vectors and tamper tests |
| **2 Auth and sessions** | Register, verify email, prelogin (decoy), login, refresh rotation, logout(-all), lockout, rate limits, audit events, AuthContext (lock, idle lock, reload→locked), Register/Login/Unlock/VerifyEmail pages with strength meter | Auth API tests green; manual register→login→lock→unlock works; refresh reuse revokes family |
| **3 MFA** | TOTP, backup codes, email OTP, passkeys, mfaToken flow, step-up middleware, Settings MFA UI | MFA tests green; login requires second factor once enabled; disabling needs step-up |
| **4 Recovery** | Recovery key UI (download+confirm), recover flow, reset-account, rotation, alerts | Recovery e2e test: forgot → email link → MFA → recovery key → new password → old sessions dead |
| **5 Vault** | Models, CRUD with `rev`, folders, sync, trash/restore/purge, client encrypt/decrypt, Vault page, ItemEditor, clipboard clear, password history, in-vault TOTP | IDOR and tamper tests green; create/edit/delete/restore in UI; failed decrypt shows warning not crash |
| **6 Password intelligence** | Strength engine and meter, generator (random/passphrase/PIN), HIBP, reuse/similar/old/master-equal, score, Security Center, Fix wizard, Dashboard, snapshots (opt-in) | Score tests green; HIBP sends only 5 hex chars; fix wizard replaces a weak password end to end |
| **7 Import/Export + Send** | Import parsers and preview, bulk endpoint, encrypted/plain export with step-up, Secure Send create/access/revoke and `/s/:id` page | Import samples parse; export round-trips; send view limit enforced atomically; fragment never logged |
| **8 Polish and hardening** | Settings (all), session manager, audit page, email notifications, empty/loading/error states, dark mode, responsive, a11y pass, bundle budget, CSP tightened, **full-repo audit gate**, README, smoke script | `npm test` + `npm run build` green; initial JS ≤ 250 KB gz; audit findings "must fix" = 0; smoke passes |
| **9 P2 (optional)** | Admin console, PWA, emergency access, Playwright smoke | Only if Phases 0–8 are fully green |

---

## 13. Deployment

- Single container: build client, copy `client/dist` into the server image, Express serves static files and `/api`.
- Required: HTTPS (HSTS via helmet), a managed MongoDB (enable auth and backups), SMTP provider, secrets via environment (never committed).
- `RP_ID` must equal the production domain for passkeys; `CLIENT_ORIGIN` must match the public URL.
- Single-instance note: rate limiting uses the in-memory store. `ponytail: per-process limiter, add a Redis store before scaling past one instance.`

---

## 14. Glossary

**authKey**: value derived in the browser and sent for login; the server only stores its scrypt hash. **wrapKey**: derived key that encrypts the vaultKey. **vaultKey**: random key that encrypts all items. **recoveryKey**: one-time-shown secret that can unwrap the vaultKey. **k-anonymity (HIBP)**: only the first 5 hex chars of the SHA-1 are sent; matching is local. **Step-up**: re-authenticating before a sensitive action. **rev**: per-record revision for optimistic concurrency.
