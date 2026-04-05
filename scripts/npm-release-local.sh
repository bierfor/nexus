#!/usr/bin/env bash
# Publish only packages/* to npm (never docs/ or examples/).
# Requires a granular npm token with Read+Write on @nexus_js/* and Bypass 2FA for publish.
#
# Usage (same shell session):
#   export NODE_AUTH_TOKEN=npm_your_token_here
#   ./scripts/npm-release-local.sh
#
# Or: NPM_TOKEN=... ./scripts/npm-release-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TOK="${NODE_AUTH_TOKEN:-${NPM_TOKEN:-}}"
if [[ -z "$TOK" ]]; then
  echo "Missing NODE_AUTH_TOKEN (or NPM_TOKEN)." >&2
  echo "Create a granular token: https://www.npmjs.com/settings/~/tokens" >&2
  echo "  - Packages: @nexus_js/* — Read and write" >&2
  echo "  - Enable: Bypass two-factor authentication (for publish)" >&2
  echo "Then run:" >&2
  echo "  export NODE_AUTH_TOKEN=npm_...." >&2
  echo "  pnpm run release:env" >&2
  exit 1
fi

export NODE_AUTH_TOKEN="$TOK"
# nexus-js and nexus_js (unscoped) are taken by other npm users — skip them
pnpm publish -r \
  --filter './packages/*' \
  --filter '!nexus-js' \
  --filter '!nexus_js' \
  --access public \
  --no-git-checks \
  --report-summary
