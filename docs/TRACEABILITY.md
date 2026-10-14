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
