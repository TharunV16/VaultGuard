# VaultGuard

> Zero-knowledge, web-based password security platform featuring end-to-end client encryption, multi-factor authentication, strength analysis, leak detection, and cryptographic account recovery.

---

## 1. Architecture Summary

VaultGuard is built as a MERN application designed with zero-knowledge cryptographic isolation:

- **Client (`client/`)**: React 19 SPA built with Vite and Tailwind CSS. All cryptographic derivations and item encryptions take place strictly inside the browser using the Web Crypto API.
- **Server (`server/`)**: Express 5 REST API using Node.js ≥ 22 and MongoDB (Mongoose). The server never sees the user's master password, vault key, item plaintext, or Secure Send encryption keys.
- **Crypto Engine**:
  - **KDF**: PBKDF2-SHA256 (600,000 iterations) with a 16-byte random salt deriving the `masterKey`.
  - **Sub-keys**: HKDF-SHA256 derives an `authKey` (transmitted to authenticate; server verifies against an `scrypt` hash with `crypto.timingSafeEqual`) and a `wrapKey` (wraps the `vaultKey`).
  - **Vault Key**: Non-extractable 256-bit AES-GCM key generated in the browser. Stored on the server only as ciphertext encrypted with `wrapKey` and `recoveryWrapKey`.
  - **Item Cipher**: AES-256-GCM with fresh 96-bit random IVs and authenticated additional data (AAD = `${userId}:${itemId}`).
  - **HIBP Check**: K-anonymity model: only the first 5 hexadecimal characters of SHA-1(password) are transmitted with `Add-Padding: true`; suffix comparison happens entirely in the browser.

---

## 2. Security Model in Plain Words

1. **Your master password never leaves your device**: When you type your master password, your browser derives a separate login token (`authKey`) and an encryption key (`wrapKey`). The server never knows your password.
2. **Your vault is unreadable by VaultGuard or anyone else**: Every login, card, note, and API key is encrypted on your machine using a random vault key before sending it over the network. Even with direct database access, attackers only see encrypted data.
3. **No tracking or third-party leaks**: Favicons use local letter avatars, and fonts use local system stacks. No third-party network requests are made that could leak your visited sites or identity.
4. **Hardware-grade Multi-Factor Authentication**: Protect logins with TOTP authenticator apps, FIDO2/WebAuthn passkeys, email OTP, and single-use emergency backup codes.

---

## 3. ⚠️ Recovery Warning

> **CRITICAL**: Because VaultGuard is zero-knowledge, the VaultGuard team cannot reset your master password or recover your data for you.
>
> When you register, you are provided with a **160-bit Emergency Recovery Key**. Keep this key in a secure offline location (printed or on an encrypted USB drive).
> If you lose both your master password and your recovery key, your encrypted credentials are permanently unrecoverable.

---

## 4. Setup & Running Locally

### Prerequisites
- **Node.js ≥ 22**
- **MongoDB ≥ 7.0** (running locally or via Docker)

### Installation
```bash
# Clone the repository
git clone https://github.com/your-username/vaultguard.git
cd vaultguard

# Install dependencies for both server and client workspaces
npm install
```

### Environment Configuration
Copy the example environment file:
```bash
cp .env.example .env
```
Fill in the required environment variables:
- `MONGO_URI`: MongoDB connection string (e.g. `mongodb://localhost:27017/vaultguard`)
- `CLIENT_ORIGIN`: Frontend URL (default: `http://localhost:5173`)
- `JWT_ACCESS_SECRET`: 64+ char random hex string for short-lived access JWTs
- `SERVER_ENCRYPTION_KEY`: 32-byte Base64-encoded key for encrypting server secrets (e.g., TOTP seeds at rest)
- `DECOY_SECRET`: 32+ char secret for deterministic decoys and verification codes

### Development Server
```bash
npm run dev
```
Starts the Express API server on `http://localhost:5000` and the Vite dev server on `http://localhost:5173`.

### Docker Deployment
```bash
docker compose up --build
```
Spins up both MongoDB and the production VaultGuard container.

---

## 5. Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Runs both server and client concurrently in watch mode |
| `npm test` | Runs all server (`node:test`) and client (`vitest`) unit & integration tests |
| `npm run build` | Builds optimized production client bundle (`dist/`) |
| `npm start` | Boots the Express server in production mode serving static client assets |
| `npm run smoke` | Runs the automated end-to-end smoke test suite (`scripts/smoke.mjs`) |

---

## 6. How to Run Tests

### Run Full Test Suite (Server + Client)
```bash
npm test
```
- **Server Tests**: 55 tests covering crypto round-trips, AAD mismatch rejection, TOTP RFC 6238 vectors, authentication, sessions, IDOR scoping, recovery, vault CRUD, and secure send view limits.
- **Client Tests**: 63 tests covering import parsers (Chrome/Edge, Bitwarden, LastPass), password strength evaluation, intelligence rules, and Web Crypto operations.

### Run End-to-End Smoke Test
```bash
npm run smoke
```
Exercises full user journey:
Registration → Email Verification → Login → TOTP MFA Enablement → Login with MFA → Encrypted Item Creation → Vault Sync → Emergency Recovery.
