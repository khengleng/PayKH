FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/dashboard/package.json apps/dashboard/
RUN npm install
COPY apps/dashboard apps/dashboard
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @paykh/dashboard

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/dashboard ./apps/dashboard
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
WORKDIR /app/apps/dashboard
CMD ["npm", "run", "start"]
