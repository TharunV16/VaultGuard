# PROMPT.md: master build prompt for Antigravity

## How to use

1. Create an empty workspace folder (e.g. `vaultguard`).
2. Put these four files in its **root**: `skill.md`, `project.md`, `SRS.md`, `PRD.md`.
3. Open the folder in Antigravity, start a new agent task, and paste **PROMPT A** below (or upload this file and say "Follow PROMPT A").
4. A project this size may not finish in one run. If the agent stops early, paste **PROMPT B** (continue).
5. Keep **Node.js ≥ 22** and **MongoDB** (local or Docker) available. Without network access the agent can't `npm install`; enable it.

---

## PROMPT A: full build

```
You are a senior full-stack (MERN) engineer and security engineer. Your job is to build the
complete "VaultGuard" project from the four specification files in this workspace root.

FILES (read ALL of them completely before writing any code):
1. skill.md    - BINDING rules for how you write code (Ponytail: the laziest solution that
                 actually works; never lazy about security, validation, data-loss handling,
                 accessibility). Copy it to ./AGENTS.md so it stays active every response.
2. project.md  - architecture, key hierarchy, flows, stack, repo layout, env, build phases.
3. SRS.md      - every functional requirement with an ID, priorities, API table, data model,
                 NFRs, crypto parameters, score formula, rate limits, acceptance tests.
4. PRD.md      - goals, personas, user stories, UX principles, screens, microcopy, metrics.

PRECEDENCE: (1) security/correctness  (2) the Ponytail ladder in skill.md  (3) SRS.md decides
WHAT to build; every P0 and P1 requirement is explicitly requested and must be built  (4) clean
UI/UX is the secondary goal. If two files disagree, SRS.md wins on behavior, skill.md wins on
how to write code. Log any conflict you resolve in docs/ASSUMPTIONS.md.

PROCESS
0. After reading, reply with a plan of at most 12 lines. Do not ask me questions; choose
   sensible defaults and record them in docs/ASSUMPTIONS.md.
1. Scaffold the repo exactly as project.md section 5 (npm workspaces: server, client).
2. Execute project.md section 12, Phases 0 to 8, strictly in order. Phase 9 (P2) only if
   Phases 0-8 are fully green.
3. For EACH phase, in this order:
   a. Build only what the phase lists, using the lowest viable ladder rung (skill.md section 2).
   b. Write the required tests for the risky logic in that phase (skill.md section 8).
   c. Run the checks: install, tests, build, boot. Fix every failure. Never skip or weaken a
      failing test to make it pass; fix the cause.
   d. Run the self-review gate (skill.md section 9) on your own diff and fix "must fix" items.
   e. Update docs/TRACEABILITY.md (SRS ID -> files -> test) and docs/DEBT.md.
   f. git commit with message "phase N: <name>".
   g. Print the Phase Report (template in skill.md section 6).
4. Verify for real. Do not claim a feature works unless you ran it. If you could not run
   something (no browser, no network, no SMTP), say exactly that in the Phase Report under Risks.
5. Dependencies: only the allowlist in skill.md section 5. Install latest stable versions.
   NEVER invent a package name: confirm it exists on npm before installing. Commit the lockfile.

HARD CONSTRAINTS (violating any of these is a failed build)
- The master password, authKey derivation inputs, vaultKey, and recovery key are NEVER sent to
  the server, logged, or stored in localStorage/sessionStorage/IndexedDB/cookies. Only the
  derived authKey and the wrapped keys go to the server. Refresh token = httpOnly cookie only.
  Access token and vaultKey live in memory only; vaultKey is a non-extractable CryptoKey.
- AES-256-GCM, fresh random 96-bit IV per encryption, AAD = `${userId}:${itemId}`.
  Web Crypto on the client, node:crypto on the server. No custom crypto. Math.random() is banned.
- Item type, folder, favorite, tags, name, and all fields live INSIDE the encrypted blob. The
  server stores only iv, ct, rev, timestamps, userId.
- Every route validates input with zod. Every query on user data is scoped by userId from the
  verified token. Constant-time comparisons for all secrets.
- Auth, register, and recovery responses must not reveal whether an email exists.
- HIBP: send only the first 5 hex chars of the SHA-1, header Add-Padding: true, match locally.
  A failed check displays "couldn't check", never "safe".
- Logs redact secrets (pino redact). No plaintext secrets or tokens in logs or error messages.
- Accessibility basics from skill.md section 4 are mandatory, not polish.
- Never use `dangerouslySetInnerHTML`. CSP per SRS NFR-S2.

QUALITY BAR FOR UI (secondary goal, still required)
Follow skill.md section 11 and PRD.md section 8: responsive, dark mode, loading/empty/error
states, native <dialog>/<details>/<meter>, progress feedback during the key derivation,
strength meter with text (never color only), keyboard shortcuts, plain-language microcopy,
initial JS <= 250 KB gzip with lazy-loaded zxcvbn dictionaries, recharts, QR, and passkey code.

FINAL DELIVERABLES (all must exist and work)
- Running app: `npm install && npm run dev` (document the Mongo requirement) and
  `docker compose up --build`.
- `npm test` green (server node:test + client vitest) and `npm run build` green.
- scripts/smoke.mjs that exercises register -> verify email -> login -> enable TOTP ->
  login with MFA -> create item -> sync -> recovery, and passes.
- README.md (setup, env, scripts, architecture summary, security model in plain words,
  recovery warning, how to run tests), .env.example, Dockerfile, docker-compose.yml,
  .github/workflows/ci.yml.
- docs/TRACEABILITY.md with 100% of P0 and P1 SRS IDs mapped to code and a test where required,
  docs/DEBT.md (every `ponytail:` shortcut), docs/ASSUMPTIONS.md, docs/API.md (route list).
- At the end of Phase 8: run the whole-repo audit (skill.md section 9), rank findings, fix all
  "must fix", and record the rest in DEBT.md.
- A final report: what was built (by SRS ID), test counts, what was NOT verified, known
  limitations, and the 5 highest-value next steps.

Begin now with step 0.
```

---

## PROMPT B: continue (use if the agent stops early)

```
Continue the VaultGuard build. First read docs/TRACEABILITY.md, docs/DEBT.md, the git log, and
the last Phase Report to find the current phase and what is unfinished. Re-read skill.md
(Ponytail rules stay binding). Do not restart or rewrite finished phases. Resume at the first
incomplete item, then proceed through the remaining phases exactly as in the original process
(build, test, run, self-review gate, traceability, debt, commit, Phase Report). Run the existing
tests first and fix any regressions before adding anything new.
```

---

## PROMPT C: review pass (optional, after the build)

```
Run the Ponytail whole-repo audit on VaultGuard (skill.md section 9). Map the entry points and
data flow first, then check bugs, security (especially every item in skill.md section 4), real
load, missing tests, speed, and what to cut. For each finding give: what the code does, what
goes wrong, the fix, and what happens if we skip it. Rank by severity, fix all "must fix"
items, update docs/DEBT.md, and print a verdict stating what to fix first.
```
