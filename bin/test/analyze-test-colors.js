#!/usr/bin/env node
/**
 * Анализирует сгенерированные тестовые изображения и показывает какой opacity применился
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { calculateAdaptiveOpacity } from '../lib/photo-variants/patterns.js';

const VARIANTS_DIR = path.join(
  process.cwd(),
  'data/photos/test_colors/calibration_test/variants'
);

// Эталонные цвета
const EXPECTED_COLORS = {
  0: 'Чёрный',
  50: 'Очень тёмный',
  100: 'Тёмный',
  127: 'Средний',
  180: 'Светло-серый',
  230: 'Очень светлый',
  255: 'Белый'
};

async function analyzeTestColors() {
  console.log('🔬 АНАЛИЗ ТЕСТОВЫХ ИЗОБРАЖЕНИЙ\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Находим последнюю папку с вариантами
  const variantsDirs = fs.readdirSync(VARIANTS_DIR).filter(name => !name.startsWith('.'));
  if (variantsDirs.length === 0) {
    console.log('❌ Папки с вариантами не найдены!');
    return;
  }

  const latestDir = variantsDirs.sort().reverse()[0];
  const latestPath = path.join(VARIANTS_DIR, latestDir);
  
  console.log(`📂 Анализируем: ${latestDir}\n`);

  // Получаем все фото
  const photos = fs.readdirSync(latestPath)
    .filter(name => name.match(/\.jpg$/i))
    .sort();

  console.log(`📸 Найдено фото: ${photos.length}\n`);

  const results = [];

  for (const photo of photos) {
    const photoPath = path.join(latestPath, photo);
    const stats = await sharp(photoPath).stats();
    const channels = stats.channels.slice(0, 3);
    const avgBrightness = Math.round(channels.reduce((s, c) => s + c.mean, 0) / 3);
    
    const { minOpacity, maxOpacity } = calculateAdaptiveOpacity(stats);
    const avgOpacity = (minOpacity + maxOpacity) / 2;

    // Находим ближайший эталонный цвет
    const expectedBrightnesses = Object.keys(EXPECTED_COLORS).map(Number);
    const closestBrightness = expectedBrightnesses.reduce((prev, curr) => {
      return Math.abs(curr - avgBrightness) < Math.abs(prev - avgBrightness) ? curr : prev;
    });

    results.push({
      photo,
      brightness: avgBrightness,
      closestBrightness,
      colorName: EXPECTED_COLORS[closestBrightness],
      minOpacity: (minOpacity * 100).toFixed(1),
      maxOpacity: (maxOpacity * 100).toFixed(1),
      avgOpacity: (avgOpacity * 100).toFixed(1)
    });
  }

  // Группируем по яркости
  const grouped = {};
  results.forEach(r => {
    const key = r.closestBrightness;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });

  // Выводим результаты
  console.log('┌─────────────┬───────────┬──────────────────────────┬──────────┐');
  console.log('│ Цвет        │ Яркость   │ Opacity диапазон         │ Средний  │');
  console.log('├─────────────┼───────────┼──────────────────────────┼──────────┤');

  Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).forEach(key => {
    const items = grouped[key];
    const first = items[0];
    const avgOfAvgs = items.reduce((s, i) => s + parseFloat(i.avgOpacity), 0) / items.length;
    
    console.log(
      `│ ${first.colorName.padEnd(11)} │ ${String(first.closestBrightness).padStart(3).padEnd(7)} │ ${first.minOpacity}% - ${first.maxOpacity}%`.padEnd(37) + `│ ${avgOfAvgs.toFixed(1)}%`.padEnd(8) + ' │'
    );
  });

  console.log('└─────────────┴───────────┴──────────────────────────┴──────────┘');

  console.log('\n📊 ПУТЬ К ФОТО ДЛЯ ВИЗУАЛЬНОЙ ОЦЕНКИ:');
  console.log(`${latestPath}\n`);

  console.log('💡 ИНСТРУКЦИЯ:');
  console.log('1. Открой папку с фото');
  console.log('2. Посмотри на каждый цвет и оцени заметность ВЗ');
  console.log('3. Для каждого цвета определи: "комфортная заметность"?');
  console.log('4. На основе твоих оценок мы скорректируем формулу!\n');
}

analyzeTestColors().catch(console.error);





