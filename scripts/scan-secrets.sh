#!/usr/bin/env bash
# Pre-push gate: fails if the tree or git history contains key-like strings, phone-like numbers or banned words.
set -u
cd "$(dirname "$0")/.."
pat='sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}|supabase|service_role|(^|[^0-9])(\+?20|0)1[0-9]{9}([^0-9]|$)|offline'
bad=0
if git grep -nIiE "$pat" -- . ':!scripts/scan-secrets.sh' ':!package-lock.json'; then bad=1; fi
if git log -p --all -- . ':!scripts/scan-secrets.sh' ':!package-lock.json' | grep -iE "$pat" ; then bad=1; fi
[ $bad = 0 ] && echo "scan: clean" || { echo "scan: FOUND matches"; exit 1; }
