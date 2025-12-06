/**
 * Универсальный генератор объявлений с проверкой дублей.
 * Использует стратегии по материалам (песок и др.), чтобы расширяться без переписывания.
 */

import { isDuplicate } from '../validators/duplicateChecker.js';
import { sandStrategy } from './materialStrategies/sand.js';

const STRATEGIES = {
  sand: sandStrategy
  // TODO: добавить стратегии для щебня и других материалов
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
  currentAds = []
}) {
  const strategy = STRATEGIES[material];
  if (!strategy) {
    throw new Error(`Strategy for material "${material}" is not implemented`);
  }

  const ads = [];
  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let ad;
    do {
      ad = strategy.buildAd({ materialId, titles, addresses, photos });
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
