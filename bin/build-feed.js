#!/usr/bin/env node
/**
 * Объединяющий скрипт для полного цикла генерации фида Авито.
 * 
 * Выполняет:
 * 1. Чтение плана
 * 2. Генерацию фото для новых объявлений
 * 3. Обновление фото для старых объявлений (если нужно)
 * 4. Загрузку всех фото на Яндекс.Диск
 * 5. Локальное удаление фото
 * 6. Чтение Excel с текущими объявлениями
 * 7. Генерацию уникальных описаний для новых объявлений
 * 8. Корректировку старых объявлений (если нужно)
 * 9. Формирование финального XML файла
 * 
 * Пример:
 *   node bin/build-feed.js --plan data/plan.json --date 11.12 --current-dir data/current
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { generateAds } from '../src/generators/adGenerator.js';
import { generateXml } from '../src/xml/xmlGenerator.js';
import { generateDescription } from '../src/generators/materials/sand/descriptionGenerator.js';
import { generateRubbleDescription } from '../src/generators/materials/rubble/descriptionGenerator.js';
import { TOP_5_TITLES, EXACT_TITLES } from '../src/constants/titles.js';
import { readCurrentAdsFromXlsx } from '../src/utils/currentAdsReader.js';
import { loadPhotosMapping } from '../src/utils/photosLinksReader.js';
import { generateAdId, getCityAlias, getMaterialAlias, CITY_ALIASES, MATERIAL_ALIASES, parseAdId, parseDateLabel } from '../src/constants/materialAliases.js';
import { getSandType } from '../src/constants/sandTypes.js';
import { getRubbleType } from '../src/constants/rubbleTypes.js';
import { syncHistoryWithActiveAds, loadHistory, saveHistory, updateHistoryWithAvitoId, commitHistoryFromTmp, discardHistoryTmp } from './lib/photo-variants/history.js';
import { collectSourcesFromPlan } from './lib/photo-variants/plan.js';
import { spawn } from 'child_process';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Подхватываем .env
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const DEFAULT_PLAN_PATH = path.resolve(__dirname, '..', 'data', 'plan.json');
const DEFAULT_CURRENT_DIR = path.resolve(__dirname, '..', 'data', 'current');
const DEFAULT_UPDATE_RULES_PATH = path.resolve(__dirname, '..', 'update_old_ads.json');
const DEFAULT_PHOTOS_ROOT = path.resolve(__dirname, '..', 'data', 'photos');
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'output');
const DEFAULT_DISK_ROOT = 'Cursor_for_Avito';
const MATERIAL_ALIAS_TO_ID = Object.fromEntries(
  Object.entries(MATERIAL_ALIASES).map(([materialId, alias]) => [alias, materialId])
);

/**
 * Форматирует дату в московское время (UTC+3)
 * @param {Date} [date=new Date()] - Дата для форматирования
 * @returns {string} Дата в формате "DD.MM.YYYY HH:mm"
 */
function formatMoscowTime(date = new Date()) {
  // Москва = UTC+3
  const moscowOffset = 3 * 60 * 60 * 1000; // 3 часа в миллисекундах
  const moscowTime = new Date(date.getTime() + moscowOffset);
  
  const dd = String(moscowTime.getUTCDate()).padStart(2, '0');
  const mm = String(moscowTime.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = moscowTime.getUTCFullYear();
  const hh = String(moscowTime.getUTCHours()).padStart(2, '0');
  const min = String(moscowTime.getUTCMinutes()).padStart(2, '0');
  
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

function resolveMaterialIdFromAdId(adId) {
  const parsed = parseAdId(adId);
  if (!parsed) return null;
  return MATERIAL_ALIAS_TO_ID[parsed.materialAlias] || null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    plan: '',
    date: '',
    currentDir: '',
    updateRules: '',
    diskRoot: DEFAULT_DISK_ROOT,
    outDir: DEFAULT_OUTPUT_DIR,
    // Тестовые флаги
    testStep: null, // null или массив [start, end] или число
    skipPhotos: false,
    skipUpload: false,
    skipNewPhotos: false,
    skipOldPhotos: false,
    skipUpdates: false,
    skipGeneration: false,
    dryRun: false,
    testOutputDir: null
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--plan' && args[i + 1]) {
      opts.plan = args[++i];
    } else if (arg === '--date' && args[i + 1]) {
      opts.date = args[++i];
    } else if (arg === '--current-dir' && args[i + 1]) {
      opts.currentDir = args[++i];
    } else if (arg === '--update-rules' && args[i + 1]) {
      opts.updateRules = args[++i];
    } else if (arg === '--root' && args[i + 1]) {
      opts.diskRoot = args[++i];
    } else if (arg === '--out' && args[i + 1]) {
      opts.outDir = args[++i];
    } else if (arg === '--test-step' && args[i + 1]) {
      const stepArg = args[++i];
      if (stepArg.includes('-')) {
        const [start, end] = stepArg.split('-').map(Number);
        opts.testStep = [start, end];
      } else {
        opts.testStep = [Number(stepArg), Number(stepArg)];
      }
    } else if (arg === '--skip-photos') {
      opts.skipPhotos = true;
    } else if (arg === '--skip-upload') {
      opts.skipUpload = true;
    } else if (arg === '--skip-new-photos') {
      opts.skipNewPhotos = true;
    } else if (arg === '--skip-old-photos') {
      opts.skipOldPhotos = true;
    } else if (arg === '--skip-updates') {
      opts.skipUpdates = true;
    } else if (arg === '--skip-generation') {
      opts.skipGeneration = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--test-output-dir' && args[i + 1]) {
      opts.testOutputDir = args[++i];
    }
  }
  
  // Если указан test-output-dir, используем его для output
  if (opts.testOutputDir) {
    opts.outDir = opts.testOutputDir;
  }
  
  return opts;
}

function shouldExecuteStep(stepNum, testStep) {
  if (!testStep) return true;
  const [start, end] = testStep;
  return stepNum >= start && stepNum <= end;
}

function formatDateLabel(str) {
  if (str) return str;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(now.getDate());
  const MM = pad(now.getMonth() + 1);
  const yyyy = now.getFullYear();
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${dd}.${MM}.${yyyy} ${hh}-${mm}-${ss}`;
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

function readPlan(planPath) {
  const resolved = planPath || (fs.existsSync(DEFAULT_PLAN_PATH) ? DEFAULT_PLAN_PATH : '');
  if (!resolved) return null;
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Не удалось прочитать план ${resolved}: ${e.message}`);
  }
}

function readUpdateRules(rulesPath) {
  const resolved = rulesPath || (fs.existsSync(DEFAULT_UPDATE_RULES_PATH) ? DEFAULT_UPDATE_RULES_PATH : '');
  if (!resolved || !fs.existsSync(resolved)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    console.log(`   [DEBUG] Сырой файл (первые 200 символов): ${raw.substring(0, 200)}`);
    const parsed = JSON.parse(raw);
    console.log(`   [DEBUG] Распарсенный объект:`, JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (e) {
    throw new Error(`Не удалось прочитать правила обновления ${resolved}: ${e.message}`);
  }
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

async function buildUpdateRulesMap(updateRules, currentAds = []) {
  if (!updateRules) {
    console.log(`      [DEBUG] updateRules is null/undefined`);
    return new Map();
  }

  const rulesMap = new Map();

  // Сначала применяем правила из byLists
  if (updateRules.byLists) {
    console.log(`      [DEBUG] updateRules.byLists =`, JSON.stringify(updateRules.byLists, null, 2));
    console.log(`      [DEBUG] updateRules.byLists.updateAll (прямой доступ) = ${updateRules.byLists.updateAll}`);
    console.log(`      [DEBUG] typeof updateRules.byLists.updateAll = ${typeof updateRules.byLists.updateAll}`);
    
    const {
      updatePhoto = [],
      updateDescription = [],
      customTitles = {},
      customDescriptions = {},
      newAddresses = {},
      updateAll = false,
      updateDescriptionForAll = false
    } = updateRules.byLists;

    console.log(`      [DEBUG] byLists.updateAll (после деструктуризации) = ${updateAll}`);
    console.log(`      [DEBUG] typeof updateAll = ${typeof updateAll}`);
    console.log(`      [DEBUG] currentAds.length = ${currentAds.length}`);
    
    // Если updateAll = true, автоматически добавляем все объявления из Excel
    if (updateAll && currentAds.length > 0) {
      const { parseAdId, MATERIAL_ALIASES, CITY_ALIASES } = await import('../src/constants/materialAliases.js');
      
      // Создаем обратные мапы для поиска materialId и address по алиасам
      const materialAliasToId = {};
      Object.entries(MATERIAL_ALIASES).forEach(([id, alias]) => {
        materialAliasToId[alias] = id;
      });
      
      const cityAliasToAddress = {};
      Object.entries(CITY_ALIASES).forEach(([address, alias]) => {
        cityAliasToAddress[alias] = address;
      });
      
      let processedCount = 0;
      let skippedNoIdCount = 0;
      
      // Для каждого объявления из Excel создаем правила
      for (const ad of currentAds) {
        const avitoId = ad.Id || ad.AvitoId;
        if (!avitoId) {
          skippedNoIdCount++;
          continue;
        }
        
        // Парсим Id для определения materialId и address
        const parsed = parseAdId(avitoId);
        let materialId = null;
        let address = null;
        
        if (parsed) {
          materialId = materialAliasToId[parsed.materialAlias] || null;
          address = cityAliasToAddress[parsed.cityAlias] || null;
        }
        
        // Если не удалось определить из Id, используем значения из объявления или дефолтные
        if (!materialId) {
          materialId = ad.bulkMaterialSubType || 'karier_neseyan_nemyt_pesok';
        }
        if (!address) {
          // Берём адрес из Excel как есть (в полном формате, как в выгрузке Авито)
          const rawAddress = (ad.address || '').trim();
          if (rawAddress) {
            address = rawAddress;
          }
        }
        
        // Создаем правила для этого объявления
        if (!rulesMap.has(avitoId)) {
          rulesMap.set(avitoId, {});
        }
        const rule = rulesMap.get(avitoId);
        // По умолчанию updateAll обновляет только фото.
        // Описание трогаем только если явно указан флаг updateDescriptionForAll = true.
        rule.updatePhoto = true;
        if (updateDescriptionForAll) {
          rule.updateDescription = 'auto';
        }
        if (materialId) rule.materialId = materialId;
        if (address) {
          // Адрес в полном формате, как в plan.json и выгрузке Авито
          rule.address = address;
        }
        
        processedCount++;
      }
      
      console.log(`      [DEBUG] Обработано объявлений: ${processedCount}`);
      if (skippedNoIdCount > 0) {
        console.log(`      [DEBUG] Пропущено (нет Id): ${skippedNoIdCount}`);
      }
      console.log(`      [DEBUG] Создано правил: ${rulesMap.size}`);
    } else {
      if (!updateAll) {
        console.log(`      [DEBUG] updateAll = false, пропускаем автоматическое создание правил`);
      }
      if (currentAds.length === 0) {
        console.log(`      [DEBUG] currentAds пуст, пропускаем автоматическое создание правил`);
      }
    }
    
    updatePhoto.forEach(avitoId => {
      if (!rulesMap.has(avitoId)) {
        rulesMap.set(avitoId, {});
      }
      rulesMap.get(avitoId).updatePhoto = true;
    });
    
    updateDescription.forEach(avitoId => {
      if (!rulesMap.has(avitoId)) {
        rulesMap.set(avitoId, {});
      }
      rulesMap.get(avitoId).updateDescription = 'auto';
    });
    
    Object.entries(customTitles).forEach(([avitoId, title]) => {
      if (!rulesMap.has(avitoId)) {
        rulesMap.set(avitoId, {});
      }
      rulesMap.get(avitoId).customTitle = title;
    });
    
    Object.entries(customDescriptions).forEach(([avitoId, desc]) => {
      if (!rulesMap.has(avitoId)) {
        rulesMap.set(avitoId, {});
      }
      rulesMap.get(avitoId).updateDescription = desc;
    });

    Object.entries(newAddresses).forEach(([avitoId, addr]) => {
      if (!rulesMap.has(avitoId)) {
        rulesMap.set(avitoId, {});
      }
      rulesMap.get(avitoId).newAddress = addr;
    });
  }

  // Автоматическая нормализация адресов для старых объявлений.
  // Идея: если адрес из Excel (после обрезки префиксов в buildUpdateRulesMap)
  // в точности совпадает с одним из утверждённых адресов Avito (CITY_ALIASES),
  // то считаем его "каноническим" и записываем как newAddress.
  //
  // Это позволяет:
  //  - привести старые объявления к тем же адресам, что и в plan.json/CITY_ALIASES;
  //  - чтобы в финальном XML у старых объявлений адрес совпадал с утверждённым адресом профиля;
  //  - уменьшить количество ошибок вида "Не получилось определить адрес по идентификатору / GEO-параметрам".
  for (const [avitoId, rule] of rulesMap.entries()) {
    if (!rule) continue;
    // Пользовательский newAddress (из byId/byLists.newAddresses) имеет приоритет и не трогаем его.
    if (rule.newAddress) continue;
    if (!rule.address) continue;

    if (CITY_ALIASES[rule.address]) {
      rule.newAddress = rule.address;
    }
  }

  // Затем применяем правила из byId (имеют приоритет)
  if (updateRules.byId) {
    Object.entries(updateRules.byId).forEach(([avitoId, rules]) => {
      if (!rulesMap.has(avitoId)) {
        rulesMap.set(avitoId, {});
      }
      // Перезаписываем правила из byLists
      Object.assign(rulesMap.get(avitoId), rules);
    });
  }
  
  return rulesMap;
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
  const result = locations.map((loc) => ({
    address: loc.address || loc.addr,
    count: Number.isFinite(loc.count) ? loc.count : null,
    percent: Number.isFinite(loc.percent) ? loc.percent : null
  }));

  let remaining = totalCount;
  result.forEach((loc) => {
    if (loc.count && loc.count > 0) {
      remaining -= loc.count;
    }
  });
  const percentTotal = result.reduce((sum, loc) => sum + (loc.percent || 0), 0);
  result.forEach((loc) => {
    if (!loc.count && loc.percent) {
      const share = Math.floor((totalCount * loc.percent) / 100);
      loc.count = share;
      remaining -= share;
    }
  });
  if (remaining > 0) {
    const target = [...result].reverse().find((loc) => loc.count !== null) || result[0];
    target.count = (target.count || 0) + remaining;
  }

  return result
    .filter((loc) => loc.count > 0)
    .map((loc) => ({
      address: resolveAddresses([loc.address], aliases)[0],
      count: loc.count
    }));
}

function parseDateTime(str) {
  if (!str) return null;
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [_, dd, MM, yyyy, hh, mm] = m;
  return new Date(`${yyyy}-${MM}-${dd}T${hh}:${mm}:00`);
}

function isWithinAllowedWindow(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const morningStart = 7 * 60;
  const morningEnd = 10 * 60;
  const eveningStart = 19 * 60;
  const eveningEnd = 23 * 60 + 59;
  return (minutes >= morningStart && minutes <= morningEnd) || (minutes >= eveningStart && minutes <= eveningEnd);
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

function formatDateLabelForFile(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

function validatePlanCounts(plan, aliases = {}) {
  if (!plan || !Array.isArray(plan.tasks) || !Array.isArray(plan.publicationQueue)) return;
  const materialResolver = (id) => resolveMaterialId(id, aliases);
  const addressResolver = (addr) => resolveAddresses([addr], aliases)[0];

  const taskCounts = new Map();
  plan.tasks.forEach((task) => {
    const materialId = materialResolver(task.materialId || task.material);
    const locations = task.locations || [];
    locations.forEach((loc) => {
      const count = Number(loc.count || task.count || 0);
      if (!count) return;
      const address = addressResolver(loc.address);
      const key = `${materialId}::${address}`;
      taskCounts.set(key, (taskCounts.get(key) || 0) + count);
    });
  });

  const queueCounts = new Map();
  plan.publicationQueue.forEach((item) => {
    const materialId = materialResolver(item.materialId || item.material);
    const address = addressResolver(item.location);
    const key = `${materialId}::${address}`;
    queueCounts.set(key, (queueCounts.get(key) || 0) + 1);
  });

  const diff = [];
  const keys = new Set([...taskCounts.keys(), ...queueCounts.keys()]);
  keys.forEach((key) => {
    const taskCnt = taskCounts.get(key) || 0;
    const queueCnt = queueCounts.get(key) || 0;
    if (taskCnt !== queueCnt) {
      diff.push({ key, taskCnt, queueCnt });
    }
  });

  if (diff.length > 0) {
    const lines = diff
      .slice(0, 10)
      .map((d) => `  ${d.key}: tasks=${d.taskCnt}, queue=${d.queueCnt}`)
      .join('\n');
    const tail = diff.length > 10 ? '\n  ...' : '';
    throw new Error(
      `План не совпадает с publicationQueue по количеству объявлений. Исправьте план и повторите.\n${lines}${tail}`
    );
  }
}

function validatePlanWindows(queue = []) {
  const bad = [];
  queue.forEach((item, idx) => {
    const dt = parseDateTime(item.DateBegin);
    if (!dt || !isWithinAllowedWindow(dt)) {
      bad.push({
        index: idx + 1,
        materialId: item.materialId || item.material || 'unknown',
        location: item.location,
        dateBegin: item.DateBegin || 'нет'
      });
    }
  });
  if (bad.length > 0) {
    const lines = bad
      .slice(0, 10)
      .map((b) => `  #${b.index}: ${b.materialId} @ ${b.location} -> ${b.dateBegin}`)
      .join('\n');
    const tail = bad.length > 10 ? '\n  ...' : '';
    throw new Error(
      `DateBegin вне допустимых окон (07:00–10:00 или 19:00–23:59) или не распарсены. Исправьте publicationQueue.\n${lines}${tail}`
    );
  }
}

function validatePlanStepIntervals(queue = [], minMinutes = 5, maxMinutes = 30) {
  if (!Array.isArray(queue) || queue.length < 2) return;
  const bad = [];
  const getWindowName = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const minutes = date.getHours() * 60 + date.getMinutes();
    const morningStart = 7 * 60;
    const morningEnd = 10 * 60;
    const eveningStart = 19 * 60;
    const eveningEnd = 23 * 60 + 59;
    if (minutes >= morningStart && minutes <= morningEnd) return 'morning';
    if (minutes >= eveningStart && minutes <= eveningEnd) return 'evening';
    return null;
  };

  for (let i = 1; i < queue.length; i++) {
    const prev = parseDateTime(queue[i - 1].DateBegin);
    const curr = parseDateTime(queue[i].DateBegin);
    if (!prev || !curr) {
      bad.push({ index: i + 1, prev: queue[i - 1].DateBegin, curr: queue[i].DateBegin, diff: 'n/a' });
      continue;
    }
    const diffMin = (curr.getTime() - prev.getTime()) / (60 * 1000);
    const prevWindow = getWindowName(prev);
    const currWindow = getWindowName(curr);
    const windowsDiffer = prevWindow && currWindow && prevWindow !== currWindow;

    if (windowsDiffer) {
      // Переход между окнами допускает большой разрыв, но не допускает слишком маленький шаг
      if (diffMin < minMinutes) {
        bad.push({ index: i + 1, prev: queue[i - 1].DateBegin, curr: queue[i].DateBegin, diff: diffMin.toFixed(1) });
      }
      continue;
    }

    if (diffMin < minMinutes || diffMin > maxMinutes) {
      bad.push({ index: i + 1, prev: queue[i - 1].DateBegin, curr: queue[i].DateBegin, diff: diffMin.toFixed(1) });
    }
  }
  if (bad.length > 0) {
    const lines = bad
      .slice(0, 10)
      .map((b) => `  #${b.index}: ${b.prev} -> ${b.curr} (Δ=${b.diff} мин)`)
      .join('\n');
    const tail = bad.length > 10 ? '\n  ...' : '';
    throw new Error(
      `Шаг между публикациями вне допустимых границ (${minMinutes}–${maxMinutes} минут). Исправьте publicationQueue.\n${lines}${tail}`
    );
  }
}

export { validatePlanCounts, validatePlanWindows, validatePlanStepIntervals, parseDateTime, isWithinAllowedWindow };

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
    if (!String(e.message).includes('409')) throw e;
  }
}

/**
 * Выполняет функцию с повторными попытками при временных ошибках
 * Использует линейный backoff (1s, 2s, 3s) для предотвращения перегрузки API
 * @param {Function} fn - асинхронная функция для выполнения
 * @param {number} maxRetries - максимальное количество попыток (по умолчанию 3)
 * @param {string} operationName - название операции для логирования
 * @returns {Promise} результат выполнения функции
 */
async function retryWithBackoff(fn, maxRetries = 3, operationName = 'операция') {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorMsg = error.message || String(error);
      
      // Определяем, является ли ошибка временной (можно повторить)
      const isRetryable = 
        errorMsg.includes('HTTP 500') || 
        errorMsg.includes('HTTP 502') || 
        errorMsg.includes('HTTP 503') || 
        errorMsg.includes('HTTP 429') ||
        errorMsg.includes('ECONNRESET') ||
        errorMsg.includes('ETIMEDOUT') ||
        errorMsg.includes('ENOTFOUND') ||
        errorMsg.includes('timeout');
      
      // Если ошибка не временная или это последняя попытка - выбрасываем ошибку
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      // Линейный backoff: 1s, 2s, 3s (не exponential, чтобы не ждать долго)
      const delay = attempt * 1000;
      console.log(`   ⚠️  ${operationName}: попытка ${attempt}/${maxRetries} не удалась (${errorMsg.substring(0, 80)}), повтор через ${delay}мс...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function uploadAndPublishPhoto(token, localPath, diskPath) {
  try {
    // Шаг 1: Получаем URL для загрузки (с retry при ошибке)
    console.log(`   [DEBUG] Шаг 1: Получение URL для загрузки...`);
    const uploadUrl = `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(diskPath)}&overwrite=true`;
    const uploadUrlRes = await retryWithBackoff(
      () => httpRequest(uploadUrl, { method: 'GET', headers: { Authorization: `OAuth ${token}` } }),
      3,
      'Получение URL для загрузки'
    );
    const { href } = JSON.parse(uploadUrlRes.data);
    console.log(`   [DEBUG] Шаг 1: URL получен, href: ${href.substring(0, 100)}...`);
    
    // Шаг 2: Загружаем файл (с retry при ошибке)
    console.log(`   [DEBUG] Шаг 2: Загрузка файла (${fs.statSync(localPath).size} байт)...`);
    const fileBody = fs.readFileSync(localPath);
    await retryWithBackoff(
      () => httpRequest(href, { method: 'PUT', headers: { 'Content-Length': fileBody.length } }, fileBody),
      3,
      'Загрузка файла'
    );
    console.log(`   [DEBUG] Шаг 2: Файл загружен успешно`);
    
    // Шаг 3: Публикуем файл (с retry при ошибке, больше попыток для критичного шага)
    console.log(`   [DEBUG] Шаг 3: Публикация файла...`);
    const publishUrl = `https://cloud-api.yandex.net/v1/disk/resources/publish?path=${encodeURIComponent(diskPath)}`;
    await retryWithBackoff(
      () => httpRequest(publishUrl, { method: 'PUT', headers: { Authorization: `OAuth ${token}` } }),
      5, // Больше попыток для публикации (самый проблемный шаг)
      'Публикация файла'
    );
    console.log(`   [DEBUG] Шаг 3: Файл опубликован успешно`);
    
    // Шаг 4: Получаем публичный URL (с retry при ошибке)
    console.log(`   [DEBUG] Шаг 4: Получение публичного URL...`);
    const infoUrl = `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(diskPath)}`;
    const info = await retryWithBackoff(
      () => httpRequest(infoUrl, { method: 'GET', headers: { Authorization: `OAuth ${token}` } }),
      3,
      'Получение публичного URL'
    );
    const json = JSON.parse(info.data);
    console.log(`   [DEBUG] Шаг 4: Публичный URL получен`);
    return json.public_url || '';
  } catch (err) {
    // Добавляем контекст к ошибке
    const errorMsg = err.message || String(err);
    const fileSize = fs.existsSync(localPath) ? fs.statSync(localPath).size : 'файл не найден';
    const encodedPath = encodeURIComponent(diskPath);
    throw new Error(`${errorMsg} (путь: ${diskPath}, закодированный путь: ${encodedPath.substring(0, 200)}..., размер файла: ${fileSize} байт)`);
  }
}

function runScript(scriptPath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    // Настраиваем окружение для немедленного вывода (отключаем буферизацию)
    const env = {
      ...process.env,
      ...options.env,
      NODE_NO_WARNINGS: '1',
      // Отключаем буферизацию вывода для немедленного отображения логов
      PYTHONUNBUFFERED: '1' // Для совместимости, хотя это Node.js
    };
    
    const child = spawn('node', [scriptPath, ...args], {
      stdio: options.silent ? 'pipe' : 'inherit',
      cwd: path.resolve(__dirname, '..'),
      env
    });
    
    let stdout = '';
    let stderr = '';
    
    if (options.silent) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Скрипт ${scriptPath} завершился с кодом ${code}${stderr ? ': ' + stderr : ''}`));
      }
    });
    
    child.on('error', (err) => {
      reject(new Error(`Ошибка запуска скрипта ${scriptPath}: ${err.message}`));
    });
  });
}

export async function generatePhotoForOldAd(avitoId, materialId, address, photosRoot, textWatermark, textOpacity, patternOpacity) {
  // Определяем, является ли это флагманским объявлением (counter = 1)
  const { parseAdId } = await import('../src/constants/materialAliases.js');
  const parsed = parseAdId(avitoId);
  const isFlagship = parsed && parsed.counter === 1;
  
  // Находим исходник
  const originalsDir = path.join(photosRoot, materialId, 'originals');
  if (!fs.existsSync(originalsDir)) {
    throw new Error(`Не найдена папка с исходниками: ${originalsDir}`);
  }
  
  const originals = fs.readdirSync(originalsDir)
    .filter(name => name.match(/\.(jpg|jpeg|png|webp)$/i))
    .map(name => path.join(originalsDir, name));
  
  if (originals.length === 0) {
    throw new Error(`В ${originalsDir} нет исходных файлов`);
  }
  
  // Папка variants как для новых объявлений: data/photos/<materialId>/<safeAddress>/variants/
  const { formatAddressLabel, sanitizeName } = await import('./lib/photo-variants/utils.js');
  const safeAddress = sanitizeName(formatAddressLabel(address));
  const variantsDir = path.join(photosRoot, materialId, safeAddress, 'variants');
  if (!fs.existsSync(variantsDir)) {
    fs.mkdirSync(variantsDir, { recursive: true });
  }
  
  const outputPath = path.join(variantsDir, `${avitoId}.jpg`);
  
  // Используем функции из lib/photo-variants для генерации фото с водяным знаком
  try {
    const sharp = await import('sharp');
    const { loadImageBuffer, clampOpacity } = await import('./lib/photo-variants/utils.js');
    const { 
      calculateAdaptiveOpacity, 
      buildTextPatternSvg, 
      pickTextPalette,
      createNoiseBuffer,
      buildDotsSvg,
      buildGradientSvg,
      buildLightSpotsSvg
    } = await import('./lib/photo-variants/patterns.js');
    const { applyTransformations } = await import('./lib/photo-variants/transformations.js');
    
    // Для флагманского фото: проверяем наличие готового flagship.jpg или fs.jpeg
    let sourceBuffer = null;
    let sourceMeta = null;
    let sourceStats = null;
    let sourcePalette = null;
    
    if (isFlagship) {
      // Для флагманского фото ищем файлы с "flagship" или "fs" в имени (любое расширение)
      // Сначала ищем в папке originals
      const allOriginals = fs.readdirSync(originalsDir)
        .filter(name => name.match(/\.(jpg|jpeg|png|webp)$/i))
        .map(name => path.join(originalsDir, name));
      
      const flagshipInOriginals = allOriginals.find(p => {
        const basename = path.basename(p).toLowerCase();
        return basename.includes('flagship') || basename.includes('fs');
      });
      
      // Также проверяем в корне материала (для обратной совместимости)
      const baseDir = path.join(photosRoot, materialId);
      let flagshipInRoot = null;
      if (fs.existsSync(baseDir)) {
        const rootFiles = fs.readdirSync(baseDir)
          .filter(name => name.match(/\.(jpg|jpeg|png|webp)$/i))
          .map(name => path.join(baseDir, name));
        flagshipInRoot = rootFiles.find(p => {
          const basename = path.basename(p).toLowerCase();
          return basename.includes('flagship') || basename.includes('fs');
        });
      }
      
      // Приоритет: originals/flagship* > originals/fs* > корень/flagship* > корень/fs*
      const flagshipPath = flagshipInOriginals || flagshipInRoot;
      
      if (flagshipPath) {
        const isFlagshipName = path.basename(flagshipPath).toLowerCase().includes('flagship');
        const location = flagshipInOriginals ? 'originals' : 'корня материала';
        console.log(`   ${isFlagshipName ? 'Используется готовый' : 'Создаём флагманское фото из'} ${path.basename(flagshipPath)} из ${location} (флагманское объявление)`);
        sourceBuffer = await loadImageBuffer(flagshipPath);
        const sourceImage = sharp.default(sourceBuffer);
        sourceMeta = await sourceImage.metadata();
        sourceStats = await sharp.default(sourceBuffer).stats();
        sourcePalette = pickTextPalette(sourceStats, null);
      }
    }
    
    // Если не нашли готовый флагманский исходник - используем обычный
    if (!sourceBuffer) {
      // Для флагманского фото ищем файлы с "flagship" или "fs" в имени (любое расширение)
      if (isFlagship) {
        const flagshipInOriginals = originals.find(p => {
          const basename = path.basename(p).toLowerCase();
          return basename.includes('flagship') || basename.includes('fs');
        });
        
        if (flagshipInOriginals) {
          const sourcePath = flagshipInOriginals;
          sourceBuffer = await loadImageBuffer(sourcePath);
          const baseImage = sharp.default(sourceBuffer);
          sourceMeta = await baseImage.metadata();
          sourceStats = await sharp.default(sourceBuffer).stats();
          sourcePalette = pickTextPalette(sourceStats, null);
          console.log(`   Создаём флагманское фото из ${path.basename(sourcePath)} (без искажений)`);
        } else {
          // Если не нашли файлы с "flagship" или "fs" - берем первый исходник
          const sourcePath = originals[0];
          sourceBuffer = await loadImageBuffer(sourcePath);
          const baseImage = sharp.default(sourceBuffer);
          sourceMeta = await baseImage.metadata();
          sourceStats = await sharp.default(sourceBuffer).stats();
          sourcePalette = pickTextPalette(sourceStats, null);
          console.log(`   ⚠️  Флагманское фото из ${path.basename(sourcePath)} (файлы с "flagship" или "fs" не найдены)`);
        }
      } else {
        // Для не-флагманских фото берем первый исходник
        const sourcePath = originals[0];
        sourceBuffer = await loadImageBuffer(sourcePath);
        const baseImage = sharp.default(sourceBuffer);
        sourceMeta = await baseImage.metadata();
        sourceStats = await sharp.default(sourceBuffer).stats();
        sourcePalette = pickTextPalette(sourceStats, null);
        console.log(`   Создаём фото с трансформациями из ${path.basename(sourcePath)}`);
      }
    }
    
    // Для флагманского фото - без трансформаций, только водяной знак
    // Для остальных - применяем трансформации
    let finalBuffer;
    
    if (isFlagship) {
      // Флагманское: без трансформаций, только водяной знак
      finalBuffer = sourceBuffer;
    } else {
      // Не флагманское: применяем трансформации
      const smallImage = Math.min(sourceMeta.width, sourceMeta.height) < 1400;
      const transformResult = await applyTransformations(sourceBuffer, {
        width: sourceMeta.width,
        height: sourceMeta.height,
        stats: sourceStats,
        smallImage: smallImage,
        zoomBoost: 1,
        angleBoost: 1,
        attemptBoost: 1
      });
      finalBuffer = await transformResult.pipeline.jpeg({ quality: 95 }).toBuffer();
    }
    
    // Пересчитываем stats для финального буфера
    const finalStats = await sharp.default(finalBuffer).stats();
    const finalPalette = pickTextPalette(finalStats, null);
    const finalMeta = await sharp.default(finalBuffer).metadata();
    
    // Вычисляем адаптивный opacity для водяного знака
    const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(finalStats);
    // Используем адаптивный диапазон (как в основном скрипте)
    const baseValue = minOpacity + Math.random() * (maxOpacity - minOpacity);
    const textOpacityValue = clampOpacity(
      (typeof textOpacity === 'number' && !Number.isNaN(textOpacity) && textOpacity > 0)
        ? textOpacity
        : baseValue,
      minOpacity,
      maxOpacity
    ) || minOpacity;
    
    // Формируем список слоев для композиции
    const compositeLayers = [];
    
    // Для не-флагманских фото добавляем паттерны для уникализации
    if (!isFlagship) {
      const patternOpacityValue = patternOpacity || 0.03;
      const noiseBuf = createNoiseBuffer(finalMeta.width, finalMeta.height, Math.min(25, Math.max(6, Math.round(patternOpacityValue * 60))));
      const dotsPng = await sharp.default(buildDotsSvg(finalMeta.width, finalMeta.height)).png().toBuffer();
      const gradPng = await sharp.default(buildGradientSvg(finalMeta.width, finalMeta.height)).png().toBuffer();
      const lightPng = await sharp.default(buildLightSpotsSvg(finalMeta.width, finalMeta.height)).png().toBuffer();
      const noisePng = await sharp.default(noiseBuf, {
        raw: { width: finalMeta.width, height: finalMeta.height, channels: 4 }
      }).png().toBuffer();
      
      compositeLayers.push(
        { input: noisePng, blend: 'soft-light', opacity: patternOpacityValue },
        { input: gradPng, blend: 'soft-light', opacity: Math.min(1, patternOpacityValue * 0.6) },
        { input: lightPng, blend: 'soft-light', opacity: Math.min(0.35, patternOpacityValue * 3) },
        { input: dotsPng, blend: 'over', opacity: Math.min(1, patternOpacityValue * 0.6) }
      );
    }
    
    // Добавляем водяной знак, если указан
    if (textWatermark) {
      // Создаем SVG водяного знака и конвертируем в PNG (как в основном скрипте)
      const textSvg = buildTextPatternSvg(
        finalMeta.width,
        finalMeta.height,
        textWatermark,
        textOpacityValue,
        finalPalette.fill,
        finalPalette.stroke || finalPalette.fill,
        finalPalette.mode
      );
      const textPng = await sharp.default(textSvg).png().toBuffer();
      compositeLayers.push({
        input: textPng,
        blend: 'over',
        top: 0,
        left: 0
        // opacity уже применён в SVG через fillOpacity, не дублируем!
      });
    }
    
    // Применяем композицию: для флагманского - только водяной знак, для остальных - паттерны + водяной знак
    const resultBuffer = compositeLayers.length > 0
      ? await sharp.default(finalBuffer)
          .composite(compositeLayers)
          .jpeg({ quality: 95, mozjpeg: true })
          .toBuffer()
      : finalBuffer; // Если нет слоев (не должно быть, если textWatermark указан)
    
    // Лёгкая валидация буфера ПЕРЕД записью (только базовые проверки, без тяжелых циклов)
    const validateImage = sharp.default(resultBuffer);
    const metadata = await validateImage.metadata();
    if (!metadata.format || metadata.format !== 'jpeg') {
      throw new Error(`Неверный формат файла: ${metadata.format}`);
    }
    if (!metadata.width || !metadata.height) {
      throw new Error(`Неверные размеры: ${metadata.width}x${metadata.height}`);
    }
    if (!resultBuffer.length) {
      throw new Error('Буфер пустой (0 байт)');
    }
    // Простая проверка JPEG-заголовка
    if (resultBuffer.length < 3 || resultBuffer[0] !== 0xFF || resultBuffer[1] !== 0xD8 || resultBuffer[2] !== 0xFF) {
      throw new Error('Буфер не является валидным JPEG (неверный заголовок)');
    }
    
    // Сохраняем результат (без дополнительных циклов post-write валидации)
    await fs.promises.writeFile(outputPath, resultBuffer);
    await new Promise(resolve => setImmediate(resolve));

    return outputPath;
  } catch (err) {
    // Если не удалось сгенерировать, используем упрощенный подход
    console.warn(`   ⚠️  Не удалось сгенерировать фото с водяным знаком: ${err.message}`);
    console.warn(`   Используется упрощенный подход (копирование исходника)`);
    
    fs.copyFileSync(sourcePath, outputPath);
    return outputPath;
  }
}

function logStep(stepNum, stepName, details = '') {
  console.log(`\n[ШАГ ${stepNum}] ${stepName}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

function logError(stepNum, stepName, error) {
  console.error(`\n❌ ОШИБКА НА ШАГЕ ${stepNum} (${stepName}):`);
  console.error(`   ${error.message}`);
  if (error.stack) {
    console.error(`\n   Stack trace:`);
    console.error(`   ${error.stack.split('\n').slice(0, 5).join('\n   ')}`);
  }
}

function cleanupOutputDir(outDir, { keepFiles = [] } = {}) {
  try {
    if (!fs.existsSync(outDir)) return;
    const keep = new Set(keepFiles.map((p) => path.basename(p)).filter(Boolean));
    const files = fs.readdirSync(outDir);

    for (const name of files) {
      const fullPath = path.join(outDir, name);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const isCandidate =
        /^ads_.*\.xml$/.test(name) ||
        /^ads_.*_manifest\.json$/.test(name) ||
        /^photos_links_.*\.json$/.test(name) ||
        name.endsWith('.backup') ||
        name === 'test_validation.xml';

      if (isCandidate && !keep.has(name)) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`   [CLEANUP] Удалён файл: ${name}`);
        } catch (e) {
          console.log(`   [CLEANUP] Не удалось удалить ${name}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.log(`   [CLEANUP] Ошибка при очистке output: ${e.message}`);
  }
}

async function main() {
  let currentStep = 0;
  let currentStepName = '';
  const startTime = Date.now(); // Объявляем до блока try, чтобы была доступна в catch
  let opts;
  
  try {
    opts = parseArgs();
    console.log('НАЧАЛО ГЕНЕРАЦИИ ФИДА АВИТО');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Время запуска: ${formatMoscowTime(new Date(startTime))}`);
    console.log(`Параметры:`);
    console.log(`  --plan: ${opts.plan || 'по умолчанию'}`);
    console.log(`  --current-dir: ${opts.currentDir || 'по умолчанию'}`);
    console.log(`  --date: ${opts.date || 'автоматически'}`);
    console.log(`  --update-rules: ${opts.updateRules || 'по умолчанию'}`);
    if (opts.testStep) {
      console.log(`  --test-step: ${opts.testStep[0]}${opts.testStep[1] !== opts.testStep[0] ? `-${opts.testStep[1]}` : ''}`);
    }
    if (opts.dryRun) {
      console.log(`  --dry-run: ВКЛЮЧЕН (режим тестирования, файлы не будут изменены)`);
    }
    if (opts.skipPhotos || opts.skipOldPhotos || opts.skipNewPhotos || opts.skipUpload || opts.skipUpdates || opts.skipGeneration) {
      console.log(`  Пропускаемые операции:`);
      if (opts.skipPhotos) console.log(`    - Все фото`);
      if (opts.skipOldPhotos) console.log(`    - Фото для старых объявлений`);
      if (opts.skipNewPhotos) console.log(`    - Фото для новых объявлений`);
      if (opts.skipUpload) console.log(`    - Загрузка на Яндекс.Диск`);
      if (opts.skipUpdates) console.log(`    - Обновление описаний/заголовков`);
      if (opts.skipGeneration) console.log(`    - Генерация новых объявлений`);
    }
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // 1. Читаем план
    currentStep = 1;
    currentStepName = 'Чтение плана';
    logStep(currentStep, currentStepName);
    const planPath = opts.plan || DEFAULT_PLAN_PATH;
    console.log(`   Путь к плану: ${planPath}`);
    const plan = readPlan(opts.plan);
    if (!plan || !plan.tasks || plan.tasks.length === 0) {
      throw new Error(`План не найден или пуст. Путь: ${planPath}`);
    }
    const publicationQueue = plan.publicationQueue || [];
    if (!publicationQueue.length) {
      throw new Error(`В плане отсутствует publicationQueue. Сформируйте план через tools/plan-builder/index.html.`);
    }
    const aliases = plan.aliases || { materials: {}, addresses: {} };
    console.log(`   Найдено задач: ${plan.tasks.length}`);
    console.log(`   Очередь публикаций: ${publicationQueue.length} элементов`);
    if (aliases.materials && Object.keys(aliases.materials).length > 0) {
      console.log(`   Алиасы материалов: ${Object.keys(aliases.materials).length}`);
    }
    if (aliases.addresses && Object.keys(aliases.addresses).length > 0) {
      console.log(`   Алиасы адресов: ${Object.keys(aliases.addresses).length}`);
    }
    // Жёсткая проверка соответствия задач и очереди, чтобы не получить смещение дат
    validatePlanCounts(plan, aliases);
    // Проверка попадания времен публикации в разрешённые окна
    validatePlanWindows(publicationQueue);
    // Проверка шагов между публикациями
    validatePlanStepIntervals(publicationQueue, 5, 30);
    
    // 2. Читаем Excel с текущими объявлениями
    currentStep = 2;
    currentStepName = 'Чтение текущих объявлений из Excel';
    let currentAds = [];
    if (!shouldExecuteStep(2, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
    } else {
      logStep(currentStep, currentStepName);
      const currentDir = opts.currentDir || DEFAULT_CURRENT_DIR;
      console.log(`   Папка: ${currentDir}`);
      const xlsxPath = findSingleXlsx(currentDir);
      if (xlsxPath) {
        console.log(`   Файл: ${path.basename(xlsxPath)}`);
        currentAds = await readCurrentAdsFromXlsx(xlsxPath);
        console.log(`   Прочитано объявлений: ${currentAds.length}`);
        if (currentAds.length > 0) {
          const sampleIds = currentAds.slice(0, 3).map(ad => ad.Id || ad.AvitoId || 'нет Id').join(', ');
          console.log(`   Примеры Id: ${sampleIds}${currentAds.length > 3 ? '...' : ''}`);
        }
      } else {
        console.log(`   ⚠️  Excel не найден в ${currentDir}, продолжаем без текущих объявлений`);
      }
    }
    
    // 3. Читаем правила обновления
    currentStep = 3;
    currentStepName = 'Чтение правил обновления';
    let updateRulesMap = new Map();
    if (!shouldExecuteStep(3, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
    } else {
      logStep(currentStep, currentStepName);
      const updateRulesPath = opts.updateRules || DEFAULT_UPDATE_RULES_PATH;
      console.log(`   Путь: ${updateRulesPath}`);
      const updateRules = readUpdateRules(opts.updateRules);
      
      if (!updateRules) {
        console.log(`   ⚠️  Файл правил не найден или не прочитан`);
      } else {
        console.log(`   ✅ Файл правил прочитан`);
        console.log(`   [DEBUG] Полный объект updateRules:`, JSON.stringify(updateRules, null, 2));
        if (updateRules.byLists) {
          console.log(`   byLists: присутствует`);
          console.log(`   [DEBUG] byLists содержимое:`, JSON.stringify(updateRules.byLists, null, 2));
          if (updateRules.byLists.updateAll !== undefined) {
            console.log(`      updateAll: ${updateRules.byLists.updateAll} (тип: ${typeof updateRules.byLists.updateAll})`);
          } else {
            console.log(`      ⚠️  updateAll отсутствует в byLists!`);
          }
        } else {
          console.log(`   byLists: отсутствует`);
        }
        if (updateRules.byId) {
          console.log(`   byId: ${Object.keys(updateRules.byId).length} правил`);
        } else {
          console.log(`   byId: отсутствует`);
        }
      }
      
      console.log(`   Передано объявлений из Excel: ${currentAds.length}`);
      if (currentAds.length > 0) {
        const withId = currentAds.filter(ad => ad.Id || ad.AvitoId).length;
        const withoutId = currentAds.length - withId;
        console.log(`      С Id/AvitoId: ${withId}`);
        if (withoutId > 0) {
          console.log(`      ⚠️  Без Id/AvitoId: ${withoutId} (будут пропущены)`);
        }
      }
      
      updateRulesMap = await buildUpdateRulesMap(updateRules, currentAds);
      
      if (updateRulesMap.size > 0) {
        console.log(`   ✅ Найдено правил обновления: ${updateRulesMap.size}`);
        const updatePhotoCount = Array.from(updateRulesMap.values()).filter(r => r.updatePhoto).length;
        const updateDescCount = Array.from(updateRulesMap.values()).filter(r => r.updateDescription).length;
        const updateTitleCount = Array.from(updateRulesMap.values()).filter(r => r.customTitle).length;
        const updateAddrCount = Array.from(updateRulesMap.values()).filter(r => r.newAddress).length;
        if (updatePhotoCount > 0) console.log(`      - Обновление фото: ${updatePhotoCount}`);
        if (updateDescCount > 0) console.log(`      - Обновление описания: ${updateDescCount}`);
        if (updateTitleCount > 0) console.log(`      - Обновление заголовка: ${updateTitleCount}`);
        if (updateAddrCount > 0) console.log(`      - Обновление адреса: ${updateAddrCount}`);
      } else {
        console.log(`   ⚠️  Старые объявления не меняем (правил не создано)`);
        if (updateRules && updateRules.byLists && updateRules.byLists.updateAll) {
          console.log(`   ⚠️  ВНИМАНИЕ: updateAll=true, но правила не созданы!`);
          console.log(`      Возможные причины:`);
          console.log(`      1. У объявлений нет Id или AvitoId`);
          console.log(`      2. currentAds был пустым на момент создания правил`);
        }
      }
    }
    
    // Множество уже существующих Id из Excel, чтобы не дублировать их для новых объявлений
    const existingIdsSet = new Set(
      (currentAds || [])
        .map(ad => ad.Id || ad.id)
        .filter(Boolean)
    );
    
    const dateLabel = formatDateLabel(opts.date);
    const diskFolderName = dateLabel.replace(/\s+/g, '_');
    const photosLinks = {
      date: dateLabel,
      diskRoot: opts.diskRoot,
      diskPath: `${opts.diskRoot}/${diskFolderName}`,
      items: []
    };
    let finalPhotosPath = null;
    let photosMapping = {};
    
    // 4. Обрабатываем старые объявления (обновление фото)
    currentStep = 4;
    currentStepName = 'Обновление фото для старых объявлений';
    if (!shouldExecuteStep(4, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
    } else if (opts.skipPhotos || opts.skipOldPhotos) {
      logStep(currentStep, currentStepName, 'Пропущен (--skip-photos или --skip-old-photos)');
    } else if (updateRulesMap.size > 0 && currentAds.length > 0) {
      logStep(currentStep, currentStepName);
      const adsToUpdatePhoto = currentAds.filter(ad => {
        const rules = updateRulesMap.get(ad.Id);
        return rules && rules.updatePhoto;
      });
      
      if (adsToUpdatePhoto.length > 0) {
        console.log(`   Найдено объявлений для обновления фото: ${adsToUpdatePhoto.length}\n`);
        
        let successCount = 0;
        let skippedCount = 0;
        
        // Генерируем фото для каждого старого объявления
        for (let i = 0; i < adsToUpdatePhoto.length; i++) {
          const ad = adsToUpdatePhoto[i];
          
          // Визуальный разделитель между объявлениями
          if (i > 0) {
            console.log('');
          }
          console.log(`${'─'.repeat(60)}`);
          console.log(`   [${i + 1}/${adsToUpdatePhoto.length}] Объявление: ${ad.Id}`);
          console.log(`${'─'.repeat(60)}`);
          
          // Определяем materialId и address из правил обновления или объявления
          const rules = updateRulesMap.get(ad.Id);
          const materialId = rules?.materialId || 'karier_neseyan_nemyt_pesok';
          // Используем адрес из правил (без префикса "Московская обл."), а не из Excel
          const address = rules?.newAddress || rules?.address || 'Московская область, Троицк';
          
          console.log(`   Параметры:`);
          console.log(`      materialId: ${materialId}`);
          console.log(`      address: ${address}`);
          
          if (!materialId) {
            throw new Error(`Не указан materialId для объявления ${ad.Id}. Укажите materialId в update_old_ads.json`);
          }
          
          try {
            console.log(`\n   Генерация фото...`);
            const photoPath = await generatePhotoForOldAd(
              ad.Id,
              materialId,
              address,
              DEFAULT_PHOTOS_ROOT,
              'NERUDA',
              null, // Используем адаптивный opacity для водяного знака
              0.03  // patternOpacity
            );
            console.log(`   ✅ Фото создано: ${path.basename(photoPath)}`);
            
            // Загружаем на Яндекс.Диск
            // Локальная история ведётся по materialId + safeAddress, поэтому
            // для истории вычисляем safeAddress и обновляем hashes.json.
            const { formatAddressLabel, sanitizeName } = await import('./lib/photo-variants/utils.js');
            const safeAddress = sanitizeName(formatAddressLabel(address));

            // Обновляем историю с AvitoId и новым хешем фото
            try {
              const { aHashFromBuffer } = await import('./lib/photo-variants/hashing.js');
              const photoHash = await aHashFromBuffer(fs.readFileSync(photoPath));
              const materialPathLocal = path.join(rules.materialId || 'karier_neseyan_nemyt_pesok', safeAddress);
              updateHistoryWithAvitoId(materialPathLocal, ad.Id, photoHash, `${ad.Id}.jpg`);
            } catch (histErr) {
              console.warn(`   ⚠️  Не удалось обновить историю: ${histErr.message}`);
            }
            
            console.log(`\n   ✅ Обновлено фото для объявления ${ad.Id}`);
            successCount++;
            
            // Минимальная задержка между фото (только если не последнее)
            // Это помогает избежать rate limiting и снижает нагрузку на API
            if (i < adsToUpdatePhoto.length - 1) {
              const delay = 300 + Math.random() * 200; // 0.3-0.5 секунды случайная задержка
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (err) {
            console.log(`\n   ❌ Ошибка при обновлении фото:`);
            console.log(`      ${err.message}`);
            
            // Определяем тип ошибки
            const errorMsg = err.message || String(err);
            const isTemporaryError = 
              errorMsg.includes('HTTP 500') || 
              errorMsg.includes('HTTP 502') || 
              errorMsg.includes('HTTP 503') || 
              errorMsg.includes('HTTP 429');
            
            if (isTemporaryError) {
              console.log(`   ⚠️  Временная ошибка сервера (после всех попыток), пропускаем это фото`);
            } else {
              console.log(`   ⚠️  Постоянная ошибка, пропускаем это фото`);
            }
            
            if (err.stack && err.message.includes('HTTP 500')) {
              console.log(`   [DEBUG] Полный стек ошибки:`);
              console.log(`      ${err.stack.split('\n').slice(0, 5).join('\n      ')}`);
            }
            console.log(`   ⚠️  Фото останется из Excel: ${ad.photoLink || 'не указано'}`);
            skippedCount++;
            // Останавливаем процесс: нельзя продолжать с неполным набором фото
            throw new Error(`Обновление фото для старого объявления ${ad.Id} не удалось: ${err.message}`);
          }
        }
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`   ИТОГО ОБНОВЛЕНО ФОТО: ${successCount} из ${adsToUpdatePhoto.length}`);
        if (skippedCount > 0) {
          console.log(`   ⚠️  Пропущено: ${skippedCount} (нет фото для материала)`);
        }
        console.log(`${'═'.repeat(60)}\n`);
      } else {
        console.log(`   ⚠️  Нет объявлений для обновления фото`);
      }
    } else {
      logStep(currentStep, currentStepName, 'Пропущен (нет правил обновления или текущих объявлений)');
    }
    
    // Определяем путь к плану для использования в шагах 5 и 6
    const planPathForPhotos = opts.plan || DEFAULT_PLAN_PATH;
    
    // 5. Генерируем фото для новых объявлений
    currentStep = 5;
    currentStepName = 'Генерация фото для новых объявлений';
    if (!shouldExecuteStep(5, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
    } else if (opts.skipPhotos || opts.skipNewPhotos) {
      logStep(currentStep, currentStepName, 'Пропущен (--skip-photos или --skip-new-photos)');
    } else {
      logStep(currentStep, currentStepName);
      console.log(`   План: ${planPathForPhotos}`);
      try {
      const photoArgs = [
        '--plan', planPathForPhotos,
        '--text-watermark', 'NERUDA',
        '--text-opacity', '0.03',
        '--pattern-opacity', '0.03'
      ];
      console.log(`   Запуск generate-photo-variants.js...`);
      await runScript(
        path.resolve(__dirname, 'generate-photo-variants.js'),
        photoArgs
      );
        console.log(`   Фото для новых объявлений сгенерированы`);
      } catch (err) {
        logError(currentStep, currentStepName, err);
        throw new Error(`Ошибка при генерации фото: ${err.message}`);
      }
    }
    
    // 6. Загружаем все фото на Яндекс.Диск (и новые, и обновленные для старых)
    currentStep = 6;
    currentStepName = 'Загрузка всех фото на Яндекс.Диск';
    if (!shouldExecuteStep(6, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
    } else if (opts.skipUpload || opts.dryRun) {
      logStep(currentStep, currentStepName, opts.dryRun ? 'Пропущен (--dry-run)' : 'Пропущен (--skip-upload)');
    } else {
      logStep(currentStep, currentStepName);
      const token = process.env.YANDEX_DISK_TOKEN;
      if (!token) {
        throw new Error('YANDEX_DISK_TOKEN не найден в окружении');
      }
      // Все фото (новые и старые) складываются в единую папку этой генерации:
      // disk:/<diskRoot>/<dateLabel>/<fileName>
      console.log(`   Структура папок: ${opts.diskRoot}/${diskFolderName}/ (единая папка без подкаталогов по материалу/адресу)`);
      console.log(`   Дата генерации: ${dateLabel}`);
      console.log('');
      
      try {
        // Загружаем фото для новых объявлений (из плана)
        if (opts.dryRun) {
          console.log(`   [DRY-RUN] Фото для новых объявлений были бы загружены`);
        } else {
          console.log(`   Загрузка фото для новых объявлений...`);
          const uploadArgs = [
            '--plan', planPathForPhotos,
            '--root', opts.diskRoot,
            '--date', dateLabel,
            '--out', opts.outDir
          ];
          
          await runScript(
            path.resolve(__dirname, 'upload-photos.js'),
            uploadArgs,
            { env: { YANDEX_DISK_TOKEN: token } }
          );
        }
        
        // Загружаем маппинг фото для новых объявлений (созданный upload-photos.js)
        console.log('');
        console.log(`   Объединение маппингов фото...`);
        const photosMappingPath = path.join(opts.outDir, `photos_links_${dateLabel}.json`);
        if (fs.existsSync(photosMappingPath)) {
          const newPhotosData = JSON.parse(fs.readFileSync(photosMappingPath, 'utf8'));
          // Добавляем фото для новых объявлений в общий маппинг
          if (newPhotosData.items && Array.isArray(newPhotosData.items)) {
            photosLinks.items.push(...newPhotosData.items);
            console.log(`   Загружено фото для новых объявлений: ${newPhotosData.items.length}`);
          }
        } else {
          console.log(`   ⚠️  Файл маппинга не найден: ${path.basename(photosMappingPath)}`);
        }
        
        // Сохраняем объединенный маппинг (новые + обновленные для старых)
        console.log(`   Сохранение объединенного маппинга...`);
        finalPhotosPath = path.join(opts.outDir, `photos_links_${dateLabel}.json`);
        fs.writeFileSync(
          finalPhotosPath,
          JSON.stringify(photosLinks, null, 2),
          'utf8'
        );
        
        // Загружаем маппинг фото (file → public_url) для использования в шагах 7 и 8
        photosMapping = loadPhotosMapping(finalPhotosPath);
        const totalPhotos = photosLinks.items.length;
        const updatedPhotosCount = photosLinks.items.filter(item => 
          currentAds.some(ad => ad.Id === item.avitoId)
        ).length;
        const newPhotosCount = totalPhotos - updatedPhotosCount;
        
        console.log('');
        console.log(`   ИТОГО ЗАГРУЖЕНО ФОТО: ${totalPhotos}`);
        if (totalPhotos > 0) {
          if (newPhotosCount > 0) {
            console.log(`      Новых объявлений: ${newPhotosCount}`);
          }
          if (updatedPhotosCount > 0) {
            console.log(`      Обновленных для старых: ${updatedPhotosCount}`);
          }
        }
        console.log(`   Файл маппинга: ${path.basename(finalPhotosPath)}`);
      } catch (err) {
        logError(currentStep, currentStepName, err);
        throw new Error(`Ошибка при загрузке фото: ${err.message}`);
      }
    }
    
    // 7. Обновляем описания/заголовки для старых объявлений
    currentStep = 7;
    currentStepName = 'Обновление описаний и заголовков для старых объявлений';
    if (!shouldExecuteStep(7, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
    } else if (opts.skipUpdates || opts.dryRun) {
      logStep(currentStep, currentStepName, opts.dryRun ? 'Пропущен (--dry-run)' : 'Пропущен (--skip-updates)');
    } else if (updateRulesMap.size > 0 && currentAds.length > 0) {
      logStep(currentStep, currentStepName);
      
      let updatedCount = 0;
      const adsToUpdate = currentAds.filter(ad => {
        const rules = updateRulesMap.get(ad.Id);
        return rules && (rules.updateDescription || rules.customTitle || rules.newAddress);
      });
      
      console.log(`\n   Найдено объявлений для обновления: ${adsToUpdate.length}`);
      if (adsToUpdate.length === 0) {
        console.log(`   Нет объявлений, требующих обновления`);
      }
      
      for (let i = 0; i < adsToUpdate.length; i++) {
        const ad = adsToUpdate[i];
        const rules = updateRulesMap.get(ad.Id);
        if (!rules) continue;
        
        console.log(`\n   ${'─'.repeat(56)}`);
        console.log(`   [${i + 1}/${adsToUpdate.length}] Объявление: ${ad.Id}`);
        console.log(`   ${'─'.repeat(56)}`);
        
        let updated = false;
        const changes = [];
        
        // Нормализуем priceFor для всех старых объявлений (если не обновляется явно)
        if (ad.priceFor && typeof ad.priceFor === 'string') {
          const normalized = ad.priceFor.toLowerCase().trim();
          if (normalized === 'тонну' || normalized === 'тонна' || normalized === 'т' || normalized === 'tonnu') {
            // Строгое значение из справочника Авито
            ad.priceFor = 'тонну';
          } else if (normalized === 'м³' || normalized === 'м3' || normalized === 'м^3' || normalized.includes('м') || normalized.includes('куб')) {
            // Строгое значение из справочника Авито
            ad.priceFor = 'м³';
          }
        }
        
        // Обновляем описание
        if (rules.updateDescription) {
          if (rules.updateDescription === 'auto') {
            try {
              console.log(`\n   Описание:`);
              console.log(`      Режим: автогенерация`);
              // Автогенерация описания
              const materialId = rules.materialId || resolveMaterialIdFromAdId(ad.Id);
              if (!materialId) {
                console.warn(`      ⚠️  Не удалось определить materialId для объявления ${ad.Id}. Описание оставлено без изменений.`);
                continue;
              }
              const rubbleType = getRubbleType(materialId);
              if (rubbleType) {
                const descResult = generateRubbleDescription(materialId);
                ad.description = descResult.description;
                ad.latinReplacements = descResult.latinReplacements;
                ad.block1Variant = descResult.block1Variant;
                ad.block7 = descResult.block7Params;
              } else {
                const sandType = getSandType(materialId);
                
                const descResult = generateDescription(materialId, sandType?.displayName || 'Песок карьерный');
                ad.description = descResult.description;
                ad.latinReplacements = descResult.latinReplacements;
                ad.block1Variant = descResult.block1Variant;
                ad.block7 = descResult.block7Params;
                
                // Для флагманского объявления обновляем точные значения priceFor, color, price
                const { parseAdId } = await import('../src/constants/materialAliases.js');
                const parsed = parseAdId(ad.Id);
                const isFlagship = parsed && parsed.counter === 1;
                
                if (isFlagship) {
                  console.log(`      Флагманское объявление`);
                  console.log(`      Используются точные параметры: priceFor, color, price`);
                  const { FLAGSHIP_PARAMETERS } = await import('../src/constants/parameters.js');
                  ad.priceFor = FLAGSHIP_PARAMETERS.PRICE_FOR;
                  ad.color = FLAGSHIP_PARAMETERS.COLOR;
                  if (sandType) {
                    ad.price = sandType.basePrice; // Точная базовая цена
                  }
                }
              }
              
              updated = true;
              changes.push('описание');
              console.log(`      Описание сгенерировано`);
            } catch (err) {
              console.log(`\n   Описание:`);
              console.warn(`      Ошибка генерации: ${err.message}`);
              console.warn(`      Описание останется из Excel`);
              // Описание остается из Excel
            }
          } else if (typeof rules.updateDescription === 'string' && rules.updateDescription !== 'auto') {
            console.log(`\n   Описание:`);
            console.log(`      Режим: ручное`);
            // Ручное описание
            ad.description = rules.updateDescription;
            updated = true;
            changes.push('описание');
            console.log(`      Описание обновлено`);
          }
        }
        
        // Обновляем заголовок
        if (rules.customTitle) {
          console.log(`\n   Заголовок:`);
          if (Array.isArray(rules.customTitle)) {
            console.log(`      Режим: выбор из списка (${rules.customTitle.length} вариантов)`);
            // Выбор из списка
            ad.title = rules.customTitle[Math.floor(Math.random() * rules.customTitle.length)];
          } else if (typeof rules.customTitle === 'string') {
            console.log(`      Режим: конкретный заголовок`);
            // Конкретный заголовок
            ad.title = rules.customTitle;
          }
          updated = true;
          changes.push('заголовок');
          console.log(`      Новый заголовок: "${ad.title}"`);
        }
        
        // Обновляем адрес
        if (rules.newAddress) {
          console.log(`\n   Адрес:`);
          console.log(`      Проверка: ${rules.newAddress}`);
          // Проверяем, что адрес из утвержденных
          if (!CITY_ALIASES[rules.newAddress]) {
            throw new Error(`Адрес "${rules.newAddress}" не найден в списке утвержденных адресов Avito для объявления ${ad.Id}`);
          }
          ad.address = rules.newAddress;
          updated = true;
          changes.push('адрес');
          console.log(`      Адрес обновлен`);
        }
        
        // Обновляем фото (если для этого объявления есть запись в маппинге)
        if (photosMapping && Object.keys(photosMapping).length > 0) {
          const mappedUrl = photosMapping[ad.Id];
          if (mappedUrl) {
            console.log(`\n   Фото:`);
            ad.photoLink = mappedUrl;
            updated = true;
            changes.push('фото');
            console.log(`      Фото обновлено`);
          }
        }
        
        if (updated) {
          updatedCount++;
          console.log(`\n   Итого обновлено: ${changes.join(', ')}`);
        } else {
          console.log(`\n   Нет изменений для этого объявления`);
        }
      }
      
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`   ИТОГО ОБНОВЛЕНО ОБЪЯВЛЕНИЙ: ${updatedCount} из ${adsToUpdate.length}`);
      if (updatedCount < adsToUpdate.length) {
        console.log(`   Пропущено: ${adsToUpdate.length - updatedCount}`);
      }
      console.log(`${'═'.repeat(60)}\n`);
    } else {
      logStep(currentStep, currentStepName, 'Пропущен (нет правил обновления или текущих объявлений)');
    }
    
    // 8. Генерируем новые объявления
    currentStep = 8;
    currentStepName = 'Генерация новых объявлений';
    if (!shouldExecuteStep(8, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
      var generatedAds = [];
    } else if (opts.skipGeneration || opts.dryRun) {
      logStep(currentStep, currentStepName, opts.dryRun ? 'Пропущен (--dry-run)' : 'Пропущен (--skip-generation)');
      var generatedAds = [];
    } else {
      logStep(currentStep, currentStepName);
      
      // Маппинг фото уже загружен на шаге 6 (photosMapping),
      // Здесь просто выводим краткую статистику.
      const photosMappingCount = photosMapping ? Object.keys(photosMapping).length : 0;
      console.log(`\n   Загрузка маппинга фото:`);
      console.log(`      Файл: ${finalPhotosPath ? path.basename(finalPhotosPath) : 'нет'}${photosMappingCount ? '' : ' (маппинг пустой)'}`);
      console.log(`      Найдено фото в маппинге: ${photosMappingCount}`);
      
      var generatedAds = [];
      console.log(`\n   Обработка задач из плана...`);
      console.log(`   Всего задач: ${plan.tasks.length}`);
      
      const planDateBegin = plan.DateBegin || null;
      if (!planDateBegin) {
        throw new Error(`В плане не указан DateBegin.`);
      }
      console.log(`   Режим: строгие даты из publicationQueue (слотов нет)`);

      // Готовим пул объявлений по связке materialId+address
      const adsByKey = new Map();

      for (let taskIdx = 0; taskIdx < plan.tasks.length; taskIdx++) {
        const task = plan.tasks[taskIdx];
        const taskMaterialId = task.materialId || task.material || 'неизвестно';
        
        console.log(`\n   ${'─'.repeat(56)}`);
        console.log(`   Задача ${taskIdx + 1}/${plan.tasks.length}: ${taskMaterialId}`);
        console.log(`   ${'─'.repeat(56)}`);
        
        let taskAdsCount = 0;
        const materialIdResolved = resolveMaterialId(task.materialId || 'karier_neseyan_nemyt_pesok', aliases);
        const locationsPlan = buildLocationPlan(
          task.count || 1,
          task.locations || task.addresses || [],
          aliases
        );

        for (const loc of locationsPlan) {
          const adCounterStart = 1;
          const flagshipFlags = Array(loc.count).fill(false).map((_, idx) => idx === 0);

          const isRubbleTask = (task.material || 'sand') === 'rubble';
          const defaultTitles = task.titles && task.titles.length
            ? task.titles
            : isRubbleTask
              ? (EXACT_TITLES[materialIdResolved] || ['Щебень', 'Щебень вторичный'])
              : TOP_5_TITLES;

          const ads = generateAds({
            material: task.material || 'sand',
            materialId: materialIdResolved,
            count: loc.count,
            titles: defaultTitles,
            addresses: [loc.address],
            photos: task.photos || [],
            currentAds,
            isFlagship: flagshipFlags
          });

          let withPhotoCount = 0;
          const adsWithoutPhoto = [];
          const matAlias = getMaterialAlias(materialIdResolved);
          const cityAlias = getCityAlias(loc.address);

          const locationPhotos = Object.keys(photosMapping)
            .map(adId => {
              const parsed = parseAdId(adId);
              if (parsed && parsed.materialAlias === matAlias && parsed.cityAlias === cityAlias) {
                const hasTime = parsed.dateLabel && parsed.dateLabel.includes('-') && parsed.dateLabel.length > 6;
                return { adId, parsed, url: photosMapping[adId], hasTime };
              }
              return null;
            })
            .filter(Boolean)
            .filter(p => p.hasTime && !existingIdsSet.has(p.adId))
            .sort((a, b) => a.parsed.counter - b.parsed.counter);

          ads.forEach((ad, idx) => {
            const targetCounter = adCounterStart + idx;
            const photo = locationPhotos.find(p => p.parsed.counter === targetCounter);
            const queueDate = parseDateTime(planDateBegin) || new Date();

            if (photo) {
              ad.adId = photo.adId;
              ad.photoLink = photo.url;
              withPhotoCount++;
            } else {
              ad.adId = generateAdId(materialIdResolved, loc.address, queueDate, targetCounter);
              if (!ad.photoLink && task.photos && task.photos.length) {
                ad.photoLink = task.photos[Math.floor(Math.random() * task.photos.length)];
                withPhotoCount++;
              } else {
                adsWithoutPhoto.push(ad.adId);
              }
            }
          });

          if (adsWithoutPhoto.length > 0) {
            throw new Error(
              `Обнаружены объявления без фото (${adsWithoutPhoto.length} из ${ads.length}):\n` +
              `  Локация: ${loc.address}\n` +
              `  Объявления без фото: ${adsWithoutPhoto.slice(0, 5).join(', ')}${adsWithoutPhoto.length > 5 ? '...' : ''}\n` +
              `  Проверьте:\n` +
              `  1. Загружены ли фото на Яндекс.Диск (шаг 6)\n` +
              `  2. Корректен ли маппинг фото (файл photos_links_${dateLabel}.json)\n` +
              `  3. Совпадают ли adId в маппинге с генерируемыми adId`
            );
          }

          console.log(`      Локация: ${loc.address}`);
          console.log(`         Объявлений: ${loc.count}`);
          console.log(`         С фото: ${withPhotoCount}, без фото: ${loc.count - withPhotoCount}`);

          const key = `${materialIdResolved}::${loc.address}`;
          adsByKey.set(key, {
            ads,
            index: 0,
            materialIdResolved,
            location: loc.address,
            task,
            locationPhotos
          });

          taskAdsCount += ads.length;
        }

        console.log(`\n   Итого для задачи "${taskMaterialId}": ${taskAdsCount} объявлений`);
      }

      console.log(`\n   Присваиваем даты строго по publicationQueue (элементов: ${publicationQueue.length})...`);
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
        const targetCounter = entry.index + 1;
        const photo = entry.locationPhotos.find((p) => p.parsed.counter === targetCounter);
        const queueDate = parseDateTime(item.DateBegin);

        if (photo) {
          ad.adId = photo.adId;
          ad.photoLink = photo.url;
        } else {
          const baseDate = queueDate || parseDateTime(planDateBegin) || new Date();
          ad.adId = generateAdId(entry.materialIdResolved, entry.location, baseDate, targetCounter);
          if (!ad.photoLink && entry.task.photos && entry.task.photos.length) {
            ad.photoLink = entry.task.photos[Math.floor(Math.random() * entry.task.photos.length)];
          }
        }

        ad.dateBegin = item.DateBegin;
        generatedAds.push(ad);
        entry.index += 1;
      });

      if (generatedAds.length !== publicationQueue.length) {
        console.warn(`⚠️  Сгенерировано объявлений: ${generatedAds.length}, в publicationQueue: ${publicationQueue.length}`);
      }
      
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`   ИТОГО СГЕНЕРИРОВАНО НОВЫХ ОБЪЯВЛЕНИЙ: ${generatedAds.length}`);
      if (generatedAds.length > 0) {
        const withPhotos = generatedAds.filter(ad => ad.photoLink).length;
        const withoutPhotos = generatedAds.length - withPhotos;
        console.log(`      С фото: ${withPhotos}`);
        console.log(`      Без фото: ${withoutPhotos}`);
      }
      console.log(`${'═'.repeat(60)}\n`);
    }
    
    // 9. Объединяем всё в XML
    currentStep = 9;
    currentStepName = 'Формирование финального XML';
    if (!shouldExecuteStep(9, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
    } else {
      logStep(currentStep, currentStepName);
      
      // Собираем итоговый массив: сначала старые (обновленные), потом новые
      const allAds = [...currentAds, ...(generatedAds || [])];
      const oldAdsCount = currentAds.length;
      const newAdsCount = generatedAds?.length || 0;
      const totalAdsCount = allAds.length;
      
      console.log(`\n   Объединение объявлений:`);
      console.log(`      Старых (обновленных): ${oldAdsCount}`);
      console.log(`      Новых (сгенерированных): ${newAdsCount}`);
      console.log(`      Всего: ${totalAdsCount}`);
      
      const dateLabelForFile = opts.date || formatDateLabelForFile(new Date());
      console.log(`\n   Генерация XML...`);
      const xml = generateXml(allAds, dateLabelForFile);
      
      if (!fs.existsSync(opts.outDir)) {
        fs.mkdirSync(opts.outDir, { recursive: true });
      }
      const xmlFilePath = path.join(opts.outDir, `ads_${dateLabelForFile}.xml`);
      
      if (opts.dryRun) {
        console.log(`\n   [DRY-RUN] XML был бы сохранен:`);
        console.log(`      Файл: ${xmlFilePath}`);
        console.log(`      Размер: ${(Buffer.byteLength(xml, 'utf8') / 1024).toFixed(2)} KB`);
      } else {
        console.log(`   Сохранение XML файла...`);
        fs.writeFileSync(xmlFilePath, xml, 'utf8');
        const fileSize = fs.statSync(xmlFilePath).size;
        
        // Сохраняем список всех adId из XML для синхронизации истории
        const adIdsFromXml = allAds
          .map(ad => ad.adId || ad.Id || ad.id)
          .filter(Boolean);
      const xmlManifestPath = path.join(opts.outDir, `ads_${dateLabelForFile}_manifest.json`);
      fs.writeFileSync(xmlManifestPath, JSON.stringify({
        date: dateLabelForFile,
        timestamp: new Date().toISOString(),
        adIds: adIdsFromXml,
        count: adIdsFromXml.length
      }, null, 2), 'utf8');

      // Сохраняем build-log для быстрой диагностики
      try {
        const buildLogPath = path.join(opts.outDir, `build-log_${dateLabelForFile}.json`);
        const buildLog = {
          status: 'success',
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          durationSeconds: Math.floor((Date.now() - startTime) / 1000),
          plan: {
            tasks: plan.tasks?.length || 0,
            publicationQueue: publicationQueue.length
          },
          ads: {
            old: oldAdsCount,
            generated: newAdsCount,
            total: totalAdsCount
          },
          files: {
            xml: path.basename(xmlFilePath),
            manifest: path.basename(xmlManifestPath),
            photosMapping: finalPhotosPath ? path.basename(finalPhotosPath) : null
          }
        };
        fs.writeFileSync(buildLogPath, JSON.stringify(buildLog, null, 2), 'utf8');
        console.log(`   build-log: ${path.basename(buildLogPath)}`);
      } catch (e) {
        console.log(`   ⚠️  Не удалось записать build-log: ${e.message}`);
      }
        
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`   ФИНАЛЬНЫЙ XML СОЗДАН`);
        console.log(`${'═'.repeat(60)}`);
        console.log(`   Статистика:`);
        console.log(`      Старых объявлений: ${oldAdsCount}`);
        console.log(`      Новых объявлений: ${newAdsCount}`);
        console.log(`      Всего в XML: ${totalAdsCount}`);
        console.log(`   Файлы:`);
        console.log(`      XML: ${path.basename(xmlFilePath)}`);
        console.log(`      Размер: ${(fileSize / 1024).toFixed(2)} KB`);
        console.log(`      Полный путь: ${xmlFilePath}`);
        console.log(`      Манифест: ${path.basename(xmlManifestPath)}`);
        console.log(`      Записей в манифесте: ${adIdsFromXml.length} adId`);
        console.log(`${'═'.repeat(60)}\n`);
        
        // Переносим временную историю в основную (только для тех фото, что попали в XML)
        console.log(`   Перенос истории из временных файлов...`);
        const { formatAddressLabel, sanitizeName } = await import('./lib/photo-variants/utils.js');
        
        // Собираем все уникальные комбинации materialId + address из publicationQueue
        const locationsMap = new Map();
        for (const item of publicationQueue) {
          const materialId = item.materialId;
          const address = item.location;
          if (materialId && address) {
            const key = `${materialId}|${address}`;
            if (!locationsMap.has(key)) {
              locationsMap.set(key, { materialId, address });
            }
          }
        }
        
        let committedCount = 0;
        if (locationsMap.size > 0) {
          console.log(`   Обработка локаций: ${locationsMap.size}`);
          for (const [key, { materialId, address }] of locationsMap) {
            const safeAddress = sanitizeName(formatAddressLabel(address));
            const materialPath = path.join(materialId, safeAddress);
            
            if (commitHistoryFromTmp(materialPath)) {
              committedCount++;
              console.log(`      ${materialId} → ${address}: история перенесена`);
            }
          }
        }
        
        if (committedCount > 0) {
          console.log(`\n   История обновлена для ${committedCount} из ${locationsMap.size} локаций`);
        } else {
          console.log(`\n   Временная история не найдена (возможно, фото не генерировались)`);
        }

        // 9.x. Очистка старых файлов в output (оставляем только актуальные ads/manifest/photos_links)
        console.log(`\n   Очистка старых файлов в output...`);
        cleanupOutputDir(opts.outDir, {
          keepFiles: [xmlFilePath, xmlManifestPath, finalPhotosPath].filter(Boolean)
        });
      }
    }
    
    // 10. Синхронизация истории с активными объявлениями (только в боевом режиме)
    if (!opts.dryRun && !opts.testStep) {
      currentStep = 10;
      currentStepName = 'Синхронизация истории с активными объявлениями';
      logStep(currentStep, currentStepName);
      
      try {
        // Находим последний манифест XML
        const manifestFiles = fs.readdirSync(opts.outDir)
          .filter(name => name.startsWith('ads_') && name.endsWith('_manifest.json'))
          .map(name => ({
            name,
            path: path.join(opts.outDir, name),
            mtime: fs.statSync(path.join(opts.outDir, name)).mtime
          }))
          .sort((a, b) => b.mtime - a.mtime);
        
        if (manifestFiles.length > 0) {
          const latestManifest = JSON.parse(fs.readFileSync(manifestFiles[0].path, 'utf8'));
          const adIdsFromXml = latestManifest.adIds || [];
          console.log(`   Используется манифест: ${manifestFiles[0].name} (${adIdsFromXml.length} adId)`);
          
          // Группируем объявления по materialId и address для синхронизации
          // Используем адреса из плана для определения локаций
          const locationsMap = new Map();
          
          // Собираем все уникальные комбинации materialId + address из publicationQueue
          for (const item of publicationQueue) {
            const materialId = item.materialId;
            const address = item.location;
            if (materialId && address) {
              const key = `${materialId}|${address}`;
              if (!locationsMap.has(key)) {
                locationsMap.set(key, { materialId, address });
              }
            }
          }
          
          let totalKept = 0;
          let totalRemoved = 0;
          
          // Импортируем утилиты для нормализации адреса
          const { formatAddressLabel, sanitizeName } = await import('./lib/photo-variants/utils.js');
          
          for (const [key, { materialId, address }] of locationsMap) {
            // Используем ту же логику нормализации адреса, что и в generate-photo-variants
            const safeAddress = sanitizeName(formatAddressLabel(address));
            const materialPath = path.join(materialId, safeAddress);
            
            const result = syncHistoryWithActiveAds(materialPath, adIdsFromXml, currentAds);
            if (result.removed > 0 || result.total > 0) {
              console.log(`   ${materialId} → ${address}: оставлено ${result.kept}, удалено ${result.removed} из ${result.total}`);
              totalKept += result.kept;
              totalRemoved += result.removed;
            }
          }
          
          if (totalRemoved > 0) {
            console.log(`   История синхронизирована: оставлено ${totalKept}, удалено ${totalRemoved} неактивных записей`);
          } else {
            console.log(`   История актуальна (неактивных записей не найдено)`);
          }
        } else {
          console.log(`   ⚠️  Манифест XML не найден - синхронизация пропущена`);
        }
      } catch (err) {
        console.warn(`   ⚠️  Ошибка при синхронизации истории: ${err.message}`);
        // Не прерываем выполнение - это не критично
      }
    } else {
      currentStep = 10;
      currentStepName = 'Синхронизация истории с активными объявлениями';
      if (opts.dryRun) {
        logStep(currentStep, currentStepName, 'Пропущен (--dry-run)');
      } else {
        logStep(currentStep, currentStepName, 'Пропущен (тестовый режим)');
      }
    }
    
    // 11. Валидация XML фида
    currentStep = 11;
    currentStepName = 'Валидация XML фида';
    if (!shouldExecuteStep(11, opts.testStep)) {
      logStep(currentStep, currentStepName, 'Пропущен (не в диапазоне test-step)');
    } else {
      logStep(currentStep, currentStepName);
      
      // Определяем путь к XML файлу
      const dateLabelForFile = opts.date || formatDateLabelForFile(new Date());
      const xmlFilePath = path.join(opts.outDir, `ads_${dateLabelForFile}.xml`);
      
      if (!fs.existsSync(xmlFilePath)) {
        console.log(`   ⚠️  XML файл не найден: ${path.basename(xmlFilePath)}`);
        console.log(`   Валидация пропущена`);
      } else {
        console.log(`   Файл: ${path.basename(xmlFilePath)}`);
        console.log(`   Полный путь: ${xmlFilePath}`);
        console.log('');
        
        try {
          // Запускаем валидацию
          const validateScriptPath = path.resolve(__dirname, 'validate-xml.js');
          await runScript(
            validateScriptPath,
            [xmlFilePath],
            { silent: false } // Выводим вывод валидатора в консоль
          );
          console.log(`\n   Валидация пройдена успешно`);
        } catch (err) {
          // Валидатор возвращает код ошибки при наличии критических ошибок
          console.log(`\n   Валидация завершилась с ошибками`);
          console.log(`   ${err.message}`);
          // Не прерываем выполнение - пользователь сам решит, что делать с ошибками
          console.log(`   Рекомендуется исправить ошибки перед загрузкой в Avito`);
        }
      }
    }
    
    const endTime = Date.now();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    const durationFormatted = minutes > 0 ? `${minutes} мин ${seconds} сек` : `${seconds} сек`;
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('ГОТОВО');
    console.log(`Время выполнения: ${durationFormatted}`);
    console.log(`Время завершения: ${formatMoscowTime()}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
  } catch (err) {
    const endTime = Date.now();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;
    const durationFormatted = minutes > 0 ? `${minutes} мин ${seconds} сек` : `${seconds} сек`;
    // Пишем build-log в случае ошибки
    try {
      const outDir = (opts && opts.outDir) || DEFAULT_OUTPUT_DIR;
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      const errLogPath = path.join(outDir, `build-log_error_${formatDateLabelForFile(new Date())}.json`);
      const errLog = {
        status: 'error',
        message: err.message,
        stack: err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : '',
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
        durationSeconds,
        plan: {
          tasks: plan?.tasks?.length || 0,
          publicationQueue: plan?.publicationQueue?.length || 0
        }
      };
      fs.writeFileSync(errLogPath, JSON.stringify(errLog, null, 2), 'utf8');
      console.log(`\n   ⚠️  build-log (ошибка): ${path.basename(errLogPath)}`);
    } catch (logErr) {
      console.log(`\n   ⚠️  Не удалось записать build-log об ошибке: ${logErr.message}`);
    }
    
    // Очищаем временную историю при ошибке
    try {
      const { formatAddressLabel, sanitizeName } = await import('./lib/photo-variants/utils.js');
      const locationsMap = new Map();
      for (const task of plan.tasks || []) {
        const materialId = task.materialId;
        for (const slot of task.slots || []) {
          for (const loc of slot.locations || []) {
            const address = loc.address;
            if (materialId && address) {
              const key = `${materialId}|${address}`;
              if (!locationsMap.has(key)) {
                locationsMap.set(key, { materialId, address });
              }
            }
          }
        }
      }
      
      for (const [key, { materialId, address }] of locationsMap) {
        const safeAddress = sanitizeName(formatAddressLabel(address));
        const materialPath = path.join(materialId, safeAddress);
        discardHistoryTmp(materialPath);
      }
    } catch (cleanupErr) {
      // Игнорируем ошибки очистки
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    logError(currentStep, currentStepName, err);
    console.log(`\nВремя до ошибки: ${durationFormatted}`);
    console.log(`Время ошибки: ${new Date().toISOString()}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    if (err.stack) {
      console.error('\nПолный stack trace:');
      console.error(err.stack);
    }
    
    process.exit(1);
  }
}

// Запускаем main() только если скрипт запущен напрямую, а не импортирован
// Проверяем, что process.argv[1] указывает на этот файл
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
