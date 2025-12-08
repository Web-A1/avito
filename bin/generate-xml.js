#!/usr/bin/env node
/**
 * CLI для генерации тестового XML по песку.
 * Пример: node bin/generate-xml.js --count 5 --date 05.12
 */

import fs from 'fs';
import path from 'path';
import { generateAds } from '../src/generators/adGenerator.js';
import { generateXml } from '../src/xml/xmlGenerator.js';
import { TOP_5_TITLES } from '../src/constants/titles.js';
import { fileURLToPath } from 'url';
import { readCurrentAdsFromXlsx } from '../src/utils/currentAdsReader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { count: 1, date: '', currentDir: '', plan: '' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--count' && args[i + 1]) {
      opts.count = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--date' && args[i + 1]) {
      opts.date = args[i + 1];
      i++;
    } else if (arg === '--current-dir' && args[i + 1]) {
      opts.currentDir = args[i + 1];
      i++;
    } else if (arg === '--plan' && args[i + 1]) {
      opts.plan = args[i + 1];
      i++;
    }
  }
  return opts;
}

function findSingleXlsx(dir) {
  if (!dir) return null;
  const entries = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.xlsx'));
  if (entries.length === 0) return null;
  if (entries.length > 1) {
    throw new Error(`В папке ${dir} найдено несколько .xlsx, оставьте один файл.`);
  }
  return path.join(dir, entries[0]);
}

function resolveMaterialId(id, aliases = {}) {
  if (!id) return id;
  const map = aliases.materials || {};
  return map[id] || id;
}

function resolveAddresses(addresses = [], aliases = {}) {
  const map = aliases.addresses || {};
  return addresses.map((addr) => map[addr] || addr);
}

async function main() {
  const { count, date, currentDir, plan } = parseArgs();

  let currentAds = [];
  if (currentDir) {
    const xlsxPath = findSingleXlsx(currentDir);
    if (xlsxPath) {
      currentAds = await readCurrentAdsFromXlsx(xlsxPath);
      console.log(`Прочитано текущих объявлений из XLSX: ${currentAds.length}`);
    }
  }

  // План задач: либо из файла, либо одна задача с count/адресами по умолчанию
  let tasks = [];
  const planPath = plan || path.resolve(__dirname, '..', 'data', 'plan.json');
  let aliases = { materials: {}, addresses: {} };
  if (fs.existsSync(planPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      tasks = json.tasks || [];
      aliases = json.aliases || aliases;
    } catch (e) {
      console.warn(`Не удалось прочитать план ${planPath}: ${e.message}`);
    }
  }
  if (!tasks.length) {
    tasks = [
      {
        material: 'sand',
        materialId: 'NEMYTYY_NESEYANYY',
        count,
        addresses: ['Московская область, Одинцово'],
        titles: TOP_5_TITLES,
        photos: ['https://disk.yandex.ru/i/example-photo']
      }
    ];
  }

  const generatedAds = [];
  for (const task of tasks) {
    const baseDate = parseDateTime(task.startAt || task.date);
    const materialIdResolved = resolveMaterialId(task.materialId || 'karier_neseyan_nemyt_pesok', aliases);
    const addressesResolved = resolveAddresses(
      task.addresses && task.addresses.length ? task.addresses : ['Московская область, Одинцово'],
      aliases
    );
    const ads = generateAds({
      material: task.material || 'sand',
      materialId: materialIdResolved,
      count: task.count || 1,
      titles: task.titles && task.titles.length ? task.titles : TOP_5_TITLES,
      addresses: addressesResolved,
      photos: task.photos || [],
      currentAds
    });
    // Расставляем время публикации: не чаще 1 объявление в 2 минуты
    if (baseDate) {
      ads.forEach((ad, idx) => {
        const dt = new Date(baseDate.getTime() + idx * 2 * 60 * 1000);
        ad.dateBegin = formatDateTime(dt);
      });
    }
    generatedAds.push(...ads);
  }

  // Собираем итоговый массив: сначала уже существующие, потом новые
  const allAds = [...currentAds, ...generatedAds];

  const xml = generateXml(allAds, date);
  const outputDir = path.resolve(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, `ads_${date || 'test'}.xml`);
  fs.writeFileSync(filePath, xml, 'utf8');

  console.log(`Сгенерировано новых: ${generatedAds.length}, всего в XML: ${allAds.length} -> ${filePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
function parseDateTime(str) {
  if (!str) return null;
  // Формат dd.MM.yyyy HH:mm
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [_, dd, MM, yyyy, hh, mm] = m;
  return new Date(`${yyyy}-${MM}-${dd}T${hh}:${mm}:00`);
}

function formatDateTime(date) {
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(date.getDate());
  const MM = pad(date.getMonth() + 1);
  const yyyy = date.getFullYear();
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${dd}.${MM}.${yyyy} ${hh}:${mm}`;
}
