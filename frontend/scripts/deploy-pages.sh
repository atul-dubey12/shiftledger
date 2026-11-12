#!/usr/bin/env bash
# Builds the GitHub Pages site and publishes it to the gh-pages branch.
# Default: the synced build that talks to the hosted API. MODE=device npm run deploy builds the old on-device version.
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=$(git remote get-url origin)
if [ "${MODE:-api}" = "device" ]; then npm run build:pages; else npm run build:pages-api; fi
OUT=dist/shiftledger-web/browser
cp "$OUT/index.html" "$OUT/404.html"
touch "$OUT/.nojekyll"
cd "$OUT"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy $(git -C ../../.. rev-parse --short HEAD 2>/dev/null || date +%F)"
git push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "Deployed to https://atul-dubey12.github.io/shiftledger/"
