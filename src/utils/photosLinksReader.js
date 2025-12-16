/**
 * Утилиты для работы с photos_links.json (результат загрузки на Яндекс.Диск)
 */

import fs from 'fs';
import path from 'path';

/**
 * Находит последний photos_links файл в output/
 * @param {string} outputDir - путь к папке output
 * @returns {string|null} - путь к файлу или null
 */
function findLatestPhotosLinks(outputDir = 'output') {
  if (!fs.existsSync(outputDir)) return null;
  
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('photos_links_') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(outputDir, f),
      stat: fs.statSync(path.join(outputDir, f))
    }))
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
  
  return files.length > 0 ? files[0].path : null;
}

/**
 * Загружает photos_links и создаёт маппинг adId → public_url
 * @param {string} [filePath] - путь к файлу (если не указан, ищется автоматически)
 * @returns {Object} - { adId: url, ... }
 */
export function loadPhotosMapping(filePath) {
  try {
    const resolvedPath = filePath || findLatestPhotosLinks();
    
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      console.warn('   photos_links.json не найден');
      return {};
    }
    
    const data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const mapping = {};
    
    if (data.items && Array.isArray(data.items)) {
      data.items.forEach(item => {
        // Извлекаем adId из имени файла: s00_bron_251210_001.jpg → s00_bron_251210_001
        const adId = item.file.replace(/\.(jpg|jpeg|png|webp)$/i, '');
        mapping[adId] = item.public_url;
      });
    }
    
    return mapping;
  } catch (e) {
    console.warn(`   Не удалось прочитать photos_links: ${e.message}`);
    return {};
  }
}





