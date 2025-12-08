#!/usr/bin/env node
/**
 * Загружает сгенерированные фото на Яндекс.Диск, публикует их и сохраняет ссылки.
 *
 * По умолчанию:
 * - читаем план data/plan.json (aliases.materials поддерживаются)
 * - берём исходники из data/photos/<materialId>/variants/*.jpg|jpeg|png
 * - складываем на Диск в папку Cursor_for_Avito/<date>/<materialId>/
 * - результат сохраняем в output/photos_links_<date>.json
 *
 * Пример:
 *   YANDEX_DISK_TOKEN=... npm run photos:upload
 *   node bin/upload-photos.js --plan ./data/plan.json --root Cursor_for_Avito --date 2025-12-09
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PLAN_PATH = path.resolve(__dirname, '..', 'data', 'plan.json');
const DEFAULT_VARIANTS_ROOT = path.resolve(__dirname, '..', 'data', 'photos');
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'output');
const DEFAULT_DISK_ROOT = 'Cursor_for_Avito';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    plan: '',
    diskRoot: DEFAULT_DISK_ROOT,
    date: '',
    outDir: DEFAULT_OUTPUT_DIR
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--plan' && args[i + 1]) {
      opts.plan = args[++i];
    } else if (arg === '--root' && args[i + 1]) {
      opts.diskRoot = args[++i];
    } else if (arg === '--date' && args[i + 1]) {
      opts.date = args[++i];
    } else if (arg === '--out' && args[i + 1]) {
      opts.outDir = args[++i];
    }
  }
  return opts;
}

function formatDateLabel(str) {
  if (str) return str;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readPlan(planPath) {
  const resolved = planPath || (fs.existsSync(DEFAULT_PLAN_PATH) ? DEFAULT_PLAN_PATH : '');
  if (!resolved) return null;
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`Не удалось прочитать план ${resolved}: ${e.message}`);
    return null;
  }
}

function resolveMaterials(plan) {
  if (!plan || !Array.isArray(plan.tasks)) return [];
  const aliases = plan.aliases || {};
  const matAliases = aliases.materials || {};
  const materials = new Set();
  plan.tasks.forEach((task) => {
    const mat = matAliases[task.materialId] || task.materialId;
    if (mat) materials.add(mat);
  });
  return Array.from(materials);
}

function listVariantFiles(materialId) {
  const dir = path.join(DEFAULT_VARIANTS_ROOT, materialId, 'variants');
  if (!fs.existsSync(dir)) {
    console.warn(`Нет папки с вариантами: ${dir}`);
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((n) => n.match(/\.(jpg|jpeg|png)$/i))
    .map((n) => ({ path: path.join(dir, n), name: n }));
}

async function httpRequest(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function ensureFolder(token, diskPath) {
  const url = `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(diskPath)}`;
  try {
    await httpRequest(url, { method: 'PUT', headers: { Authorization: `OAuth ${token}` } });
  } catch (e) {
    // Если уже существует, API вернет 409 — это не критично
    if (!String(e.message).includes('409')) throw e;
  }
}

async function uploadFile(token, localPath, diskPath) {
  const uploadUrlRes = await httpRequest(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(diskPath)}&overwrite=true`,
    { method: 'GET', headers: { Authorization: `OAuth ${token}` } }
  );
  const { href } = JSON.parse(uploadUrlRes.data);
  const fileBody = fs.readFileSync(localPath);
  await httpRequest(href, { method: 'PUT', headers: { 'Content-Length': fileBody.length } }, fileBody);
}

async function publishFile(token, diskPath) {
  await httpRequest(
    `https://cloud-api.yandex.net/v1/disk/resources/publish?path=${encodeURIComponent(diskPath)}`,
    { method: 'PUT', headers: { Authorization: `OAuth ${token}` } }
  );
  const info = await httpRequest(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(diskPath)}`,
    { method: 'GET', headers: { Authorization: `OAuth ${token}` } }
  );
  const json = JSON.parse(info.data);
  return json.public_url || '';
}

async function processMaterial(token, materialId, diskRoot, dateLabel) {
  const files = listVariantFiles(materialId);
  if (!files.length) return [];

  const remoteBase = `disk:/${diskRoot}/${dateLabel}/${materialId}`;
  await ensureFolder(token, remoteBase);

  const results = [];
  for (const file of files) {
    const remotePath = `${remoteBase}/${file.name}`;
    await uploadFile(token, file.path, remotePath);
    const publicUrl = await publishFile(token, remotePath);
    results.push({ materialId, file: file.name, public_url: publicUrl });
    console.log(`Загружено и опубликовано: ${materialId}/${file.name}`);
  }
  return results;
}

async function main() {
  try {
    const opts = parseArgs();
    const token = process.env.YANDEX_DISK_TOKEN;
    if (!token) {
      throw new Error('YANDEX_DISK_TOKEN не найден в окружении');
    }

    const plan = readPlan(opts.plan);
    const materials = resolveMaterials(plan);
    if (!materials.length) {
      throw new Error('В плане не найдено ни одного materialId');
    }

    const dateLabel = formatDateLabel(opts.date);
    const allResults = [];
    for (const mat of materials) {
      const res = await processMaterial(token, mat, opts.diskRoot, dateLabel);
      allResults.push(...res);
    }

    if (!fs.existsSync(opts.outDir)) {
      fs.mkdirSync(opts.outDir, { recursive: true });
    }
    const outPath = path.join(opts.outDir, `photos_links_${dateLabel}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          date: dateLabel,
          diskRoot: opts.diskRoot,
          items: allResults
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`Готово: ${allResults.length} файлов, ссылки сохранены в ${outPath}`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
