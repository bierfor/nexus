#!/usr/bin/env bash
# Quick checks when `pnpm release` fails with E404 on PUT to registry.npmjs.org.
# See docs/PUBLISHING.md — usually: publish 2FA needs a granular token with "bypass 2FA".
set -euo pipefail
echo "=== npm whoami ==="
npm whoami 2>&1 || true
echo ""
echo "=== ~/.npmrc publish auth (line present? token value is NOT shown) ==="
if [[ -f "$HOME/.npmrc" ]] && grep -qE '^//registry\.npmjs\.org/:_authToken=|^//registry\.npmjs\.org/:_authToken ' "$HOME/.npmrc" 2>/dev/null; then
  echo "OK: found //registry.npmjs.org/:_authToken=... in ~/.npmrc"
elif [[ -f "$HOME/.npmrc" ]] && grep -q '_authToken' "$HOME/.npmrc" 2>/dev/null; then
  echo "Note: ~/.npmrc mentions _authToken but not for registry.npmjs.org — check //registry.npmjs.org/:_authToken="
else
  echo "MISSING: no _authToken for registry.npmjs.org in ~/.npmrc — interactive npm login often is not enough for CI-style publish; add a granular token (see below)."
fi
echo ""
echo "=== npm config get @nexus_js:registry (project + user) ==="
npm config get @nexus_js:registry 2>&1 || true
echo ""
echo "=== Latest npm debug log: does stack mention otplease (2FA)? ==="
LOG_DIR="$HOME/.npm/_logs"
LATEST=""
OT_FILE=""
if [[ -d "$LOG_DIR" ]]; then
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    if grep -q otplease "$f" 2>/dev/null; then OT_FILE="$f"; break; fi
  done < <(ls -t "$LOG_DIR"/*-debug-0.log 2>/dev/null | head -8)
fi
if [[ -n "$OT_FILE" ]]; then
  echo ">>> FOUND 'otplease' in: $OT_FILE"
  echo "    npm required 2FA/OTP for publish but did not get it (npm 10/11 often surfaces this as E404 on PUT)."
  echo "    Fix: create a NEW granular token (Publish + Bypass 2FA) and REPLACE the line in ~/.npmrc."
  if [[ -f "$HOME/.npmrc" ]] && grep -qE '^//registry\.npmjs\.org/:_authToken=' "$HOME/.npmrc" 2>/dev/null; then
    echo "    You already have _authToken in ~/.npmrc — if publish still fails, that token is not allowed to bypass publish 2FA (revoke it and use a granular token with Bypass 2FA)."
  fi
elif [[ -d "$LOG_DIR" ]] && LATEST="$(ls -t "$LOG_DIR"/*-debug-0.log 2>/dev/null | head -1)" && [[ -n "$LATEST" ]]; then
  echo "Latest log (no otplease in last 8 files): $LATEST"
  echo "If publish still failed with E404, open ~/.npm/_logs/*-debug-0.log from that run and search for otplease."
else
  echo "No *-debug-0.log found under $LOG_DIR"
fi
echo ""
echo "=== Env vars that npm may treat as config (names only; no values) ==="
# npm maps NPM_CONFIG_* / npm_config_* into config; typos show as Unknown env config.
env | grep -E '^(npm_config_|NPM_CONFIG_)' | cut -d= -f1 | sort -u | head -40 || true
echo ""
echo "If you see odd keys (e.g. containing nexus-js), unset them from your shell profile."
echo ""
echo "=== TL;DR when PUT returns E404 (log stack contains otplease) ==="
echo "1. New granular token: @nexus_js/* Read+Write + Bypass 2FA (required)."
echo "2. Try env var (often fixes pnpm + npm subprocess):"
echo "   export NODE_AUTH_TOKEN=npm_PASTE_TOKEN && pnpm release"
echo "3. Or ~/.npmrc one line (not pasted alone in zsh):"
echo "   printf '%s\\n' '//registry.npmjs.org/:_authToken=npm_PASTE_TOKEN' >> ~/.npmrc"
