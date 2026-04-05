#!/usr/bin/env bash
# Remove ALL published versions of Nexus framework packages from npm.
# Run ONLY after: npm login.
#
# @nexus_js packages require TFA for publish AND unpublish (same as your 403).
# A single OTP only lasts ~30s — bulk unpublish usually needs either:
#   • Granular npm token with "Bypass two-factor authentication" (recommended), or
#   • PROMPT_OTP_EACH=1 to paste a fresh OTP before each package.
#
# Order: dependents first (npm blocks unpublish if another published package depends on yours).
#
# Usage:
#   DRY_RUN=1 ./scripts/unpublish-all-packages.sh
#   ./scripts/unpublish-all-packages.sh
#   NPM_OTP=123456 ./scripts/unpublish-all-packages.sh    # one OTP (may fail mid-loop if it expires)
#   PROMPT_OTP_EACH=1 ./scripts/unpublish-all-packages.sh
#
set -euo pipefail

if [[ "${DRY_RUN:-}" == "1" ]]; then
  NPM="echo npm"
else
  NPM="npm"
fi

# shellcheck disable=SC2206
PACKAGES=(
  @nexus_js/vite-plugin-nexus
  @nexus_js/create-nexus
  @nexus_js/cli
  @nexus_js/testing
  @nexus_js/head
  @nexus_js/db
  @nexus_js/types
  @nexus_js/server
  @nexus_js/router
  @nexus_js/runtime
  @nexus_js/serialize
  @nexus_js/connect
  @nexus_js/assets
  @nexus_js/audit
  @nexus_js/compiler
  @nexus_js/middleware
  @nexus_js/ui
  @nexus_js/sync
)

echo "This will run: npm unpublish <pkg> --force for ${#PACKAGES[@]} packages."
echo "You must be logged in (npm whoami). Destructive and irreversible for users on npm."
if [[ -z "${NPM_OTP:-}" && "${PROMPT_OTP_EACH:-}" != "1" && "${DRY_RUN:-}" != "1" ]]; then
  echo ""
  echo "Tip: If you get 403 'provide an OTP', use a granular token with bypass 2FA, or run:"
  echo "  PROMPT_OTP_EACH=1 $0"
  echo ""
fi

failed=0
for pkg in "${PACKAGES[@]}"; do
  echo "==> $pkg"
  OTP_ARGS=()
  if [[ "${PROMPT_OTP_EACH:-}" == "1" && "${DRY_RUN:-}" != "1" ]]; then
    read -r -p "Paste current 6-digit OTP from your authenticator app: " OTP
    if [[ -n "${OTP:-}" ]]; then
      OTP_ARGS=(--otp "$OTP")
    fi
  elif [[ -n "${NPM_OTP:-}" ]]; then
    OTP_ARGS=(--otp "$NPM_OTP")
  fi
  if ! $NPM unpublish "$pkg" --force "${OTP_ARGS[@]}"; then
    echo "WARN: unpublish failed or skipped: $pkg" >&2
    failed=$((failed + 1))
  fi
done

echo ""
if [[ "$failed" -gt 0 ]]; then
  echo "$failed package(s) had errors (already removed, policy, dependents, or missing OTP)."
else
  echo "All unpublish commands completed."
fi
echo "npm may block unpublish if a package has registry dependents outside this org."
