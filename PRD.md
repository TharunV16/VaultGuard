# VaultGuard: Product Requirements Document (PRD)

Version 1.0 · Owner: Product · Companion docs: `SRS.md` (what exactly), `project.md` (how it's structured), `skill.md` (how code is written)

---

## 1. Summary

**VaultGuard** is a zero-knowledge password security platform. It tells people honestly how strong their passwords are, stores their credentials so that not even the server can read them, helps them replace weak and reused passwords with strong ones, and lets them get back into their account safely with multi-factor authentication.

**One-line pitch:** *A password manager that coaches you, and can't read your secrets even if it wanted to.*

## 2. Problem

Users frequently create weak passwords and reuse credentials across multiple services, increasing cybersecurity risks. Existing answers fail in three ways:

1. Tools tell you *that* a password is bad but not *what to do next*.
2. Password managers add friction at setup, so people never finish moving over.
3. Recovery is either insecure (email-only reset) or terrifying (lose the master password, lose everything), and users aren't told which one they have.

## 3. Goals and non-goals

### Goals
| # | Goal | How we know |
|---|---|---|
| G1 | Make weak and reused passwords visible and fixable in minutes | Time to first fix; % of flagged items fixed |
| G2 | Store credentials with real zero-knowledge encryption | Server never holds plaintext or keys (verified by tests) |
| G3 | Make strong choices the easy choice | % of new passwords generated vs typed |
| G4 | Make recovery safe *and* understandable | Recovery key confirmed by ≥ 95% of signups |
| G5 | Drive MFA adoption | ≥ 70% of active users with MFA enabled |
| G6 | Be clean, calm, and accessible (secondary goal) | Lighthouse a11y ≥ 95; task success in usability pass |

### Non-goals (v1)
Browser-extension autofill, native mobile apps, team/org vaults, SSO, push notifications, "remember this device" for MFA, passkey-as-primary-login, password sharing between accounts (Secure Send covers one-off sharing).

## 4. Personas

**Priya, 21, engineering student.** Reuses 3 passwords across 40 accounts. Doesn't want to read about security. Needs: a score she can improve, one-click strong passwords, nothing confusing.

**Arjun, 29, freelance developer.** Many logins plus API keys and 2FA seeds. Already uses TOTP. Needs: API key item type, built-in authenticator, import from his browser, keyboard shortcuts, export (to trust it).

**Meera, 45, runs a small shop.** Shares a supplier portal login with her cousin occasionally. Cautious. Needs: clear recovery explanation, large readable UI, Secure Send for one-off sharing, alerts when something happens.

## 5. Jobs to be done

- When I'm creating a password, help me pick one that's actually strong, without a lecture.
- When I log into dozens of services, let me do it without reusing anything.
- When I suspect I'm in a breach, tell me exactly which of my passwords are affected.
- When I forget my master password, get me back in without making it easy for an attacker to do the same.
- When I need to hand someone a password once, let me do it without email or chat history keeping it forever.

## 6. User stories and acceptance criteria

IDs map to SRS requirements in brackets.

### Epic A: Get started safely
- **A1** As a new user, I want to create an account and see how strong my master password is *as I type* so that I start with a good one. [AUTH-01, AUTH-02, STR-01]
  *AC:* Meter updates within 150 ms; weak/breached passwords block submit with a specific tip; no master password in any network request.
- **A2** As a new user, I want to save my recovery key properly so that I'm never locked out forever. [REC-01]
  *AC:* Key shown once, downloadable, last group must be re-typed to continue; plain-language explanation of what it does.
- **A3** As a new user, I want to verify my email so that my account is genuinely mine. [AUTH-04]

### Epic B: Daily vault use
- **B1** As a user, I want to add a login, note, card, or API key quickly so that I actually use the vault. [VLT-01]
  *AC:* Add flow ≤ 3 steps for a login; `N` opens the editor; generator is inline.
- **B2** As a user, I want to search instantly so that I find an item in seconds. [VLT-07, UX-05]
  *AC:* `Ctrl/Cmd+K` or `/`; results filter as I type across name, username, URL, tags.
- **B3** As a user, I want secrets masked and copy to auto-clear so that shoulder-surfing and clipboard leaks are less likely. [VLT-08]
- **B4** As a user, I want to see my 2FA codes next to my logins so that I stop switching apps. [VLT-11]
- **B5** As a user, I want deleted items to be recoverable for 30 days so that mistakes aren't permanent. [VLT-04]
- **B6** As a user, I want my vault to lock itself when I walk away so that someone else can't use it. [AUTH-12]

### Epic C: Fix my passwords
- **C1** As a user, I want a single Security Score with a breakdown so that I know where I stand. [SCR-01]
- **C2** As a user, I want to see which passwords are weak, reused, similar, old, or breached so that I know what to fix. [HLT-01…05, BRE-02]
- **C3** As a user, I want a guided "Fix" flow that proposes a strong replacement so that fixing takes seconds, not hours. [HLT-06, GEN-06]
  *AC:* From a flagged item, one click proposes a generated password with a strength preview; saving records history; the score updates immediately.
- **C4** As a user, I want a generator for random passwords, passphrases, and PINs so that I always have a strong option. [GEN-01…05]
- **C5** As a user, I want breach checks that don't expose my passwords so that checking isn't itself a risk. [BRE-01]
  *AC:* Only a 5-character hash prefix leaves the browser; offline shows "couldn't check", never "safe".

### Epic D: MFA and recovery
- **D1** As a user, I want to turn on an authenticator app and get backup codes so that my account survives a stolen password. [MFA-01, MFA-02]
- **D2** As a user, I want to add a passkey as a second factor so that login is both stronger and faster. [MFA-04]
- **D3** As a user who forgot my master password, I want a safe recovery path so that I can regain access. [REC-02…04]
  *AC:* Email link + MFA + recovery key → new master password; all other sessions end; I get an alert email.
- **D4** As a user who lost everything, I want an honest reset option so that I can start over rather than be stuck. [REC-05]
  *AC:* Clear warning that the vault will be erased; typed confirmation required.
- **D5** As a user, I want sensitive actions to re-confirm my identity so that a hijacked open session can't do damage. [AUTH-16]

### Epic E: Control and visibility
- **E1** As a user, I want to see and end my active sessions so that I can kick out devices I don't recognize. [SES-01]
- **E2** As a user, I want an audit log and alert emails so that I notice suspicious activity. [AUD-01, AUD-02]
- **E3** As a user, I want to import from my browser or old manager so that switching takes minutes. [VLT-12]
- **E4** As a user, I want to export my data so that I never feel locked in. [VLT-13]
- **E5** As a user, I want to send a secret that expires after one view so that it doesn't linger in chat history. [SND-01…04]

## 7. Prioritization

| Priority | Included | Release |
|---|---|---|
| **P0 (MVP)** | Zero-knowledge auth, verification, sessions, lock/unlock, step-up, change password, TOTP/backup/email OTP, recovery (all paths), vault CRUD (4 types, folders, trash, search, concurrency), strength meter, generator (random + passphrase), HIBP, reuse/weak/old detection, score, dashboard, fix wizard, sessions, audit, settings, core UX/a11y | v1.0 |
| **P1** | Passkeys, new-device alerts, KDF upgrade, account deletion, password history, in-vault TOTP, import/export, PIN generator, similar-password and master-equal detection, auto breach scan, trend chart, Secure Send, email notifications, recovery key rotation, shortcuts | v1.0 (same release, built after P0) |
| **P2** | Admin console, PWA, emergency access, Playwright smoke | v1.1+ |

Build order follows `project.md` §12; P2 starts only when every P0 and P1 requirement is green.

## 8. UX principles and design

**Secondary goal: clean, calm, trustworthy.** Security products feel scary; this one should feel like a quiet, competent assistant.

### 8.1 Principles
1. **One next action per screen.** The dashboard always says what to fix first.
2. **Plain words first, details on demand.** Security explanations sit in `<details>` ("How is this protected?").
3. **Never frozen, never silent.** The ~1 s key derivation shows progress; every failure has a reason and a next step.
4. **Honest by default.** "Couldn't check" ≠ "safe". Entropy is "≈ N bits (estimate)". Recovery limits are stated up front.
5. **Safe defaults, visible controls.** Masked secrets, auto-lock on, clipboard clears, MFA nudged.
6. **Accessible without extra effort.** Keyboard, labels, contrast, reduced motion, no color-only meaning.

### 8.2 Visual system
- Tailwind utilities; system font stack; one accent (deep teal/indigo), neutral grays, semantic colors used **with text and icons** (never color alone).
- 8 px spacing grid; `rounded-xl` cards; subtle shadow; generous whitespace; max width ~1100 px.
- Light and dark themes; manual toggle stored locally.
- Score ring and 4-segment strength bar are the signature elements. Motion is minimal and respects `prefers-reduced-motion`.
- Letter avatars for sites (no third-party favicon requests).

### 8.3 Navigation
Desktop: left sidebar (Dashboard, Vault, Generator, Security, Send, Settings) with a top bar (search, lock button, theme). Mobile: bottom nav (Vault, Security, Generator, Send, More) plus a floating "Add" button.

### 8.4 Key screens (sketches)

**Dashboard**
```
┌ Good evening                                  [Lock] ┐
│  ┌ Security Score ┐   Fix this first                 │
│  │      72        │   ▸ 3 reused passwords   [Fix]   │
│  │     Fair       │   ▸ 2 weak passwords     [Fix]   │
│  └────────────────┘   ▸ 1 found in a breach  [Fix]   │
│  Weak 2 · Reused 3 · Breached 1 · Old 4 · Similar 2    │
│  Account checklist:  ✔ Email  ✔ MFA  ✖ Passkey  ✔ Recovery key │
│  Trend (opt-in) ▁▂▃▅▆▇                                 │
└──────────────────────────────────────────────────────┘
```

**Vault:** filter bar (type, folder, tag, favorites, issues), list of cards (avatar, name, username, issue badges), detail drawer with masked password, copy buttons, live TOTP ring, history under `<details>`. `N` creates; `Esc` closes.

**Register:** 3 steps with a visible stepper: (1) email + master password with strength meter and "How is this protected?"; (2) recovery key (download, confirm last group); (3) check your email.

**Security Center:** tabs (Weak, Reused, Breached, Old, Similar) with counts, "Scan for breaches" button with progress, "Start fix wizard".

**Settings:** sections for Profile, Security (MFA, passkeys, backup codes, change master password, recovery key), Sessions, Vault (auto-lock, clipboard), Import/Export, Privacy (snapshots), Danger zone.

### 8.5 Microcopy tone
Friendly, direct, no fear-mongering. Examples:
- Weak password tip: "Add two more words and this gets much harder to guess."
- Recovery step: "This is your only way back in if you forget your master password. We can't see it or reset it for you."
- Offline breach check: "We couldn't check right now. Try again when you're online."
- Lock screen: "Your vault is locked. Enter your master password to continue."

## 9. Key user flows

1. **First run:** Landing → Register (3 steps) → verify email → login → empty vault with a "Add your first login" or "Import from browser" prompt → dashboard shows the checklist (enable MFA).
2. **Fix a weak password:** Dashboard "Fix" → wizard shows the item and reason → "Generate strong password" → editor opens pre-filled → user changes it on the site → Save → score ring animates up (or updates instantly with reduced motion).
3. **Login with MFA:** email + master password → "Enter your 6-digit code" (or use a backup code / email code / passkey) → vault unlocks.
4. **Forgot master password:** Login → "Forgot?" → email → link → MFA → recovery key → new master password + new recovery key → signed in; other devices signed out.
5. **Share once:** Send → paste secret → expiry + max views → copy link → recipient opens it, sees the secret once.

## 10. Success metrics

| Metric | Target (first 90 days of pilot) |
|---|---|
| Signup → first vault item within 5 min | ≥ 60% |
| Recovery key confirmed at signup | ≥ 95% |
| Active users with MFA | ≥ 70% |
| Flagged items fixed within 7 days of flag | ≥ 40% |
| Average Security Score improvement after first fix session | ≥ +15 points |
| New passwords created via generator | ≥ 50% |
| Support-free recoveries | ≥ 90% of recovery starts complete |
| Task success in 5-person usability test (register, add item, fix item, lock/unlock) | ≥ 90% |

Measurement is **privacy-preserving**: only server-side aggregate counts (e.g., MFA enabled %, snapshot counts for opted-in users). No third-party analytics, no per-user behavioral tracking, nothing derived from vault contents.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Users lose both master password and recovery key | Prominent, honest recovery UX; forced confirmation; reminders in the hygiene checklist; destructive reset path so they're never stuck |
| Client-side crypto bugs | Native Web Crypto only; required tests (round trip, AAD, tamper); self-review gate each phase |
| XSS steals decrypted data | Strict CSP, no inline scripts, React escaping, non-extractable key, in-memory only, auto-lock |
| Email account compromise abuses recovery | Recovery needs email link **and** MFA **and** the recovery key to read data; alerts on every step; reset path destroys data rather than exposing it |
| HIBP unavailability | Graceful "couldn't check" state; never claims safety |
| Scope creep | `skill.md` ladder; features must trace to an SRS ID; P2 gated |
| PBKDF2 weaker than Argon2id against GPUs | Strict master-password policy plus 600k iterations; documented upgrade path; KDF auto-upgrade (AUTH-19) |
| Dependency compromise | Allowlist, pinned lockfile, `npm audit` in CI |

## 12. Release plan

| Release | Contents |
|---|---|
| **v1.0** | All P0 and P1, hardened (Phase 8 audit with zero "must fix") |
| v1.1 | P2: admin console, PWA, Playwright smoke |
| v1.2 | Emergency access |
| Later | Extension autofill, Argon2id, import from more managers, org vaults |

## 13. Open questions (default chosen so building never stalls)

| Question | Default | Where logged |
|---|---|---|
| Email provider for production | SMTP via `SMTP_URL`; console in dev | ASSUMPTIONS.md |
| Language support | English only; strings centralized in one file per page group is **not** required (YAGNI) | ASSUMPTIONS.md |
| Wordlist source | EFF short wordlist (1296 words) | ASSUMPTIONS.md |
| Hosting | Single container + managed MongoDB | project.md §13 |
