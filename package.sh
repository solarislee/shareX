#!/usr/bin/env bash
# 打包成可上传到 Chrome Web Store 的 zip（只含运行所需文件）
set -euo pipefail
cd "$(dirname "$0")"

OUT="post-to-image-card.zip"
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  content.css \
  popup.html \
  icons \
  -x '*.DS_Store'

echo ""
echo "✅ 打包完成: $OUT"
echo "包含文件:"
unzip -l "$OUT"
