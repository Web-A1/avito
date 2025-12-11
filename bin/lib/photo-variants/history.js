import fs from 'fs';
import path from 'path';
import { DEFAULT_PHOTOS_ROOT } from './constants.js';

/**
 * Загружает историю объявлений с их хэшами.
 * Поддерживает миграцию со старого формата {hashes: [...]} на новый {version: 2, ads: [...]}.
 * @param {string} materialPath - путь к материалу (materialId/address)
 * @returns {Object} - {version: 2, ads: [{adId, hash, materialId, address, dateBegin, photoPath, timestamp}, ...]}
 */
export function loadHistory(materialPath) {
  if (!materialPath) return { version: 2, ads: [] };
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json');
  if (!fs.existsSync(historyPath)) return { version: 2, ads: [] };

  try {
    const json = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

    // Старый формат: {hashes: [...]} - мигрируем в новый
    if (Array.isArray(json.hashes)) {
      console.warn(`⚠️  История в старом формате (${materialPath}). Автоматическая миграция...`);
      return {
        version: 2,
        ads: json.hashes.map((hash, idx) => ({
          adId: `migrated_${String(idx + 1).padStart(3, '0')}`,
          hash,
          materialId: '',
          address: '',
          dateBegin: '',
          photoPath: '',
          timestamp: new Date().toISOString()
        }))
      };
    }

    // Новый формат: {version: 2, ads: [...]}
    return {
      version: json.version || 2,
      ads: Array.isArray(json.ads) ? json.ads : []
    };
  } catch (e) {
    console.warn(`⚠️  Не удалось прочитать историю ${historyPath}: ${e.message}`);
    return { version: 2, ads: [] };
  }
}

/**
 * Сохраняет историю объявлений.
 * @param {string} materialPath - путь к материалу (materialId/address)
 * @param {Array} ads - массив объектов с adId, hash и метаданными
 */
export function saveHistory(materialPath, ads) {
  if (!materialPath) return;
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json');
  try {
    const data = {
      version: 2,
      ads: Array.isArray(ads) ? ads : []
    };
    fs.writeFileSync(historyPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn(`⚠️  Не удалось сохранить историю ${materialPath}: ${e.message}`);
  }
}

/**
 * Фильтрует историю, оставляя только активные объявления (по adId из Excel).
 * @param {Array} ads - массив всех объявлений из истории
 * @param {Array<string>} activeAdIds - массив активных adId из Excel
 * @returns {Array} - отфильтрованный массив активных объявлений
 */
export function filterActiveAds(ads, activeAdIds) {
  if (!Array.isArray(ads) || !Array.isArray(activeAdIds)) return ads || [];
  const activeSet = new Set(activeAdIds);
  return ads.filter((ad) => ad.adId && activeSet.has(ad.adId));
}

