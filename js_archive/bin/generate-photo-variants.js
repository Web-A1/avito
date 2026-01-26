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
import { randomBetween, randomInt, formatLabelDate, clampOpacity, loadImageBuffer, sanitizeName } from './lib/photo-variants/utils.js';
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
import { generateAdId, parseAdId } from '../src/constants/materialAliases.js';
import { loadWatermarkSettings, findWatermarkSettings } from './lib/photo-variants/watermark-settings.js';

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
    watermarkSettings: '',
    ignoreHistory: false,
    overshoot: 0,
    plan: '',
    runLabel: '',
    parallel: 0, // 0 = auto (6-10 в зависимости от размера изображения)
    flatOut: false // Сохранять все сгенерированные фото в одну общую папку out
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
    } else if ((arg === '--wm-settings' || arg === '--watermark-settings') && args[i + 1]) {
      opts.watermarkSettings = args[++i];
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
    } else if (arg === '--flat-out') {
      opts.flatOut = true;
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
  flagshipSource,  // Путь к предпочтительному чистому исходнику (с "fs" в имени)
  totalPhotosInLocation = 0,  // Общее количество фото для этой локации
  globalPhotoIndex = 0,  // Глобальный индекс фото (для нумерации 1/10, 2/10 и т.д.)
  totalPhotosGlobal = 0,  // Общее количество фото по всем локациям (для сквозной нумерации)
  flatOut = false,
  watermarkSettings = {}
}) {
  if (!input) throw new Error('Укажите --input путь к исходному фото');

  const baseBuffer = await loadImageBuffer(input);
  const baseImage = sharp(baseBuffer);
  const meta = await baseImage.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Не удалось прочитать размер исходного изображения');
  }
  const stats = await sharp(baseBuffer).stats();
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
  
  // Извлекаем только хэши для проверки дубликатов
  const historyHashes = historyData.ads.map(ad => ad.hash);

  const useAdId = !!(materialId && address);
  const adIdBaseTime = new Date();
  const getAdIdDate = (counter = 1) => new Date(adIdBaseTime.getTime() + (counter - 1) * 1000);
  const startingCounter = 1;
  const sourceBaseName = sanitizeName(path.basename(input, path.extname(input)) || 'photo');
  const hasMatchingFlagshipSource =
    flagshipSource &&
    path.basename(flagshipSource, path.extname(flagshipSource)) === path.basename(input, path.extname(input)) &&
    fs.existsSync(flagshipSource);
  const cleanSourcePath = hasMatchingFlagshipSource ? flagshipSource : input;
  const cleanSourceName = path.basename(cleanSourcePath);
  
  const smallImage = Math.min(meta.width, meta.height) < 1400;
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
  
  // Переменная для отслеживания реального исходника (может меняться для чистого фото)
  let actualSourceFileName = inputFileName;
  
  // Показываем информацию о текущем исходнике
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Материал: ${displayName}`);
  console.log(`Адрес: ${displayAddress}`);
  console.log(`Исходник: ${inputFileName}`);
  const hasHistory = historyHashes.length > 0;
  const hasCleanForSource = historyData.ads.some((ad) => {
    if (ad && ad.adId) {
      const parsed = parseAdId(ad.adId);
      if (parsed && parsed.sourceBase === sourceBaseName && parsed.counter === 1) {
        return true;
      }
    }
    const photoPath = typeof ad?.photoPath === 'string' ? ad.photoPath : '';
    if (!photoPath) return false;
    const base = photoPath.replace(/\.(jpg|jpeg|png)$/i, '');
    if (!base.startsWith(`${sourceBaseName}_`)) return false;
    const m = base.match(/_(\d+)$/);
    return m ? Number(m[1]) === 1 : false;
  });
  const allowCleanForSource = !hasCleanForSource;
  console.log(`История: ${historyHashes.length} фото`);
  if (totalPhotosInLocation > 0) {
    console.log(`Всего будет создано фото для этой локации: ${totalPhotosInLocation}`);
  }
  console.log(
    allowCleanForSource
      ? 'Первое фото этого исходника будет без искажений (только водяной знак)'
      : 'Для этого исходника чистое фото уже было — все фото будут с трансформациями'
  );
  console.log(`${'─'.repeat(60)}`);
  
  // Функция для получения имени файла (с поддержкой adId)
  function getFilenameForIndex(idx) {
    if (useAdId) {
      // Используем реальное время (с шагом в 1 сек на каждый counter) для имени
      const counter = startingCounter + idx;
      const photoDateTime = getAdIdDate(counter);
      const adId = generateAdId({
        sourceBase: sourceBaseName,
        materialId,
        address,
        dateBegin: photoDateTime,
        counter
      });
      return `${adId}.jpg`;
    }
    // Fallback: старый формат для обратной совместимости
    const baseName = sourceBaseName;
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
    const baseName = sourceBaseName;
    // Упрощенная структура: все фото в одной папке variants/ без подпапок по датам
    // Объявляем variantDir ДО блока if/else, чтобы он был доступен везде
    const variantDir = materialId
      ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddr, 'variants')
      : flatOut
        ? out
        : path.join(out, baseName, safeAddr, 'variants');
    
    if (baseOnly) {
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }

      const filename = getFilenameForIndex(idx);
      const outPath = path.join(variantDir, filename);
      let sourceBuffer = baseBuffer;
      let sourceMeta = meta;
      let sourcePalette = null;
      let sourceStats = stats;

      if (cleanSourcePath !== input) {
        const cleanName = path.basename(cleanSourcePath);
        console.log(`   Используем чистый исходник ${cleanName} (без искажений)`);
        actualSourceFileName = cleanName;
        sourceBuffer = await loadImageBuffer(cleanSourcePath);
        const sourceImage = sharp(sourceBuffer);
        sourceMeta = await sourceImage.metadata();
        sourceStats = await sharp(sourceBuffer).stats();
      } else {
        console.log(`   Используем текущий исходник ${path.basename(input)} (без искажений)`);
        actualSourceFileName = inputFileName;
      }

      let buf = sourceBuffer;
      if (textWatermark) {
        // АДАПТИВНЫЙ OPACITY на основе визуального контраста и детализированности
        const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(sourceStats);
        const wmSettings = findWatermarkSettings(watermarkSettings, actualSourceFileName || input);
        const effectiveTextWatermark = wmSettings?.textWatermark || textWatermark;
        const effectiveTextColor = wmSettings?.textColor || textColor;
        const settingsPatternOpacity = wmSettings && typeof wmSettings.patternOpacity === 'number'
          ? wmSettings.patternOpacity
          : undefined;
        const settingsTextOpacity = wmSettings && typeof wmSettings.textOpacity === 'number'
          ? wmSettings.textOpacity
          : undefined;
        sourcePalette = pickTextPalette(sourceStats, effectiveTextColor);
        
        const basePatternOpacity =
          typeof settingsPatternOpacity === 'number' && !Number.isNaN(settingsPatternOpacity) && settingsPatternOpacity > 0
            ? settingsPatternOpacity
            : typeof forcedPatternOpacity === 'number' && !Number.isNaN(forcedPatternOpacity) && forcedPatternOpacity > 0
            ? forcedPatternOpacity
            : 0.05;
        
        // Используем адаптивный диапазон для всех режимов
        // Фиксированный opacity: берём середину диапазона, без рандома
        const baseValue = (minOpacity + maxOpacity) / 2;
        const hasSettingsOpacity =
          typeof settingsTextOpacity === 'number' && !Number.isNaN(settingsTextOpacity) && settingsTextOpacity > 0;
        const textOpacity = hasSettingsOpacity
          // Для точечного оверрайда не ограничиваем адаптивным диапазоном, чтобы значение применялось буквально
          ? clampOpacity(settingsTextOpacity, 0.02, 1)
          : clampOpacity(
              typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
                ? forcedTextOpacity
                : baseValue,
              minOpacity,
              maxOpacity
            ) || minOpacity;
        const textSvg = buildTextPatternSvg(
          sourceMeta.width,
          sourceMeta.height,
          effectiveTextWatermark,
          textOpacity,
          sourcePalette.fill,
          sourcePalette.fill,
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
        const wmSettings = findWatermarkSettings(watermarkSettings, actualSourceFileName || input);
        const effectiveTextWatermark = wmSettings?.textWatermark || textWatermark;
        const effectiveTextColor = wmSettings?.textColor || textColor;
        const hasForcedOpacity =
          typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0;
        const hasSettingsOpacity =
          typeof wmSettings?.textOpacity === 'number' && !Number.isNaN(wmSettings.textOpacity) && wmSettings.textOpacity > 0;
        // Если opacity задано явно — используем фиксированное значение для стабильной видимости.
        // Иначе используем адаптивный диапазон на основе визуального контраста и детализированности.
        const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(stats);
        // Фиксированный opacity: середина диапазона, без рандома
        const baseValue = (minOpacity + maxOpacity) / 2;
        const textOpacity = hasSettingsOpacity
          ? clampOpacity(wmSettings.textOpacity, 0.02, 1)
          : hasForcedOpacity
          ? clampOpacity(forcedTextOpacity, minOpacity, maxOpacity)
          : clampOpacity(baseValue, minOpacity, maxOpacity) || minOpacity;

        const palette = pickTextPalette(stats, effectiveTextColor);

        // Для текста всегда используем точные размеры (он легковесный)
        const textPng = await sharp(
          buildTextPatternSvg(
            compWidth,
            compHeight,
            effectiveTextWatermark,
            textOpacity,
            palette.fill,
            palette.fill,
            palette.mode
          )
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

  if (allowCleanForSource) {
    console.log(`\n✅ Первая копия будет с одним водяным знаком, остальные — с трансформациями`);
  } else {
    console.log(`\n✅ Чистое фото для этого исходника уже есть — все копии с трансформациями`);
  }

  for (let i = 0; i < targetCount; i++) {
    if (i === 0 && allowCleanForSource) {
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
        ? generateAdId({
            sourceBase: sourceBaseName,
            materialId,
            address,
            dateBegin: getAdIdDate(adCounter),
            counter: adCounter
          })
        : null;
      
      // Определяем реальный исходник
      const displayedSource = originalIndex === 0 ? cleanSourceName : inputFileName;
      
      // Немедленный вывод без буферизации
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`ФОТО ${photoNumberLabel}`);
      if (adId) {
        console.log(`ID объявления: ${adId}`);
      }
      console.log(`Исходник: ${displayedSource}`);
      
      if (originalIndex === 0) {
        console.log(`Тип: Чистый вариант (только водяной знак)`);
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
    const generatedForValidation = generated.map((g, idx) => (idx === 0 ? null : g));
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
      ? generateAdId({
          sourceBase: sourceBaseName,
          materialId,
          address,
          dateBegin: getAdIdDate(counter),
          counter
        })
      : `legacy_${String(idx + 1).padStart(3, '0')}`;
    
    return {
      adId,
      hash: item.hash,
      sourceBase: sourceBaseName,
      isClean: allowCleanForSource && generated.indexOf(item) === 0,
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
    const settingsPath = opts.watermarkSettings
      ? path.resolve(opts.watermarkSettings)
      : path.join(process.cwd(), 'data', 'js_watermark-settings.json');
    const watermarkSettings = loadWatermarkSettings(settingsPath);
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
          flagshipSource: src.flagshipSource,
          count: perFile,
          totalPhotosInLocation,  // Общее количество фото для этой локации
          globalPhotoIndex,  // Глобальный индекс для нумерации
          totalPhotosGlobal,  // Общее количество фото по всем локациям
          watermarkSettings
        });
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
