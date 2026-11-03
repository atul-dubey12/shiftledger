#!/usr/bin/env bash
# Builds the on-device (GitHub Pages) version and publishes it to the gh-pages branch.
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=$(git remote get-url origin)
npm run build:pages
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
