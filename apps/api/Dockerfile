# ---- Build stage ----
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy manifests for cached installs.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/security/package.json packages/security/
COPY apps/api/package.json apps/api/

RUN npm install

# Copy sources.
COPY packages/shared-types packages/shared-types
COPY packages/security packages/security
COPY apps/api apps/api

RUN npm run build --workspace @paykh/shared-types \
 && npm run build --workspace @paykh/security \
 && npm run prisma:generate --workspace @paykh/api \
 && npm run build --workspace @paykh/api

# ---- Runtime stage ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

EXPOSE 4000
WORKDIR /app/apps/api
# Run migrations then start (Railway: set start command explicitly if preferred).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
