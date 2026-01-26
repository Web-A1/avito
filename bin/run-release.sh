#!/usr/bin/env bash
set -euo pipefail

start_total=$(date +%s)

echo "==> Сборка release"
start_build=$(date +%s)
cargo build -p feed-cli --manifest-path rust/Cargo.toml --release
build_secs=$(( $(date +%s) - start_build ))
echo "==> Сборка завершена за ${build_secs} сек"

echo "==> Запуск feed-cli"
start_run=$(date +%s)
./rust/target/release/feed-cli \
  --plan data/plan.json \
  --current-dir data/current \
  --update-rules update_old_ads.json \
  --photos-rust \
  --upload-rust \
  --out-dir rust/output \
  "$@"
run_secs=$(( $(date +%s) - start_run ))
total_secs=$(( $(date +%s) - start_total ))

echo "==> Выполнение feed-cli: ${run_secs} сек"
echo "==> ИТОГО (сборка + запуск): ${total_secs} сек"
