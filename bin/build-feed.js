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
import { generateDescription } from '../src/generators/descriptionGenerator.js';
import { TOP_5_TITLES } from '../src/constants/titles.js';
import { readCurrentAdsFromXlsx } from '../src/utils/currentAdsReader.js';
import { loadPhotosMapping } from '../src/utils/photosLinksReader.js';
import { generateAdId, getCityAlias, CITY_ALIASES } from '../src/constants/materialAliases.js';
import { getSandType } from '../src/constants/sandTypes.js';
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
    return JSON.parse(raw);
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
  if (!updateRules) return new Map();
  
  const rulesMap = new Map();
  
  // Сначала применяем правила из byLists
  if (updateRules.byLists) {
    const { updatePhoto = [], updateDescription = [], customTitles = {}, customDescriptions = {}, newAddresses = {}, updateAll = false } = updateRules.byLists;
    
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
      
      // Для каждого объявления из Excel создаем правила
      for (const ad of currentAds) {
        const avitoId = ad.Id || ad.AvitoId;
        if (!avitoId) continue;
        
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
          address = ad.address || null;
        }
        
        // Создаем правила для этого объявления
        if (!rulesMap.has(avitoId)) {
          rulesMap.set(avitoId, {});
        }
        const rule = rulesMap.get(avitoId);
        rule.updatePhoto = true;
        rule.updateDescription = 'auto';
        if (materialId) rule.materialId = materialId;
        if (address) rule.address = address;
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

async function uploadAndPublishPhoto(token, localPath, diskPath) {
  const uploadUrlRes = await httpRequest(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(diskPath)}&overwrite=true`,
    { method: 'GET', headers: { Authorization: `OAuth ${token}` } }
  );
  const { href } = JSON.parse(uploadUrlRes.data);
  const fileBody = fs.readFileSync(localPath);
  await httpRequest(href, { method: 'PUT', headers: { 'Content-Length': fileBody.length } }, fileBody);
  
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

async function generatePhotoForOldAd(avitoId, materialId, address, photosRoot, textWatermark, textOpacity, patternOpacity) {
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
  
  // Создаем временную папку для генерации
  const tempDir = path.join(photosRoot, materialId, 'temp_updates');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const outputPath = path.join(tempDir, `${avitoId}.jpg`);
  
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
      // Для флагманского фото ищем fs.jpeg или flagship.jpg в папке originals
      const flagshipPath = path.join(originalsDir, 'flagship.jpg');
      const fsJpegPath = path.join(originalsDir, 'fs.jpeg');
      
      // Также проверяем в корне материала (для обратной совместимости)
      const baseDir = path.join(photosRoot, materialId);
      const flagshipPathRoot = path.join(baseDir, 'flagship.jpg');
      const fsJpegPathRoot = path.join(baseDir, 'fs.jpeg');
      
      if (fs.existsSync(flagshipPath)) {
        console.log(`   Используется готовый flagship.jpg из originals (флагманское объявление)`);
        sourceBuffer = await loadImageBuffer(flagshipPath);
        const sourceImage = sharp.default(sourceBuffer);
        sourceMeta = await sourceImage.metadata();
        sourceStats = await sharp.default(sourceBuffer).stats();
        sourcePalette = pickTextPalette(sourceStats, null);
      } else if (fs.existsSync(fsJpegPath)) {
        console.log(`   Создаём флагманское фото из fs.jpeg из originals (без искажений)`);
        sourceBuffer = await loadImageBuffer(fsJpegPath);
        const sourceImage = sharp.default(sourceBuffer);
        sourceMeta = await sourceImage.metadata();
        sourceStats = await sharp.default(sourceBuffer).stats();
        sourcePalette = pickTextPalette(sourceStats, null);
      } else if (fs.existsSync(flagshipPathRoot)) {
        console.log(`   Используется готовый flagship.jpg из корня материала (флагманское объявление)`);
        sourceBuffer = await loadImageBuffer(flagshipPathRoot);
        const sourceImage = sharp.default(sourceBuffer);
        sourceMeta = await sourceImage.metadata();
        sourceStats = await sharp.default(sourceBuffer).stats();
        sourcePalette = pickTextPalette(sourceStats, null);
      } else if (fs.existsSync(fsJpegPathRoot)) {
        console.log(`   Создаём флагманское фото из fs.jpeg из корня материала (без искажений)`);
        sourceBuffer = await loadImageBuffer(fsJpegPathRoot);
        const sourceImage = sharp.default(sourceBuffer);
        sourceMeta = await sourceImage.metadata();
        sourceStats = await sharp.default(sourceBuffer).stats();
        sourcePalette = pickTextPalette(sourceStats, null);
      }
    }
    
    // Если не нашли готовый флагманский исходник - используем обычный
    if (!sourceBuffer) {
      // Для флагманского фото ищем fs.jpeg или flagship.jpg среди исходников
      if (isFlagship) {
        const fsJpegInOriginals = originals.find(p => 
          path.basename(p).toLowerCase() === 'fs.jpeg' || 
          path.basename(p).toLowerCase() === 'flagship.jpg'
        );
        
        if (fsJpegInOriginals) {
          const sourcePath = fsJpegInOriginals;
          sourceBuffer = await loadImageBuffer(sourcePath);
          const baseImage = sharp.default(sourceBuffer);
          sourceMeta = await baseImage.metadata();
          sourceStats = await sharp.default(sourceBuffer).stats();
          sourcePalette = pickTextPalette(sourceStats, null);
          console.log(`   Создаём флагманское фото из ${path.basename(sourcePath)} (без искажений)`);
        } else {
          // Если не нашли fs.jpeg/flagship.jpg - берем первый исходник
          const sourcePath = originals[0];
          sourceBuffer = await loadImageBuffer(sourcePath);
          const baseImage = sharp.default(sourceBuffer);
          sourceMeta = await baseImage.metadata();
          sourceStats = await sharp.default(sourceBuffer).stats();
          sourcePalette = pickTextPalette(sourceStats, null);
          console.log(`   ⚠️  Флагманское фото из ${path.basename(sourcePath)} (fs.jpeg/flagship.jpg не найден)`);
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
    
    // Валидация буфера ПЕРЕД записью
    try {
      const validateImage = sharp.default(resultBuffer);
      const metadata = await validateImage.metadata();
      if (!metadata.format || metadata.format !== 'jpeg') {
        throw new Error(`Неверный формат файла: ${metadata.format}`);
      }
      if (metadata.width === 0 || metadata.height === 0) {
        throw new Error(`Неверные размеры: ${metadata.width}x${metadata.height}`);
      }
      if (resultBuffer.length === 0) {
        throw new Error('Буфер пустой (0 байт)');
      }
      // Проверяем JPEG заголовок
      if (resultBuffer.length < 3 || resultBuffer[0] !== 0xFF || resultBuffer[1] !== 0xD8 || resultBuffer[2] !== 0xFF) {
        throw new Error('Буфер не является валидным JPEG (неверный заголовок)');
      }
    } catch (validationErr) {
      console.error(`   ❌ Ошибка валидации фото ${path.basename(outputPath)} перед записью: ${validationErr.message}`);
      throw new Error(`Фото повреждено при генерации: ${validationErr.message}`);
    }
    
    // Сохраняем результат с гарантией полной записи
    await fs.promises.writeFile(outputPath, resultBuffer);
    await new Promise(resolve => setImmediate(resolve));
    
    // Проверяем записанный файл
    let retries = 3;
    let fileValid = false;
    while (retries > 0 && !fileValid) {
      try {
        const fileStats = await fs.promises.stat(outputPath);
        if (fileStats.size === 0) {
          throw new Error('Файл пустой после записи (0 байт)');
        }
        if (fileStats.size !== resultBuffer.length) {
          throw new Error(`Размер файла (${fileStats.size}) не совпадает с размером буфера (${resultBuffer.length})`);
        }
        
        // Читаем файл и проверяем JPEG заголовок
        const fileBuffer = await fs.promises.readFile(outputPath);
        if (fileBuffer.length < 3 || fileBuffer[0] !== 0xFF || fileBuffer[1] !== 0xD8 || fileBuffer[2] !== 0xFF) {
          throw new Error('Файл не является валидным JPEG (неверный заголовок)');
        }
        
        // Сравниваем первые байты для проверки целостности
        const compareLength = Math.min(100, resultBuffer.length);
        for (let j = 0; j < compareLength; j++) {
          if (fileBuffer[j] !== resultBuffer[j]) {
            throw new Error(`Файл поврежден: несовпадение байта на позиции ${j}`);
          }
        }
        
        fileValid = true;
      } catch (fileErr) {
        retries--;
        if (retries === 0) {
          console.error(`   ❌ Ошибка проверки файла ${path.basename(outputPath)} после записи: ${fileErr.message}`);
          // Удаляем поврежденный файл
          try {
            await fs.promises.unlink(outputPath);
          } catch (unlinkErr) {
            // Игнорируем ошибки удаления
          }
          throw new Error(`Файл поврежден после записи: ${fileErr.message}`);
        }
        // Ждем перед повторной попыткой
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
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

async function main() {
  let currentStep = 0;
  let currentStepName = '';
  const startTime = Date.now(); // Объявляем до блока try, чтобы была доступна в catch
  
  try {
    const opts = parseArgs();
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
    const aliases = plan.aliases || { materials: {}, addresses: {} };
    console.log(`   Найдено задач: ${plan.tasks.length}`);
    if (aliases.materials && Object.keys(aliases.materials).length > 0) {
      console.log(`   Алиасы материалов: ${Object.keys(aliases.materials).length}`);
    }
    if (aliases.addresses && Object.keys(aliases.addresses).length > 0) {
      console.log(`   Алиасы адресов: ${Object.keys(aliases.addresses).length}`);
    }
    
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
      updateRulesMap = await buildUpdateRulesMap(updateRules, currentAds);
      if (updateRulesMap.size > 0) {
        console.log(`   Найдено правил обновления: ${updateRulesMap.size}`);
        const updatePhotoCount = Array.from(updateRulesMap.values()).filter(r => r.updatePhoto).length;
        const updateDescCount = Array.from(updateRulesMap.values()).filter(r => r.updateDescription).length;
        const updateTitleCount = Array.from(updateRulesMap.values()).filter(r => r.customTitle).length;
        const updateAddrCount = Array.from(updateRulesMap.values()).filter(r => r.newAddress).length;
        if (updatePhotoCount > 0) console.log(`      - Обновление фото: ${updatePhotoCount}`);
        if (updateDescCount > 0) console.log(`      - Обновление описания: ${updateDescCount}`);
        if (updateTitleCount > 0) console.log(`      - Обновление заголовка: ${updateTitleCount}`);
        if (updateAddrCount > 0) console.log(`      - Обновление адреса: ${updateAddrCount}`);
      } else {
        console.log(`   ⚠️  Старые объявления не меняем`);
      }
    }
    
    const dateLabel = formatDateLabel(opts.date);
    const photosLinks = { date: dateLabel, diskRoot: opts.diskRoot, items: [] };
    
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
          const address = rules?.newAddress || ad.address || 'Московская область, Троицк';
          
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
            console.log(`\n   Загрузка на Яндекс.Диск...`);
            const token = process.env.YANDEX_DISK_TOKEN;
            if (!token) {
              throw new Error('YANDEX_DISK_TOKEN не найден в окружении');
            }
            
            // Определяем safeAddress для структуры папок
            const { formatAddressLabel, sanitizeName } = await import('./lib/photo-variants/utils.js');
            const safeAddress = sanitizeName(formatAddressLabel(address));
            
            // Новая структура: disk:/<diskRoot>/<materialId>/<safeAddress>/<dateLabel>/<filename>
            const rootPath = `disk:/${opts.diskRoot}`;
            const materialPath = `${rootPath}/${materialId}`;
            const addressPath = `${materialPath}/${safeAddress}`;
            const datePath = `${addressPath}/${dateLabel}`;
            
            console.log(`   Создание папок на Диске...`);
            await ensureFolder(token, rootPath);
            await ensureFolder(token, materialPath);
            await ensureFolder(token, addressPath);
            await ensureFolder(token, datePath);
            
            const remotePath = `${datePath}/${ad.Id}.jpg`;
            console.log(`   Путь: ${materialId}/${safeAddress}/${dateLabel}/${ad.Id}.jpg`);
            
            if (opts.dryRun) {
              console.log(`   [DRY-RUN] Фото было бы загружено на: ${remotePath}`);
              const mockUrl = `https://disk.yandex.ru/i/MOCK_URL_${ad.Id}`;
              photosLinks.items.push({
                avitoId: ad.Id,
                file: `${ad.Id}.jpg`,
                public_url: mockUrl
              });
              console.log(`   [DRY-RUN] Публичный URL: ${mockUrl}`);
            } else {
              const publicUrl = await uploadAndPublishPhoto(token, photoPath, remotePath);
              console.log(`   ✅ Фото загружено и опубликовано`);
              
              photosLinks.items.push({
                avitoId: ad.Id,
                file: `${ad.Id}.jpg`,
                public_url: publicUrl
              });
              
              // Обновляем историю с AvitoId и новым хешем фото
              try {
                const { aHashFromBuffer } = await import('./lib/photo-variants/hashing.js');
                const photoHash = await aHashFromBuffer(fs.readFileSync(photoPath));
                const materialPathLocal = path.join(rules.materialId || 'karier_neseyan_nemyt_pesok', safeAddress);
                updateHistoryWithAvitoId(materialPathLocal, ad.Id, photoHash, `${ad.Id}.jpg`);
              } catch (histErr) {
                console.warn(`   ⚠️  Не удалось обновить историю: ${histErr.message}`);
              }
              
              // Удаляем локальный файл
              console.log(`\n   Удаление локального файла...`);
              fs.unlinkSync(photoPath);
              console.log(`   ✅ Локальный файл удален`);
            }
            
            console.log(`\n   ✅ Обновлено фото для объявления ${ad.Id}`);
            successCount++;
          } catch (err) {
            console.log(`\n   ❌ Ошибка при обновлении фото:`);
            console.log(`      ${err.message}`);
            console.log(`   ⚠️  Фото останется из Excel: ${ad.photoLink || 'не указано'}`);
            skippedCount++;
            // Продолжаем обработку остальных объявлений
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
      console.log(`   Структура папок: ${opts.diskRoot}/<материал>/<адрес>/<дата>/`);
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
        const finalPhotosPath = path.join(opts.outDir, `photos_links_${dateLabel}.json`);
        fs.writeFileSync(
          finalPhotosPath,
          JSON.stringify(photosLinks, null, 2),
          'utf8'
        );
        
        // Подсчет статистики
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
        
        // Обновляем описание
        if (rules.updateDescription) {
          if (rules.updateDescription === 'auto') {
            try {
              console.log(`\n   Описание:`);
              console.log(`      Режим: автогенерация`);
              // Автогенерация описания
              const materialId = rules.materialId || 'karier_neseyan_nemyt_pesok';
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
        
        // Обновляем фото (если было обновлено на шаге 4)
        const photoItem = photosLinks.items.find(item => item.avitoId === ad.Id);
        if (photoItem) {
          console.log(`\n   Фото:`);
          ad.photoLink = photoItem.public_url;
          updated = true;
          changes.push('фото');
          console.log(`      Фото обновлено`);
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
      
      // Загружаем маппинг фото
      const photosMappingPath = path.join(opts.outDir, `photos_links_${dateLabel}.json`);
      console.log(`\n   Загрузка маппинга фото:`);
      console.log(`      Файл: ${path.basename(photosMappingPath)}`);
      const photosMapping = loadPhotosMapping(photosMappingPath);
      const photosMappingCount = Object.keys(photosMapping).length;
      console.log(`      Найдено фото в маппинге: ${photosMappingCount}`);
      
      var generatedAds = [];
      console.log(`\n   Обработка задач из плана...`);
      console.log(`   Всего задач: ${plan.tasks.length}`);
      
      for (let taskIdx = 0; taskIdx < plan.tasks.length; taskIdx++) {
        const task = plan.tasks[taskIdx];
        const taskMaterialId = task.materialId || task.material || 'неизвестно';
        
        console.log(`\n   ${'─'.repeat(56)}`);
        console.log(`   Задача ${taskIdx + 1}/${plan.tasks.length}: ${taskMaterialId}`);
        console.log(`   ${'─'.repeat(56)}`);
        
        const slots = task.slots && task.slots.length ? task.slots : [{ DateBegin: task.DateBegin, count: task.count }];
        console.log(`   Слотов в задаче: ${slots.length}`);
        
        let taskAdsCount = 0;
        
        for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
          const slot = slots[slotIdx];
          const baseDate = parseDateTime(slot.DateBegin);
          const minInterval =
            Number.isFinite(slot.intervalMinMinutes) && slot.intervalMinMinutes > 0
              ? slot.intervalMinMinutes
              : Number.isFinite(task.intervalMinMinutes) && task.intervalMinMinutes > 0
                ? task.intervalMinMinutes
                : 1;
          const maxIntervalCandidate =
            Number.isFinite(slot.intervalMaxMinutes) && slot.intervalMaxMinutes > 0
              ? slot.intervalMaxMinutes
              : Number.isFinite(slot.intervalMinutes) && slot.intervalMinutes > 0
                ? slot.intervalMinutes
                : Number.isFinite(task.intervalMaxMinutes) && task.intervalMaxMinutes > 0
                  ? task.intervalMaxMinutes
                  : Number.isFinite(task.intervalMinutes) && task.intervalMinutes > 0
                    ? task.intervalMinutes
                    : 6;
          const maxInterval = Math.max(minInterval, maxIntervalCandidate);
          const materialIdResolved = resolveMaterialId(task.materialId || 'karier_neseyan_nemyt_pesok', aliases);
          const locationsPlan = buildLocationPlan(
            slot.count || task.count || 1,
            slot.locations || task.locations || task.addresses || [],
            aliases
          );

          console.log(`\n   Слот ${slotIdx + 1}/${slots.length}:`);
          if (baseDate) {
            console.log(`      Дата начала: ${formatDateTime(baseDate)}`);
          }
          console.log(`      Количество объявлений: ${slot.count || task.count || 1}`);
          console.log(`      Интервал между объявлениями: ${minInterval}-${maxInterval} минут`);
          console.log(`      Локаций: ${locationsPlan.length}`);

          const slotAds = [];
          
          for (const loc of locationsPlan) {
            // Счетчик начинается с 1 для каждой локации (чтобы соответствовать фото, которые генерируются с 01)
            let adCounter = 1;
            
            // Определяем, какие объявления будут флагманскими (counter = 1)
            const flagshipFlags = Array(loc.count).fill(false).map((_, idx) => idx === 0);
            
            const ads = generateAds({
              material: task.material || 'sand',
              materialId: materialIdResolved,
              count: loc.count,
              titles: task.titles && task.titles.length ? task.titles : TOP_5_TITLES,
              addresses: [loc.address],
              photos: task.photos || [],
              currentAds,
              isFlagship: flagshipFlags
            });
            
            // Присваиваем adId и photoLink каждому объявлению
            let withPhotoCount = 0;
            const adsWithoutPhoto = [];
            ads.forEach((ad, idx) => {
              const adId = generateAdId(materialIdResolved, loc.address, baseDate, adCounter++);
              ad.adId = adId;
              
              // Если есть фото с таким adId - используем его URL
              if (photosMapping[adId]) {
                ad.photoLink = photosMapping[adId];
                withPhotoCount++;
              } else if (!ad.photoLink && task.photos && task.photos.length) {
                // Fallback: используем случайное фото из task.photos
                ad.photoLink = task.photos[Math.floor(Math.random() * task.photos.length)];
                withPhotoCount++;
              } else {
                // Фото не найдено - это ошибка
                adsWithoutPhoto.push(adId);
              }
            });
            
            // Проверяем, что все объявления имеют фото
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
            
            slotAds.push(...ads);
          }

          // Расставляем время публикации с заданным интервалом
          if (baseDate) {
            let currentDt = baseDate;
            slotAds.forEach((ad, idx) => {
              ad.dateBegin = formatDateTime(currentDt);
              if (idx < slotAds.length - 1) {
                const step = randomInt(minInterval, maxInterval);
                currentDt = new Date(currentDt.getTime() + step * 60 * 1000);
              }
            });
          }

          generatedAds.push(...slotAds);
          taskAdsCount += slotAds.length;
        }
        
        console.log(`\n   Итого для задачи "${taskMaterialId}": ${taskAdsCount} объявлений`);
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
        
        // Собираем все уникальные комбинации materialId + address из плана
        const locationsMap = new Map();
        for (const task of plan.tasks) {
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
          
          // Собираем все уникальные комбинации materialId + address из плана
          for (const task of plan.tasks) {
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

main();

