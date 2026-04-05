#!/usr/bin/env bash
# Publish a single package from packages/ only (not examples/ or docs/).
# Usage from repo root:
#   pnpm publish:package -- @nexus_js/assets
#   pnpm publish:package -- @nexus_js/vite-plugin-nexus
# pnpm forwards a literal "--" before the package name; strip it so $1 is the name.
set -euo pipefail
while [ "${1:-}" = "--" ]; do shift; done
if [ "${1:-}" = "" ]; then
  echo "Usage: pnpm publish:package -- <package-name>" >&2
  echo "Example: pnpm publish:package -- @nexus_js/assets" >&2
  exit 1
fi
PKG="$1"
# Suffix "..." = this package plus its workspace dependencies (pnpm filter grammar).
pnpm --filter "${PKG}..." run build
pnpm --filter "${PKG}" publish --access public --no-git-checks
