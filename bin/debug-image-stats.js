#!/usr/bin/env node
/**
 * Вспомогательный скрипт: печатает статистику изображения (яркость, детализацию)
 * чтобы точнее настраивать видимость водяного знака.
 *
 * Пример:
 *   node bin/debug-image-stats.js --input ./data/photos/karier_seyan_nemyt_pesok/originals/fs.webp
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

function parseArgs() {
  const args = process.argv.slice(2);
  let input = '';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--input' || arg === '-i') && args[i + 1]) {
      input = args[++i];
    } else if (!arg.startsWith('-') && !input) {
      // Допускаем позиционный аргумент как путь к файлу
      input = arg;
    }
  }
  return { input };
}

async function main() {
  const { input } = parseArgs();
  if (!input) {
    console.error('Укажите --input путь к файлу изображения');
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), input);
  if (!fs.existsSync(resolved)) {
    console.error(`Файл не найден: ${resolved}`);
    process.exit(1);
  }

  const image = sharp(resolved);
  const meta = await image.metadata();
  const stats = await image.stats();

  const channels = stats.channels || [];
  const means = channels.slice(0, 3).map((c) => c?.mean ?? 128);
  const stdevs = channels.slice(0, 3).map((c) => c?.stdev ?? 0);

  const avgBrightness =
    means.reduce((sum, v) => sum + v, 0) / (means.length || 1);
  const avgStdev = stdevs.reduce((sum, v) => sum + v, 0) / (stdevs.length || 1);

  console.log('Файл:', resolved);
  console.log('Размер:', meta.width, 'x', meta.height);
  console.log('');
  console.log('Яркость по каналам (mean):', means.map((m) => m.toFixed(2)));
  console.log('Детализация по каналам (stdev):', stdevs.map((s) => s.toFixed(2)));
  console.log('Средняя яркость (avgBrightness):', avgBrightness.toFixed(2));
  console.log('Средняя детализация (avgStdev):', avgStdev.toFixed(2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});






