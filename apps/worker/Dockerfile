FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/worker/package.json apps/worker/
RUN npm install
COPY packages/shared-types packages/shared-types
COPY apps/worker apps/worker
RUN npm run build --workspace @paykh/shared-types \
 && npm run build --workspace @paykh/worker

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
