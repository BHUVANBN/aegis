# AEGIS API image. Build from the repository root:  docker build -t aegis-api .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @aegis/api --workspace @aegis/shared
RUN mkdir -p apps/api/node_modules

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node_modules/.bin/tsx", "apps/api/src/index.ts"]
