#!/usr/bin/env bash
# Baut das SvelteKit-Frontend direkt nach pb/pb_public/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/frontend"

if [ ! -d node_modules ]; then
	if [ -f package-lock.json ]; then npm ci; else npm install; fi
fi

rm -rf "$ROOT/pb/pb_public"
mkdir -p "$ROOT/pb/pb_public"

npm run build

# pb/pb_hooks/webpush.js liegt im Repo, damit der Server kein npm braucht --
# hier neu erzeugt, damit es nicht hinter seiner Quelle zurueckbleibt.
npm run build:hooks

echo "Fertig: $ROOT/pb/pb_public"
