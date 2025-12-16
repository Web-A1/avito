#!/usr/bin/env node
/**
 * Генерирует тестовые однотонные изображения для калибровки opacity водяного знака
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'data/photos/test_colors/originals');
const WIDTH = 1920;
const HEIGHT = 1080;

// Набор тестовых цветов (от чёрного до белого)
const TEST_COLORS = [
  { name: 'black', rgb: [0, 0, 0], brightness: 0 },
  { name: 'dark50', rgb: [50, 50, 50], brightness: 50 },
  { name: 'dark100', rgb: [100, 100, 100], brightness: 100 },
  { name: 'mid127', rgb: [127, 127, 127], brightness: 127 },
  { name: 'light180', rgb: [180, 180, 180], brightness: 180 },
  { name: 'light230', rgb: [230, 230, 230], brightness: 230 },
  { name: 'white', rgb: [255, 255, 255], brightness: 255 }
];

async function generateTestColors() {
  // Создаём папку если её нет
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('🎨 Генерация тестовых однотонных изображений...\n');

  for (const color of TEST_COLORS) {
    const filename = `${color.name}.jpg`;
    const filepath = path.join(OUTPUT_DIR, filename);

    // Создаём буфер с однотонным цветом
    const buffer = Buffer.alloc(WIDTH * HEIGHT * 3);
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      buffer[i * 3 + 0] = color.rgb[0]; // R
      buffer[i * 3 + 1] = color.rgb[1]; // G
      buffer[i * 3 + 2] = color.rgb[2]; // B
    }

    // Сохраняем как JPEG
    await sharp(buffer, {
      raw: {
        width: WIDTH,
        height: HEIGHT,
        channels: 3
      }
    })
      .jpeg({ quality: 95 })
      .toFile(filepath);

    console.log(`✅ ${filename} (RGB: ${color.rgb.join(',')}, brightness: ${color.brightness})`);
  }

  console.log(`\n🎉 Готово! Создано ${TEST_COLORS.length} тестовых изображений в:\n${OUTPUT_DIR}`);
  console.log('\n📋 Следующий шаг: прогнать через generate-photo-variants.js');
}

generateTestColors().catch(console.error);


