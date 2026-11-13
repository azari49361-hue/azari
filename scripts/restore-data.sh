#!/usr/bin/env bash
# آخرین فایل‌های داده (state.json و ...) را از شاخهٔ data می‌گیرد و در پوشهٔ مقصد می‌گذارد.
# اگر شاخه هنوز نیست (اولین اجرا)، پوشهٔ خالی می‌ماند.
set -euo pipefail
DIR="${1:-out}"
REMOTE="${DATA_REMOTE:-https://x-access-token:${GITHUB_TOKEN:-}@github.com/${GITHUB_REPOSITORY:-}.git}"
mkdir -p "$DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if git ls-remote --exit-code --heads "$REMOTE" data >/dev/null 2>&1; then
  git clone -q --depth 1 --branch data "$REMOTE" "$TMP/d"
  rm -rf "$TMP/d/.git"
  cp -a "$TMP/d/." "$DIR/"
  echo "داده از شاخهٔ data بازیابی شد."
else
  echo "شاخهٔ data هنوز وجود ندارد (اولین اجرا)."
fi
