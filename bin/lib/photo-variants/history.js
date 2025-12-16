import fs from 'fs';
import path from 'path';
import { DEFAULT_PHOTOS_ROOT } from './constants.js';

/**
 * Загружает историю объявлений с их хэшами.
 * Поддерживает миграцию со старого формата {hashes: [...]} на новый {version: 2, ads: [...]}.
 * Также загружает временную историю (hashes.json.tmp), если она есть, для проверки дубликатов.
 * @param {string} materialPath - путь к материалу (materialId/address)
 * @param {boolean} includeTmp - загружать ли временную историю (по умолчанию true)
 * @returns {Object} - {version: 2, ads: [{adId, hash, materialId, address, dateBegin, photoPath, timestamp}, ...]}
 */
export function loadHistory(materialPath, includeTmp = true) {
  if (!materialPath) return { version: 2, ads: [] };
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json');
  
  let mainAds = [];
  if (fs.existsSync(historyPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

      // Старый формат: {hashes: [...]} - мигрируем в новый
      if (Array.isArray(json.hashes)) {
        console.warn(`⚠️  История в старом формате (${materialPath}). Автоматическая миграция...`);
        mainAds = json.hashes.map((hash, idx) => ({
          adId: `migrated_${String(idx + 1).padStart(3, '0')}`,
          hash,
          materialId: '',
          address: '',
          dateBegin: '',
          photoPath: '',
          timestamp: new Date().toISOString()
        }));
      } else {
        // Новый формат: {version: 2, ads: [...]}
        mainAds = Array.isArray(json.ads) ? json.ads : [];
      }
    } catch (e) {
      console.warn(`⚠️  Не удалось прочитать историю ${historyPath}: ${e.message}`);
    }
  }
  
  // Загружаем временную историю, если она есть (для проверки дубликатов во время генерации)
  let tmpAds = [];
  if (includeTmp) {
    const tmpData = loadHistoryTmp(materialPath);
    tmpAds = tmpData.ads || [];
  }
  
  // Объединяем: сначала основная история, потом временная (временная перезаписывает по adId)
  const adsMap = new Map();
  for (const ad of mainAds) {
    if (ad.adId) {
      adsMap.set(ad.adId, ad);
    }
  }
  for (const ad of tmpAds) {
    if (ad.adId) {
      adsMap.set(ad.adId, ad);
    }
  }
  
  return {
    version: 2,
    ads: Array.from(adsMap.values())
  };
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
 * Сохраняет историю во временный файл (hashes.json.tmp).
 * Используется для сохранения истории до успешной генерации XML.
 * @param {string} materialPath - путь к материалу (materialId/address)
 * @param {Array} ads - массив объектов с adId, hash и метаданными
 */
export function saveHistoryTmp(materialPath, ads) {
  if (!materialPath) return;
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json.tmp');
  try {
    const data = {
      version: 2,
      ads: Array.isArray(ads) ? ads : []
    };
    fs.writeFileSync(historyPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn(`⚠️  Не удалось сохранить временную историю ${materialPath}: ${e.message}`);
  }
}

/**
 * Загружает временную историю из hashes.json.tmp.
 * @param {string} materialPath - путь к материалу (materialId/address)
 * @returns {Object} - {version: 2, ads: [...]}
 */
export function loadHistoryTmp(materialPath) {
  if (!materialPath) return { version: 2, ads: [] };
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json.tmp');
  if (!fs.existsSync(historyPath)) return { version: 2, ads: [] };

  try {
    const json = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    return {
      version: json.version || 2,
      ads: Array.isArray(json.ads) ? json.ads : []
    };
  } catch (e) {
    console.warn(`⚠️  Не удалось прочитать временную историю ${historyPath}: ${e.message}`);
    return { version: 2, ads: [] };
  }
}

/**
 * Переносит историю из временного файла в основной (hashes.json).
 * Вызывается после успешной генерации XML.
 * @param {string} materialPath - путь к материалу (materialId/address)
 * @returns {boolean} - true если перенос выполнен, false если временного файла нет
 */
export function commitHistoryFromTmp(materialPath) {
  if (!materialPath) return false;
  
  const tmpPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json.tmp');
  const mainPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json');
  
  if (!fs.existsSync(tmpPath)) {
    return false; // Временного файла нет - ничего не делаем
  }

  try {
    // Загружаем временную историю
    const tmpData = loadHistoryTmp(materialPath);
    
    // Загружаем существующую основную историю (если есть)
    const mainData = loadHistory(materialPath);
    
    // Объединяем: сначала существующая история, потом временная (чтобы не было дубликатов)
    // Создаем Map для быстрого поиска по adId
    const adsMap = new Map();
    
    // Сначала добавляем существующие записи
    for (const ad of mainData.ads) {
      if (ad.adId) {
        adsMap.set(ad.adId, ad);
      }
    }
    
    // Затем добавляем новые из временной истории (перезаписывают существующие по adId)
    for (const ad of tmpData.ads) {
      if (ad.adId) {
        adsMap.set(ad.adId, ad);
      }
    }
    
    // Сохраняем объединенную историю в основной файл
    const mergedAds = Array.from(adsMap.values());
    saveHistory(materialPath, mergedAds);
    
    // Удаляем временный файл
    fs.unlinkSync(tmpPath);
    
    return true;
  } catch (e) {
    console.warn(`⚠️  Не удалось перенести историю из временного файла ${materialPath}: ${e.message}`);
    return false;
  }
}

/**
 * Удаляет временный файл истории (hashes.json.tmp).
 * Вызывается при отмене генерации или ошибке.
 * @param {string} materialPath - путь к материалу (materialId/address)
 */
export function discardHistoryTmp(materialPath) {
  if (!materialPath) return;
  const tmpPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json.tmp');
  if (fs.existsSync(tmpPath)) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      console.warn(`⚠️  Не удалось удалить временную историю ${tmpPath}: ${e.message}`);
    }
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

/**
 * Синхронизирует историю с активными объявлениями из последнего XML и Excel.
 * Оставляет только те записи, которые есть в последнем XML или в Excel (по AvitoId).
 * @param {string} materialPath - путь к материалу (materialId/address)
 * @param {Array<string>} adIdsFromXml - массив adId из последнего XML
 * @param {Array<Object>} currentAds - массив текущих объявлений из Excel (с AvitoId)
 * @returns {Object} - {kept: number, removed: number, total: number}
 */
export function syncHistoryWithActiveAds(materialPath, adIdsFromXml = [], currentAds = []) {
  if (!materialPath) return { kept: 0, removed: 0, total: 0 };
  
  const historyData = loadHistory(materialPath);
  if (!historyData.ads || historyData.ads.length === 0) {
    return { kept: 0, removed: 0, total: 0 };
  }
  
  const beforeCount = historyData.ads.length;
  
  // Создаем множества для быстрой проверки
  const xmlAdIdsSet = new Set(adIdsFromXml);
  
  // Создаем множества AvitoId из Excel для проверки
  const excelAvitoIdsSet = new Set(currentAds.map(ad => ad.Id || ad.AvitoId).filter(Boolean));
  
  // Создаем маппинг AvitoId -> adId из Excel (если в Excel есть adId)
  const avitoIdToAdIdMap = new Map();
  currentAds.forEach(ad => {
    if (ad.adId && (ad.Id || ad.AvitoId)) {
      avitoIdToAdIdMap.set(ad.Id || ad.AvitoId, ad.adId);
    }
  });
  
  // Фильтруем историю: оставляем только те записи, которые:
  // 1. Есть в последнем XML (по adId)
  // 2. ИЛИ есть в Excel (по AvitoId, если он сохранен в истории)
  const filteredAds = historyData.ads.filter(ad => {
    // Проверяем по adId из XML
    if (ad.adId && xmlAdIdsSet.has(ad.adId)) {
      return true;
    }
    
    // Проверяем по AvitoId из Excel (если он сохранен в истории)
    if (ad.avitoId && excelAvitoIdsSet.has(ad.avitoId)) {
      return true;
    }
    
    // Если ни то, ни другое - удаляем
    return false;
  });
  
  const removed = beforeCount - filteredAds.length;
  
  // Сохраняем отфильтрованную историю
  if (removed > 0) {
    saveHistory(materialPath, filteredAds);
  }
  
  return {
    kept: filteredAds.length,
    removed,
    total: beforeCount
  };
}

/**
 * Обновляет запись в истории с AvitoId (для старых объявлений).
 * @param {string} materialPath - путь к материалу (materialId/address)
 * @param {string} avitoId - AvitoId объявления
 * @param {string} photoHash - хеш нового фото (если обновлено)
 * @param {string} photoPath - путь к новому фото (если обновлено)
 * @returns {boolean} - true если запись обновлена, false если не найдена
 */
export function updateHistoryWithAvitoId(materialPath, avitoId, photoHash = null, photoPath = null) {
  if (!materialPath || !avitoId) return false;
  
  const historyData = loadHistory(materialPath);
  if (!historyData.ads || historyData.ads.length === 0) return false;
  
  // Ищем запись по AvitoId или обновляем последнюю запись для этого объявления
  // В истории может не быть AvitoId, поэтому ищем по другим признакам
  let found = false;
  let updated = false;
  
  // Сначала пытаемся найти по avitoId
  for (const ad of historyData.ads) {
    if (ad.avitoId === avitoId) {
      if (photoHash) ad.hash = photoHash;
      if (photoPath) ad.photoPath = photoPath;
      ad.avitoId = avitoId; // Обновляем/сохраняем AvitoId
      updated = true;
      found = true;
      break;
    }
  }
  
  // Если не нашли, но есть фото с таким же именем файла (AvitoId.jpg)
  if (!found && photoPath) {
    const fileName = path.basename(photoPath, path.extname(photoPath));
    if (fileName === avitoId) {
      // Ищем последнюю запись без AvitoId и обновляем её
      for (let i = historyData.ads.length - 1; i >= 0; i--) {
        const ad = historyData.ads[i];
        if (!ad.avitoId) {
          ad.avitoId = avitoId;
          if (photoHash) ad.hash = photoHash;
          if (photoPath) ad.photoPath = photoPath;
          updated = true;
          found = true;
          break;
        }
      }
    }
  }
  
  if (updated) {
    saveHistory(materialPath, historyData.ads);
  }
  
  return found;
}

