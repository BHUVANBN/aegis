#!/usr/bin/env bash
# Build and push the API image. Tries 'az acr build' (in Azure); falls back to local Docker if ACR Tasks is not allowed.
source "$(dirname "$0")/lib.sh"; : "${ACR_NAME:?run 30-app-infra.sh first}"
cd "$REPO_ROOT"
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%s); IMG="$ACR_NAME.azurecr.io/aegis-api:$TAG"
if az acr build -r "$ACR_NAME" -t "aegis-api:$TAG" . -o none 2>/tmp/acr-build.err; then log "built in Azure"
else
  grep -q TasksOperationsNotAllowed /tmp/acr-build.err && warn "ACR Tasks is not allowed on this subscription; using local Docker" || warn "az acr build failed: $(tail -2 /tmp/acr-build.err | tr '\n' ' '); trying local Docker"
  docker info >/dev/null 2>&1 || die "no usable Docker. Fix Docker access (sudo usermod -aG docker \$USER, then re-login) or ask for ACR Tasks"
  az acr login -n "$ACR_NAME"; docker build -t "$IMG" .; docker push "$IMG"
fi
save IMAGE_TAG "$TAG"; log "image: $IMG"
