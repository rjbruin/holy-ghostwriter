#!/usr/bin/env bash
# bump-version.sh — synchronise the version string across all files and tag.
#
# Usage:
#   ./scripts/bump-version.sh 1.2.3
#
# What it does:
#   1. Updates APP_VERSION in app.py
#   2. Updates "version" in desktop/package.json
#   3. Commits both changes
#   4. Creates an annotated git tag  v1.2.3
#
# After running, push the tag to trigger the GitHub Actions release:
#   git push origin main --follow-tags

set -euo pipefail

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]]; then
  echo "Usage: $0 <version>   e.g. $0 1.2.3"
  exit 1
fi

# Strip a leading 'v' if someone passes v1.2.3
NEW_VERSION="${NEW_VERSION#v}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── app.py ──────────────────────────────────────────────────────────────────
APP_PY="$ROOT/app.py"
if ! grep -q 'APP_VERSION' "$APP_PY"; then
  echo "ERROR: APP_VERSION not found in $APP_PY"
  exit 1
fi
sed -i.bak -E "s/^APP_VERSION = \"[^\"]+\"/APP_VERSION = \"$NEW_VERSION\"/" "$APP_PY"
rm -f "$APP_PY.bak"
echo "Updated $APP_PY  →  APP_VERSION = \"$NEW_VERSION\""

# ── desktop/package.json ────────────────────────────────────────────────────
PKG_JSON="$ROOT/desktop/package.json"
# Use node to safely update the JSON (handles any existing version format)
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('$PKG_JSON', 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync('$PKG_JSON', JSON.stringify(pkg, null, 2) + '\n');
"
echo "Updated $PKG_JSON  →  version: \"$NEW_VERSION\""

# ── git commit + tag ────────────────────────────────────────────────────────
cd "$ROOT"
git add app.py desktop/package.json
git commit -m "chore: bump version to $NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo ""
echo "✓ Version bumped to $NEW_VERSION and tagged as v$NEW_VERSION."
echo "  Push with:  git push origin main --follow-tags"
echo "  This will trigger the GitHub Actions release workflow."
