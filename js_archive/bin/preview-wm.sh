#!/usr/bin/env bash
set -euo pipefail

# Быстрый запуск превью ватермарка по списку исходников.
# Пример:
#   bin/preview-wm.sh "s00_1 s00_2 s00_3" "0.3,0.4,0.5"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NAMES="${1:-}"
OPACITIES="${2:-0.3,0.4,0.5,0.6,0.7}"
OUT_DIR="${3:-output/watermark-previews}"

if [[ -z "$NAMES" ]]; then
  echo "Usage: $(basename "$0") \"name1 name2\" \"op1,op2,...\" [output_dir]" >&2
  exit 1
fi

BIN="$ROOT_DIR/rust/target/release/feed-cli"
if [[ ! -x "$BIN" ]]; then
  BIN="$ROOT_DIR/rust/target/debug/feed-cli"
fi
if [[ ! -x "$BIN" ]]; then
  echo "Бинарник не найден: $BIN" >&2
  echo "Соберите: cargo build -p feed-cli --manifest-path rust/Cargo.toml" >&2
  exit 1
fi

for name in $NAMES; do
  file="$(find "$ROOT_DIR/data/photos" -path '*/originals/*' -type f -iname "${name}.*" | head -n 1 || true)"
  if [[ -z "$file" ]]; then
    echo "Не найден исходник: $name" >&2
    continue
  fi
  start_ts="$(date +%s)"
  "$BIN" --photos-preview "$file" \
    --preview-opacities "$OPACITIES" \
    --preview-ignore-settings \
    --preview-out "$OUT_DIR"
  end_ts="$(date +%s)"
  echo "Готово: $name за $((end_ts - start_ts))s"
done
