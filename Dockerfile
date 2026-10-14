# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy manifests and install all deps (workspaces)
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --ignore-scripts

# Build client
COPY client/ ./client/
RUN npm run build --workspace=client

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Install only server production deps
COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci --workspace=server --omit=dev --ignore-scripts

COPY server/ ./server/
# Copy built client into server public dir for static serving
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "--env-file=/run/secrets/vaultguard-env", "server/src/server.js"]
