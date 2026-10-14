# docs/DEBT.md

Ponytail shortcuts ledger. One row per deliberate ceiling-cut.

| # | Where | Shortcut | Ceiling | Upgrade when | FR |
|---|---|---|---|---|---|
| 1 | root/package.json | `concurrently` added for `npm run dev` DX (not in prod bundle) | Fine for single-process dev | Remove if using Docker-only workflow | — |
| 2 | server/src/middleware/rateLimit.js | `express-rate-limit` in-memory store | One process only | Add Redis store before scaling past 1 instance | NFR-S4 |
| 3 | client crypto | PBKDF2-SHA256 (600k) instead of Argon2id | GPU attacks slightly easier vs Argon2id | Upgrade when Argon2id lands natively or threat model demands | AUTH-01, Appendix A |
| 4 | server/lib/totp.js | ~25 lines node:crypto HMAC, no otplib | Only RFC 6238 SHA-1 TOTP | Add HOTP/other algos if needed | MFA-01 |
