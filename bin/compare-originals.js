#!/usr/bin/env node
/**
 * Сравнивает исходные фотографии используя существующие функции из библиотеки
 * Использует те же функции, что и generate-photo-variants.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { aHashFromBuffer, hamming } from './lib/photo-variants/hashing.js';
import { loadImageBuffer } from './lib/photo-variants/utils.js';
import { HASH_THRESHOLD } from './lib/photo-variants/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function compareOriginals(photoDir, photoNames) {
  console.log('🔍 Сравнение исходных фотографий\n');
  console.log(`Директория: ${photoDir}`);
  console.log(`Порог уникальности (HASH_THRESHOLD): ${HASH_THRESHOLD}\n`);
  console.log('─'.repeat(80));

  // Загружаем и вычисляем хэши
  const photos = [];
  for (const name of photoNames) {
    const filePath = path.join(photoDir, name);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  Файл не найден: ${name}`);
      continue;
    }

    try {
      const buffer = await loadImageBuffer(filePath);
      const hash = await aHashFromBuffer(buffer);
      const stats = fs.statSync(filePath);
      photos.push({ name, hash, size: stats.size });
      console.log(`✓ ${name} (${(stats.size / 1024).toFixed(2)} KB)`);
    } catch (error) {
      console.error(`❌ Ошибка: ${name}: ${error.message}`);
    }
  }

  if (photos.length < 2) {
    console.error('\n❌ Недостаточно изображений для сравнения');
    return;
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\n📊 Попарное сравнение (используя hamming из библиотеки):\n');

  const distances = [];
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const dist = hamming(photos[i].hash, photos[j].hash);
      const similarity = ((1 - dist / photos[0].hash.length) * 100).toFixed(1);
      const isSimilar = dist < HASH_THRESHOLD;
      const isBorderline = dist >= HASH_THRESHOLD && dist <= HASH_THRESHOLD + 2;

      distances.push({ photo1: photos[i].name, photo2: photos[j].name, dist, similarity, isSimilar, isBorderline });

      let status = isSimilar ? '🔴 ПОХОЖИ' : isBorderline ? '🟡 НА ГРАНИЦЕ' : '🟢 УНИКАЛЬНЫ';
      console.log(`${photos[i].name} ↔ ${photos[j].name}:`);
      console.log(`  Расстояние: ${dist} | Схожесть: ${similarity}% | ${status}`);
      if (isBorderline) {
        console.log(`  ⚠️  Близко к порогу (${HASH_THRESHOLD})`);
      }
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\n📈 Статистика:\n');
  const similar = distances.filter(d => d.isSimilar);
  const borderline = distances.filter(d => d.isBorderline);
  const unique = distances.filter(d => !d.isSimilar && !d.isBorderline);

  console.log(`Всего сравнений: ${distances.length}`);
  console.log(`Похожих: ${similar.length} 🔴`);
  console.log(`На границе: ${borderline.length} 🟡`);
  console.log(`Уникальных: ${unique.length} 🟢`);

  if (distances.length > 0) {
    const avgDist = distances.reduce((sum, d) => sum + d.dist, 0) / distances.length;
    const minDist = Math.min(...distances.map(d => d.dist));
    const maxDist = Math.max(...distances.map(d => d.dist));
    console.log(`\nСреднее расстояние: ${avgDist.toFixed(2)}`);
    console.log(`Минимум: ${minDist} (${distances.find(d => d.dist === minDist).photo1} ↔ ${distances.find(d => d.dist === minDist).photo2})`);
    console.log(`Максимум: ${maxDist} (${distances.find(d => d.dist === maxDist).photo1} ↔ ${distances.find(d => d.dist === maxDist).photo2})`);
  }

  if (similar.length > 0 || borderline.length > 0) {
    console.log('\n' + '─'.repeat(80));
    console.log('\n⚠️  Похожие/близкие пары:\n');
    [...similar, ...borderline].forEach(pair => {
      console.log(`  ${pair.photo1} ↔ ${pair.photo2} (расстояние: ${pair.dist})`);
    });
  }

  console.log('\n' + '─'.repeat(80));
}

// Основная функция
async function main() {
  const args = process.argv.slice(2);
  
  let photoDir, photoNames;
  
  if (args.length === 0) {
    // По умолчанию - предыдущая папка
    photoDir = path.resolve(__dirname, '..', 'data', 'photos', 'karier_neseyan_nemyt_pesok', 'originals');
    photoNames = ['nb.png', 'nb2.png', 'nb3.png', 'nb4.png', 'nb5.png'];
  } else if (args.length === 1) {
    // Передан только путь к папке - сравниваем все изображения в ней
    photoDir = path.resolve(args[0]);
    if (!fs.existsSync(photoDir)) {
      console.error(`❌ Директория не найдена: ${photoDir}`);
      process.exit(1);
    }
    const files = fs.readdirSync(photoDir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();
    if (files.length === 0) {
      console.error(`❌ В директории нет изображений: ${photoDir}`);
      process.exit(1);
    }
    photoNames = files;
    console.log(`📁 Найдено изображений: ${photoNames.length}\n`);
  } else {
    // Передан путь и список файлов
    photoDir = path.resolve(args[0]);
    photoNames = args.slice(1);
  }
  
  await compareOriginals(photoDir, photoNames);
}

main().catch(console.error);

