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
  sanitizeName
} from './lib/photo-variants/utils.js';
import {
  createNoiseBuffer,
  buildDotsSvg,
  buildGradientSvg,
  buildLightSpotsSvg,
  pickTextPalette,
  buildTextPatternSvg
} from './lib/photo-variants/patterns.js';
import { aHashFromBuffer, hamming, pruneByHash, findCloseIndices } from './lib/photo-variants/hashing.js';
import { loadHistory, saveHistory } from './lib/photo-variants/history.js';
import { applyTransformations } from './lib/photo-variants/transformations.js';
import { collectSourcesFromPlan } from './lib/photo-variants/plan.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    input: '',
    out: '',
    count: 50,
    patternOpacity: '',
    textWatermark: '',
    textOpacity: '',
    textColor: '',
    ignoreHistory: false,
    overshoot: 0,
    plan: '',
    runLabel: ''
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
  runLabel,
  name
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
  const safeAddress = sanitizeName(address || 'default');
  const baseDir = materialId ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddress) : out;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  const historyHashes = ignoreHistory || !materialId ? [] : loadHistory(path.join(materialId, safeAddress));
  const smallImage = Math.min(meta.width, meta.height) < 1400;
  const flagshipPath = materialId ? path.join(baseDir, 'flagship.jpg') : '';

  const targetCount = count;
  const maxRetriesPerIndex = 1;
  const maxGlobalPasses = 2;
  const overshootSafe = Number.isFinite(overshoot) && overshoot > 0 ? overshoot : 0;
  const zoomBoost = 1 + Math.min(overshootSafe, 0.05); // минимальный вклад overshoot
  const angleBoost = 1 + Math.min(overshootSafe, 0.05);
  const generated = new Array(targetCount);
  let aggressiveMode = false;

  console.log(
    `Генерируем ${targetCount} шт (materialId=${materialId || 'N/A'}, address=${safeAddress}, history=${
      historyHashes.length
    } хэшей)${smallImage ? ' [бережный режим для малого исходника]' : ''}`
  );

  async function makeVariant(idx, baseOnly = false) {
    const attempt = generated[idx]?.attempts || 0;
    const attemptBoost = aggressiveMode ? 1.2 : 1;
    const baseName = name || materialId || path.basename(input, path.extname(input));
    const labelValue = runLabel || formatLabelDate();
    const variantDir = materialId
      ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddress, 'variants', labelValue)
      : path.join(out, baseName, safeAddress, 'variants', labelValue);
    if (baseOnly) {
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }
      if (flagshipPath && fs.existsSync(flagshipPath)) {
        const perFileTime = formatLabelDate(new Date());
        const outPath = path.join(variantDir, `${baseName}_${perFileTime}_${String(idx + 1).padStart(3, '0')}.jpg`);
        fs.copyFileSync(flagshipPath, outPath);
        const hash = await aHashFromBuffer(fs.readFileSync(flagshipPath));
        generated[idx] = { path: outPath, hash, attempts: (generated[idx]?.attempts || 0) + 1 };
        console.log(`  [=] ${path.basename(outPath)} базовый (использован существующий флагман)`);
        return;
      }

      if (generated[idx]?.path && fs.existsSync(generated[idx].path)) {
        try {
          fs.unlinkSync(generated[idx].path);
        } catch (e) {
          console.warn(`Не удалось удалить старый файл ${generated[idx].path}: ${e.message}`);
        }
      }
      const perFileTime = formatLabelDate(new Date());
      const outPath = path.join(variantDir, `${baseName}_${perFileTime}_${String(idx + 1).padStart(3, '0')}.jpg`);

      let buf = baseBuffer;
      if (textWatermark) {
        const basePatternOpacity =
          typeof forcedPatternOpacity === 'number' && !Number.isNaN(forcedPatternOpacity) && forcedPatternOpacity > 0
            ? forcedPatternOpacity
            : 0.05;
        const minOpacity = palette.mode === 'bright' ? 0.12 : palette.mode === 'dark' ? 0.07 : 0.08;
        const maxOpacity = palette.mode === 'bright' ? 0.18 : palette.mode === 'dark' ? 0.14 : 0.12;
        const textOpacity =
          clampOpacity(
            typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
              ? forcedTextOpacity
              : basePatternOpacity,
            minOpacity,
            maxOpacity
          ) || basePatternOpacity;
        const textSvg = buildTextPatternSvg(
          meta.width,
          meta.height,
          textWatermark,
          textOpacity,
          palette.fill,
          palette.stroke || palette.fill,
          palette.mode
        );
        buf = await sharp(baseBuffer)
          .composite([
            {
              input: textSvg,
              top: 0,
              left: 0,
              blend: 'over',
              opacity: textOpacity
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
      generated[idx] = { path: outPath, hash, attempts: (generated[idx]?.attempts || 0) + 1 };
      console.log(`  [=] ${path.basename(outPath)} базовый (без геометрии)`);
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
        angleBoost
      });

      let baseTransformed = transformResult.pipeline;
      const compWidth = transformResult.finalWidth;
      const compHeight = transformResult.finalHeight;
      const { angle, scale, flipped } = transformResult.metadata;

      console.log(
        `    [geom] crop ${compWidth}x${compHeight}, angle=${angle.toFixed(2)}°, scale=${scale.toFixed(3)}, flipped=${flipped}`
      );

      const quality = 90;

      const basePatternOpacity =
        typeof forcedPatternOpacity === 'number' && !Number.isNaN(forcedPatternOpacity) && forcedPatternOpacity > 0
          ? forcedPatternOpacity
          : 0.05;

      const cacheKey = `${compWidth}x${compHeight}`;
      const patternCache = makeVariant.patternCache || (makeVariant.patternCache = new Map());
      let cached = patternCache.get(cacheKey);
      if (!cached) {
        const patternOpacity =
          clampOpacity(basePatternOpacity * randomBetween(0.7, 1.4), 0.02, 0.12) || basePatternOpacity;
        const noiseSpread = Math.min(25, Math.max(6, Math.round(patternOpacity * 60)));
        const noiseBuf = createNoiseBuffer(compWidth, compHeight, noiseSpread);
        const noisePng = await sharp(noiseBuf, {
          raw: { width: compWidth, height: compHeight, channels: 4 }
        })
          .png()
          .toBuffer();
        const dotsPng = await sharp(buildDotsSvg(compWidth, compHeight)).png().toBuffer();
        const gradPng = await sharp(buildGradientSvg(compWidth, compHeight)).png().toBuffer();
        const lightPng = await sharp(buildLightSpotsSvg(compWidth, compHeight)).png().toBuffer();
        cached = {
          patternOpacity,
          noisePng,
          dotsPng,
          gradPng,
          lightPng
        };
        patternCache.set(cacheKey, cached);
      }

      const layerList = [
        { name: 'noise', buffer: cached.noisePng, blend: 'soft-light', opacity: cached.patternOpacity },
        { name: 'gradient', buffer: cached.gradPng, blend: 'soft-light', opacity: Math.min(1, cached.patternOpacity * 0.6) },
        { name: 'lightSpots', buffer: cached.lightPng, blend: 'soft-light', opacity: Math.min(0.35, cached.patternOpacity * 3) },
        { name: 'dots', buffer: cached.dotsPng, blend: 'over', opacity: Math.min(1, cached.patternOpacity * 0.6) }
      ];

      if (textWatermark) {
        const minOpacity = palette.mode === 'bright' ? 0.1 : palette.mode === 'dark' ? 0.07 : 0.05;
        const maxOpacity = palette.mode === 'bright' ? 0.15 : palette.mode === 'dark' ? 0.14 : 0.09;
        const textOpacity =
          clampOpacity(
            typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
              ? forcedTextOpacity
              : cached.patternOpacity,
            minOpacity,
            maxOpacity
          ) || cached.patternOpacity;

        const textCache = makeVariant.textCache || (makeVariant.textCache = new Map());
        const textKey = `${cacheKey}|${textWatermark}|${textOpacity.toFixed(3)}|${palette.fill}|${palette.stroke || ''}|${palette.mode}`;
        let textPng = textCache.get(textKey);
        if (!textPng) {
          textPng = await sharp(
            buildTextPatternSvg(compWidth, compHeight, textWatermark, textOpacity, palette.fill, palette.stroke || palette.fill, palette.mode)
          )
            .png()
            .toBuffer();
          textCache.set(textKey, textPng);
        }
        layerList.push({
          name: 'text',
          buffer: textPng,
          blend: 'over',
          opacity: textOpacity
        });
      }

      console.log(`    [composite] base ${compWidth}x${compHeight}, layers=${layerList.length}`);

      const composites = layerList.map((layer) => ({
        input: layer.buffer,
        blend: layer.blend,
        opacity: layer.opacity
      }));

      const baseBuf = await baseTransformed.png().toBuffer();
      const withLayers = await sharp(baseBuf).composite(composites).toBuffer();

      // Прозрачность уже убрана flatten'ом после rotate, можем сразу в JPEG
      imgBuffer = await sharp(withLayers)
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (generated[idx]?.path && fs.existsSync(generated[idx].path)) {
        try {
          fs.unlinkSync(generated[idx].path);
        } catch (e) {
          console.warn(`Не удалось удалить старый файл ${generated[idx].path}: ${e.message}`);
        }
      }
      const perFileTime = formatLabelDate(new Date());
      const baseName = name || materialId || path.basename(input, path.extname(input));
      const labelValue = runLabel || formatLabelDate();
      const variantDir = materialId
        ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddress, 'variants', labelValue)
        : path.join(out, baseName, safeAddress, 'variants', labelValue);
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }
      outPath = path.join(variantDir, `${baseName}_${perFileTime}_${String(idx + 1).padStart(3, '0')}.jpg`);
      fs.writeFileSync(outPath, imgBuffer);
      imgHash = await aHashFromBuffer(imgBuffer);
    }

    if (!imgBuffer || !imgHash || !outPath) {
      throw new Error('Не удалось сгенерировать файл без артефактов по краям');
    }

    generated[idx] = { path: outPath, hash: imgHash, attempts: (generated[idx]?.attempts || 0) + 1 };
    if (attempt === 0) {
      console.log(`  [+] ${path.basename(outPath)} готов (attempt ${attempt + 1})`);
    } else {
      console.log(`  [~] ${path.basename(outPath)} пересоздан (attempt ${attempt + 1})`);
    }
  }

  await makeVariant(0, true);
  for (let i = 1; i < targetCount; i++) {
    await makeVariant(i);
  }

  for (let pass = 0; pass < maxGlobalPasses; pass++) {
    const closeOnes = findCloseIndices(generated, historyHashes, HASH_THRESHOLD);
    const minDist = closeOnes.length ? closeOnes[0].minDist : null;
    if (minDist !== null) {
      console.log(
        `Пасс ${pass + 1}: всего ${closeOnes.length} кандидатов, минимальная дистанция ${minDist} (порог ${HASH_THRESHOLD})`
      );
      if (minDist === 0) aggressiveMode = true;
    }
    const indicesToRegen = closeOnes
      .filter((c) => (generated[c.index]?.attempts || 0) < maxRetriesPerIndex)
      .map((c) => c.index);
    if (!indicesToRegen.length) break;
    const unique = Array.from(new Set(indicesToRegen));
    for (const idx of unique) {
      await makeVariant(idx);
    }
  }

  const remainingClose = findCloseIndices(generated, historyHashes, HASH_THRESHOLD);
  if (remainingClose.length) {
    const minDist = remainingClose[0].minDist;
    console.warn(
      `Внимание: минимальная дистанция между вариантами/историей ${minDist} (< ${HASH_THRESHOLD}), увеличьте разброс трансформаций при необходимости.`
    );
  } else {
    console.log(`Все варианты удовлетворяют порогу ${HASH_THRESHOLD} по aHash.`);
  }

  const newHistory = Array.from(new Set([...historyHashes, ...generated.map((g) => g.hash)]));
  if (materialId) {
    saveHistory(path.join(materialId, safeAddress), newHistory);
  }
  console.log(`Готово: сохранено ${generated.length} файлов, обновлено хэшей истории: ${newHistory.length}`);
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
          console.log(`Исходники из плана: найдено файлов ${sources.length}`);
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
    for (const src of sources) {
      const perFile = planPath ? src.count || opts.count : opts.count;
      perSourceCounts.push(perFile);
      await generateVariants({
        ...opts,
        input: src.path,
        materialId: src.materialId,
        name: src.name,
        address: src.address,
        runLabel,
        count: perFile
      });
    }
    console.log(
      `Готово: сгенерированы варианты для ${sources.length} исходников, по [${perSourceCounts.join(', ')}] шт.`
    );
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
