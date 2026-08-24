# ZOOGA OS WhatsApp Web bridge — Alex Personal identity only.
# Deployment target: Hostinger / generic VPS with Docker.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY scripts ./scripts

# Persistent volume for Baileys auth state + idempotency ledger.
VOLUME ["/data"]
ENV DATA_DIR=/data
ENV SESSION_DIR=/data/session
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node scripts/healthcheck.mjs

USER node
CMD ["node", "dist/index.js"]
