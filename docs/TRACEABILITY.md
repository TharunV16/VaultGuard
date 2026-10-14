# docs/TRACEABILITY.md

Maps every SRS FR ID to implementation files and tests. Updated at the end of each phase.

| SRS ID | Priority | Description (short) | Implementation | Test |
|---|---|---|---|---|
| — | — | Phase 0: Foundation | | |
| NFR-S2 | P0 | Helmet/CSP | server/src/app.js | manual: curl headers |
| NFR-S4 | P0 | Rate limits | server/src/middleware/rateLimit.js | Phase 2 |
| NFR-S6 | P0 | Pino redact | server/src/app.js | — |
| UX-01 | P0 | Responsive layout | client/src/components/Layout.jsx | — |
| UX-02 | P0 | Dark mode | client/src/main.jsx, Layout.jsx | — |
| — | — | Phase 1: Crypto Core | | |
| NFR-S1 | P0 | Zero-knowledge client KDF & vaultKey wrap | client/src/lib/crypto.js | client/src/test/crypto.test.js |
| AUTH-01 | P0 | Client authKey derivation & server scrypt verify | client/src/lib/crypto.js, server/lib/crypto.js | client/src/test/crypto.test.js, server/test/crypto.test.js |
| MFA-01 | P0 | RFC 6238 TOTP logic with ±1 window | server/lib/totp.js | server/test/crypto.test.js |
| REC-01 | P0 | 160-bit Recovery key generation & derivation | client/src/lib/crypto.js | client/src/test/crypto.test.js |
| VLT-01 | P0 | Item AES-256-GCM encryption with AAD binding | client/src/lib/crypto.js | client/src/test/crypto.test.js |
| NFR-S5 | P0 | AES-256-GCM server data encryption at rest | server/lib/crypto.js | server/test/crypto.test.js |
| AUTH-03 | P0 | JWT access & opaque refresh token generation | server/lib/tokens.js | server/test/auth.test.js |
| — | — | Phase 2: Auth and Sessions | | |
| AUTH-01 | P0 | Registration endpoint & duplicate 202 | server/src/routes/auth.js | server/test/auth.test.js |
| AUTH-02 | P0 | Master password policy & strength meter | client/src/components/StrengthMeter.jsx, Register.jsx | client/src/test/strength.test.js |
| AUTH-03 | P0 | Prelogin endpoint with deterministic decoy salt | server/src/routes/auth.js | server/test/auth.test.js |
| AUTH-04 | P0 | Login with scrypt verify and lockout | server/src/routes/auth.js, client/src/pages/Login.jsx | server/test/auth.test.js |
| AUTH-05 | P0 | Refresh token rotation & reuse detection | server/src/routes/auth.js | server/test/auth.test.js |
| AUTH-06 | P0 | Logout & logout-all session revocation | server/src/routes/auth.js | server/test/auth.test.js |
| AUTH-07 | P0 | Email verification challenge flow | server/src/routes/auth.js, client/src/pages/VerifyEmail.jsx | server/test/auth.test.js |
| AUTH-08 | P0 | Progressive account lockout (5/10/15) | server/src/routes/auth.js | server/test/auth.test.js |
| AUTH-09 | P0 | Client idle auto-lock and unlock page | client/src/hooks/useIdleLock.js, client/src/pages/Unlock.jsx | manual |
| NFR-S4 | P0 | Zod boundary defense against NoSQL injection | server/src/routes/auth.js | server/test/auth.test.js |
| NFR-S6 | P0 | Audit event logging | server/lib/audit.js, server/src/models/Audit.js | server/test/auth.test.js |
| — | — | Phase 3: MFA | | |
| MFA-01 | P0 | TOTP setup & verify with AES-GCM secret at rest | server/src/routes/mfa.js, client/src/components/MfaSetup.jsx | server/test/mfa.test.js |
| MFA-02 | P0 | 10 single-use Crockford Base32 backup codes | server/src/routes/mfa.js, client/src/components/MfaSetup.jsx | server/test/mfa.test.js |
| MFA-03 | P0 | Email OTP fallback with 60s cooldown | server/src/routes/auth.js, server/src/routes/mfa.js | server/test/mfa.test.js |
| MFA-04 | P1 | Passkeys / WebAuthn as second factor | server/lib/webauthn.js, server/src/routes/mfa.js, client/src/components/MfaSetup.jsx | manual / unit |
| MFA-05 | P0 | mfaToken challenge flow on login | server/src/routes/auth.js, client/src/pages/Login.jsx | server/test/mfa.test.js |
| MFA-06 | P0 | Step-up requirement for disabling MFA | server/src/middleware/stepUp.js, server/src/routes/mfa.js | server/test/mfa.test.js |
| MFA-07 | P0 | Rate limits & audit logging for MFA | server/src/routes/auth.js, server/src/routes/mfa.js | server/test/mfa.test.js |
| AUTH-16 | P0 | Step-up token generation & middleware | server/lib/tokens.js, server/src/middleware/stepUp.js, server/src/routes/auth.js | server/test/mfa.test.js |
| — | — | Phase 4: Recovery | | |
| REC-01 | P0 | 160-bit Recovery key generation & derivation | client/src/lib/crypto.js | client/src/test/crypto.test.js |
| REC-02 | P0 | Recovery key compulsory confirmation during registration | client/src/pages/Register.jsx | manual |
| REC-03 | P0 | Recovery start endpoint with generic 202 & email link | server/src/routes/auth.js, client/src/pages/Recover.jsx | server/test/recovery.test.js |
| REC-04 | P0 | Recovery verify endpoint with optional MFA challenge | server/src/routes/auth.js, client/src/pages/Recover.jsx | server/test/recovery.test.js |
| REC-05 | P0 | Recovery complete: verify verifier, re-wrap vaultKey, revoke sessions | server/src/routes/auth.js, client/src/pages/Recover.jsx | server/test/recovery.test.js |
| REC-06 | P0 | Destructive account reset fallback (typed confirmation) | server/src/routes/auth.js, client/src/pages/Recover.jsx | server/test/recovery.test.js |
| REC-07 | P1 | Recovery key rotation with step-up verification | server/src/routes/me.js, client/src/pages/Settings.jsx | server/test/recovery.test.js |
| — | — | Phase 5: Vault CRUD & Client Encryption | | |
| VLT-01 | P0 | Item AES-256-GCM encrypt/decrypt with AAD binding | client/src/context/VaultContext.jsx, client/src/lib/crypto.js | client/src/test/crypto.test.js |
| VLT-02 | P0 | Vault sync endpoint with ETag / If-None-Match | server/src/routes/vault.js | server/test/vault.test.js |
| VLT-03 | P0 | Item CRUD with optimistic concurrency (rev, If-Match) | server/src/routes/vault.js, server/src/models/Item.js | server/test/vault.test.js |
| VLT-04 | P0 | Soft-delete trash with 30-day TTL purge | server/src/routes/vault.js, server/src/models/Item.js | server/test/vault.test.js |
| VLT-05 | P1 | Folder CRUD | server/src/routes/vault.js, server/src/models/Folder.js | server/test/vault.test.js |
| VLT-06 | P1 | Bulk import endpoint | server/src/routes/vault.js | server/test/vault.test.js |
| VLT-07 | P1 | In-vault TOTP authenticator codes | client/src/lib/totp.js, client/src/pages/Vault.jsx | — |
| VLT-08 | P1 | Clipboard auto-clear (30s) | client/src/lib/clipboard.js | — |
| VLT-09 | P0 | IDOR isolation: all item/folder queries scoped by userId | server/src/routes/vault.js | server/test/vault.test.js |
| VLT-10 | P1 | Password generator | client/src/lib/generator.js, client/src/components/ItemEditor.jsx | client/src/test/intelligence.test.js |
| VLT-11 | P1 | Password history (last 5) per item | client/src/components/ItemEditor.jsx | — |
| VLT-12 | P1 | Item editor UI: login/card/note/apiKey types, favorite, tags, URIs | client/src/components/ItemEditor.jsx, client/src/pages/Vault.jsx | — |
| — | — | Phase 6: Password Intelligence | | |
| HLT-01 | P0 | Reuse detection: exact password on >= 2 logins | client/src/lib/score.js | client/src/test/intelligence.test.js |
| HLT-02 | P1 | Similar-password detection (leet normalization) | client/src/lib/score.js | client/src/test/intelligence.test.js |
| HLT-03 | P0 | Old-password detection (>180 days) | client/src/lib/score.js | client/src/test/intelligence.test.js |
| HLT-04 | P0 | Weak password detection (zxcvbn score < 3) | client/src/lib/score.js, client/src/lib/strength.js | client/src/test/intelligence.test.js |
| HLT-05 | P1 | Master-equal password detection | client/src/lib/score.js | client/src/test/intelligence.test.js |
| BRE-01 | P0 | HIBP k-anonymity breach check — only 5 hex chars sent | client/src/lib/hibp.js | client/src/test/strength.test.js |
| BRE-02 | P1 | HIBP bulk scan with progress + bounded concurrency 4 | client/src/lib/hibp.js, client/src/pages/SecurityCenter.jsx | client/src/test/strength.test.js |
| SCR-01 | P0 | Security Score 0-100 with breakdown, bands, and account penalty | client/src/lib/score.js | client/src/test/intelligence.test.js |
| GEN-01 | P0 | Random password generator with charset coverage and no bias | client/src/lib/generator.js | client/src/test/intelligence.test.js |
| GEN-02 | P0 | Passphrase generator from EFF short wordlist | client/src/lib/generator.js | client/src/test/intelligence.test.js |
| GEN-03 | P1 | PIN generator (4-12 digits, CSPRNG) | client/src/lib/generator.js | client/src/test/intelligence.test.js |
| FIX-01 | P0 | Fix wizard: one-click strong replacement per flagged item | client/src/pages/SecurityCenter.jsx | — |
| UI-SC | P1 | Security Center: flagged list, filter tabs, HIBP scan, score bar | client/src/pages/SecurityCenter.jsx | — |
| UI-DB | P1 | Dashboard: SVG score ring, breakdown, quick stats | client/src/pages/Dashboard.jsx | — |
| — | — | Phase 7: Import/Export + Secure Send | | |
| IMP-01 | P1 | CSV import: Chrome/Edge format auto-detected | client/src/lib/importParser.js | client/src/test/import.test.js |
| IMP-02 | P1 | CSV import: Bitwarden format (login + note types) | client/src/lib/importParser.js | client/src/test/import.test.js |
| IMP-03 | P1 | CSV import: LastPass format, strips http://sn | client/src/lib/importParser.js | client/src/test/import.test.js |
| IMP-04 | P1 | CSV import: generic best-effort column matching | client/src/lib/importParser.js | client/src/test/import.test.js |
| EXP-01 | P1 | Bulk import route: POST /vault/items/bulk (max 500, 5000 cap) | server/src/routes/vault.js | — |
| SND-01 | P1 | Create send: AES-256-GCM, key only in URL fragment | server/src/routes/send.js, client/src/pages/Send.jsx | server/test/send.test.js |
| SND-02 | P1 | Recipient access: POST (not GET), atomic view limit | server/src/routes/send.js, client/src/pages/SendView.jsx | server/test/send.test.js |
| SND-03 | P1 | Owner list and revoke sends; TTL auto-purge | server/src/routes/send.js, client/src/pages/Send.jsx | server/test/send.test.js |
| SND-04 | P1 | Fragment key never reaches server; referrerPolicy no-referrer | client/src/pages/SendView.jsx | server/test/send.test.js |
| AT-26 | P0 | Parallel access race: exactly one wins with maxViews=1 | server/src/routes/send.js | server/test/send.test.js |
| — | — | Phase 8: Polish, Hardening & Audit | | |
| VLT-13 | P1 | Export: encrypted JSON default; plaintext CSV with step-up and alert | client/src/pages/Settings.jsx, server/src/routes/vault.js | server/test/me.test.js |
| SES-01 | P0 | List active sessions, device label, coarse IP prefix, revoke one/all | server/src/routes/me.js, client/src/pages/Settings.jsx | server/test/me.test.js |
| AUD-01 | P0 | User-visible paginated audit log, 365-day TTL, categories | server/src/routes/me.js, client/src/pages/Audit.jsx | server/test/me.test.js |
| AUD-02 | P1 | High-risk events send security alert email | server/src/routes/me.js, server/src/routes/mfa.js, server/src/routes/vault.js | server/test/me.test.js |
| SET-01 | P0 | Preferences: auto-lock, clipboard clear, theme, breach scan, generator | client/src/pages/Settings.jsx, server/src/routes/me.js | server/test/me.test.js |
| SET-02 | P0 | Server-side settings contain only non-sensitive values | server/src/models/User.js, server/src/routes/me.js | server/test/me.test.js |
| AUTH-15 | P0 | Change master password: step-up, re-wrap vaultKey, revoke sessions | client/src/pages/Settings.jsx, server/src/routes/me.js | server/test/me.test.js |
| AUTH-18 | P1 | Account deletion: step-up, typed confirmation, full data wipe | client/src/pages/Settings.jsx, server/src/routes/me.js | server/test/me.test.js |
| UX-01 | P0 | Responsive layout from 360px up (sidebar/bottom nav) | client/src/components/Layout.jsx | — |
| UX-02 | P0 | Light/dark theme following prefers-color-scheme with manual override | client/src/components/Layout.jsx, client/src/pages/Settings.jsx | — |
| UX-03 | P0 | Loading, empty, and error states; destructive actions use <dialog> | client/src/pages/Audit.jsx, client/src/pages/Settings.jsx | — |
| UX-05 | P1 | Keyboard shortcuts: Ctrl+K, /, N, Ctrl+L | client/src/pages/Vault.jsx, client/src/context/AuthContext.jsx | — |
| UX-06 | P0 | WCAG 2.2 AA accessibility compliance | client/src/ | — |
| SMK-01 | P0 | End-to-end automated smoke test suite | scripts/smoke.mjs | npm run smoke |


