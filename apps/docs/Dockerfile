FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/docs/package.json apps/docs/
RUN npm install
COPY apps/docs apps/docs
# NEXT_PUBLIC_* is inlined at build time — accept it as a build arg (Railway
# passes service variables to the Docker build automatically).
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @paykh/docs

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/docs ./apps/docs
COPY --from=build /app/package.json ./package.json
EXPOSE 3002
WORKDIR /app/apps/docs
CMD ["npm", "run", "start"]
