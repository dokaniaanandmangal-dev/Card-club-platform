#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?usage: run-container.sh <image@sha256:digest>}"
node scripts/verify-image-ref.mjs "$IMAGE" >/dev/null

exec docker run --rm \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -p 127.0.0.1:8080:8080 \
  "$IMAGE"
