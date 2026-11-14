# Static build served by unprivileged nginx. Build from repo root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_AUTH_MODE=entra ... -t aegis-web .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY tsconfig.base.json ./
COPY apps/web apps/web
ARG VITE_AUTH_MODE=entra
ARG VITE_API_BASE=
ARG VITE_ENTRA_CLIENT_ID=
ARG VITE_ENTRA_TENANT_ID=
ARG VITE_ENTRA_API_SCOPE=
RUN npm run build -w @aegis/web

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
