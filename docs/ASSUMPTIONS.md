# docs/ASSUMPTIONS.md

Defaults chosen so building never stalls. Each logged here per skill.md §3.

| # | Question | Default | Phase |
|---|---|---|---|
| 1 | Email provider for production | SMTP via `SMTP_URL`; console transport in dev (nodemailer) | 0 |
| 2 | Language support | English only; no i18n framework | 0 |
| 3 | Wordlist source | EFF short wordlist (1296 words), bundled in client | 0 |
| 4 | Hosting | Single container + managed MongoDB (documented in README) | 0 |
| 5 | `npm run dev` concurrency | `concurrently` package added to root devDeps (allowlist: not listed; justified: only for DX, not in production bundle; logged in DEBT.md row 1) | 0 |
| 6 | Tailwind CSS version | v4 (ships via `@tailwindcss/vite` plugin, no separate config file needed) | 0 |
| 7 | CSP `style-src` | `'unsafe-inline'` kept per SRS NFR-S2 comment; scripts stay strict | 0 |
| 8 | Auto-lock default | 5 minutes (user can choose 1/5/15/30/60; no "never") per AUTH-12 | 0 |
| 9 | TOTP window | ±1 step (RFC 6238 recommendation) per MFA-01 | 1 |
| 10 | Backup code format | 10 chars Crockford Base32 per MFA-02 | 1 |
| 11 | Recovery key format | 160-bit, 32 Base32 chars grouped as 8×4 with dashes | 1 |
| 12 | Item hard size limit | 64 KB ciphertext per VLT-02; server validates Content-Length | 5 |
| 13 | Secure Send key | 256-bit random, base64url in fragment (never reaches server) | 7 |
| 14 | Session device label | Hash of UA + coarse IP prefix (first 3 octets IPv4 / /48 IPv6) | 2 |
| 15 | `concurrently` version | Latest stable; justified as DX-only, not in production bundle | 0 |
