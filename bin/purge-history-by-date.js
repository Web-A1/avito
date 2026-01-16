#!/usr/bin/env node
/**
 * Удаляет записи истории и локальные фото по дате.
 *
 * Пример:
 *   node bin/purge-history-by-date.js --date 12.01.2026
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PHOTOS_ROOT = path.join(ROOT, 'data', 'photos');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { date: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      opts.date = args[++i];
    }
  }
  return opts;
}

function dateToIsoPrefix(ddmmyyyy) {
  const [dd, mm, yyyy] = ddmmyyyy.split('.');
  if (!dd || !mm || !yyyy) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function collectHistoryFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectHistoryFiles(full, out);
      continue;
    }
    if (entry.isFile() && (entry.name === 'hashes.json' || entry.name === 'hashes.json.tmp')) {
      out.push(full);
    }
  }
}

function matchesDate(ad, targetDate, isoPrefix) {
  const dateBegin = String(ad.dateBegin || '');
  if (dateBegin.startsWith(targetDate)) return true;
  const ts = String(ad.timestamp || '');
  if (isoPrefix && ts.startsWith(isoPrefix)) return true;
  return false;
}

function removePhotoIfExists(dir, photoPath) {
  if (!photoPath) return 0;
  const variantsDir = path.join(dir, 'variants');
  const filePath = path.join(variantsDir, photoPath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return 1;
  }
  return 0;
}

function main() {
  const opts = parseArgs();
  if (!opts.date) {
    console.error('Нужна дата: --date DD.MM.YYYY');
    process.exit(1);
  }
  const isoPrefix = dateToIsoPrefix(opts.date);
  const files = [];
  collectHistoryFiles(PHOTOS_ROOT, files);

  let removedEntries = 0;
  let removedFiles = 0;
  let touchedHistoryFiles = 0;
  let deletedHistoryFiles = 0;

  for (const file of files) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.warn(`⚠️  Не удалось прочитать ${file}: ${e.message}`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn(`⚠️  Некорректный JSON в ${file}: ${e.message}`);
      continue;
    }
    const ads = Array.isArray(data.ads) ? data.ads : [];
    if (!ads.length) continue;

    const dir = path.dirname(file);
    const keep = [];
    for (const ad of ads) {
      if (matchesDate(ad, opts.date, isoPrefix)) {
        removedEntries++;
        removedFiles += removePhotoIfExists(dir, ad.photoPath);
      } else {
        keep.push(ad);
      }
    }

    if (keep.length !== ads.length) {
      touchedHistoryFiles++;
      if (keep.length === 0) {
        fs.unlinkSync(file);
        deletedHistoryFiles++;
      } else {
        const next = { ...data, ads: keep };
        fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
      }
    }
  }

  console.log(`Готово. Дата: ${opts.date}`);
  console.log(`Удалено записей истории: ${removedEntries}`);
  console.log(`Удалено файлов фото: ${removedFiles}`);
  console.log(`Файлов истории изменено: ${touchedHistoryFiles}`);
  console.log(`Файлов истории удалено: ${deletedHistoryFiles}`);
}

main();
