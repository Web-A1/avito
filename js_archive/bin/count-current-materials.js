#!/usr/bin/env node
/**
 * Подсчёт количества объявлений по товарам на основе AdId.
 *
 * Запуск:
 *   node bin/count-current-materials.js           # берёт единственный .xlsx из data/current
 *   node bin/count-current-materials.js --file path/to/file.xlsx
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readCurrentAdsFromXlsx } from '../src/utils/currentAdsReader.js';
import { parseAdId, MATERIAL_ALIASES } from '../src/constants/materialAliases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findSingleXlsx(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx'));
  if (files.length === 0) {
    throw new Error(`Нет .xlsx в ${dir}`);
  }
  if (files.length > 1) {
    throw new Error(`Нашлось несколько .xlsx в ${dir}, укажите нужный через --file: ${files.join(', ')}`);
  }
  return path.join(dir, files[0]);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { file: '', json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--file' || arg === '-f') && args[i + 1]) {
      opts.file = args[++i];
    } else if (arg === '--json') {
      opts.json = true;
    }
  }
  return opts;
}

async function main() {
  const { file, json } = parseArgs();
  const xlsxPath =
    file && file.trim()
      ? path.resolve(file)
      : findSingleXlsx(path.resolve(__dirname, '..', 'data', 'current'));

  const ads = await readCurrentAdsFromXlsx(xlsxPath);
  const aliasToMaterialId = new Map(
    Object.entries(MATERIAL_ALIASES).map(([id, alias]) => [alias, id])
  );
  const counts = new Map();

  for (const ad of ads) {
    const rawId = ad.Id || ad.AvitoId || ad.id || '';
    const parsed = parseAdId(String(rawId));
    const matAlias = parsed?.materialAlias;
    const materialId = matAlias ? aliasToMaterialId.get(matAlias) || `unknown(${matAlias})` : 'unknown';
    counts.set(materialId, (counts.get(materialId) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (json) {
    const payload = {
      file: path.basename(xlsxPath),
      total: ads.length,
      counts: sorted.map(([materialId, count]) => ({ materialId, count }))
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Файл: ${path.basename(xlsxPath)}`);
    console.log(`Всего объявлений: ${ads.length}`);
    sorted.forEach(([k, v]) => console.log(`${k} = ${v}`));
  }
}

main().catch((err) => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
