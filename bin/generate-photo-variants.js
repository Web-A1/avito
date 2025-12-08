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

const DEFAULT_SOURCE_DIR = path.resolve(__dirname, '..', 'data', 'photos', 'source');
const DEFAULT_VARIANTS_DIR = path.resolve(__dirname, '..', 'data', 'photos', 'variants');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: '', out: '', count: 50, patternOpacity: '', textWatermark: '', textOpacity: '' };
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
    }
  }
  return opts;
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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

function buildTextPatternSvg(width, height, text, opacity) {
  const fontSize = Math.round(width * randomBetween(0.04, 0.055)); // чуть меньше: 4-5.5% ширины
  const wordWidthFactor = 5.5; // запас по длине слова
  const cellSize = Math.round(fontSize * wordWidthFactor * randomBetween(1.0, 1.1));
  const tileW = cellSize * 3.0; // шире плитка, чтобы не обрезать слова
  const tileH = cellSize * 1.8; // выше плитка, чтобы не обрезать слова
  const rotation = Math.random() < 0.5 ? randomBetween(-30, -20) : randomBetween(20, 30); // общий наклон для всех строк
  const color = `rgba(255,255,255,${opacity})`;
  const pad = fontSize * 0.9; // увеличенный отступ, чтобы избежать обрезки
  // Шахматный порядок: слово в первой строке слева, во второй строке — справа
  const x1 = pad + tileW * 0.25;
  const y1 = pad + tileH * 0.4;
  const x2 = pad + tileW * 0.75;
  const y2 = tileH - pad;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern id="tp" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotation})">
          <text x="${x1}" y="${y1}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${color}" font-weight="600">${text}</text>
          <text x="${x2}" y="${y2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${color}" font-weight="600">${text}</text>
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
  textOpacity: forcedTextOpacity
}) {
  if (!input) throw new Error('Укажите --input путь к исходному фото');

  if (!fs.existsSync(out)) {
    fs.mkdirSync(out, { recursive: true });
  }

  const baseBuffer = await loadImageBuffer(input);
  const baseImage = sharp(baseBuffer);
  const meta = await baseImage.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Не удалось прочитать размер исходного изображения');
  }

  for (let i = 0; i < count; i++) {
    // Размер итогового изображения: небольшой рандомный ресайз 95-105% от исходника
    const scale = randomBetween(0.95, 1.05);
    const targetWidth = Math.max(32, Math.round(meta.width * scale));
    const targetHeight = Math.max(32, Math.round(meta.height * scale));

    // Рандомные трансформации
    const rotateDeg = randomBetween(-2, 2);
    const shouldFlop = Math.random() < 0.5; // горизонтальный флоп (отзеркаливание)

    // Лёгкая цветокоррекция/гамма
    const brightness = randomBetween(0.97, 1.03);
    const saturation = randomBetween(0.97, 1.03);
    const hue = randomInt(-3, 3);

    // JPEG качество
    const quality = randomInt(88, 96);

    // Ресайз + поворот + последующий кроп до нужного размера (слегка увеличиваем, чтобы убрать полосы)
    const overscale = 1.15; // больше запас при повороте, чтобы исключить черные углы
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

    img = img.modulate({ brightness, saturation, hue });

    // Комбинированный паттерн: шум + точки + легкий градиент
    const patternOpacity =
      typeof forcedPatternOpacity === 'number' && !Number.isNaN(forcedPatternOpacity) && forcedPatternOpacity > 0
        ? forcedPatternOpacity
        : 0.05; // умеренно по умолчанию
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
        typeof forcedTextOpacity === 'number' && !Number.isNaN(forcedTextOpacity) && forcedTextOpacity > 0
          ? forcedTextOpacity
          : patternOpacity; // по умолчанию совпадает с patternOpacity
      const textSvg = buildTextPatternSvg(targetWidth, targetHeight, textWatermark, textOpacity);
      composites.push({
        input: textSvg,
        top: 0,
        left: 0,
        blend: 'over',
        opacity: textOpacity
      });
    }

    img = await img
      .composite(composites)
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();

    // Добавляем к имени индекс и качество для прозрачности изменений
    const baseName = path.basename(input, path.extname(input));
    const variantDir = path.join(out, baseName);
    if (!fs.existsSync(variantDir)) {
      fs.mkdirSync(variantDir, { recursive: true });
    }
    const outPath = path.join(variantDir, `${baseName}_var${String(i + 1).padStart(3, '0')}_q${quality}.jpg`);
    fs.writeFileSync(outPath, img);
  }
}

async function main() {
  try {
    const opts = parseArgs();

    // Если input не указан — берем первый файл из data/photos/source
    if (!opts.input) {
      if (!fs.existsSync(DEFAULT_SOURCE_DIR)) {
        throw new Error(`Папка с исходниками не найдена: ${DEFAULT_SOURCE_DIR}`);
      }
      const candidates = fs
        .readdirSync(DEFAULT_SOURCE_DIR)
        .filter((name) => name.match(/\.(jpg|jpeg|png)$/i))
        .map((name) => path.join(DEFAULT_SOURCE_DIR, name));
      if (!candidates.length) {
        throw new Error(`В ${DEFAULT_SOURCE_DIR} нет исходных файлов (jpg/png)`);
      }
      opts.input = candidates[0];
      console.log(`--input не указан, используем первый файл: ${opts.input}`);
    }

    // Если out не указан — кладем в data/photos/variants/<имя_файла>/
    if (!opts.out) {
      opts.out = DEFAULT_VARIANTS_DIR;
    }

    await generateVariants(opts);
    console.log(`Готово: сгенерировано ${opts.count} вариантов в ${opts.out}`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
