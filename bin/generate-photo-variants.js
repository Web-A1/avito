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
    overshoot: 0.2,
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

function pruneByHash(variants, targetCount, origHash, minDistance = 12) {
  if (!variants.length) return variants;
  let current = [...variants];
  while (current.length > targetCount || true) {
    let minDist = Infinity;
    let victimIdx = -1;
    for (let i = 0; i < current.length; i++) {
      let nearest = origHash ? hamming(current[i].hash, origHash) : Infinity;
      for (let j = 0; j < current.length; j++) {
        if (i === j) continue;
        const d = hamming(current[i].hash, current[j].hash);
        if (d < nearest) nearest = d;
      }
      // Чем ближе к другим и к оригиналу — тем выше шанс удалить
      const score = nearest;
      if (score < minDist) {
        minDist = score;
        victimIdx = i;
      }
    }
    if (victimIdx >= 0 && (minDist < minDistance || current.length > targetCount)) {
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
  return current;
}

function pickTextPalette(stats, forcedColor) {
  if (forcedColor) {
    return { fill: forcedColor };
  }
  const channels = stats?.channels || [];
  const means = channels.slice(0, 3).map((c) => c?.mean || 128);
  const avg = means.reduce((sum, v) => sum + v, 0) / (means.length || 1);
  // Яркие фото — темный знак, тёмные — светлый, средние — светлый с мягкой обводкой
  if (avg >= 190) return { fill: 'rgba(30,30,30,1)' };
  if (avg <= 80) return { fill: 'rgba(245,245,245,1)' };
  return { fill: 'rgba(235,235,235,1)' };
}

function buildTextPatternSvg(width, height, text, opacity, fillColor) {
  const fontSize = Math.round(width * randomBetween(0.028, 0.038)); // компактнее, чтобы плотнее, но без резки
  const wordWidthFactor = 4.8; // запас по длине слова
  const cellSize = Math.round(fontSize * wordWidthFactor * randomBetween(0.94, 1.02));
  const tileW = cellSize * 2.7; // плотнее горизонтальный шаг, но с запасом
  const tileH = cellSize * 1.65; // плотный вертикальный шаг с запасом под наклон
  const rotation = Math.random() < 0.5 ? randomBetween(-22, -18) : randomBetween(18, 22); // умеренный наклон паттерна
  const fillOpacity = Math.min(0.6, Math.max(0.18, opacity * 1.25)); // мягкая прозрачность с небольшим бустом
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
          <text x="${x1}" y="${y1}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${fillColor}" fill-opacity="${fillOpacity}" font-weight="600">${text}</text>
          <text x="${x2}" y="${y2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${fillColor}" fill-opacity="${fillOpacity}" font-weight="600">${text}</text>
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
  overshoot,
  patternOpacity: forcedPatternOpacity,
  textWatermark,
  textOpacity: forcedTextOpacity,
  textColor,
  materialId,
  runLabel,
  name
}) {
  if (!input) throw new Error('Укажите --input путь к исходному фото');

  const baseDir = materialId ? path.join(DEFAULT_PHOTOS_ROOT, materialId) : out;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const baseBuffer = await loadImageBuffer(input);
  const baseImage = sharp(baseBuffer);
  const meta = await baseImage.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Не удалось прочитать размер исходного изображения');
  }
  const stats = await sharp(baseBuffer).stats();
  const palette = pickTextPalette(stats, textColor);

  const targetCount = count;
  const totalCount = Math.max(
    targetCount + 2, // минимальный запас
    Math.round(targetCount * (1 + Math.max(0, overshoot || 0.2)))
  );
  const generated = [];

  for (let i = 0; i < totalCount; i++) {
    // Размер итогового изображения: небольшой рандомный ресайз 95-105% от исходника
    const scale = randomBetween(0.9, 1.1);
    const targetWidth = Math.max(32, Math.round(meta.width * scale));
    const targetHeight = Math.max(32, Math.round(meta.height * scale));

    // Рандомные трансформации
    const rotateDeg = randomBetween(-6, 6);
    const shouldFlop = Math.random() < 0.5; // горизонтальный флоп (отзеркаливание)

    // Очень лёгкая цветокоррекция, чтобы не уводить цвет песка
    const brightness = randomBetween(0.98, 1.02);
    const saturation = randomBetween(0.97, 1.03);
    const hue = randomInt(-2, 2);
    const contrast = randomBetween(0.98, 1.04);

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
    const overscale = Math.max(1.3, Math.max(scaleX, scaleY) * 1.15 + 0.08); // увеличенный запас
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
        input: dotsSvg,
        top: 0,
        left: 0,
        blend: 'over',
        opacity: Math.min(1, patternOpacity * 0.6)
      }
    ];

    // Текстовый водяной знак, если задан
    if (textWatermark) {
      const textOpacity =
        clampOpacity(
          typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
            ? forcedTextOpacity
            : patternOpacity,
          0.03,
          0.08
        ) || patternOpacity; // мягкая прозрачность
      const textSvg = buildTextPatternSvg(targetWidth, targetHeight, textWatermark, textOpacity, palette.fill);
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
    const baseName = (name || materialId) || path.basename(input, path.extname(input));
    const label = runLabel || formatLabelDate();
    const variantDir = materialId
      ? path.join(DEFAULT_PHOTOS_ROOT, materialId, 'variants', label)
      : path.join(out, baseName, 'variants', label);
    if (!fs.existsSync(variantDir)) {
      fs.mkdirSync(variantDir, { recursive: true });
    }
    const outPath = path.join(variantDir, `${baseName}_${label}_${String(i + 1).padStart(3, '0')}.jpg`);
    fs.writeFileSync(outPath, img);
    const hash = await aHashFromBuffer(img);
    generated.push({ path: outPath, hash });
  }

  // Обрезаем самые похожие, если сгенерировали больше
  if (generated.length > targetCount) {
    const origHash = await aHashFromBuffer(baseBuffer);
    pruneByHash(generated, targetCount, origHash);
  }
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
      sources = [{ path: opts.input, materialId: '' }];
    } else {
      // Если в плане есть tasks — используем materialId/photoKey для путей
      if (planPath) {
        try {
          const raw = fs.readFileSync(planPath, 'utf8');
          const plan = JSON.parse(raw);
          const tasks = plan.tasks || [];
          const photoAliases = aliases.photos || {};
          const materialAliases = aliases.materials || {};
          const folders = new Map(); // folder -> { materialId, name }
          tasks.forEach((t) => {
            const materialId = materialAliases[t.materialId] || t.materialId;
            const photoKey = t.photoKey || materialId;
            const resolved =
              photoAliases[photoKey] ||
              path.join(DEFAULT_PHOTOS_ROOT, materialId || photoKey, 'originals');
            folders.set(resolved, { materialId, name: t.materialId || materialId });
          });
          folders.forEach((info, folder) => {
            if (fs.existsSync(folder)) {
              const files = fs
                .readdirSync(folder)
                .filter((name) => name.match(/\.(jpg|jpeg|png)$/i))
                .map((name) => ({ path: path.join(folder, name), materialId: info.materialId, name: info.name }));
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
          .filter((name) => name.match(/\.(jpg|jpeg|png)$/i))
          .map((name) => ({ path: path.join(DEFAULT_SOURCE_DIR, name), materialId: '', name: '' }));
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
    if (planPath) {
      const totalFromPlan = sumAdsFromPlan(planPath);
      if (totalFromPlan > 0 && sources.length > 0) {
        perFileCount = Math.ceil(totalFromPlan / sources.length);
        console.log(`По плану ${totalFromPlan} объявлений, источников ${sources.length}, на файл по ${perFileCount}`);
      }
    }

    // Генерим общий runLabel, если не задан, чтобы все файлы одного запуска были уникальны
    const runLabel = opts.runLabel || formatLabelDate();

    for (const src of sources) {
      await generateVariants({
        ...opts,
        input: src.path,
        materialId: src.materialId,
        name: src.name,
        runLabel,
        count: perFileCount
      });
    }
    console.log(`Готово: сгенерированы варианты для ${sources.length} исходников, по ${perFileCount} шт.`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
