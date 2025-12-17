#!/usr/bin/env node
/**
 * Скрипт для очистки истории генерации фото (hashes.json) и созданных вариантов
 * 
 * Использование:
 *   node bin/clean-history.js                    # Удалить все hashes.json и фото в variants/
 *   node bin/clean-history.js --keep-flagship    # Удалить все, но оставить flagship.jpg
 *   node bin/clean-history.js --hashes-only      # Удалить только hashes.json, оставить фото
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHOTOS_ROOT = path.join(__dirname, '..', 'data', 'photos');

function findHashesFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) {
    return files;
  }
  
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name === 'hashes.json') {
        files.push(fullPath);
      }
    }
  };
  
  walk(rootDir);
  return files;
}

function findVariantDirs(rootDir) {
  const dirs = [];
  if (!fs.existsSync(rootDir)) {
    return dirs;
  }
  
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'variants') {
          dirs.push(fullPath);
        } else {
          walk(fullPath);
        }
      }
    }
  };
  
  walk(rootDir);
  return dirs;
}

function cleanVariantsDir(variantsDir, keepFlagship = false) {
  if (!fs.existsSync(variantsDir)) {
    return { deleted: 0, kept: 0 };
  }
  
  const entries = fs.readdirSync(variantsDir, { withFileTypes: true });
  let deleted = 0;
  let kept = 0;
  
  for (const entry of entries) {
    const fullPath = path.join(variantsDir, entry.name);
    if (entry.isFile() && entry.name.match(/\.(jpg|jpeg|png)$/i)) {
      if (keepFlagship && entry.name === 'flagship.jpg') {
        kept++;
        continue;
      }
      try {
        fs.unlinkSync(fullPath);
        deleted++;
      } catch (e) {
        console.warn(`   ⚠️  Не удалось удалить ${fullPath}: ${e.message}`);
      }
    } else if (entry.isDirectory()) {
      // Удаляем подпапки (старая структура с датами)
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        deleted++;
      } catch (e) {
        console.warn(`   ⚠️  Не удалось удалить папку ${fullPath}: ${e.message}`);
      }
    }
  }
  
  return { deleted, kept };
}

function main() {
  const args = process.argv.slice(2);
  const keepFlagship = args.includes('--keep-flagship');
  const hashesOnly = args.includes('--hashes-only');
  
  console.log('ОЧИСТКА ИСТОРИИ ГЕНЕРАЦИИ ФОТО');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (keepFlagship) {
    console.log('Режим: удалить все, но оставить flagship.jpg\n');
  } else if (hashesOnly) {
    console.log('Режим: удалить только hashes.json, оставить фото\n');
  } else {
    console.log('Режим: удалить все (hashes.json и фото в variants/)\n');
  }
  
  // Находим все hashes.json
  const hashesFiles = findHashesFiles(PHOTOS_ROOT);
  console.log(`Найдено файлов hashes.json: ${hashesFiles.length}`);
  
  // Удаляем hashes.json
  let deletedHashes = 0;
  for (const file of hashesFiles) {
    try {
      fs.unlinkSync(file);
      deletedHashes++;
      const relativePath = path.relative(PHOTOS_ROOT, file);
      console.log(`   Удален: ${relativePath}`);
    } catch (e) {
      console.warn(`   ⚠️  Не удалось удалить ${file}: ${e.message}`);
    }
  }
  
  console.log(`\nУдалено файлов hashes.json: ${deletedHashes}`);
  
  if (hashesOnly) {
    console.log('\n✅ Очистка завершена (только hashes.json)');
    return;
  }
  
  // Находим все папки variants
  const variantDirs = findVariantDirs(PHOTOS_ROOT);
  console.log(`\nНайдено папок variants: ${variantDirs.length}`);
  
  // Очищаем папки variants
  let totalDeleted = 0;
  let totalKept = 0;
  for (const dir of variantDirs) {
    const relativePath = path.relative(PHOTOS_ROOT, dir);
    console.log(`\nОчистка: ${relativePath}`);
    const result = cleanVariantsDir(dir, keepFlagship);
    totalDeleted += result.deleted;
    totalKept += result.kept;
    if (result.deleted > 0) {
      console.log(`   Удалено файлов: ${result.deleted}`);
    }
    if (result.kept > 0) {
      console.log(`   Оставлено файлов: ${result.kept}`);
    }
  }
  
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`✅ ОЧИСТКА ЗАВЕРШЕНА`);
  console.log(`   Удалено файлов hashes.json: ${deletedHashes}`);
  console.log(`   Удалено фото в variants/: ${totalDeleted}`);
  if (totalKept > 0) {
    console.log(`   Оставлено файлов: ${totalKept}`);
  }
  console.log(`═══════════════════════════════════════════════════════════════\n`);
}

main();





