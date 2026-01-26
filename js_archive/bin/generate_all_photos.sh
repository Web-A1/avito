#!/usr/bin/env bash
set -euo pipefail

SRC_ROOT="/Users/andrey.filipov/Desktop/avito_api/data/photos"
OUT_DIR="/Users/andrey.filipov/Desktop/avito_api/output/test_fs_flat"

mkdir -p "$OUT_DIR"

shopt -s nullglob
for img in "$SRC_ROOT"/*/originals/*.{jpg,jpeg,png,webp}; do
  [ -f "$img" ] || continue
  node "$(dirname "$0")/generate-photo-variants.js" \
    --input "$img" \
    --out "$OUT_DIR" \
    --count 1 \
    --text-watermark NERUDA \
    --text-opacity 0.03 \
    --pattern-opacity 0.03 \
    --flat-out \
    --ignore-history
  echo "Generated: $img"
done
