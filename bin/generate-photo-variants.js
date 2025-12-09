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
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PHOTOS_ROOT = path.resolve(__dirname, '..', 'data', 'photos');
const DEFAULT_SOURCE_DIR = path.join(DEFAULT_PHOTOS_ROOT, 'source');
const DEFAULT_VARIANTS_DIR = path.join(DEFAULT_PHOTOS_ROOT, 'variants');
const DEFAULT_PLAN_PATH = path.resolve(__dirname, '..', 'data', 'plan.json');

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

function sumAdsFromPlan(planPath) {
  try {
    const raw = fs.readFileSync(planPath, 'utf8');
    const json = JSON.parse(raw);
    const tasks = json.tasks || [];
    let total = 0;
    tasks.forEach((t) => {
      if (Array.isArray(t.slots) && t.slots.length) {
        t.slots.forEach((slot) => {
          if (Number.isFinite(slot.count)) total += slot.count;
        });
      } else if (Number.isFinite(t.count)) {
        total += t.count;
      }
    });
    return total || 0;
  } catch (e) {
    console.warn(`Не удалось прочитать план ${planPath}: ${e.message}`);
    return 0;
  }
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatLabelDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(d.getDate());
  const MM = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${dd}.${MM}.${yyyy} ${hh}-${mm}-${ss}`;
}

async function loadImageBuffer(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Файл не найден: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

function createNoiseBuffer(width, height, spread = 12) {
  const size = width * height * 4;
  const data = new Uint8ClampedArray(size);
  for (let i = 0; i < size; i += 4) {
    const delta = Math.floor(randomBetween(-spread, spread));
    const val = Math.max(0, Math.min(255, 128 + delta));
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = 255;
  }
  return Buffer.from(data);
}

function buildDotsSvg(width, height) {
  const dotsCount = randomInt(6, 14);
  const rMin = 1;
  const rMax = 3.5;
  let circles = '';
  for (let i = 0; i < dotsCount; i++) {
    const r = randomBetween(rMin, rMax);
    const cx = randomBetween(0, width);
    const cy = randomBetween(0, height);
    const opacity = randomBetween(0.04, 0.08);
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" opacity="${opacity}" />`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`);
}

function buildGradientSvg(width, height) {
  const angle = randomBetween(0, 360);
  const start = randomBetween(0.05, 0.12);
  const end = randomBetween(0.0, 0.04);
  const color1 = `rgba(255,255,255,${start})`;
  const color2 = `rgba(0,0,0,${end})`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="g" gradientTransform="rotate(${angle})">
          <stop offset="0%" stop-color="${color1}" />
          <stop offset="100%" stop-color="${color2}" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)" />
    </svg>`
  );
}

function buildLightSpotsSvg(width, height) {
  const spots = randomInt(3, 7);
  let circles = '';
  for (let i = 0; i < spots; i++) {
    const r = randomBetween(10, 26);
    const cx = randomBetween(0, width);
    const cy = randomBetween(0, height);
    const op = randomBetween(0.05, 0.12);
    const blur = randomBetween(2, 6);
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" opacity="${op}" filter="url(#bl${i})" />`;
    circles += `<filter id="bl${i}"><feGaussianBlur stdDeviation="${blur}" /></filter>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`);
}

function clampOpacity(value, min = 0.02, max = 0.15) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(max, Math.max(min, value));
}

async function aHashFromBuffer(buffer, size = 16) {
  const { data } = await sharp(buffer)
    .greyscale()
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
  let bits = '';
  for (const v of data) bits += v >= avg ? '1' : '0';
  return bits;
}

function hamming(a, b) {
  let dist = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

function pruneByHash(variants, targetCount, origHash, warnDistance = 14) {
  if (!variants.length) return variants;
  let current = [...variants];
  // Удаляем самые близкие, пока не выйдем на нужное количество
  while (current.length > targetCount) {
    let minDist = Infinity;
    let victimIdx = -1;
    for (let i = 0; i < current.length; i++) {
      let nearest = origHash ? hamming(current[i].hash, origHash) : Infinity;
      for (let j = 0; j < current.length; j++) {
        if (i === j) continue;
        const d = hamming(current[i].hash, current[j].hash);
        if (d < nearest) nearest = d;
      }
      if (nearest < minDist) {
        minDist = nearest;
        victimIdx = i;
      }
    }
    if (victimIdx >= 0) {
      const [victim] = current.splice(victimIdx, 1);
      try {
        fs.unlinkSync(victim.path);
      } catch (e) {
        console.warn(`Не удалось удалить файл ${victim.path}: ${e.message}`);
      }
    } else {
      break;
    }
  }
  // Проверяем минимальную дистанцию после отбора, чтобы понимать запас уникальности
  if (current.length) {
    let minDist = Infinity;
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const d = hamming(current[i].hash, current[j].hash);
        if (d < minDist) minDist = d;
      }
    }
    if (minDist < warnDistance) {
      console.warn(`Внимание: минимальная дистанция между вариантами всего ${minDist}, можно поднять overshoot или диапазон трансформаций.`);
    }
  }
  return current;
}

function findCloseIndices(items, historyHashes, threshold) {
  const result = [];
  for (let i = 0; i < items.length; i++) {
    let minDist = Infinity;
    // История
    historyHashes.forEach((h) => {
      const d = hamming(items[i].hash, h);
      if (d < minDist) minDist = d;
    });
    // Другие элементы
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const d = hamming(items[i].hash, items[j].hash);
      if (d < minDist) minDist = d;
    }
    if (minDist < threshold) result.push({ index: i, minDist });
  }
  return result.sort((a, b) => a.minDist - b.minDist);
}

function loadHistory(materialId) {
  if (!materialId) return [];
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialId, 'hashes.json');
  if (!fs.existsSync(historyPath)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    return Array.isArray(json.hashes) ? json.hashes : [];
  } catch {
    return [];
  }
}

function saveHistory(materialId, hashes) {
  if (!materialId) return;
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialId, 'hashes.json');
  try {
    fs.writeFileSync(historyPath, JSON.stringify({ hashes }, null, 2), 'utf8');
  } catch (e) {
    console.warn(`Не удалось сохранить хэши истории для ${materialId}: ${e.message}`);
  }
}

function sanitizeName(str = '') {
  return str
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase() || 'default';
}

function pickTextPalette(stats, forcedColor) {
  const lc = forcedColor ? forcedColor.trim().toLowerCase() : '';
  const isDarkForced = lc === '#000' || lc === 'black' || lc === '000000';
  if (forcedColor) {
    return { fill: forcedColor, stroke: 'rgba(0,0,0,0)', mode: 'custom' };
  }
  // Всегда белый текст, тёмная обводка; режим влияет только на прозрачность/силу обводки
  const channels = stats?.channels || [];
  const means = channels.slice(0, 3).map((c) => c?.mean || 128);
  const avg = means.reduce((sum, v) => sum + v, 0) / (means.length || 1);
  if (avg >= 170) return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'bright' };
  if (avg <= 110) return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'dark' };
  return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'mid' };
}

function buildTextPatternSvg(width, height, text, opacity, fillColor, strokeColor, mode = 'mid') {
  const fontSize = Math.round(width * randomBetween(0.022, 0.032)); // уменьшаем размер водяного знака
  const wordWidthFactor = 4.8; // запас по длине слова
  const cellSize = Math.round(fontSize * wordWidthFactor * randomBetween(0.94, 1.02));
  const tileW = cellSize * 2.7; // плотнее горизонтальный шаг, но с запасом
  const tileH = cellSize * 1.65; // плотный вертикальный шаг с запасом под наклон
  const rotation = Math.random() < 0.5 ? randomBetween(-22, -18) : randomBetween(18, 22); // умеренный наклон паттерна
  const modeSettings =
    {
      bright: { boost: 1.5, fillMin: 0.5, fillMax: 0.8, strokeMin: 0, strokeMax: 0, strokeW: 0 },
      mid: { boost: 0.85, fillMin: 0.28, fillMax: 0.5, strokeMin: 0, strokeMax: 0, strokeW: 0 }, // ослабить средние (песчаные)
      dark: { boost: 0.85, fillMin: 0.32, fillMax: 0.62, strokeMin: 0, strokeMax: 0, strokeW: 0 }, // ещё чуть ярче тёмные
      custom: { boost: 1.0, fillMin: 0.4, fillMax: 0.7, strokeMin: 0, strokeMax: 0, strokeW: 0 }
    }[mode] || { boost: 1.0, fillMin: 0.4, fillMax: 0.7, strokeMin: 0, strokeMax: 0, strokeW: 0 };
  const fillOpacity = Math.min(
    modeSettings.fillMax,
    Math.max(modeSettings.fillMin, opacity * 1.5 * modeSettings.boost)
  );
  const strokeOpacity = strokeColor
    ? Math.min(
        modeSettings.strokeMax,
        Math.max(modeSettings.strokeMin, opacity * 2.6 * modeSettings.boost)
      )
    : 0;
  const strokeWidth = modeSettings.strokeW ? Math.max(0.6, fontSize * modeSettings.strokeW) : 0;
  const pad = fontSize * 1.1; // запас от краёв тайла, чтобы не обрезало буквы
  const offsetX = randomBetween(-tileW * 0.5, tileW * 0.5);
  const offsetY = randomBetween(-tileH * 0.5, tileH * 0.5);
  // Шахматный порядок: слово в первой строке слева, во второй строке — справа, с равным вертикальным шагом
  const x1 = pad + tileW * 0.3;
  const y1 = pad + fontSize * 0.95; // baseline с запасом по верхней кромке
  const x2 = pad + tileW * 0.7;
  const y2 = y1 + tileH / 2; // половина тайла, чтобы дистанция между строками была одинаковой
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern id="tp" width="${tileW}" height="${tileH}" x="${offsetX}" y="${offsetY}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotation})">
          <text x="${x1}" y="${y1}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="${strokeColor || fillColor}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" font-weight="600">${text}</text>
          <text x="${x2}" y="${y2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="${strokeColor || fillColor}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" font-weight="600">${text}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#tp)" />
    </svg>`
  );
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
  const maxRetriesPerIndex = 5;
  const maxGlobalPasses = 10;
  const HASH_THRESHOLD = 8;
  const generated = new Array(targetCount);
  let aggressiveMode = false;

  console.log(
    `Генерируем ${targetCount} шт (materialId=${materialId || 'N/A'}, address=${safeAddress}, history=${historyHashes.length} хэшей)${
      smallImage ? ' [бережный режим для малого исходника]' : ''
    }`
  );

  async function makeVariant(idx, baseOnly = false) {
    const attempt = generated[idx]?.attempts || 0;
    const baseBoost = aggressiveMode ? 1.8 : 1;
    const attemptBoost = baseBoost + attempt * 0.45; // при регенерациях увеличиваем разброс
    const baseName = (name || materialId) || path.basename(input, path.extname(input));
    const labelValue = runLabel || formatLabelDate();
    const variantDir = materialId
      ? path.join(DEFAULT_PHOTOS_ROOT, materialId, safeAddress, 'variants', labelValue)
      : path.join(out, baseName, safeAddress, 'variants', labelValue);
    if (baseOnly) {
      // Базовый вариант без геометрических/цветовых изменений — только ВЗ.
      // Делается один раз на товар+адрес, потом переиспользуется.
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }
      // Если уже есть флагманский файл — копируем его в текущую папку запуска и используем хэш
      if (flagshipPath && fs.existsSync(flagshipPath)) {
        const perFileTime = formatLabelDate(new Date());
        const outPath = path.join(variantDir, `${baseName}_${perFileTime}_${String(idx + 1).padStart(3, '0')}.jpg`);
        fs.copyFileSync(flagshipPath, outPath);
        const hash = await aHashFromBuffer(fs.readFileSync(flagshipPath));
        generated[idx] = { path: outPath, hash, attempts: (generated[idx]?.attempts || 0) + 1 };
        console.log(`  [=] ${path.basename(outPath)} базовый (использован существующий флагман)`);
        return;
      }

      // Удаляем предыдущий файл этого индекса, если он есть, чтобы не накапливать лишние варианты
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
        const minOpacity =
          palette.mode === 'bright' ? 0.12 : palette.mode === 'dark' ? 0.07 : 0.08;
        const maxOpacity =
          palette.mode === 'bright' ? 0.18 : palette.mode === 'dark' ? 0.14 : 0.12;
        const textOpacity =
          clampOpacity(
            typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
              ? forcedTextOpacity
              : patternOpacity,
            minOpacity,
            maxOpacity
          ) || patternOpacity;
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
    // Размер итогового изображения: ресайз с учётом размера исходника (меньшие — более бережно)
    const scaleMin = smallImage ? 0.96 : 0.92;
    const scaleMax = smallImage ? 1.04 : 1.08;
    const scale = randomBetween(scaleMin, scaleMax);
    const targetWidth = Math.max(32, Math.round(meta.width * scale));
    const targetHeight = Math.max(32, Math.round(meta.height * scale));

    // Рандомные трансформации
    const rotateBase = smallImage ? 6 : 8;
    const rotateRange = rotateBase * attemptBoost;
    const rotateDeg = randomBetween(-rotateRange, rotateRange);
    const shouldFlop = Math.random() < 0.5; // горизонтальный флоп (отзеркаливание)

    // Очень лёгкая цветокоррекция, чтобы не уводить цвет песка (чуть шире при повторных попытках)
    const clampRange = (min, max) => [Math.max(min, 0.85), Math.min(max, 1.15)];
    const [bMin, bMax] = clampRange(0.95 / attemptBoost, 1.05 * attemptBoost);
    const [sMin, sMax] = clampRange(0.94 / attemptBoost, 1.06 * attemptBoost);
    const [cMin, cMax] = clampRange(0.95 / attemptBoost, 1.08 * attemptBoost);
    const hueRange = Math.max(3, Math.round(3 * attemptBoost));
    const brightness = randomBetween(bMin, bMax);
    const saturation = randomBetween(sMin, sMax);
    const hue = randomInt(-hueRange, hueRange);
    const contrast = randomBetween(cMin, cMax);

    // JPEG качество
    const quality = randomInt(88, 96);

    // Ресайз + поворот + последующий кроп до нужного размера (слегка увеличиваем, чтобы убрать полосы)
    const angleRad = (rotateDeg * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const aspect = targetHeight / targetWidth;
    // Масштаб, чтобы повернутый прямоугольник покрывал целевые размеры (нормализовано по ширине/высоте)
    const scaleX = Math.abs(cos) + aspect * Math.abs(sin); // boundingWidth / W
    const scaleY = Math.abs(cos) + Math.abs(sin) / aspect; // boundingHeight / H
    // Чем сильнее поворот, тем больше зум, чтобы исключить пустые углы
    const overscale = Math.max(
      smallImage ? 1.3 : 1.4,
      Math.max(scaleX, scaleY) * (aggressiveMode ? 1.18 : 1.12) + (smallImage ? 0.12 : 0.18)
    );
    const oversizeWidth = Math.round(targetWidth * overscale);
    const oversizeHeight = Math.round(targetHeight * overscale);

    let img = sharp(baseBuffer)
      .resize(oversizeWidth, oversizeHeight, { fit: 'cover', position: 'center' })
      .rotate(rotateDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extract({
        left: Math.max(0, Math.floor((oversizeWidth - targetWidth) / 2)),
        top: Math.max(0, Math.floor((oversizeHeight - targetHeight) / 2)),
        width: targetWidth,
        height: targetHeight
      });

    if (shouldFlop) img = img.flop();

    img = img.modulate({ brightness, saturation, hue }).linear(contrast, 128 * (1 - contrast));

    // Комбинированный паттерн: шум + точки + легкий градиент
    const basePatternOpacity =
      typeof forcedPatternOpacity === 'number' && !Number.isNaN(forcedPatternOpacity) && forcedPatternOpacity > 0
        ? forcedPatternOpacity
        : 0.05;
    const patternOpacity =
      clampOpacity(basePatternOpacity * randomBetween(0.7, 1.4), 0.02, 0.12) || basePatternOpacity; // умеренно по умолчанию с разбросом
    const noiseSpread = Math.min(25, Math.max(6, Math.round(patternOpacity * 60)));
    const noiseBuf = createNoiseBuffer(targetWidth, targetHeight, noiseSpread);
    const dotsSvg = buildDotsSvg(targetWidth, targetHeight);
    const gradientSvg = buildGradientSvg(targetWidth, targetHeight);
    const lightSpotsSvg = buildLightSpotsSvg(targetWidth, targetHeight);

    const composites = [
      {
        input: noiseBuf,
        raw: { width: targetWidth, height: targetHeight, channels: 4 },
        blend: 'soft-light',
        opacity: patternOpacity
      },
      {
        input: gradientSvg,
        top: 0,
        left: 0,
        blend: 'soft-light',
        opacity: Math.min(1, patternOpacity * 0.6)
      },
      {
        input: lightSpotsSvg,
        top: 0,
        left: 0,
        blend: 'soft-light',
        opacity: Math.min(0.35, patternOpacity * 3)
      },
      {
        input: dotsSvg,
        top: 0,
        left: 0,
        blend: 'over',
        opacity: Math.min(1, patternOpacity * 0.6)
      }
    ];

    // Текстовый водяной знак, если задан
    if (textWatermark) {
      const minOpacity =
        palette.mode === 'bright' ? 0.1 : palette.mode === 'dark' ? 0.07 : 0.05; // mid ослабляем
      const maxOpacity =
        palette.mode === 'bright' ? 0.15 : palette.mode === 'dark' ? 0.14 : 0.09;
      const textOpacity =
        clampOpacity(
          typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
            ? forcedTextOpacity
            : patternOpacity,
          minOpacity,
          maxOpacity
        ) || patternOpacity; // мягкая прозрачность
      const textSvg = buildTextPatternSvg(
        targetWidth,
        targetHeight,
        textWatermark,
        textOpacity,
        palette.fill,
        palette.stroke || palette.fill,
        palette.mode
      );
      composites.push({
        input: textSvg,
        top: 0,
        left: 0,
        blend: 'over',
        opacity: textOpacity // управляем прозрачностью здесь
      });
    }

    img = await img
      .composite(composites)
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();

    // Добавляем к имени индекс и качество для прозрачности изменений
    if (!fs.existsSync(variantDir)) {
      fs.mkdirSync(variantDir, { recursive: true });
    }
    // Удаляем предыдущий файл этого индекса, если он есть, чтобы не накапливать лишние варианты
    if (generated[idx]?.path && fs.existsSync(generated[idx].path)) {
      try {
        fs.unlinkSync(generated[idx].path);
      } catch (e) {
        console.warn(`Не удалось удалить старый файл ${generated[idx].path}: ${e.message}`);
      }
    }
    const perFileTime = formatLabelDate(new Date());
    const outPath = path.join(variantDir, `${baseName}_${perFileTime}_${String(idx + 1).padStart(3, '0')}.jpg`);
    fs.writeFileSync(outPath, img);
    const hash = await aHashFromBuffer(img);
    generated[idx] = { path: outPath, hash, attempts: (generated[idx]?.attempts || 0) + 1 };
    if (attempt === 0) {
      console.log(`  [+] ${path.basename(outPath)} готов (attempt ${attempt + 1})`);
    } else {
      console.log(`  [~] ${path.basename(outPath)} пересоздан (attempt ${attempt + 1})`);
    }
  }

  // Первичная генерация: первый кадр — без геометрии, с водяным знаком; остальные — с трансформациями
  await makeVariant(0, true);
  for (let i = 1; i < targetCount; i++) {
    await makeVariant(i);
  }

  // Итеративно пересоздаём слишком похожие
  for (let pass = 0; pass < maxGlobalPasses; pass++) {
    const closeOnes = findCloseIndices(generated, historyHashes, HASH_THRESHOLD);
    const minDist = closeOnes.length ? closeOnes[0].minDist : null;
    if (minDist !== null) {
      console.log(
        `Пасс ${pass + 1}: всего ${closeOnes.length} кандидатов, минимальная дистанция ${minDist} (порог ${HASH_THRESHOLD})`
      );
      if (minDist === 0) aggressiveMode = true; // включаем усиление разброса при точных дублях
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

  // Финальная проверка и предупреждение
  const remainingClose = findCloseIndices(generated, historyHashes, HASH_THRESHOLD);
  if (remainingClose.length) {
    const minDist = remainingClose[0].minDist;
    console.warn(
      `Внимание: минимальная дистанция между вариантами/историей ${minDist} (< ${HASH_THRESHOLD}), увеличьте разброс трансформаций при необходимости.`
    );
  } else {
    console.log(`Все варианты удовлетворяют порогу ${HASH_THRESHOLD} по aHash.`);
  }

  // Обновляем историю
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
    const aliases = (() => {
      if (!planPath) return { materials: {}, photos: {} };
      try {
        const raw = fs.readFileSync(planPath, 'utf8');
        const json = JSON.parse(raw);
        return json.aliases || { materials: {}, photos: {} };
      } catch {
        return { materials: {}, photos: {} };
      }
    })();

  // Собираем список исходников
  let sources = [];
  if (opts.input) {
    sources = [{ path: opts.input, materialId: '', name: '', address: '' }];
    } else {
      // Если в плане есть tasks — используем materialId/photoKey для путей
      if (planPath) {
      try {
        const raw = fs.readFileSync(planPath, 'utf8');
        const plan = JSON.parse(raw);
        const tasks = plan.tasks || [];
        const photoAliases = aliases.photos || {};
        const materialAliases = aliases.materials || {};
        const folders = new Map(); // key (folder|address) -> { materialId, name, address, folder }
        const addrCounts = new Map(); // key: materialId|address -> count
        tasks.forEach((t) => {
          const materialId = materialAliases[t.materialId] || t.materialId;
          const photoKey = t.photoKey || materialId;
          const slots = t.slots && t.slots.length ? t.slots : [{ locations: t.locations }];
          slots.forEach((slot) => {
            const locs = (slot.locations && slot.locations.length ? slot.locations : [{ address: 'default' }]) || [
              { address: 'default' }
            ];
            locs.forEach((loc) => {
              const addr = loc.address || 'default';
              const safeAddress = sanitizeName(addr);
              const countKey = `${materialId || ''}|${safeAddress}`;
              const addCount = Number(loc.count) || Number(slot.count) || Number(t.count) || 0;
              addrCounts.set(countKey, (addrCounts.get(countKey) || 0) + addCount);
              const resolved =
                photoAliases[photoKey] ||
                path.join(DEFAULT_PHOTOS_ROOT, materialId || photoKey, 'originals');
              const folderKey = `${resolved}|${safeAddress}`;
              folders.set(folderKey, { materialId, name: t.materialId || materialId, address: safeAddress, folder: resolved });
            });
          });
        });
        folders.forEach((info) => {
          if (fs.existsSync(info.folder)) {
            const files = fs
              .readdirSync(info.folder)
              .filter((name) => name.match(/\.(jpg|jpeg|png|webp)$/i))
              .map((name) => ({
                path: path.join(info.folder, name),
                materialId: info.materialId,
                name: info.name,
                address: info.address,
                count: addrCounts.get(`${info.materialId || ''}|${info.address}`) || 0
              }));
            sources.push(...files);
          }
        });
        } catch (e) {
          console.warn(`Не удалось разобрать план ${planPath}: ${e.message}`);
        }
      }

      // Fallback: если ничего не нашли — читаем базовую папку source
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
      } else {
        console.log(`Исходники из плана: найдено файлов ${sources.length}`);
      }
    }

    // Если out не указан — кладем в data/photos/variants/<имя_файла>/
    if (!opts.out) {
      opts.out = DEFAULT_VARIANTS_DIR;
    }

    // Если указан план — вычисляем суммарное количество объявлений и распределяем по исходникам
    let perFileCount = opts.count;
    // Генерим общий runLabel, если не задан, чтобы все файлы одного запуска были уникальны
    const runLabel = opts.runLabel || formatLabelDate();

    const perSourceCounts = [];
    for (const src of sources) {
      const perFile = planPath ? src.count || opts.count : perFileCount;
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
