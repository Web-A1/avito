#!/usr/bin/env node
/**
 * Генерирует по одному водяному знаку для каждого исходника из data/photos/[material]/originals
 * и складывает всё в одну папку для ручной проверки.
 *
 * Пример:
 *   node bin/generate-watermark-previews.js --out ./output/watermark-previews --text NERUDA
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

import { DEFAULT_PHOTOS_ROOT } from './lib/photo-variants/constants.js';
import { calculateAdaptiveOpacity, buildTextPatternSvg, pickTextPalette } from './lib/photo-variants/patterns.js';
import { clampOpacity, loadImageBuffer, sanitizeName } from './lib/photo-variants/utils.js';
import { getSandType } from '../src/constants/sandTypes.js';
import { getRubbleType } from '../src/constants/rubbleTypes.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    out: path.resolve(process.cwd(), 'output', 'watermark-previews'),
    text: 'NERUDA',
    textOpacity: null,
    textColor: ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' && args[i + 1]) {
      opts.out = path.resolve(process.cwd(), args[++i]);
    } else if ((arg === '--text' || arg === '--text-watermark') && args[i + 1]) {
      opts.text = args[++i];
    } else if (arg === '--text-opacity' && args[i + 1]) {
      opts.textOpacity = parseFloat(args[++i]);
    } else if (arg === '--text-color' && args[i + 1]) {
      opts.textColor = args[++i];
    }
  }

  return opts;
}

function getMaterialLabel(materialId) {
  const sand = getSandType(materialId);
  if (sand?.displayName) return sand.displayName;
  const rubble = getRubbleType(materialId);
  if (rubble?.displayName) return rubble.displayName;
  return materialId;
}

function listOriginals(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const materials = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const originals = [];

  for (const materialId of materials) {
    const originalsDir = path.join(rootDir, materialId, 'originals');
    if (!fs.existsSync(originalsDir) || !fs.statSync(originalsDir).isDirectory()) continue;

    const files = fs
      .readdirSync(originalsDir, { withFileTypes: true })
      .filter((f) => f.isFile() && !f.name.startsWith('.'));

    for (const file of files) {
      originals.push({
        materialId,
        materialLabel: getMaterialLabel(materialId),
        fileName: file.name,
        filePath: path.join(originalsDir, file.name)
      });
    }
  }

  return originals;
}

function buildOutputPath(outDir, materialLabel, originalName) {
  const materialSlug = sanitizeName(materialLabel);
  const originalSlug = sanitizeName(originalName);
  const base = `${materialSlug}__${originalSlug}`;

  let attempt = 0;
  let candidate = path.join(outDir, `${base}.jpg`);
  while (fs.existsSync(candidate)) {
    attempt += 1;
    candidate = path.join(outDir, `${base}-${attempt}.jpg`);
  }
  return candidate;
}

async function generateWatermarkedCopy(entry, opts) {
  const buffer = await loadImageBuffer(entry.filePath);
  const image = sharp(buffer);
  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('не удалось прочитать размеры исходника');
  }

  const stats = await sharp(buffer).stats();
  const palette = pickTextPalette(stats, opts.textColor);
  const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(stats);

  const resolvedOpacity =
    clampOpacity(opts.textOpacity, minOpacity, maxOpacity) ??
    clampOpacity((minOpacity + maxOpacity) / 2, minOpacity, maxOpacity) ??
    minOpacity;

  const textSvg = buildTextPatternSvg(
    meta.width,
    meta.height,
    opts.text,
    resolvedOpacity,
    palette.fill,
    palette.stroke || palette.fill,
    palette.mode
  );

  const outBuffer = await sharp(buffer)
    .composite([{ input: textSvg, top: 0, left: 0, blend: 'over' }])
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();

  const outPath = buildOutputPath(opts.out, entry.materialLabel, entry.fileName);
  await fs.promises.writeFile(outPath, outBuffer);

  return outPath;
}

async function main() {
  const opts = parseArgs();
  if (!fs.existsSync(opts.out)) {
    fs.mkdirSync(opts.out, { recursive: true });
  }

  const originals = listOriginals(DEFAULT_PHOTOS_ROOT);
  if (originals.length === 0) {
    console.log('Исходники не найдены в data/photos/*/originals');
    process.exit(0);
  }

  console.log(`Найдено исходников: ${originals.length}`);
  console.log(`Выходная папка: ${opts.out}`);

  let ok = 0;
  for (const entry of originals) {
    const label = `${entry.materialId} / ${entry.fileName}`;
    try {
      const saved = await generateWatermarkedCopy(entry, opts);
      ok += 1;
      console.log(`✅ ${label} → ${path.basename(saved)}`);
    } catch (err) {
      console.error(`❌ ${label}: ${err.message}`);
    }
  }

  console.log(`Готово: ${ok}/${originals.length} файлов.`);
}

main().catch((err) => {
  console.error(`Неожиданная ошибка: ${err.message}`);
  process.exit(1);
});
