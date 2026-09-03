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

echo "Fertig: $ROOT/pb/pb_public"
