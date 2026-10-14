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
| AUTH-03 | P0 | JWT access & opaque refresh token generation | server/lib/tokens.js | Phase 2 |

