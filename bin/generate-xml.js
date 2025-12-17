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
import { generateAdId, parseAdId, parseDateLabel, getMaterialAlias, getCityAlias } from '../src/constants/materialAliases.js';

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

function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
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
  const planPath = plan || path.resolve(__dirname, '..', 'data', 'plan.json');
  let aliases = { materials: {}, addresses: {} };
  if (fs.existsSync(planPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(planPath, 'utf8'));
      tasks = json.tasks || [];
      aliases = json.aliases || aliases;
      planDateBegin = json.DateBegin || null;
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
  
  // Определяем, используем ли новую логику (DateBegin в корне + нет slots) или старую (slots)
  const useNewLogic = planDateBegin && tasks.every(task => !task.slots || !task.slots.length);
  
  if (useNewLogic) {
    // НОВАЯ ЛОГИКА: DateBegin из корня, товары публикуются последовательно
    const baseDate = parseDateTime(planDateBegin);
    if (!baseDate) {
      throw new Error(`Не удалось распарсить DateBegin из плана: "${planDateBegin}"`);
    }
    
    let currentDt = baseDate; // Текущее время для публикации
    
    for (const task of tasks) {
      // Определяем интервалы для этого товара
      const minInterval =
        Number.isFinite(task.intervalMinMinutes) && task.intervalMinMinutes > 0
          ? task.intervalMinMinutes
          : 10;
      const maxIntervalCandidate =
        Number.isFinite(task.intervalMaxMinutes) && task.intervalMaxMinutes > 0
          ? task.intervalMaxMinutes
          : Number.isFinite(task.intervalMinutes) && task.intervalMinutes > 0
            ? task.intervalMinutes
            : 30;
      const maxInterval = Math.max(minInterval, maxIntervalCandidate);
      
      const materialIdResolved = resolveMaterialId(task.materialId || 'karier_neseyan_nemyt_pesok', aliases);
      const locationsPlan = buildLocationPlan(
        task.count || 1,
        task.locations || task.addresses || [],
        aliases
      );

      const taskAds = [];
      let adCounter = 1; // Счётчик для adId в рамках этого товара
      
      for (const loc of locationsPlan) {
        const ads = generateAds({
          material: task.material || 'sand',
          materialId: materialIdResolved,
          count: loc.count,
          titles: task.titles && task.titles.length ? task.titles : TOP_5_TITLES,
          addresses: [loc.address],
          photos: task.photos || [],
          currentAds
        });
        
        // Присваиваем adId и photoLink каждому объявлению
        // ВАЖНО: adId берется из имени файла фото (реальное время создания), dateBegin = реальное время + интервалы
        const adsWithTime = [];
        const matAlias = getMaterialAlias(materialIdResolved);
        const cityAlias = getCityAlias(loc.address);
        
        // Ищем все фото для этой локации в photosMapping
        // ВАЖНО: для новых объявлений ищем только фото с новым форматом (с временем в dateLabel)
        const locationPhotos = Object.keys(photosMapping)
          .map(adId => {
            const parsed = parseAdId(adId);
            if (parsed && parsed.materialAlias === matAlias && parsed.cityAlias === cityAlias) {
              // Для новых объявлений используем только фото с новым форматом (с временем)
              // Старые фото (без времени) имеют dateLabel в формате "DDMMYY", новые - "DDMMYY-HHmmss"
              const hasTime = parsed.dateLabel && parsed.dateLabel.includes('-') && parsed.dateLabel.length > 6;
              return { adId, parsed, url: photosMapping[adId], hasTime };
            }
            return null;
          })
          .filter(Boolean)
          .filter(p => p.hasTime) // Только фото с новым форматом (с временем)
          .sort((a, b) => a.parsed.counter - b.parsed.counter); // Сортируем по counter
        
        // Определяем базовое время для dateBegin: берем из первого фото или используем baseDate
        let dateBeginDt = baseDate;
        if (locationPhotos.length > 0 && locationPhotos[0].parsed.dateLabel) {
          const photoTime = parseDateLabel(locationPhotos[0].parsed.dateLabel);
          if (photoTime) {
            dateBeginDt = photoTime;
          }
        }
        
        ads.forEach((ad, idx) => {
          // Ищем фото с нужным counter
          const targetCounter = adCounter + idx;
          const photo = locationPhotos.find(p => p.parsed.counter === targetCounter);
          
          let adId = null;
          if (photo) {
            adId = photo.adId;
            ad.photoLink = photo.url;
          } else {
            // Если фото не найдено - генерируем adId с базовым временем
            adId = generateAdId(materialIdResolved, loc.address, baseDate, targetCounter);
            if (!ad.photoLink && task.photos && task.photos.length) {
              // Fallback: случайное фото из task.photos если adId не найден
              ad.photoLink = task.photos[Math.floor(Math.random() * task.photos.length)];
            }
          }
          
          ad.adId = adId;
          
          // Расставляем время публикации с заданным интервалом (начиная с реального времени первого фото)
          ad.dateBegin = formatDateTime(dateBeginDt);
          
          adsWithTime.push(ad);
          
          // Обновляем время для следующего объявления
          if (idx < ads.length - 1) {
            const step = randomInt(minInterval, maxInterval);
            dateBeginDt = new Date(dateBeginDt.getTime() + step * 60 * 1000);
          }
        });
        
        taskAds.push(...adsWithTime);
        // Обновляем currentDt для следующего товара (используем тот же интервал, что и между объявлениями)
        if (adsWithTime.length > 0) {
          const step = randomInt(minInterval, maxInterval);
          currentDt = new Date(tempDt.getTime() + step * 60 * 1000);
        }
      }

      generatedAds.push(...taskAds);
      
      // После завершения товара, следующий начинается после последнего объявления
      // Используем тот же интервал (10-30 минут), что и между объявлениями
      if (taskAds.length > 0) {
        const step = randomInt(minInterval, maxInterval);
        currentDt = new Date(currentDt.getTime() + step * 60 * 1000);
      }
    }
  } else {
    // СТАРАЯ ЛОГИКА: поддержка slots для обратной совместимости
    for (const task of tasks) {
      const slots = task.slots && task.slots.length ? task.slots : [{ DateBegin: task.DateBegin, count: task.count }];
      for (const slot of slots) {
        const baseDate = parseDateTime(slot.DateBegin);
        const minInterval =
          Number.isFinite(slot.intervalMinMinutes) && slot.intervalMinMinutes > 0
            ? slot.intervalMinMinutes
            : Number.isFinite(task.intervalMinMinutes) && task.intervalMinMinutes > 0
              ? task.intervalMinMinutes
              : 10;
        const maxIntervalCandidate =
          Number.isFinite(slot.intervalMaxMinutes) && slot.intervalMaxMinutes > 0
            ? slot.intervalMaxMinutes
            : Number.isFinite(slot.intervalMinutes) && slot.intervalMinutes > 0
              ? slot.intervalMinutes
              : Number.isFinite(task.intervalMaxMinutes) && task.intervalMaxMinutes > 0
                ? task.intervalMaxMinutes
                : Number.isFinite(task.intervalMinutes) && task.intervalMinutes > 0
                  ? task.intervalMinutes
                  : 30;
        const maxInterval = Math.max(minInterval, maxIntervalCandidate);
        const materialIdResolved = resolveMaterialId(task.materialId || 'karier_neseyan_nemyt_pesok', aliases);
        const locationsPlan = buildLocationPlan(
          slot.count || task.count || 1,
          slot.locations || task.locations || task.addresses || [],
          aliases
        );

        const slotAds = [];
        let adCounter = 1; // Счётчик для adId в рамках этого слота
        
        for (const loc of locationsPlan) {
          const ads = generateAds({
            material: task.material || 'sand',
            materialId: materialIdResolved,
            count: loc.count,
            titles: task.titles && task.titles.length ? task.titles : TOP_5_TITLES,
            addresses: [loc.address],
            photos: task.photos || [],
            currentAds
          });
          
          // Присваиваем adId и photoLink каждому объявлению
          // ВАЖНО: adId берется из имени файла фото (реальное время создания), dateBegin = реальное время + интервалы
          const adsWithTime = [];
          const matAlias = getMaterialAlias(materialIdResolved);
          const cityAlias = getCityAlias(loc.address);
          
          // Ищем все фото для этой локации в photosMapping
          // ВАЖНО: для новых объявлений ищем только фото с новым форматом (с временем в dateLabel)
          const locationPhotos = Object.keys(photosMapping)
            .map(adId => {
              const parsed = parseAdId(adId);
              if (parsed && parsed.materialAlias === matAlias && parsed.cityAlias === cityAlias) {
                // Для новых объявлений используем только фото с новым форматом (с временем)
                // Старые фото (без времени) имеют dateLabel в формате "DDMMYY", новые - "DDMMYY-HHmmss"
                const hasTime = parsed.dateLabel && parsed.dateLabel.includes('-') && parsed.dateLabel.length > 6;
                return { adId, parsed, url: photosMapping[adId], hasTime };
              }
              return null;
            })
            .filter(Boolean)
            .filter(p => p.hasTime) // Только фото с новым форматом (с временем)
            .sort((a, b) => a.parsed.counter - b.parsed.counter); // Сортируем по counter
          
          // Определяем базовое время для dateBegin: берем из первого фото или используем baseDate
          let dateBeginDt = baseDate;
          if (locationPhotos.length > 0 && locationPhotos[0].parsed.dateLabel) {
            const photoTime = parseDateLabel(locationPhotos[0].parsed.dateLabel);
            if (photoTime) {
              dateBeginDt = photoTime;
            }
          }
          
          ads.forEach((ad, idx) => {
            // Ищем фото с нужным counter
            const targetCounter = adCounter + idx;
            const photo = locationPhotos.find(p => p.parsed.counter === targetCounter);
            
            let adId = null;
            if (photo) {
              adId = photo.adId;
              ad.photoLink = photo.url;
            } else {
              // Если фото не найдено - генерируем adId с базовым временем
              adId = generateAdId(materialIdResolved, loc.address, baseDate, targetCounter);
              if (!ad.photoLink && task.photos && task.photos.length) {
                // Fallback: случайное фото из task.photos если adId не найден
                ad.photoLink = task.photos[Math.floor(Math.random() * task.photos.length)];
              }
            }
            
            ad.adId = adId;
            
            // Расставляем время публикации с заданным интервалом (начиная с реального времени первого фото)
            ad.dateBegin = formatDateTime(dateBeginDt);
            
            adsWithTime.push(ad);
            
            // Обновляем время для следующего объявления
            if (idx < ads.length - 1) {
              const step = randomInt(minInterval, maxInterval);
              dateBeginDt = new Date(dateBeginDt.getTime() + step * 60 * 1000);
            }
          });
          
          slotAds.push(...adsWithTime);
        }

        generatedAds.push(...slotAds);
      }
    }
  }

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
