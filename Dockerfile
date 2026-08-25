FROM node:22-alpine AS base
RUN apk add --no-cache git curl

# ── deps layer ─────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY website/package*.json ./website/
RUN cd website && npm ci --omit=dev

# ── builder ────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY website/package*.json ./website/
RUN cd website && npm ci
COPY website ./website
COPY src ./src
COPY bin ./bin
COPY package.json ./
# The website's npm `prebuild` hook runs ../scripts/generate-build-info.js,
# which also reads ../CLAUDE.md for the version. Without both, `npm run build`
# exits 1 (MODULE_NOT_FOUND) before next build ever starts.
COPY scripts ./scripts
COPY CLAUDE.md ./
# website/tsconfig.json maps "@lib/*" to the repo-root lib/ — next build cannot
# resolve those imports without it.
COPY lib ./lib
WORKDIR /app/website
RUN npm run build

# ── runner ─────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built app
COPY --from=builder /app/website/.next/standalone ./website/
COPY --from=builder /app/website/.next/static ./website/.next/static
COPY --from=builder /app/website/public ./website/public

# Copy engine (CLI + modules) for direct repair
COPY --from=builder /app/src ./src
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/website/node_modules ./website/node_modules

# Worker script
COPY scripts/sandbox-worker.js ./scripts/

RUN npm install --omit=dev --ignore-scripts 2>/dev/null || true

USER nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app/website
CMD ["node", "server.js"]
