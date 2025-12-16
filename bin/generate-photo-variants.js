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
import { loadHistory, saveHistory, filterActiveAds } from './lib/photo-variants/history.js';
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
  counterOffset = 0  // Смещение счётчика для батчевой обработки источников
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
  
  // Читаем Excel для фильтрации истории по активным объявлениям
  // (только для первого источника в батче)
  let activeAdIds = [];
  if (counterOffset === 0 && !ignoreHistory && materialId && historyData.ads.length > 0) {
    try {
      const excelPath = findLatestExcel(path.join(process.cwd(), 'data', 'current'));
      if (excelPath) {
        console.log(`📊 Чтение Excel: ${path.basename(excelPath)}`);
        const currentAds = await readCurrentAdsFromXlsx(excelPath);
        activeAdIds = currentAds.map(ad => ad.Id).filter(Boolean);
        console.log(`   Найдено ${activeAdIds.length} активных объявлений`);
        
        // Фильтруем историю - оставляем только активные объявления
        const beforeCount = historyData.ads.length;
        historyData.ads = filterActiveAds(historyData.ads, activeAdIds);
        const removed = beforeCount - historyData.ads.length;
        if (removed > 0) {
          console.log(`   🗑️  Удалено ${removed} неактивных объявлений из истории`);
        }
      } else {
        console.log(`⚠️  Excel не найден в data/current/ - история не фильтруется`);
      }
    } catch (e) {
      console.warn(`⚠️  Не удалось прочитать Excel: ${e.message}`);
      console.warn(`   История не фильтруется, продолжаем без Excel...`);
    }
  }
  
  // Извлекаем только хэши для проверки дубликатов
  const historyHashes = historyData.ads.map(ad => ad.hash);
  
  // Вычисляем стартовый счётчик для adId
  let startingCounter = 1;
  const useAdId = !!(dateBegin && materialId && address);
  
  if (useAdId) {
    // Ищем максимальный counter в истории только для ПЕРВОГО источника батча
    if (counterOffset === 0) {
      const matAlias = getMaterialAlias(materialId);
      const cityAlias = getCityAlias(address);
      // Форматируем дату (функция из materialAliases)
      const dateObj = typeof dateBegin === 'string' ? parseDateBeginLocal(dateBegin) : dateBegin;
      const dateLabel = dateObj ? formatDateLabelLocal(dateObj) : '000000';
      const prefix = `${matAlias}_${cityAlias}_${dateLabel}`;
      
      // Ищем максимальный counter в истории для этого префикса
      const matchingCounters = historyData.ads
        .filter(ad => ad.adId && ad.adId.startsWith(prefix))
        .map(ad => {
          const parsed = parseAdId(ad.adId);
          return parsed ? parsed.counter : 0;
        })
        .filter(c => c > 0);
      
      if (matchingCounters.length) {
        startingCounter = Math.max(...matchingCounters) + 1;
        console.log(`📊 Найдено ${matchingCounters.length} существующих adId с префиксом ${prefix}`);
      }
      console.log(`🔢 Начальный счётчик: ${startingCounter}`);
    } else {
      // Для не-первых источников батча просто используем смещение
      startingCounter = 1;
    }
    // Добавляем смещение для продолжения счётчика в батче источников
    startingCounter += counterOffset;
  }
  
  const smallImage = Math.min(meta.width, meta.height) < 1400;
  const flagshipPath = materialId ? path.join(baseDir, 'flagship.jpg') : '';
  
  // Вспомогательные функции для форматирования (копии из materialAliases)
  function parseDateBeginLocal(str) {
    if (!str) return null;
    const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!m) return null;
    const [_, dd, MM, yyyy] = m;
    return new Date(`${yyyy}-${MM}-${dd}`);
  }
  
  function formatDateLabelLocal(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '000000';
    const yy = String(date.getFullYear()).substring(2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  const targetCount = count;
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
  
  console.log(`${displayName} → ${displayAddress} (история: ${historyHashes.length} фото)`);
  console.log(`Кол-во: ${targetCount}\n`);
  
  // Функция для получения имени файла (с поддержкой adId)
  function getFilenameForIndex(idx) {
    if (useAdId) {
      const adId = generateAdId(materialId, address, dateBegin, startingCounter + idx);
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
        console.error(`❌ Ошибка генерации варианта ${idx} (попытка ${errorAttempt + 1}/${maxErrorRetries}): ${err.message}`);
        if (errorAttempt === maxErrorRetries - 1) {
          console.error(`⚠️  Не удалось создать вариант ${idx} после ${maxErrorRetries} попыток, пропускаем`);
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
    const labelValue = runLabel || formatLabelDate();
    const variantDir = materialId
      ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddr, 'variants', labelValue)
      : path.join(out, baseName, safeAddr, 'variants', labelValue);
    if (baseOnly) {
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }

      const filename = getFilenameForIndex(idx);
      const outPath = path.join(variantDir, filename);

      // СНАЧАЛА проверяем - есть ли уже готовый flagship.jpg?
      if (flagshipPath && fs.existsSync(flagshipPath)) {
        console.log(`   📌 Используется готовый flagship.jpg`);
        // Просто копируем готовый flagship (с водяным знаком)
        fs.copyFileSync(flagshipPath, outPath);
        const hash = await aHashFromBuffer(fs.readFileSync(flagshipPath));
        generated[idx] = { path: outPath, hash, attempts: (generated[idx]?.attempts || 0) + 1, filename };
        console.log(`#${idx + 1} - готово`);
        return;
      }

      // Если flagship.jpg НЕТ - создаём его
      if (generated[idx]?.path && fs.existsSync(generated[idx].path)) {
        try {
          fs.unlinkSync(generated[idx].path);
        } catch (e) {
          console.warn(`Не удалось удалить старый файл ${generated[idx].path}: ${e.message}`);
        }
      }

      // Создаём flagship: используем fs.jpeg если есть, иначе baseBuffer
      let sourceBuffer = baseBuffer;
      let sourceMeta = meta;
      let sourcePalette = palette;
      let sourceStats = stats;
      
      if (flagshipSource && fs.existsSync(flagshipSource)) {
        console.log(`   📌 Создаём flagship из ${path.basename(flagshipSource)}`);
        sourceBuffer = await loadImageBuffer(flagshipSource);
        // Пересчитываем meta, stats и palette для флагманского исходника
        const sourceImage = sharp(sourceBuffer);
        sourceMeta = await sourceImage.metadata();
        sourceStats = await sharp(sourceBuffer).stats();
        sourcePalette = pickTextPalette(sourceStats, textColor);
      } else {
        console.log(`   📌 Создаём flagship из текущего исходника`);
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
      fs.writeFileSync(outPath, buf);
      if (flagshipPath) {
        try {
          fs.writeFileSync(flagshipPath, buf);
        } catch (e) {
          console.warn(`Не удалось сохранить флагманский файл ${flagshipPath}: ${e.message}`);
        }
      }
      const hash = await aHashFromBuffer(buf);
      generated[idx] = { path: outPath, hash, attempts: (generated[idx]?.attempts || 0) + 1, filename };
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
        // АДАПТИВНЫЙ OPACITY на основе визуального контраста и детализированности
        const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(stats);
        
        // Используем адаптивный диапазон
        const baseValue = randomBetween(minOpacity, maxOpacity);
        
        const textOpacity =
          clampOpacity(
            typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
              ? forcedTextOpacity
              : baseValue,
            minOpacity,
            maxOpacity
          ) || minOpacity;

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
      const baseName = name || materialId || path.basename(input, path.extname(input));
      const labelValue = runLabel || formatLabelDate();
      const variantDir = materialId
        ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddr, 'variants', labelValue)
        : path.join(out, baseName, safeAddr, 'variants', labelValue);
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }
      const filename = getFilenameForIndex(idx);
      outPath = path.join(variantDir, filename);
      fs.writeFileSync(outPath, imgBuffer);
      imgHash = await aHashFromBuffer(imgBuffer);
    }

    if (!imgBuffer || !imgHash || !outPath) {
      throw new Error('Не удалось сгенерировать файл без артефактов по краям');
    }

    const filename = getFilenameForIndex(idx);
    generated[idx] = { path: outPath, hash: imgHash, attempts: (generated[idx]?.attempts || 0) + 1, filename };
    if (attempt === 0) {
      console.log(`#${idx + 1} - готово`);
    } else {
      console.log(`  🔄 #${idx + 1} - пересоздан (попытка ${attempt + 1}/${maxRetriesPerIndex})`);
    }
  }

  // Первый вариант всегда базовый (без трансформаций)
  await makeVariantSafe(0, true);
  
  // Последовательная генерация остальных вариантов
  // Надёжнее на слабом железе, проще отлаживать
  for (let i = 1; i < targetCount; i++) {
    await makeVariantSafe(i);
    
    // Убрали прогресс-бар для более чистого вывода
  }

  // Валидация и пересоздание дубликатов (параллельно батчами)
  // ИСКЛЮЧАЕМ idx=0 (flagship) из проверки - он всегда копия flagship.jpg
  for (let pass = 0; pass < maxGlobalPasses; pass++) {
    const generatedForValidation = generated.map((g, idx) => idx === 0 ? null : g);
    const closeOnes = findCloseIndices(generatedForValidation, historyHashes, HASH_THRESHOLD);
    const minDist = closeOnes.length ? closeOnes[0].minDist : null;
    if (minDist !== null) {
      console.log(
        `\n🔍 Проверка: найдено ${closeOnes.length} похожих фото (aHash ${minDist}) → пересоздаём...`
      );
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

  // Проверяем только успешно созданные варианты
  const successfulForValidation = generated.filter(g => g && g.hash);
  const remainingClose = findCloseIndices(successfulForValidation, historyHashes, HASH_THRESHOLD);
  if (remainingClose.length) {
    const minDist = remainingClose[0].minDist;
    console.warn(
      `\n⚠️  ВНИМАНИЕ: Обнаружено ${remainingClose.length} дубликатов (aHash < ${HASH_THRESHOLD}) после ${maxRetriesPerIndex} попыток!`
    );
    console.warn(`   Минимальный aHash: ${minDist}`);
    console.warn(`\n   Список дубликатов:`);
    remainingClose.forEach((item, idx) => {
      const fileName = path.basename(successfulForValidation[item.index].path);
      console.warn(`   ${idx + 1}. ${fileName} (aHash: ${item.minDist})`);
    });
    console.warn(`\n   Рекомендация: увеличьте разброс трансформаций или проверьте исходное фото.\n`);
  } else {
    console.log(`\n✅ Все фото уникальны!`);
  }

  // Фильтруем null значения (неудачные варианты) перед сохранением истории
  const successfulGenerated = generated.filter(g => g && g.hash);
  
  // Создаём новые записи в формате {adId, hash, ...metadata}
  const newAds = successfulGenerated.map((item, idx) => {
    const adId = useAdId 
      ? generateAdId(materialId, address, dateBegin, startingCounter + generated.indexOf(item))
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
  const allAds = [...historyData.ads, ...newAds];
  
  if (materialId) {
    saveHistory(path.join(materialId, safeAddr), allAds);
  }
  
  const failedCount = generated.length - successfulGenerated.length;
  console.log(`🎉 Готово! Создано ${successfulGenerated.length} фото${failedCount > 0 ? ` (${failedCount} с ошибками)` : ''} (история: ${allAds.length} объявлений)`);
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

    const runLabel = opts.runLabel || formatLabelDate();
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
    
    // Обрабатываем каждую локацию как единый батч
    for (const [locationKey, locationSources] of sourcesByLocation) {
      let counterOffset = 0;  // Смещение счётчика для источников в батче
      
      for (const src of locationSources) {
        const perFile = planPath ? src.count || opts.count : opts.count;
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
          runLabel,
          count: perFile,
          counterOffset  // Передаём смещение для продолжения счётчика
        });
        counterOffset += perFile;  // Увеличиваем смещение на кол-во созданных фото
      }
    }
    console.log(
      `\nИтого: обработано ${sources.length} исходников, создано фото: [${perSourceCounts.join(', ')}]`
    );
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
