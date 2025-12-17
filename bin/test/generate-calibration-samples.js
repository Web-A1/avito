#!/usr/bin/env node
/**
 * Создаёт ТОЧЕЧНЫЕ тестовые образцы для калибровки opacity
 * По одному фото для каждого тестового цвета
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { calculateAdaptiveOpacity } from '../lib/photo-variants/patterns.js';
import { buildTextPatternSvg } from '../lib/photo-variants/patterns.js';
import { pickTextPalette } from '../lib/photo-variants/patterns.js';

const OUTPUT_DIR = path.join(process.cwd(), 'data/photos/test_colors/calibration_samples');
const WIDTH = 1920;
const HEIGHT = 1080;
const WATERMARK_TEXT = 'NERUDA';

// Набор тестовых цветов
const TEST_COLORS = [
  { name: 'black', rgb: [0, 0, 0], brightness: 0 },
  { name: 'dark50', rgb: [50, 50, 50], brightness: 50 },
  { name: 'dark100', rgb: [100, 100, 100], brightness: 100 },
  { name: 'mid127', rgb: [127, 127, 127], brightness: 127 },
  { name: 'light180', rgb: [180, 180, 180], brightness: 180 },
  { name: 'light230', rgb: [230, 230, 230], brightness: 230 },
  { name: 'white', rgb: [255, 255, 255], brightness: 255 }
];

async function generateCalibrationSamples() {
  // Создаём папку
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('🎨 СОЗДАНИЕ КАЛИБРОВОЧНЫХ ОБРАЗЦОВ\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = [];

  for (const color of TEST_COLORS) {
    console.log(`📸 ${color.name} (RGB: ${color.rgb.join(',')}, яркость: ${color.brightness})`);

    // Создаём исходное изображение
    const buffer = Buffer.alloc(WIDTH * HEIGHT * 3);
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      buffer[i * 3 + 0] = color.rgb[0];
      buffer[i * 3 + 1] = color.rgb[1];
      buffer[i * 3 + 2] = color.rgb[2];
    }

    const imageBuffer = await sharp(buffer, {
      raw: { width: WIDTH, height: HEIGHT, channels: 3 }
    }).jpeg({ quality: 95 }).toBuffer();

    // Получаем stats для расчёта opacity
    const stats = await sharp(imageBuffer).stats();
    const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(stats);
    const avgOpacity = (minOpacity + maxOpacity) / 2;

    // Создаём палитру
    const palette = pickTextPalette(stats, null);

    // Создаём SVG водяного знака
    const textSvg = buildTextPatternSvg(
      WIDTH,
      HEIGHT,
      WATERMARK_TEXT,
      avgOpacity,
      palette.fill,
      palette.stroke || palette.fill,
      palette.mode
    );

    // Применяем водяной знак
    const resultBuffer = await sharp(imageBuffer)
      .composite([{
        input: textSvg,
        top: 0,
        left: 0,
        blend: 'over'
      }])
      .jpeg({ quality: 95 })
      .toBuffer();

    // Сохраняем
    const filename = `${color.name}_opacity${(avgOpacity * 100).toFixed(0)}.jpg`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, resultBuffer);

    console.log(`   ✅ ${filename}`);
    console.log(`   → Opacity: ${(minOpacity * 100).toFixed(1)}% - ${(maxOpacity * 100).toFixed(1)}% (средний: ${(avgOpacity * 100).toFixed(1)}%)\n`);

    results.push({
      name: color.name,
      brightness: color.brightness,
      opacity: (avgOpacity * 100).toFixed(1),
      filename
    });
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('🎉 ГОТОВО! Создано 7 калибровочных образцов\n');
  console.log('📂 Путь:');
  console.log(`${OUTPUT_DIR}\n`);

  console.log('📊 СВОДНАЯ ТАБЛИЦА:\n');
  console.log('┌─────────────┬───────────┬──────────┐');
  console.log('│ Цвет        │ Яркость   │ Opacity  │');
  console.log('├─────────────┼───────────┼──────────┤');
  
  results.forEach(r => {
    const colorName = r.name.replace('dark', 'Тёмный ').replace('light', 'Светлый ').replace('mid', 'Средний ').replace('black', 'Чёрный').replace('white', 'Белый');
    console.log(`│ ${colorName.padEnd(11)} │ ${String(r.brightness).padStart(3).padEnd(7)} │ ${r.opacity}%`.padEnd(8) + '  │');
  });
  
  console.log('└─────────────┴───────────┴──────────┘\n');

  console.log('💡 ТЕПЕРЬ:');
  console.log('1. Открой папку с образцами');
  console.log('2. Посмотри на каждое фото');
  console.log('3. Оцени видимость водяного знака');
  console.log('4. Скажи какие нужно усилить/ослабить!\n');
}

generateCalibrationSamples().catch(console.error);





