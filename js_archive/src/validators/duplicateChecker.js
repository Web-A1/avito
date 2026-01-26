/**
 * Двухуровневая проверка дублей объявлений.
 * Конфиг по умолчанию — песок: 9 основных полей (>=3 отличий) и 9 полей блока 7 (>=5 отличий).
 * Можно передать свой конфиг для других материалов.
 */

export const DEFAULT_DUPLICATE_CONFIG = {
  mainFields: [
    'title',
    'bulkMaterialSubType', // для песка
    'color',
    'priceFor',
    'price',
    'address',
    'block1Variant',
    'photoLink',
    'latinReplacements'
  ],
  block7Path: 'block7',
  block7Fields: [
    'volume',
    'truck',
    'xpc',
    'gp',
    'density',
    'module',
    'fraction',
    'pnr',
    'psi'
  ],
  minMainDifferences: 3,
  minBlock7Differences: 5
};

function isEqual(a, b) {
  if (a === undefined && b === undefined) return true;
  return a === b;
}

function countDifferences(objA = {}, objB = {}, fields = []) {
  let diff = 0;
  fields.forEach((field) => {
    if (!isEqual(objA[field], objB[field])) {
      diff += 1;
    }
  });
  return diff;
}

/**
 * Сравнивает два объявления и возвращает число отличий по двум группам параметров.
 * @param {Object} adA - Первое объявление
 * @param {Object} adB - Второе объявление
 * @param {Object} config - Конфиг с полями и порогами
 * @returns {{mainDifferences: number, block7Differences: number}}
 */
export function compareAds(adA = {}, adB = {}, config = DEFAULT_DUPLICATE_CONFIG) {
  const { mainFields, block7Fields, block7Path } = config;
  const block7A = block7Path ? adA[block7Path] : adA;
  const block7B = block7Path ? adB[block7Path] : adB;

  const mainDifferences = countDifferences(adA, adB, mainFields);
  const block7Differences = countDifferences(block7A || {}, block7B || {}, block7Fields);
  return { mainDifferences, block7Differences };
}

/**
 * Проверяет объявление на дубли среди уже сгенерированных.
 * @param {Object} newAd - Новое объявление
 * @param {Array<Object>} existingAds - Список уже сгенерированных объявлений
 * @param {Object} config - Конфиг с полями и порогами
 * @returns {{isDuplicate: boolean, duplicateOf?: Object, mainDifferences?: number, block7Differences?: number}}
 */
export function isDuplicate(newAd, existingAds = [], config = DEFAULT_DUPLICATE_CONFIG) {
  for (const ad of existingAds) {
    const { mainDifferences, block7Differences } = compareAds(newAd, ad, config);
    const uniqueEnough =
      mainDifferences >= (config.minMainDifferences || 0) &&
      block7Differences >= (config.minBlock7Differences || 0);
    if (!uniqueEnough) {
      return {
        isDuplicate: true,
        duplicateOf: ad,
        mainDifferences,
        block7Differences
      };
    }
  }

  return { isDuplicate: false };
}
