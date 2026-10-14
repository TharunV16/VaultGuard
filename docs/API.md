# docs/API.md — VaultGuard REST API

Base path: `/api/v1`. All responses JSON. Auth: `Authorization: Bearer <accessToken>` unless marked public.
Error shape: `{ "error": { "code": "...", "message": "...", "details"?: {} } }`.
All responses include `Cache-Control: no-store`.

## Health
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | public | liveness check |

## Auth
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/prelogin` | public | KDF params (decoy for unknown email) |
| POST | `/auth/register` | public | Create account (always 202) |
| POST | `/auth/verify-email` | public | Verify email token |
| POST | `/auth/resend-verification` | public | Resend (always 202) |
| POST | `/auth/login` | public | Login → tokens or MFA challenge |
| POST | `/auth/mfa/email/send` | mfaToken | Send email OTP |
| POST | `/auth/mfa/passkey/options` | mfaToken | WebAuthn assertion options |
| POST | `/auth/mfa/verify` | mfaToken | Complete login (TOTP/backup/email/passkey) |
| POST | `/auth/refresh` | cookie | Rotate refresh, return access + wrappedVaultKey |
| POST | `/auth/logout` | token | Revoke current session |
| POST | `/auth/logout-all` | token | Revoke all sessions |
| POST | `/auth/step-up` | token | authKey (+MFA) → stepUpToken |
| POST | `/auth/recovery/start` | public | Always 202; sends email link if account exists |
| POST | `/auth/recovery/verify` | public | Token + MFA → recovery blob |
| POST | `/auth/recovery/complete` | recoveryToken | Store new keys |
| POST | `/auth/recovery/reset-account` | recoveryToken | Wipe vault data |

## Me
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/me` | token | Profile, MFA flags, settings, hygiene inputs |
| PATCH | `/me/settings` | token | Non-sensitive settings |
| POST | `/me/password` | stepUp | Change master password |
| POST | `/me/recovery-key/rotate` | stepUp | New recovery material |
| GET | `/me/sessions` | token | List active sessions |
| DELETE | `/me/sessions/:id` | token | Revoke one session |
| GET | `/me/audit` | token | Paginated audit log |
| GET | `/me/snapshots` | token | Security score trend |
| POST | `/me/snapshots` | token | Save snapshot (opt-in) |
| DELETE | `/me` | stepUp | Delete account and all data |

## MFA
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/mfa/totp/setup` | token | Generate TOTP secret + QR |
| POST | `/mfa/totp/enable` | token | Confirm and enable TOTP |
| DELETE | `/mfa/totp` | stepUp | Disable TOTP |
| POST | `/mfa/backup-codes/regenerate` | stepUp | New backup codes |
| POST | `/mfa/email/enable` | token | Enable email OTP |
| POST | `/mfa/email/disable` | stepUp | Disable email OTP |
| POST | `/mfa/passkeys/register/options` | stepUp | WebAuthn registration options |
| POST | `/mfa/passkeys/register/verify` | stepUp | Verify and save passkey |
| GET | `/mfa/passkeys` | token | List passkeys |
| DELETE | `/mfa/passkeys/:id` | stepUp | Remove passkey |

## Vault
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/vault/sync` | token | Sync items + folders (since=ISO) |
| POST | `/vault/items` | token | Create item |
| PUT | `/vault/items/:id` | token | Update item (If-Match: rev) |
| DELETE | `/vault/items/:id` | token | Soft delete (trash) |
| POST | `/vault/items/:id/restore` | token | Restore from trash |
| DELETE | `/vault/items/:id/permanent` | token | Permanent delete |
| POST | `/vault/items/bulk` | token | Bulk import (≤500) |
| GET | `/vault/folders` | token | List folders |
| POST | `/vault/folders` | token | Create folder |
| PUT | `/vault/folders/:id` | token | Update folder |
| DELETE | `/vault/folders/:id` | token | Delete folder |

## Send
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/send` | token | Create send |
| GET | `/send` | token | List owner's sends |
| DELETE | `/send/:id` | token | Revoke send |
| POST | `/send/:id/access` | public | Consume a view, return ciphertext |

## Admin (P2)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/stats` | admin | Aggregate stats |
| GET | `/admin/users` | admin | User list |
| PATCH | `/admin/users/:id` | admin | Enable/disable user |

## Error Codes
`VALIDATION` 400 · `AUTH_INVALID` 401 · `TOKEN_EXPIRED` 401 · `MFA_REQUIRED` 401 · `MFA_INVALID` 401 · `STEP_UP_REQUIRED` 403 · `EMAIL_NOT_VERIFIED` 403 · `ACCOUNT_LOCKED` 423 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `GONE` 410 · `PAYLOAD_TOO_LARGE` 413 · `RATE_LIMITED` 429 · `INTERNAL` 500
