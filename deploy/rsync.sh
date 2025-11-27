#!/usr/bin/env bash
set -euo pipefail

# Требуемые переменные: DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH, DEPLOY_KEY (путь к приватному ключу)
if [[ -z "${DEPLOY_HOST:-}" || -z "${DEPLOY_USER:-}" || -z "${DEPLOY_PATH:-}" || -z "${DEPLOY_KEY:-}" ]]; then
  echo "Не заданы DEPLOY_HOST/DEPLOY_USER/DEPLOY_PATH/DEPLOY_KEY" >&2
  exit 1
fi

rsync -az --delete \
  -e "ssh -i ${DEPLOY_KEY} -o StrictHostKeyChecking=no" \
  --exclude '.git' \
  --exclude '.github' \
  --exclude '.env' \
  --exclude 'node_modules' \
  ./ "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"
