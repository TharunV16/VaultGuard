# docs/DEBT.md

Ponytail shortcuts ledger. One row per deliberate ceiling-cut.

| # | Where | Shortcut | Ceiling | Upgrade when | FR |
|---|---|---|---|---|---|
| 1 | root/package.json | `concurrently` added for `npm run dev` DX (not in prod bundle) | Fine for single-process dev | Remove if using Docker-only workflow | — |
| 2 | server/src/middleware/rateLimit.js | `express-rate-limit` in-memory store | One process only | Add Redis store before scaling past 1 instance | NFR-S4 |
| 3 | client crypto | PBKDF2-SHA256 (600k) instead of Argon2id | GPU attacks slightly easier vs Argon2id | Upgrade when Argon2id lands natively or threat model demands | AUTH-01, Appendix A |
| 4 | server/lib/totp.js | ~25 lines node:crypto HMAC, no otplib | Only RFC 6238 SHA-1 TOTP | Add HOTP/other algos if needed | MFA-01 |
| 5 | server/lib/webauthn.js | Direct `@simplewebauthn` with `none` attestation | WebAuthn passkeys without hardware root verification | Add enterprise attestation if enterprise SSO/MDM demands | MFA-04 |
| 6 | client/src/components/ItemEditor.jsx | Password history stored in encrypted item payload (client-only, last 5) | No server audit trail of prior passwords | Move to server-side history ledger if compliance requires it | VLT-11 |
| 7 | client/src/pages/Vault.jsx | Client-side search: Array.filter on decrypted items | Scales to ~10k items in memory | Add server-side FTS (MongoDB Atlas) if vault > 10k items | VLT-12 |
| 8 | client/vite.config.js | zxcvbn isolated into manualChunk (resolved: index is 122 KB gzip) | Main bundle clean; zxcvbn loaded as vendor chunk | Move to dynamic import if initial page load must defer dictionary entirely | NFR-perf |
| 9 | scripts/smoke.mjs | Ephemeral in-process fallback with MongoMemoryServer if BASE_URL unavailable | Dev & CI single-process only | Run against external BASE_URL in distributed staging environments | SMK-01 |


