/**
 * Универсальный генератор объявлений с проверкой дублей.
 * Использует стратегии по материалам (песок и др.), чтобы расширяться без переписывания.
 */

import { isDuplicate } from '../validators/duplicateChecker.js';
import { sandStrategy } from './materialStrategies/sand.js';
import { rubbleStrategy } from './materialStrategies/rubble.js';

const STRATEGIES = {
  sand: sandStrategy,
  rubble: rubbleStrategy
};

/**
 * Генерирует массив объявлений с проверкой дублей.
 * @param {Object} params
 * @param {string} params.material - имя стратегии (например, "sand")
 * @param {string} params.materialId - ID конкретного материала (например, sandTypeId)
 * @param {number} params.count - количество объявлений
 * @param {string[]} params.titles
 * @param {string[]} params.addresses
 * @param {string[]} params.photos
 * @param {number} [params.maxAttempts=50]
 * @param {Array<Object>} [params.currentAds=[]] - текущие объявления (например, из выгрузки Авито)
 * @param {boolean|Array<boolean>} [params.isFlagship=false] - флагманское объявление (или массив для каждого объявления)
 * @returns {Object[]} список уникальных объявлений
 */
export function generateAds({
  material = 'sand',
  materialId,
  count,
  titles = [],
  addresses = [],
  photos = [],
  maxAttempts = 50,
  currentAds = [],
  isFlagship = false
}) {
  const strategy = STRATEGIES[material];
  if (!strategy) {
    throw new Error(`Strategy for material "${material}" is not implemented`);
  }

  // Преобразуем isFlagship в массив, если это не массив
  const flagshipFlags = Array.isArray(isFlagship) 
    ? isFlagship 
    : Array(count).fill(isFlagship);

  const ads = [];
  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let ad;
    do {
      ad = strategy.buildAd({ 
        materialId, 
        titles, 
        addresses, 
        photos, 
        isFlagship: flagshipFlags[i] || false 
      });
      attempts += 1;
      if (attempts >= maxAttempts) {
        // сохраняем даже если дубль, чтобы не зациклиться
        break;
      }
    } while (
      isDuplicate(ad, ads, strategy.duplicateConfig).isDuplicate ||
      isDuplicate(ad, currentAds, strategy.duplicateConfig).isDuplicate
    );

    ads.push(ad);
  }

  return ads;
}
