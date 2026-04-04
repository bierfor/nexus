#!/usr/bin/env bash
# Publish a single package from packages/ only (not examples/ or docs/).
# Usage from repo root:
#   pnpm publish:package -- @nexus_js/assets
#   pnpm publish:package -- vite-plugin-nexus
set -euo pipefail
if [ "${1:-}" = "" ]; then
  echo "Usage: pnpm publish:package -- <package-name>" >&2
  echo "Example: pnpm publish:package -- @nexus_js/assets" >&2
  exit 1
fi
PKG="$1"
# Suffix "..." = this package plus its workspace dependencies (pnpm filter grammar).
pnpm --filter "${PKG}..." run build
pnpm --filter "${PKG}" publish --access public --no-git-checks
