#!/usr/bin/env bash
set -euo pipefail

# Помощник: по имени файла подсказывает команду генерации 1 фото
# Использование:
#   bin/watermark-cmd.sh "s00_2.JPG"
#   bin/watermark-cmd.sh "data/photos/.../file.jpg"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_OUT="output/test_fs_flat"

if [[ $# -lt 1 ]]; then
  echo "Usage: $(basename "$0") <filename> [extra node args]" >&2
  exit 1
fi

INPUT_NAME="$1"
shift || true

resolve_input() {
  local name="$1"
  # Абсолютный путь — сразу возвращаем
  if [[ "$name" = /* ]]; then
    echo "$name"
    return 0
  fi
  # Если путь относительно корня репо
  if [[ -f "$ROOT_DIR/$name" ]]; then
    echo "$ROOT_DIR/$name"
    return 0
  fi
  # Пробуем найти в data/photos по имени (без учёта регистра)
  local found base
  found="$(find "$ROOT_DIR/data/photos" -type f -iname "$name" | head -n 1 || true)"
  if [[ -n "$found" ]]; then
    echo "$found"
    return 0
  fi
  # Если не нашли точным совпадением, пробуем по basename с любым расширением
  base="$(basename "$name")"
  base="${base%.*}"
  if [[ -n "$base" ]]; then
    found="$(find "$ROOT_DIR/data/photos" -type f -iname "${base}.*" | head -n 1 || true)"
    if [[ -n "$found" ]]; then
      echo "$found"
      return 0
    fi
  fi
  return 1
}

INPUT_PATH="$(resolve_input "$INPUT_NAME")" || {
  echo "Не найден файл по имени: $INPUT_NAME" >&2
  exit 1
}

CMD=(
  node "$ROOT_DIR/bin/generate-photo-variants.js"
  --input "$INPUT_PATH"
  --out "$ROOT_DIR/$DEFAULT_OUT"
  --count 1
  --flat-out
  --ignore-history
)

# Добавляем любые дополнительные аргументы, если передали после имени файла
if [[ $# -gt 0 ]]; then
  CMD+=("$@")
fi

printf 'Запускаю:\n'
printf '%q ' "${CMD[@]}"
printf '\n'
"${CMD[@]}"
