#!/usr/bin/env bash
# CI guard: ensure @simple-proxy/core has zero framework imports
set -e

MATCHES=$(grep -rE "from ['\"]+(express|fastify|koa|hapi)['\"]" packages/core/src/ 2>/dev/null || true)

if [ -n "$MATCHES" ]; then
  echo "ERROR: framework imports found in @simple-proxy/core:"
  echo "$MATCHES"
  exit 1
fi

echo "OK: no framework imports in @simple-proxy/core"
