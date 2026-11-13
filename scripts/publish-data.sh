#!/usr/bin/env bash
# فایل‌های پوشهٔ داده را به‌عنوان «یک کامیت تنها» روی شاخهٔ data می‌فرستد (force).
# هر بار تاریخچه از نو ساخته می‌شود تا حجم ریپو با گذشت زمان بزرگ نشود.
set -euo pipefail
DIR="${1:-out}"
REMOTE="${DATA_REMOTE:-https://x-access-token:${GITHUB_TOKEN:-}@github.com/${GITHUB_REPOSITORY:-}.git}"
cd "$DIR"
rm -rf .git
git init -q -b data
git config user.name "azari-bot"
git config user.email "azari-bot@users.noreply.github.com"
git add -A
git commit -q -m "data $(date -u +%Y-%m-%dT%H:%MZ)"
for attempt in 1 2 3; do
  if git push -q --force "$REMOTE" HEAD:refs/heads/data; then
    echo "داده روی شاخهٔ data منتشر شد."
    exit 0
  fi
  echo "ارسال ناموفق بود (تلاش $attempt)؛ دوباره تلاش می‌شود…"
  sleep $((attempt * 5))
done
echo "::error::انتشار داده روی شاخهٔ data ناموفق بود"
exit 1
