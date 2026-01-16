#!/usr/bin/env node
/**
 * Нормализует адреса в Excel выгрузке: заменяет известные алиасы на канонические.
 *
 * Пример:
 *   node bin/normalize-current-addresses.js
 *   node bin/normalize-current-addresses.js --file data/current/file.xlsx
 *   node bin/normalize-current-addresses.js --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { CITY_ALIASES, SELLER_ADDRESS_ALIASES } from '../src/constants/materialAliases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CURRENT_DIR = path.resolve(__dirname, '..', 'data', 'current');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { file: '', dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--file' || arg === '-f') && args[i + 1]) {
      opts.file = args[++i];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    }
  }
  return opts;
}

function findSingleXlsx(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx'));
  if (files.length === 0) {
    throw new Error(`Нет .xlsx в ${dir}`);
  }
  if (files.length > 1) {
    throw new Error(`Нашлось несколько .xlsx в ${dir}, укажите --file: ${files.join(', ')}`);
  }
  return path.join(dir, files[0]);
}

function toKey(header = '') {
  return header
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .toLowerCase();
}

function detectHeaderRow(rows = []) {
  if (rows.length >= 2) {
    const headerRow1 = rows[1] || [];
    if (headerRow1.some((cell) =>
      String(cell || '').toLowerCase().includes('уникальный идентификатор объявления')
    )) {
      return { headerRowIndex: 1, dataStartIndex: 2 };
    }
  }
  if (rows.length >= 1) {
    const headerRow0 = rows[0] || [];
    if (headerRow0.some((cell) =>
      String(cell || '').toLowerCase() === 'id' ||
      String(cell || '').toLowerCase() === 'avitoid'
    )) {
      return { headerRowIndex: 0, dataStartIndex: 1 };
    }
  }
  return { headerRowIndex: -1, dataStartIndex: -1 };
}

function buildCityNames() {
  const names = new Set();
  Object.keys(CITY_ALIASES).forEach((addr) => {
    const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts[1]) names.add(parts[1]);
  });
  return Array.from(names);
}

function hasLocality(address, cityNames) {
  const text = String(address || '').toLowerCase();
  return cityNames.some((city) => text.includes(city.toLowerCase()));
}

function main() {
  const { file, dryRun } = parseArgs();
  const xlsxPath = file && file.trim()
    ? path.resolve(file)
    : findSingleXlsx(DEFAULT_CURRENT_DIR);

  const workbook = xlsx.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const { headerRowIndex, dataStartIndex } = detectHeaderRow(rows);
  if (headerRowIndex === -1) {
    throw new Error('Не удалось найти заголовки (Id/AvitoId) в Excel');
  }

  const headers = (rows[headerRowIndex] || []).map((h) => toKey(String(h || '')));
  const addressIdx = headers.findIndex((h) => h === 'адрес' || h === 'address');
  if (addressIdx === -1) {
    throw new Error('Не найден столбец Address/Адрес в Excel');
  }

  const cityNames = buildCityNames();
  let normalizedCount = 0;
  let missingLocalityCount = 0;
  const missingSamples = [];

  for (let i = dataStartIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const rawAddress = String(row[addressIdx] || '').trim();
    if (!rawAddress) continue;

    const normalized = SELLER_ADDRESS_ALIASES[rawAddress] || rawAddress;
    if (normalized !== rawAddress) {
      row[addressIdx] = normalized;
      normalizedCount += 1;
    }

    if (!hasLocality(row[addressIdx], cityNames)) {
      missingLocalityCount += 1;
      if (missingSamples.length < 5) {
        missingSamples.push(row[addressIdx]);
      }
    }
  }

  if (!dryRun && normalizedCount > 0) {
    const nextSheet = xlsx.utils.aoa_to_sheet(rows);
    workbook.Sheets[sheetName] = nextSheet;
    xlsx.writeFile(workbook, xlsxPath);
  }

  console.log(`Файл: ${path.basename(xlsxPath)}`);
  console.log(`Нормализовано адресов: ${normalizedCount}${dryRun ? ' (dry-run)' : ''}`);
  console.log(`Адресов без населенного пункта: ${missingLocalityCount}`);
  if (missingSamples.length) {
    console.log(`Примеры: ${missingSamples.join(' | ')}`);
  }
}

try {
  main();
} catch (err) {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
}
