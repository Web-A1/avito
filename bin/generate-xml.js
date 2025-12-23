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
import { loadPhotosMapping } from '../src/utils/photosLinksReader.js';
import { generateAdId, parseAdId, getMaterialAlias, getCityAlias } from '../src/constants/materialAliases.js';

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

function buildLocationPlan(totalCount, locations = [], aliases = {}) {
  if (!locations.length) {
    return [{ address: 'Московская область, Троицк', count: totalCount }];
  }
  // Явные counts
  const result = locations.map((loc) => ({
    address: loc.address || loc.addr,
    count: Number.isFinite(loc.count) ? loc.count : null,
    percent: Number.isFinite(loc.percent) ? loc.percent : null
  }));

  let remaining = totalCount;
  // Сначала фиксированные count
  result.forEach((loc) => {
    if (loc.count && loc.count > 0) {
      remaining -= loc.count;
    }
  });
  // Затем проценты
  const percentTotal = result.reduce((sum, loc) => sum + (loc.percent || 0), 0);
  result.forEach((loc) => {
    if (!loc.count && loc.percent) {
      const share = Math.floor((totalCount * loc.percent) / 100);
      loc.count = share;
      remaining -= share;
    }
  });
  // Оставшиеся объявления отдаем последней локации с заданием или первой
  if (remaining > 0) {
    const target = [...result].reverse().find((loc) => loc.count !== null) || result[0];
    target.count = (target.count || 0) + remaining;
  }

  // Резолвим алиасы адресов
  return result
    .filter((loc) => loc.count > 0)
    .map((loc) => ({
      address: resolveAddresses([loc.address], aliases)[0],
      count: loc.count
    }));
}

function formatDateLabel(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

async function main() {
  const { count, date, currentDir, plan } = parseArgs();

  // Загружаем маппинг adId → URL фото с Яндекс.Диска
  const photosMapping = loadPhotosMapping();

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
  let planDateBegin = null; // DateBegin из корня плана
  let publicationQueue = []; // Очередь публикаций из plan.json
  const planPath = plan || path.resolve(__dirname, '..', 'data', 'plan.json');
  let aliases = { materials: {}, addresses: {} };
  if (fs.existsSync(planPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      tasks = json.tasks || [];
      aliases = json.aliases || aliases;
      planDateBegin = json.DateBegin || null;
      publicationQueue = json.publicationQueue || [];
    } catch (e) {
      console.warn(`Не удалось прочитать план ${planPath}: ${e.message}`);
    }
  }
  if (!tasks.length) {
    tasks = [
      {
        material: 'sand',
        materialId: 'karier_neseyan_nemyt_pesok',
        count,
        addresses: ['Московская область, Троицк'],
        titles: TOP_5_TITLES,
        photos: ['https://disk.yandex.ru/i/example-photo']
      }
    ];
  }

  const generatedAds = [];

  if (!planDateBegin) {
    throw new Error('В plan.json отсутствует DateBegin. Сформируйте план через tools/plan-builder/index.html.');
  }
  if (!publicationQueue.length) {
    throw new Error('В plan.json отсутствует publicationQueue. Сформируйте план через tools/plan-builder/index.html.');
  }

  const adsByKey = new Map();

  for (const task of tasks) {
    const materialIdResolved = resolveMaterialId(task.materialId || 'karier_neseyan_nemyt_pesok', aliases);
    const locationsPlan = buildLocationPlan(
      task.count || 1,
      task.locations || task.addresses || [],
      aliases
    );

    for (const loc of locationsPlan) {
      const baseCount = Math.round(loc.count * 0.5);
      const basePriceCount = Math.max(0, Math.min(loc.count, baseCount));
      const useBasePriceFlags = Array.from({ length: loc.count }, (_, idx) => idx < basePriceCount);
      const baseShare = loc.count > 0 ? basePriceCount / loc.count : 0;
      if (loc.count > 0 && Math.abs(baseShare - 0.5) > 0.1) {
        console.log(
          `      ⚠️ Доля базовой цены отклоняется от 50% (${(baseShare * 100).toFixed(0)}% при ${loc.count} объявл.)`
        );
      }

      const ads = generateAds({
        material: task.material || 'sand',
        materialId: materialIdResolved,
        count: loc.count,
        titles: task.titles && task.titles.length ? task.titles : TOP_5_TITLES,
        addresses: [loc.address],
        photos: task.photos || [],
        currentAds,
        useBasePrice: useBasePriceFlags
      });

      const matAlias = getMaterialAlias(materialIdResolved);
      const cityAlias = getCityAlias(loc.address);
      const locationPhotos = Object.keys(photosMapping)
        .map((adId) => {
          const parsed = parseAdId(adId);
          if (parsed && parsed.materialAlias === matAlias && parsed.cityAlias === cityAlias) {
            const hasTime = parsed.dateLabel && parsed.dateLabel.includes('-') && parsed.dateLabel.length > 6;
            return { adId, parsed, url: photosMapping[adId], hasTime };
          }
          return null;
        })
        .filter(Boolean)
        .filter((p) => p.hasTime)
        .sort((a, b) => {
          if (a.parsed.dateLabel === b.parsed.dateLabel) {
            if (a.parsed.sourceBase === b.parsed.sourceBase) {
              return a.parsed.counter - b.parsed.counter;
            }
            return a.parsed.sourceBase.localeCompare(b.parsed.sourceBase);
          }
          return a.parsed.dateLabel.localeCompare(b.parsed.dateLabel);
        });
      const photoQueue = [...locationPhotos];

      const key = `${materialIdResolved}::${loc.address}`;
      adsByKey.set(key, {
        ads,
        index: 0,
        materialIdResolved,
        location: loc.address,
        task,
        locationPhotos,
        photoQueue
      });
    }
  }

  publicationQueue.forEach((item) => {
    const materialIdResolved = resolveMaterialId(item.materialId, aliases);
    const resolvedLocation = resolveAddresses([item.location], aliases)[0];
    const key = `${materialIdResolved}::${resolvedLocation}`;
    const entry = adsByKey.get(key);
    if (!entry || entry.index >= entry.ads.length) {
      console.warn(`Нет объявления для очереди: ${item.materialId} @ ${item.location}`);
      return;
    }

    const ad = entry.ads[entry.index];
    const photo = entry.photoQueue && entry.photoQueue.length > entry.index ? entry.photoQueue[entry.index] : null;
    const queueDate = parseDateTime(item.DateBegin);

    if (photo) {
      ad.adId = photo.adId;
      ad.photoLink = photo.url;
    } else {
      const baseDate = queueDate || parseDateTime(planDateBegin) || new Date();
      ad.adId = generateAdId({
        materialId: entry.materialIdResolved,
        sourceBase: getMaterialAlias(entry.materialIdResolved),
        address: entry.location,
        dateBegin: baseDate,
        counter: entry.index + 1
      });
      if (!ad.photoLink && entry.task.photos && entry.task.photos.length) {
        ad.photoLink = entry.task.photos[Math.floor(Math.random() * entry.task.photos.length)];
      }
    }

    ad.dateBegin = item.DateBegin;
    generatedAds.push(ad);
    entry.index += 1;
  });

  adsByKey.forEach((entry) => {
    if (entry.index < entry.ads.length) {
      console.warn(`Остались необработанные объявления: ${entry.materialIdResolved} @ ${entry.location}`);
    }
  });

  // Собираем итоговый массив: сначала уже существующие, потом новые
  const allAds = [...currentAds, ...generatedAds];

  const dateLabel = date || formatDateLabel(new Date());
  const xml = generateXml(allAds, dateLabel);
  const outputDir = path.resolve(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, `ads_${dateLabel}.xml`);
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
