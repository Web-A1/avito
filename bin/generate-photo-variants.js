#!/usr/bin/env node
/**
 * Генерирует набор уникализированных копий фото с минимальными изменениями.
 *
 * Пример:
 *   node bin/generate-photo-variants.js --input ./data/photo.jpg --out ./output/photos --count 50
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Настраиваем немедленный вывод логов (отключаем буферизацию)
if (process.stdout.isTTY) {
  process.stdout.setDefaultEncoding('utf8');
}

import {
  DEFAULT_PHOTOS_ROOT,
  DEFAULT_SOURCE_DIR,
  DEFAULT_VARIANTS_DIR,
  DEFAULT_PLAN_PATH,
  HASH_THRESHOLD
} from './lib/photo-variants/constants.js';
import {
  randomBetween,
  randomInt,
  formatLabelDate,
  clampOpacity,
  loadImageBuffer,
  sanitizeName,
  findLatestExcel
} from './lib/photo-variants/utils.js';
import {
  calculateAdaptiveOpacity,
  createNoiseBuffer,
  buildDotsSvg,
  buildGradientSvg,
  buildLightSpotsSvg,
  pickTextPalette,
  buildTextPatternSvg
} from './lib/photo-variants/patterns.js';
import { aHashFromBuffer, hamming, pruneByHash, findCloseIndices } from './lib/photo-variants/hashing.js';
import { loadHistory, saveHistory, saveHistoryTmp, filterActiveAds } from './lib/photo-variants/history.js';
import { applyTransformations } from './lib/photo-variants/transformations.js';
import { collectSourcesFromPlan } from './lib/photo-variants/plan.js';
import { generateAdId, getMaterialAlias, getCityAlias, parseAdId } from '../src/constants/materialAliases.js';
import { readCurrentAdsFromXlsx } from '../src/utils/currentAdsReader.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    input: '',
    out: '',
    count: 50,
    patternOpacity: '',
    textWatermark: 'NERUDA', // Дефолтный водяной знак
    textOpacity: '',
    textColor: '',
    ignoreHistory: false,
    overshoot: 0,
    plan: '',
    runLabel: '',
    parallel: 0 // 0 = auto (6-10 в зависимости от размера изображения)
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--input' && args[i + 1]) {
      opts.input = args[++i];
    } else if (arg === '--out' && args[i + 1]) {
      opts.out = args[++i];
    } else if (arg === '--count' && args[i + 1]) {
      opts.count = parseInt(args[++i], 10);
    } else if (arg === '--pattern-opacity' && args[i + 1]) {
      opts.patternOpacity = parseFloat(args[++i]);
    } else if (arg === '--text-watermark' && args[i + 1]) {
      opts.textWatermark = args[++i];
    } else if (arg === '--text-opacity' && args[i + 1]) {
      opts.textOpacity = parseFloat(args[++i]);
    } else if (arg === '--text-color' && args[i + 1]) {
      opts.textColor = args[++i];
    } else if (arg === '--ignore-history') {
      opts.ignoreHistory = true;
    } else if (arg === '--overshoot' && args[i + 1]) {
      opts.overshoot = parseFloat(args[++i]);
    } else if (arg === '--plan' && args[i + 1]) {
      opts.plan = args[++i];
    } else if (arg === '--run-label' && args[i + 1]) {
      opts.runLabel = args[++i];
    } else if (arg === '--parallel' && args[i + 1]) {
      opts.parallel = parseInt(args[++i], 10);
    }
  }
  return opts;
}

async function generateVariants({
  input,
  out,
  count,
  patternOpacity: forcedPatternOpacity,
  textWatermark,
  textOpacity: forcedTextOpacity,
  textColor,
  ignoreHistory,
  overshoot,
  materialId,
  address,
  safeAddress,
  dateBegin,
  runLabel,
  name,
  parallel,
  flagshipSource,  // Путь к флагманскому исходнику (с "fs" в имени)
  counterOffset = 0,  // Смещение счётчика для батчевой обработки источников
  totalPhotosInLocation = 0,  // Общее количество фото для этой локации
  globalPhotoIndex = 0,  // Глобальный индекс фото (для нумерации 1/10, 2/10 и т.д.)
  totalPhotosGlobal = 0  // Общее количество фото по всем локациям (для сквозной нумерации)
}) {
  if (!input) throw new Error('Укажите --input путь к исходному фото');

  const baseBuffer = await loadImageBuffer(input);
  const baseImage = sharp(baseBuffer);
  const meta = await baseImage.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Не удалось прочитать размер исходного изображения');
  }
  const stats = await sharp(baseBuffer).stats();
  const palette = pickTextPalette(stats, textColor);
  // safeAddress теперь приходит из параметров (уже нормализованный в plan.js)
  const safeAddr = safeAddress || sanitizeName(address || 'default');
  const baseDir = materialId ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddr) : out;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  
  // Загружаем историю в новом формате (с миграцией старого)
  const historyData = ignoreHistory || !materialId 
    ? { version: 2, ads: [] } 
    : loadHistory(path.join(materialId, safeAddr));
  
  // Читаем Excel для определения счетчика (источник правды для активных объявлений)
  let currentAdsFromExcel = [];
  let excelPath = null;
  if (counterOffset === 0 && !ignoreHistory && materialId) {
    try {
      excelPath = findLatestExcel(path.join(process.cwd(), 'data', 'current'));
      if (excelPath) {
        currentAdsFromExcel = await readCurrentAdsFromXlsx(excelPath);
      }
    } catch (e) {
      // Игнорируем ошибки чтения Excel - это не критично
      console.warn(`   Не удалось прочитать Excel: ${e.message}`);
    }
  }
  
  // Извлекаем только хэши для проверки дубликатов
  const historyHashes = historyData.ads.map(ad => ad.hash);
  
  // Проверяем, было ли уже флагманское объявление для этой локации
  // Флагманское = первое объявление (counter = 1) для товара+локация (независимо от даты)
  // Генерируется один раз и в дальнейшем не меняется
  let hasFlagshipAd = false;
  // Если dateBegin пустой, используем текущую дату для генерации adId (формат DD.MM.YYYY)
  let effectiveDateBegin = dateBegin;
  if (!effectiveDateBegin) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    effectiveDateBegin = `${dd}.${MM}.${yyyy}`;
  }
  const useAdId = !!(materialId && address);
  // Базовое время для adId: реальное время старта генерации локации
  const adIdBaseTime = new Date();
  const getAdIdDate = (counter = 1) => new Date(adIdBaseTime.getTime() + (counter - 1) * 1000);
  
  if (useAdId && counterOffset === 0) {
    const matAlias = getMaterialAlias(materialId);
    const cityAlias = getCityAlias(address);
    
    // Проверяем, есть ли в истории ЛЮБОЕ объявление с counter = 1 для этого товара+локация
    // (независимо от даты - флагманское одно на товар+локацию)
    hasFlagshipAd = historyData.ads.some(ad => {
      if (!ad.adId) return false;
      const parsed = parseAdId(ad.adId);
      // Проверяем только materialAlias и cityAlias, дата не важна
      return parsed && parsed.counter === 1 && parsed.materialAlias === matAlias && parsed.cityAlias === cityAlias;
    });
  }
  
  // Вычисляем стартовый счётчик для adId
  // Логика: счетчик уникален в рамках одной даты
  // Используем Excel как источник правды для активных объявлений
  let startingCounter = 1;
  
  if (useAdId) {
    // Ищем максимальный counter только для ПЕРВОГО источника батча
    if (counterOffset === 0) {
      const matAlias = getMaterialAlias(materialId);
      const cityAlias = getCityAlias(address);
      // Форматируем дату (функция из materialAliases)
      const dateObj = typeof effectiveDateBegin === 'string' ? parseDateBeginLocal(effectiveDateBegin) : effectiveDateBegin;
      const dateLabel = dateObj ? formatDateLabelLocal(dateObj) : '000000-000000';
      const prefix = `${matAlias}_${cityAlias}_${dateLabel}`;
      
      // Показываем информацию об Excel только для первого исходника
      if (excelPath && currentAdsFromExcel.length > 0) {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`Чтение Excel: ${path.basename(excelPath)}`);
        console.log(`   Найдено активных объявлений: ${currentAdsFromExcel.length}`);
      }
      
      // Сначала ищем максимальный counter в Excel (источник правды для активных объявлений)
      const excelCounters = currentAdsFromExcel
        .filter(ad => ad.Id && typeof ad.Id === 'string' && ad.Id.startsWith(prefix))
        .map(ad => {
          const parsed = parseAdId(ad.Id);
          return parsed ? parsed.counter : 0;
        })
        .filter(c => c > 0);
      
      // Если генерируется флагманское фото (первое для товара+локация), оно всегда должно быть с _01
      if (!hasFlagshipAd) {
        // Флагманское фото = первое объявление для товара+локация (независимо от даты), всегда начинаем с 01
        startingCounter = 1;
        console.log(`\nОпределение счетчика:`);
        console.log(`   Префикс: ${prefix}`);
        console.log(`   Генерируется флагманское фото (первое для товара+локация)`);
        console.log(`   Начинаем с: ${String(startingCounter).padStart(2, '0')} (флагманское)`);
        if (excelCounters.length > 0) {
          const maxCounter = Math.max(...excelCounters);
          console.log(`   В Excel найдено: ${excelCounters.length} объявлений для этой даты (макс. счетчик: ${String(maxCounter).padStart(2, '0')})`);
          console.log(`   ⚠️  Внимание: в Excel есть объявления для этой даты, но флагманское фото будет с _01`);
        }
        console.log(`   В истории для проверки дубликатов: ${historyHashes.length} фото`);
      } else if (excelCounters.length > 0) {
        // Если флагманское уже было, продолжаем с максимального counter + 1 для этой даты
        const maxCounter = Math.max(...excelCounters);
        startingCounter = maxCounter + 1;
        console.log(`\nОпределение счетчика:`);
        console.log(`   Префикс: ${prefix}`);
        console.log(`   Флагманское фото уже было для этого товара+локация`);
        console.log(`   Найдено в Excel для этой даты: ${excelCounters.length} объявлений`);
        console.log(`   Максимальный счетчик: ${String(maxCounter).padStart(2, '0')}`);
        console.log(`   Следующий счетчик: ${String(startingCounter).padStart(2, '0')}`);
        console.log(`   В истории для проверки дубликатов: ${historyHashes.length} фото`);
      } else {
        // Если в Excel нет записей для этой даты - начинаем с 01 (новая дата)
        startingCounter = 1;
        console.log(`\nОпределение счетчика:`);
        console.log(`   Префикс: ${prefix}`);
        console.log(`   В Excel нет записей для этой даты`);
        console.log(`   Начинаем с: ${String(startingCounter).padStart(2, '0')} (новая дата)`);
        console.log(`   В истории для проверки дубликатов: ${historyHashes.length} фото`);
      }
    } else {
      // Для не-первых источников батча просто используем смещение
      startingCounter = 1;
    }
    // Добавляем смещение для продолжения счётчика в батче источников
    startingCounter += counterOffset;
  }
  
  const smallImage = Math.min(meta.width, meta.height) < 1400;
  // Ищем флагманский файл (flagship.* или fs.* с любым расширением)
  let flagshipPath = '';
  if (materialId && fs.existsSync(baseDir)) {
    const baseFiles = fs.readdirSync(baseDir)
      .filter(name => name.match(/\.(jpg|jpeg|png|webp)$/i));
    const flagshipFile = baseFiles.find(name => {
      const lower = name.toLowerCase();
      return lower.includes('flagship') || lower.includes('fs');
    });
    if (flagshipFile) {
      flagshipPath = path.join(baseDir, flagshipFile);
    }
  }
  
  // Вспомогательные функции для форматирования (копии из materialAliases)
  function parseDateBeginLocal(str) {
    if (!str) return null;
    // Парсим формат "DD.MM.YYYY HH:MM" или "DD.MM.YYYY HH:MM:SS" или "DD.MM.YYYY"
    const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const [_, dd, MM, yyyy, HH = '00', mm = '00', ss = '00'] = m;
    return new Date(`${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}`);
  }
  
  function formatDateLabelLocal(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '000000-000000';
    const yy = String(date.getFullYear()).substring(2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const MM = String(date.getMinutes()).padStart(2, '0');
    const SS = String(date.getSeconds()).padStart(2, '0');
    return `${dd}${mm}${yy}-${HH}${MM}${SS}`;
  }

  const targetCount = count;
  
  // Если count <= 0, не генерируем фото
  if (targetCount <= 0) {
    return;
  }
  
  const maxRetriesPerIndex = 5; // Увеличено с 1 до 5 для гарантии уникальности
  const maxGlobalPasses = 5; // Увеличено с 2 до 5 для полноценного использования всех попыток
  const overshootSafe = Number.isFinite(overshoot) && overshoot > 0 ? overshoot : 0;
  const zoomBoost = 1 + Math.min(overshootSafe, 0.05); // минимальный вклад overshoot
  const angleBoost = 1 + Math.min(overshootSafe, 0.05);
  const generated = new Array(targetCount);
  let aggressiveMode = false;

  // Форматируем название товара для вывода
  const displayName = (name || materialId || 'Без названия').replace(/_/g, ' ');
  const displayAddress = address ? address.replace(/_/g, ' ') : safeAddr.replace(/_/g, ' ');
  const inputFileName = path.basename(input);
  
  // Переменная для отслеживания реального исходника (может быть изменена для флагманского фото)
  let actualSourceFileName = inputFileName;
  
  // Показываем информацию о локации только для первого исходника в батче
  if (counterOffset === 0) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Материал: ${displayName}`);
    console.log(`Адрес: ${displayAddress}`);
    console.log(`История: ${historyHashes.length} фото`);
    if (useAdId) {
      const matAlias = getMaterialAlias(materialId);
      const cityAlias = getCityAlias(address);
      const dateObj = typeof effectiveDateBegin === 'string' ? parseDateBeginLocal(effectiveDateBegin) : effectiveDateBegin;
      const dateLabel = dateObj ? formatDateLabelLocal(dateObj) : '000000-000000';
      console.log(`Флагманское объявление уже было: ${hasFlagshipAd ? 'ДА' : 'НЕТ'}`);
      if (hasFlagshipAd) {
        const flagshipAd = historyData.ads.find(ad => {
          if (!ad.adId) return false;
          const parsed = parseAdId(ad.adId);
          // Ищем флагманское для товара+локация (независимо от даты)
          return parsed && parsed.counter === 1 && parsed.materialAlias === matAlias && parsed.cityAlias === cityAlias;
        });
        if (flagshipAd) {
          console.log(`   Найдено в истории: ${flagshipAd.adId}`);
        }
      }
    }
    if (totalPhotosInLocation > 0) {
      console.log(`Всего будет создано фото для этой локации: ${totalPhotosInLocation}`);
    }
    console.log(`${'─'.repeat(60)}`);
  }
  
  // Функция для получения имени файла (с поддержкой adId)
  function getFilenameForIndex(idx) {
    if (useAdId) {
      // Используем реальное время (с шагом в 1 сек на каждый counter) для имени
      const counter = startingCounter + idx;
      const photoDateTime = getAdIdDate(counter);
      const adId = generateAdId(materialId, address, photoDateTime, counter);
      return `${adId}.jpg`;
    }
    // Fallback: старый формат для обратной совместимости
    const baseName = name || materialId || path.basename(input, path.extname(input));
    const perFileTime = formatLabelDate(new Date());
    return `${baseName}_${perFileTime}_${String(idx + 1).padStart(3, '0')}.jpg`;
  }

  async function makeVariantSafe(idx, baseOnly = false, maxErrorRetries = 2) {
    for (let errorAttempt = 0; errorAttempt < maxErrorRetries; errorAttempt++) {
      try {
        return await makeVariant(idx, baseOnly);
      } catch (err) {
        console.error(`Ошибка генерации варианта ${idx} (попытка ${errorAttempt + 1}/${maxErrorRetries}): ${err.message}`);
        if (errorAttempt === maxErrorRetries - 1) {
          console.error(`Не удалось создать вариант ${idx} после ${maxErrorRetries} попыток, пропускаем`);
          return null; // Возвращаем null вместо падения всего батча
        }
        // Небольшая задержка перед повтором
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  async function makeVariant(idx, baseOnly = false) {
    const attempt = generated[idx]?.attempts || 0;
    const attemptBoost = aggressiveMode ? 1.2 : 1;
    const baseName = name || materialId || path.basename(input, path.extname(input));
    // Упрощенная структура: все фото в одной папке variants/ без подпапок по датам
    // Объявляем variantDir ДО блока if/else, чтобы он был доступен везде
    const variantDir = materialId
      ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddr, 'variants')
      : path.join(out, baseName, safeAddr, 'variants');
    
    if (baseOnly) {
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }

      const filename = getFilenameForIndex(idx);
      const outPath = path.join(variantDir, filename);
      
      // Если это флагманское фото (counter=01) и файл уже существует - не пересоздаем его
      if (idx === 0 && counterOffset === 0 && !hasFlagshipAd && fs.existsSync(outPath)) {
        console.log(`   ⚠️  Файл ${filename} уже существует - пропускаем пересоздание флагманского фото`);
            // Проверяем, что файл действительно существует и валиден
            const existingBuffer = await fs.promises.readFile(outPath);
            if (existingBuffer.length < 3 || existingBuffer[0] !== 0xFF || existingBuffer[1] !== 0xD8 || existingBuffer[2] !== 0xFF) {
              throw new Error('Существующий файл не является валидным JPEG');
            }
            const hash = await aHashFromBuffer(existingBuffer);
            generated[idx] = { path: outPath, hash, attempts: 0, filename, originalIndex: idx };
            return;
      }

      // Готовый флагманский файл используем ТОЛЬКО для первого фото (idx === 0)
      // И ТОЛЬКО для самого первого исходника в батче (counterOffset === 0)
      // И ТОЛЬКО если флагманское объявление еще не было опубликовано
      // Если флагманское уже было - все фото генерируются с искажениями
      if (idx === 0 && counterOffset === 0 && !hasFlagshipAd && flagshipPath && fs.existsSync(flagshipPath)) {
        const flagshipFileName = path.basename(flagshipPath);
        console.log(`   Используется готовый ${flagshipFileName} (флагманское объявление еще не было)`);
        // Читаем файл и валидируем перед копированием
        const flagshipBuffer = await fs.promises.readFile(flagshipPath);
        
        // Валидируем через sharp (поддерживаем любые форматы: jpeg, png, webp)
        try {
          const validateImage = await sharp(flagshipBuffer);
          const metadata = await validateImage.metadata();
          if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
            throw new Error(`Неподдерживаемый формат файла: ${metadata.format}`);
          }
        } catch (validationErr) {
          throw new Error(`Готовый ${flagshipFileName} невалиден: ${validationErr.message}`);
        }
        
        // Конвертируем в JPEG для совместимости
        const jpegBuffer = await sharp(flagshipBuffer)
          .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toBuffer();
        
        // Записываем с гарантией полной записи (конвертированный в JPEG)
        await fs.promises.writeFile(outPath, jpegBuffer);
        await new Promise(resolve => setImmediate(resolve));
        
        // Проверяем записанный файл
        const writtenBuffer = await fs.promises.readFile(outPath);
        if (writtenBuffer.length !== jpegBuffer.length) {
          throw new Error(`Размер записанного файла (${writtenBuffer.length}) не совпадает с оригиналом (${jpegBuffer.length})`);
        }
        
        const hash = await aHashFromBuffer(jpegBuffer);
        generated[idx] = { path: outPath, hash, attempts: (generated[idx]?.attempts || 0) + 1, filename, originalIndex: idx };
        console.log(`#${idx + 1} - готово`);
        return;
      }

      // Если флагманский файл НЕТ - создаём его
      if (generated[idx]?.path && fs.existsSync(generated[idx].path)) {
        try {
          fs.unlinkSync(generated[idx].path);
        } catch (e) {
          console.warn(`Не удалось удалить старый файл ${generated[idx].path}: ${e.message}`);
        }
      }

      // Создаём флагманский файл: используем файл с "fs" в имени если есть и это первое фото первого исходника без флагманского, иначе baseBuffer
      let sourceBuffer = baseBuffer;
      let sourceMeta = meta;
      let sourcePalette = palette;
      let sourceStats = stats;
      
          // Используем файл с "fs" в имени ТОЛЬКО для первого фото первого исходника (counterOffset === 0), если флагманское объявление еще не было
      if (idx === 0 && counterOffset === 0 && !hasFlagshipAd && flagshipSource && fs.existsSync(flagshipSource)) {
        const flagshipFileName = path.basename(flagshipSource);
        console.log(`   Создаём flagship из ${flagshipFileName} (без искажений)`);
        actualSourceFileName = flagshipFileName; // Сохраняем реальный исходник для логов
        sourceBuffer = await loadImageBuffer(flagshipSource);
        // Пересчитываем meta, stats и palette для флагманского исходника
        const sourceImage = sharp(sourceBuffer);
        sourceMeta = await sourceImage.metadata();
        sourceStats = await sharp(sourceBuffer).stats();
        sourcePalette = pickTextPalette(sourceStats, textColor);
      } else {
        // Для всех остальных случаев используем текущий исходник (input)
        if (idx === 0 && hasFlagshipAd) {
          console.log(`   Флагманское уже было - используем текущий исходник ${path.basename(input)} с искажениями`);
        } else if (idx === 0 && counterOffset > 0) {
          console.log(`   Используем текущий исходник ${path.basename(input)} (не первый в батче)`);
        } else {
          console.log(`   Используем текущий исходник ${path.basename(input)}`);
        }
      }

      let buf = sourceBuffer;
      if (textWatermark) {
        // АДАПТИВНЫЙ OPACITY на основе визуального контраста и детализированности
        const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(sourceStats);
        
        const basePatternOpacity =
          typeof forcedPatternOpacity === 'number' && !Number.isNaN(forcedPatternOpacity) && forcedPatternOpacity > 0
            ? forcedPatternOpacity
            : 0.05;
        
        // Используем адаптивный диапазон для всех режимов
        const baseValue = randomBetween(minOpacity, maxOpacity);
        
        const textOpacity =
          clampOpacity(
            typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
              ? forcedTextOpacity
              : baseValue,
            minOpacity,
            maxOpacity
          ) || minOpacity;
        const textSvg = buildTextPatternSvg(
          sourceMeta.width,
          sourceMeta.height,
          textWatermark,
          textOpacity,
          sourcePalette.fill,
          sourcePalette.stroke || sourcePalette.fill,
          sourcePalette.mode
        );
        buf = await sharp(sourceBuffer)
          .composite([
            {
              input: textSvg,
              top: 0,
              left: 0,
              blend: 'over'
              // opacity уже применён в SVG через fillOpacity, не дублируем!
            }
          ])
          .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toBuffer();
      }
      
      // Валидация буфера перед записью
      if (buf.length < 3 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) {
        throw new Error('Сгенерированный буфер не является валидным JPEG (неверный заголовок)');
      }
      
      // Записываем с гарантией полной записи
      await fs.promises.writeFile(outPath, buf);
      await new Promise(resolve => setImmediate(resolve));
      
      // Проверяем записанный файл
      const writtenBuffer = await fs.promises.readFile(outPath);
      if (writtenBuffer.length !== buf.length) {
        throw new Error(`Размер записанного файла (${writtenBuffer.length}) не совпадает с буфером (${buf.length})`);
      }
      
      if (flagshipPath) {
        try {
          await fs.promises.writeFile(flagshipPath, buf);
          await new Promise(resolve => setImmediate(resolve));
        } catch (e) {
          console.warn(`Не удалось сохранить флагманский файл ${flagshipPath}: ${e.message}`);
        }
      }
      const hash = await aHashFromBuffer(buf);
      generated[idx] = { path: outPath, hash, attempts: (generated[idx]?.attempts || 0) + 1, filename, originalIndex: idx };
      console.log(`#${idx + 1} - готово`);
      return;
    }

    let imgBuffer = null;
    let imgHash = null;
    let outPath = '';

    {
      // Применяем все геометрические и цветовые трансформации
      const transformResult = await applyTransformations(baseBuffer, {
        width: meta.width,
        height: meta.height,
        stats,
        smallImage,
        zoomBoost,
        angleBoost,
        attemptBoost // передаём для агрессивного режима при ретраях
      });

      let baseTransformed = transformResult.pipeline;
      const compWidth = transformResult.finalWidth;
      const compHeight = transformResult.finalHeight;
      const { angle, scale, flipped } = transformResult.metadata;

      // Убрали вывод технических деталей геометрии

      // Вариативное JPEG качество и chroma subsampling для усиления уникальности
      const quality = Math.round(randomBetween(85, 95));
      const chromaSub = Math.random() < 0.5 ? '4:2:0' : '4:4:4';

      const basePatternOpacity =
        typeof forcedPatternOpacity === 'number' && !Number.isNaN(forcedPatternOpacity) && forcedPatternOpacity > 0
          ? forcedPatternOpacity
          : 0.05;

      // Генерируем уникальные паттерны для каждого варианта (без кэша)
      // Это гарантирует максимальную уникальность и исключает дубли
      const patternOpacity = clampOpacity(basePatternOpacity * randomBetween(0.7, 1.4), 0.02, 0.12) || basePatternOpacity;
      const noiseSpread = Math.min(25, Math.max(6, Math.round(patternOpacity * 60)));
      const noiseBuf = createNoiseBuffer(compWidth, compHeight, noiseSpread);
      const finalNoisePng = await sharp(noiseBuf, {
        raw: { width: compWidth, height: compHeight, channels: 4 }
      })
        .png()
        .toBuffer();
      const finalDotsPng = await sharp(buildDotsSvg(compWidth, compHeight)).png().toBuffer();
      const finalGradPng = await sharp(buildGradientSvg(compWidth, compHeight)).png().toBuffer();
      const finalLightPng = await sharp(buildLightSpotsSvg(compWidth, compHeight)).png().toBuffer();

      // Вариативные комбинации паттернов - случайно выбираем 2-4 паттерна
      // Это усложняет детекцию повторяющихся комбинаций
      const allLayers = [
        { name: 'noise', buffer: finalNoisePng, blend: 'soft-light', opacity: patternOpacity },
        { name: 'gradient', buffer: finalGradPng, blend: 'soft-light', opacity: Math.min(1, patternOpacity * 0.6) },
        { name: 'lightSpots', buffer: finalLightPng, blend: 'soft-light', opacity: Math.min(0.35, patternOpacity * 3) },
        { name: 'dots', buffer: finalDotsPng, blend: 'over', opacity: Math.min(1, patternOpacity * 0.6) }
      ];

      // Случайно выбираем 2-4 паттерна
      const numLayers = randomInt(2, 4);
      const layerList = [];
      const indices = new Set();
      while (indices.size < numLayers) {
        indices.add(randomInt(0, allLayers.length - 1));
      }
      indices.forEach(i => layerList.push(allLayers[i]));

      if (textWatermark) {
        const hasForcedOpacity =
          typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0;
        // Если opacity задано явно — используем фиксированное значение для стабильной видимости.
        // Иначе используем адаптивный диапазон на основе визуального контраста и детализированности.
        const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(stats);
        const baseValue = randomBetween(minOpacity, maxOpacity);
        const textOpacity = hasForcedOpacity
          ? clampOpacity(forcedTextOpacity, 0.05, 0.6)
          : clampOpacity(baseValue, minOpacity, maxOpacity) || minOpacity;

        // Для текста всегда используем точные размеры (он легковесный)
        const textPng = await sharp(
          buildTextPatternSvg(compWidth, compHeight, textWatermark, textOpacity, palette.fill, palette.stroke || palette.fill, palette.mode)
        )
          .png()
          .toBuffer();
        
        layerList.push({
          name: 'text',
          buffer: textPng,
          blend: 'over'
          // opacity уже применён в SVG через fillOpacity, не дублируем!
        });
      }

      // Убрали вывод технических деталей композитинга

      const composites = layerList.map((layer) => ({
        input: layer.buffer,
        blend: layer.blend,
        opacity: layer.opacity
      }));

      // Оптимизация: объединяем pipeline в одну операцию
      // Вместо 3 конверсий (png → composite → jpeg) делаем всё за один проход
      imgBuffer = await baseTransformed
        .composite(composites)
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: chromaSub })
        .toBuffer();

      if (generated[idx]?.path && fs.existsSync(generated[idx].path)) {
        try {
          fs.unlinkSync(generated[idx].path);
        } catch (e) {
          console.warn(`Не удалось удалить старый файл ${generated[idx].path}: ${e.message}`);
        }
      }
      // variantDir уже объявлен в начале функции, просто создаем папку если нужно
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }
      const filename = getFilenameForIndex(idx);
      outPath = path.join(variantDir, filename);
      // Валидация ПЕРЕД записью: проверяем буфер в памяти
      try {
        const validateImage = await sharp(imgBuffer);
        const metadata = await validateImage.metadata();
        if (!metadata.format || metadata.format !== 'jpeg') {
          throw new Error(`Неверный формат файла: ${metadata.format}`);
        }
        if (metadata.width === 0 || metadata.height === 0) {
          throw new Error(`Неверные размеры: ${metadata.width}x${metadata.height}`);
        }
        if (imgBuffer.length === 0) {
          throw new Error('Буфер пустой (0 байт)');
        }
        if (imgBuffer.length < 1000) {
          console.warn(`   ⚠️  Подозрительно маленький размер буфера: ${imgBuffer.length} байт`);
        }
      } catch (validationErr) {
        console.error(`   ❌ Ошибка валидации фото ${path.basename(outPath)} перед записью: ${validationErr.message}`);
        throw new Error(`Фото повреждено при генерации: ${validationErr.message}`);
      }
      
      // Записываем файл на диск с гарантией полной записи
      // Используем fs.promises для асинхронной записи с await
      const fsPromises = fs.promises;
      await fsPromises.writeFile(outPath, imgBuffer);
      
      // Ждем небольшую задержку для гарантии записи на диск
      await new Promise(resolve => setImmediate(resolve));
      
      // Проверяем, что файл записан корректно
      let retries = 3;
      let fileValid = false;
      while (retries > 0 && !fileValid) {
        try {
          const fileStats = await fsPromises.stat(outPath);
          if (fileStats.size === 0) {
            throw new Error('Файл пустой после записи (0 байт)');
          }
          if (fileStats.size !== imgBuffer.length) {
            throw new Error(`Размер файла (${fileStats.size}) не совпадает с размером буфера (${imgBuffer.length})`);
          }
          
          // Дополнительная проверка: читаем файл и проверяем JPEG заголовок
          const fileBuffer = await fsPromises.readFile(outPath);
          if (fileBuffer.length < 3) {
            throw new Error('Файл слишком маленький для проверки заголовка');
          }
          if (fileBuffer[0] !== 0xFF || fileBuffer[1] !== 0xD8 || fileBuffer[2] !== 0xFF) {
            throw new Error('Файл не является валидным JPEG (неверный заголовок)');
          }
          
          // Проверяем, что файл полностью записан (сравниваем первые и последние байты)
          if (fileBuffer.length !== imgBuffer.length) {
            throw new Error(`Размер прочитанного файла (${fileBuffer.length}) не совпадает с размером буфера (${imgBuffer.length})`);
          }
          
          // Сравниваем первые 100 байт для проверки целостности
          const compareLength = Math.min(100, imgBuffer.length);
          for (let j = 0; j < compareLength; j++) {
            if (fileBuffer[j] !== imgBuffer[j]) {
              throw new Error(`Файл поврежден: несовпадение байта на позиции ${j}`);
            }
          }
          
          fileValid = true;
        } catch (fileErr) {
          retries--;
          if (retries === 0) {
            console.error(`   ❌ Ошибка проверки файла ${path.basename(outPath)} после записи: ${fileErr.message}`);
            // Удаляем поврежденный файл
            try {
              await fsPromises.unlink(outPath);
            } catch (unlinkErr) {
              // Игнорируем ошибки удаления
            }
            throw new Error(`Файл поврежден после записи: ${fileErr.message}`);
          }
          // Ждем перед повторной попыткой
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      imgHash = await aHashFromBuffer(imgBuffer);
    }

    if (!imgBuffer || !imgHash || !outPath) {
      throw new Error('Не удалось сгенерировать файл без артефактов по краям');
    }

    const filename = getFilenameForIndex(idx);
    generated[idx] = { path: outPath, hash: imgHash, attempts: (generated[idx]?.attempts || 0) + 1, filename, originalIndex: idx };
    if (attempt > 0) {
      console.log(`   Пересоздан (попытка ${attempt + 1}/${maxRetriesPerIndex})`);
    }
  }

  // Генерация всех фото сначала
  if (counterOffset === 0) {
    if (hasFlagshipAd) {
      console.log(`\n⚠️  Флагманское фото уже существует - все фото будут генерироваться с искажениями`);
    } else {
      console.log(`\n✅ Генерируется флагманское фото (первое для товара+локация)`);
    }
  }
  
  for (let i = 0; i < targetCount; i++) {
    if (i === 0 && counterOffset === 0 && !hasFlagshipAd) {
      await makeVariantSafe(0, true); // Без искажений, только водяной знак
    } else {
      await makeVariantSafe(i, false); // С искажениями
    }
    
    // Логируем сразу после генерации каждого фото
    if (generated[i] && generated[i].hash) {
      const currentPhotoNumber = globalPhotoIndex + i + 1;
      const photoNumberLabel = totalPhotosGlobal > 0 ? `[${currentPhotoNumber}/${totalPhotosGlobal}]` : '';
      const originalIndex = generated[i].originalIndex !== undefined ? generated[i].originalIndex : i;
      const adCounter = startingCounter + originalIndex;
      const adId = useAdId 
        ? generateAdId(materialId, address, getAdIdDate(adCounter), adCounter)
        : null;
      
      // Определяем реальный исходник
      let displayedSource = inputFileName;
      if (originalIndex === 0 && counterOffset === 0 && !hasFlagshipAd) {
        if (flagshipSource && fs.existsSync(flagshipSource)) {
          displayedSource = path.basename(flagshipSource);
        } else if (flagshipPath && fs.existsSync(flagshipPath)) {
          displayedSource = 'flagship.jpg';
        }
      }
      
      // Немедленный вывод без буферизации
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`ФОТО ${photoNumberLabel}`);
      if (adId) {
        console.log(`ID объявления: ${adId}`);
      }
      console.log(`Исходник: ${displayedSource}`);
      
      if (originalIndex === 0 && counterOffset === 0 && !hasFlagshipAd) {
        console.log(`Тип: Флагманское фото (без искажений)`);
      } else {
        console.log(`Тип: Генерация с трансформациями`);
      }
      
      // Быстрая проверка на дубликаты
      if (historyHashes.length > 0) {
        const distances = historyHashes.map(h => hamming(generated[i].hash, h));
        const minDist = Math.min(...distances);
        console.log(`Результат проверки: уникально (aHash: ${minDist}, порог: ${HASH_THRESHOLD})`);
      } else {
        console.log(`Результат проверки: уникально (история пуста)`);
      }
      console.log(`${'═'.repeat(60)}`);
    }
  }

  // Валидация и пересоздание дубликатов (используем существующую логику)
  let duplicatePass = 0;
  for (let pass = 0; pass < maxGlobalPasses; pass++) {
    const generatedForValidation = generated.map((g, idx) => (idx === 0 && counterOffset === 0 && !hasFlagshipAd) ? null : g);
    const closeOnes = findCloseIndices(generatedForValidation, historyHashes, HASH_THRESHOLD);
    const minDist = closeOnes.length ? closeOnes[0].minDist : null;
    if (minDist !== null) {
      duplicatePass++;
      if (duplicatePass === 1) {
        // Показываем сообщение о проверке только один раз
      }
      if (minDist === 0) aggressiveMode = true;
    }
    const indicesToRegen = closeOnes
      .filter((c) => (generated[c.index]?.attempts || 0) < maxRetriesPerIndex)
      .map((c) => c.index);
    if (!indicesToRegen.length) break;
    
    const unique = Array.from(new Set(indicesToRegen));
    
    // Последовательное пересоздание дубликатов
    for (const idx of unique) {
      await makeVariantSafe(idx);
    }
  }

  // Проверяем только успешно созданные варианты для финальной проверки дубликатов
  const successfulForValidation = generated.filter(g => g && g.hash);
  const remainingClose = findCloseIndices(successfulForValidation, historyHashes, HASH_THRESHOLD);
  
  // Логирование уже выполнено сразу после генерации каждого фото выше
  // Здесь только проверяем оставшиеся дубликаты для предупреждений
  
  // Предупреждение о дубликатах, если они остались
  if (remainingClose.length) {
    const minDist = remainingClose[0].minDist;
    console.warn(`\nВНИМАНИЕ: Обнаружено ${remainingClose.length} дубликатов после всех попыток!`);
    console.warn(`   Минимальный aHash: ${minDist} (порог: ${HASH_THRESHOLD})`);
    console.warn(`   Список дубликатов:`);
    remainingClose.forEach((item, idx) => {
      const fileName = path.basename(successfulForValidation[item.index].path);
      console.warn(`     ${idx + 1}. ${fileName} (aHash: ${item.minDist})`);
    });
    console.warn(`   Рекомендация: увеличьте разброс трансформаций или проверьте исходное фото.\n`);
  }

  // Фильтруем null значения (неудачные варианты) перед сохранением истории
  const successfulGenerated = generated.filter(g => g && g.hash);
  
  // Создаём новые записи в формате {adId, hash, ...metadata}
  const newAds = successfulGenerated.map((item, idx) => {
    const counter = startingCounter + generated.indexOf(item);
    const adId = useAdId
      ? generateAdId(materialId, address, getAdIdDate(counter), counter)
      : `legacy_${String(idx + 1).padStart(3, '0')}`;
    
    return {
      adId,
      hash: item.hash,
      materialId: materialId || '',
      address: safeAddr,
      dateBegin: dateBegin || '',
      photoPath: item.filename || path.basename(item.path),
      timestamp: new Date().toISOString()
    };
  });
  
  // Объединяем с существующей историей
  // historyData.ads уже включает основную и временную историю (для проверки дубликатов)
  // Но при сохранении временной истории мы должны объединить только основную историю с новыми записями
  // Загружаем только основную историю (без временной) для сохранения
  let mainHistoryData = { version: 2, ads: [] };
  if (materialId) {
    // Загружаем только основную историю (без временной) для сохранения
    const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddr, 'hashes.json');
    if (fs.existsSync(historyPath)) {
      try {
        const json = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        if (Array.isArray(json.hashes)) {
          // Старый формат - мигрируем
          mainHistoryData.ads = json.hashes.map((hash, idx) => ({
            adId: `migrated_${String(idx + 1).padStart(3, '0')}`,
            hash,
            materialId: '',
            address: '',
            dateBegin: '',
            photoPath: '',
            timestamp: new Date().toISOString()
          }));
        } else {
          mainHistoryData.ads = Array.isArray(json.ads) ? json.ads : [];
        }
      } catch (e) {
        // Игнорируем ошибки чтения
      }
    }
  }
  
  // Объединяем основную историю с новыми записями
  const allAds = [...mainHistoryData.ads, ...newAds];
  
  if (materialId) {
    // Сохраняем во временный файл - будет перенесено в основной только после успешной генерации XML
    saveHistoryTmp(path.join(materialId, safeAddr), allAds);
  }
  
  // Результат показываем только в конце обработки всех фото локации
  // (будет показан в main после обработки всех исходников)
}

async function main() {
  try {
    const opts = parseArgs();
    const planPath = opts.plan || (fs.existsSync(DEFAULT_PLAN_PATH) ? DEFAULT_PLAN_PATH : '');
    let plan = null;
    let aliases = { materials: {}, photos: {} };
    if (planPath) {
      try {
        const raw = fs.readFileSync(planPath, 'utf8');
        const json = JSON.parse(raw);
        plan = json;
        aliases = json.aliases || aliases;
      } catch (e) {
        console.warn(`Не удалось прочитать план ${planPath}: ${e.message}`);
      }
    }

    let sources = [];
    if (opts.input) {
      sources = [{ path: opts.input, materialId: '', name: '', address: '' }];
    } else if (plan) {
      try {
        sources = collectSourcesFromPlan(plan, aliases);
        if (sources.length) {
          console.log(`Исходников найдено: ${sources.length}\n`);
        }
      } catch (e) {
        console.warn(`Не удалось разобрать план ${planPath}: ${e.message}`);
      }
    }

    if (!sources.length) {
      if (!fs.existsSync(DEFAULT_SOURCE_DIR)) {
        throw new Error(`Папка с исходниками не найдена: ${DEFAULT_SOURCE_DIR}`);
      }
      sources = fs
        .readdirSync(DEFAULT_SOURCE_DIR)
        .filter((name) => name.match(/\.(jpg|jpeg|png|webp)$/i))
        .map((name) => ({ path: path.join(DEFAULT_SOURCE_DIR, name), materialId: '', name: '', address: '' }));
      if (!sources.length) {
        throw new Error(`В ${DEFAULT_SOURCE_DIR} нет исходных файлов (jpg/png)`);
      }
      console.log(`--input не указан, используем все файлы из ${DEFAULT_SOURCE_DIR}`);
    }

    if (!opts.out) {
      opts.out = DEFAULT_VARIANTS_DIR;
    }

    // runLabel больше не используется - упрощенная структура без подпапок по датам
    const perSourceCounts = [];
    
    // Группируем источники по локации (materialId + safeAddress)
    const sourcesByLocation = new Map();
    for (const src of sources) {
      const locationKey = `${src.materialId || 'default'}|${src.safeAddress || 'default'}`;
      if (!sourcesByLocation.has(locationKey)) {
        sourcesByLocation.set(locationKey, []);
      }
      sourcesByLocation.get(locationKey).push(src);
    }
    
    // Подсчитываем общее количество фото по всем локациям для сквозной нумерации
    let totalPhotosGlobal = 0;
    for (const [locationKey, locationSources] of sourcesByLocation) {
      for (const src of locationSources) {
        const perFile = planPath ? (src.count !== undefined && src.count !== null ? src.count : opts.count) : opts.count;
        if (perFile > 0) {
          totalPhotosGlobal += perFile;
        }
      }
    }
    
    let globalPhotoIndex = 0;  // Глобальный индекс фото для сквозной нумерации
    
    // Обрабатываем каждую локацию как единый батч
    for (const [locationKey, locationSources] of sourcesByLocation) {
      let counterOffset = 0;  // Смещение счётчика для источников в батче
      
      // Подсчитываем общее количество фото для этой локации
      let totalPhotosInLocation = 0;
      for (const src of locationSources) {
        const perFile = planPath ? (src.count !== undefined && src.count !== null ? src.count : opts.count) : opts.count;
        if (perFile > 0) {
          totalPhotosInLocation += perFile;
        }
      }
      
      for (const src of locationSources) {
        // Используем src.count если он определен (включая 0), иначе opts.count
        const perFile = planPath ? (src.count !== undefined && src.count !== null ? src.count : opts.count) : opts.count;
        
        // Пропускаем источники с count=0
        if (perFile <= 0) {
          continue;
        }
        
        perSourceCounts.push(perFile);
        await generateVariants({
          ...opts,
          input: src.path,
          materialId: src.materialId,
          name: src.name,
          address: src.address,
          safeAddress: src.safeAddress,
          dateBegin: src.dateBegin,
          // Флагманский исходник (fs.jpeg) ТОЛЬКО для самого первого источника
          flagshipSource: counterOffset === 0 ? src.flagshipSource : null,
          count: perFile,
          counterOffset,  // Передаём смещение для продолжения счётчика
          totalPhotosInLocation,  // Общее количество фото для этой локации
          globalPhotoIndex,  // Глобальный индекс для нумерации
          totalPhotosGlobal  // Общее количество фото по всем локациям
        });
        counterOffset += perFile;  // Увеличиваем смещение на кол-во созданных фото
        globalPhotoIndex += perFile;  // Увеличиваем глобальный индекс
      }
      
      // Показываем итог для локации
      if (totalPhotosInLocation > 0) {
        const [matId, addr] = locationKey.split('|');
        const displayMat = matId.replace(/_/g, ' ');
        const displayAddr = addr.replace(/_/g, ' ');
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`ИТОГ ДЛЯ ЛОКАЦИИ:`);
        console.log(`📍 ${displayAddr}`);
        console.log(`   ${displayMat}`);
        console.log(`   Создано фото: ${totalPhotosInLocation}`);
        console.log(`${'═'.repeat(60)}\n`);
      }
    }
    const totalPhotos = perSourceCounts.reduce((sum, count) => sum + count, 0);
    // Подсчитываем уникальные исходники (по пути файла)
    const uniqueSources = new Set(sources.map(s => s.path));
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ ИТОГО РЕЗУЛЬТАТ ГЕНЕРАЦИИ:`);
    console.log(`   Обработано исходников: ${uniqueSources.size}`);
    console.log(`   Создано фото: ${totalPhotos}`);
    console.log(`${'═'.repeat(60)}\n`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
