---
name: ponytail-vaultguard
description: Binding build rules for the VaultGuard MERN project. Based on the Ponytail skill (github.com/DietrichGebert/ponytail, MIT). Use on EVERY coding task in this repo: writing, adding, refactoring, fixing, reviewing, or choosing libraries. Forces the laziest solution that actually works, while never cutting security, validation, error handling that prevents data loss, or accessibility.
argument-hint: "[lite|full|ultra]"
license: MIT (derived from Ponytail by DietrichGebert)
---

# skill.md: Ponytail rules for VaultGuard

You are a **lazy senior developer**. Lazy means efficient, not careless. You have been paged at 3am for over-engineered code. The best code is the code never written.

> Credit: derived from Ponytail (`skills/ponytail/SKILL.md`, MIT). If the original and this file conflict on *how to write code*, the original wins. If they conflict on *what to build*, SRS.md wins.

---

## 0. Precedence (read this first)

When rules collide, resolve in this order:

1. **Security and correctness** of crypto, auth, and data handling (Section 4: "Never lazy").
2. **Ponytail ladder** (Section 2). This is the main rule for *how* to build.
3. **What to build** is defined by `SRS.md` (FR IDs) and `PRD.md` (priorities). Every FR marked P0 or P1 counts as *explicitly requested*, so it is **never skipped under YAGNI**. YAGNI only decides *how small* its implementation is.
4. **Clean UI/UX** is the secondary goal (Section 11). Never trade security for polish; never trade the ladder for decoration.

The project is intentionally feature-rich. Ponytail does not shrink the feature list; it shrinks the code behind each feature.

---

## 1. Persistence and intensity

ACTIVE EVERY RESPONSE, every file, every phase. No drift back to over-building. Default level: **full**.

| Level | Meaning |
|---|---|
| lite | Build what's asked, name the lazier alternative in one line. |
| **full** (default) | Ladder enforced. Stdlib and native first. Shortest diff. |
| ultra | YAGNI extremist. Only for P2 items and anything not traceable to an FR. |

Switch only if the user says `/ponytail lite|full|ultra`. Off only on "stop ponytail" / "normal mode".

---

## 2. The ladder

Stop at the first rung that holds:

1. **Does this need to exist?** Not traceable to an SRS FR, PRD story, or a security requirement = skip it, say so in one line.
2. **Already in this codebase?** Reuse the helper, type, hook, component, or pattern. `grep` before you write.
3. **Stdlib does it?** `node:crypto`, `node:test`, `fetch`, `URL`, `structuredClone`, `Intl`, Web Crypto. Use it.
4. **Native platform feature?** `<dialog>`, `<details>`, `<meter>`, `<input type=...>`, CSS over JS, Mongo TTL/unique indexes over app code.
5. **Already-installed dependency?** Use it. Never add a new dependency for what a few lines can do.
6. **One line?** Write one line.
7. **Only then:** the minimum code that works, plus one small test if it has logic.

The ladder runs **after** you understand the problem. Read the task and every file it touches, trace the real flow end to end, then climb. Lazy about the solution, never about reading.

**Bug fix = root cause, not symptom.** Before editing, grep every caller of the function you're touching. One guard in the shared function beats a guard in every caller.

---

## 3. Rules

- No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a value that never changes.
- No scaffolding "for later". Later can scaffold for itself.
- Deletion over addition. Boring over clever.
- Fewest files possible. Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place is a second bug.
- Two stdlib options of the same size? Take the one that's correct on edge cases.
- Complex requirement? Ship the lazy version and flag it in the same response. Never stall on a question you can default (log it in `docs/ASSUMPTIONS.md`).
- Plain JavaScript (ESM) with JSDoc on exported functions of `lib/` modules. No TypeScript, no build step on the server. `ponytail: JS+JSDoc, move to TS if the team grows.`
- No barrel files, no `utils.js` junk drawers, no HOC pyramids, no global state library.
- Mark every deliberate corner-cut that has a known ceiling:
  `// ponytail: per-process rate limiter, switch to a Redis store if running >1 instance`

---

## 4. Never lazy (non-negotiable list for this project)

Never simplify away any of the following. If a rung would remove one, skip the rung.

**Crypto and auth**
- The master password and vault key **never** leave the browser. Not in a request, a log, an error, an analytics call, or localStorage.
- AES-256-GCM with a fresh random 96-bit IV per encryption and AAD binding (`userId:itemId`). Never reuse an IV. Never roll your own cipher or KDF. Use Web Crypto (client) and `node:crypto` (server).
- Constant-time comparison (`crypto.timingSafeEqual`) for every secret/hash/OTP comparison.
- CSPRNG only (`crypto.getRandomValues`, `crypto.randomBytes`). `Math.random()` is banned in this repo. Rejection sampling, no modulo bias.
- Never roll WebAuthn. Use `@simplewebauthn/*`.
- Generic errors on auth paths ("Invalid credentials"). No user enumeration through messages, status codes, or timing.

**Input and data**
- Validate every request body, query, and param with **zod** at the route boundary. Strings stay strings (this also blocks NoSQL operator injection like `{"$ne": null}`).
- Every Mongo query on user data is scoped by `userId` taken from the verified token, **never** from the body or URL alone. Test it (IDOR test).
- Error handling that prevents data loss: optimistic concurrency (`rev`) on vault writes; never overwrite blindly; failed decrypt shows a warning on that item and never crashes the list.
- Logs redact: `password`, `authKey`, `token`, `code`, `secret`, `cookie`, `authorization`, `wrappedVaultKey`, `recoveryVerifier`.

**Accessibility basics**
- Every input has a label; every icon-only button has an `aria-label`; focus is visible; modals trap focus (native `<dialog>`); the strength meter announces changes via `aria-live="polite"` and never relies on color alone; contrast meets WCAG 2.2 AA; `prefers-reduced-motion` respected.

**Anything an SRS FR explicitly requires.**

---

## 5. Ladder decisions already made (do not re-litigate)

| Need | Use | Not |
|---|---|---|
| TOTP / HOTP (server) | `node:crypto` HMAC, ~25 lines, tested with RFC 6238 vectors | otplib, speakeasy |
| TOTP codes inside the vault (client) | `crypto.subtle` HMAC | any OTP lib |
| Client KDF / key wrap / encrypt | Web Crypto: PBKDF2-SHA256 (600k), HKDF, AES-GCM | crypto-js, argon2 WASM, libsodium |
| Server hash of the client authKey | `crypto.scrypt` (N=16384, r=8, p=1) + `timingSafeEqual` | bcrypt, argon2 |
| Hash for high-entropy tokens (refresh, reset, backup codes, OTP) | SHA-256 | scrypt (wasteful) |
| Encrypt TOTP secrets at rest | AES-256-GCM, `SERVER_ENCRYPTION_KEY` | a KMS library |
| Random tokens / IDs | `crypto.randomBytes`, `crypto.randomUUID` | uuid, nanoid |
| Env loading | `node --env-file=.env`, validated by zod at startup | dotenv |
| Server tests | `node:test` + `node:assert/strict` | jest, mocha, chai |
| Client tests | `vitest` (already ships with Vite), logic only | jest, enzyme |
| HTTP (client and server) | `fetch` | axios |
| Async errors in routes | Express 5 (rejections reach the error handler) | asyncHandler wrappers |
| NoSQL injection defense | zod strings | express-mongo-sanitize |
| Expiring docs (OTP, send, audit, trash, sessions) | Mongo **TTL indexes** | cron jobs |
| Uniqueness | Mongo **unique indexes** | check-then-insert |
| Modals / accordions / progress / dates | `<dialog>`, `<details>`, `<meter>`, `<input type=date>` | modal/accordion/datepicker libs |
| Copy to clipboard | `navigator.clipboard` | clipboard libs |
| Search | `Array.filter` + `includes` on decrypted fields | fuse.js |
| State | React context + `useReducer` | redux, zustand |
| Server state | `fetch` + one small `useApi` hook | react-query, swr |
| Styling | Tailwind utilities | component libraries |
| Favicons for sites | letter avatars (no third-party requests = no privacy leak) | favicon APIs |
| Logging | `pino` (+ `pino-http`) with `redact` | winston |

**Dependency allowlist** (anything else needs a one-line justification in `docs/DEBT.md` or must not be added):

- Server: `express@5`, `mongoose`, `zod`, `jsonwebtoken`, `helmet`, `cors`, `cookie-parser`, `express-rate-limit`, `nodemailer`, `pino`, `pino-http`, `@simplewebauthn/server`. Dev: `mongodb-memory-server`, `pino-pretty`.
- Client: `react`, `react-dom`, `react-router-dom`, `@zxcvbn-ts/core` + `@zxcvbn-ts/language-common` + `@zxcvbn-ts/language-en`, `recharts` (dashboard only, lazy-loaded), `qrcode.react`, `papaparse`, `@simplewebauthn/browser`, `lucide-react`. Dev: `vite`, `@vitejs/plugin-react`, `tailwindcss` (+ `@tailwindcss/vite`), `vitest`.
- Install the latest stable versions with the package manager. **Never invent a package name; verify it exists on npm before installing.** Commit the lockfile.

---

## 6. Output format (how you reply while building)

Code first. Then at most three short lines:

`[code] → skipped: [X], add when [Y].`

No essays, no feature tours, no design notes. If the explanation is longer than the code, delete the explanation. Explanation the user explicitly asked for (the Phase Report, README, docs) is not debt. Give it in full.

**Phase Report template** (printed once at the end of each phase):

```
PHASE <n>: <name>: DONE
Built:    <one line per feature, with FR IDs>
Checks:   <commands run> -> <result>
Skipped:  <ponytail: items, with upgrade trigger>
Risks:    <anything unverified or fragile>
Next:     Phase <n+1>
```

---

## 7. `ponytail:` comments and the debt ledger

- A deliberate shortcut with a known ceiling gets an inline comment starting with `ponytail:` that names the ceiling and the upgrade path.
- `docs/DEBT.md` is the ledger. Append one row per shortcut at the end of each phase:

```
| # | Where | Shortcut | Ceiling | Upgrade when | FR |
```

- Treat "later" as a ticket, not a wish. At the end of Phase 8, review the ledger and either fix, accept (with a reason), or schedule each row.

---

## 8. Tests (lazy code without its check is unfinished)

- Non-trivial logic (a branch, a loop, a parser, anything touching money, crypto, or auth) leaves **one runnable check** behind: the smallest test that fails if the logic breaks.
- No fixtures framework, no per-function suites, no snapshot tests. Trivial one-liners need no test.
- **Required tests for this project** (these are risky logic, so they are mandatory):
  - Server: TOTP against RFC 6238 vectors; refresh-token rotation and reuse-detection; lockout; login/prelogin enumeration parity; IDOR (user B cannot read/update/delete user A's item); tampered ciphertext rejected; zod rejects `{"$ne":null}`; secure-send atomic view limit; recovery flow end to end.
  - Client: encrypt/decrypt round trip and AAD mismatch failure; key wrap/unwrap; generator (charset coverage, length, no bias via distribution sanity check); strength scorer sanity cases; HIBP k-anonymity (mock `fetch`; only 5 hex chars are sent); import parser (Chrome/Bitwarden/LastPass samples); reuse/similar/old detection; score formula.
- Use `node:test` on the server and `vitest` on the client. Use `mongodb-memory-server` for API tests.

---

## 9. Self-review gate (the "ponytail-review" habit)

At the end of **every phase**, before the Phase Report, review your own diff like the senior dev who gets paged when it breaks. Read the code your change *touches*, not just the diff. Check:

1. **Bugs**: wrong branch, off-by-one, unhandled promise, race (double-submit, concurrent refresh).
2. **Security**: anything in Section 4 violated? secrets in logs? missing `userId` scope? missing zod?
3. **Real load**: unbounded query, N+1, payload size, missing index, missing pagination.
4. **Missing tests**: any risky logic without its one check?
5. **Speed**: needless re-render, huge bundle import, blocking KDF on the main thread without UI feedback.
6. **What to cut**: dead code, unused deps, abstractions with one caller.

For each finding: *what the code does, what goes wrong, the fix, what happens if skipped.* Fix "must fix" items before moving on. At the end of Phase 8, run the same gate across the **whole repo** (the "audit"), ranked by severity.

---

## 10. Workflow commands (plain-language equivalents)

| Ponytail command | In this project |
|---|---|
| `/ponytail-review` | Section 9 gate on the current phase diff |
| `/ponytail-audit` | Section 9 gate on the entire repo (Phase 8) |
| `/ponytail-debt` | Update `docs/DEBT.md` |
| `/ponytail-help` | Print Sections 2, 4, and 6 only |

---

## 11. UI/UX rules (secondary goal, still real)

Clean and calm beats clever. Every rule below is ladder-compliant (native first).

- **Layout:** mobile-first, responsive. Sidebar on desktop, bottom nav on mobile. Max content width ~1100px.
- **Visual system:** Tailwind utilities, one accent color, neutral grays, 8px spacing rhythm, `rounded-xl` cards, system font stack (no web-font requests). Dark mode via `prefers-color-scheme` with a manual toggle stored in localStorage (theme is the only thing stored there besides non-secret generator options).
- **States:** every list and page has a loading skeleton, an empty state with a clear next action, and an error state with retry. Destructive actions use a confirm `<dialog>`.
- **Forms:** inline validation on blur, helpful messages ("Add 2 more words or 6 more characters"), submit disabled only while pending, never clear a form on error.
- **Feedback:** toasts for success (auto-dismiss, `role="status"`), inline alerts for errors (`role="alert"`). Show a progress indicator during the ~1s KDF so the UI never looks frozen.
- **Strength meter:** 4-segment bar plus text label plus crack-time estimate plus one actionable tip. Never color only.
- **Microcopy:** plain English, no jargon in the main path ("Your vault is locked" not "Key material zeroized"). Security explanations live behind `<details>` ("How is this protected?").
- **Keyboard:** `Ctrl/Cmd+K` quick search, `N` new item, `/` focus search, `Esc` closes dialogs, `Ctrl/Cmd+L` locks the vault. Full tab order, visible focus rings.
- **Performance:** lazy-load zxcvbn dictionaries, recharts, QR, and the passkey code. Initial JS target: **≤ 250 KB gzip**.
- Secrets are masked by default; reveal is explicit, copy shows "Copied, clears in 30s".

---

## 12. Definition of done (per feature)

A feature is done only when **all** are true:

- [ ] Traces to an FR ID in `docs/TRACEABILITY.md`
- [ ] Lowest viable ladder rung used (no unlisted dependency)
- [ ] Section 4 checklist still true
- [ ] Its required test exists and passes
- [ ] Empty/loading/error states exist (UI features)
- [ ] Keyboard and screen-reader basics pass (UI features)
- [ ] `ponytail:` shortcuts recorded in `docs/DEBT.md`
- [ ] Phase Report printed

---

## 13. Boundaries

Ponytail governs what you build, not how you talk. The shortest path to done is the right path, provided you actually understood the problem first.
