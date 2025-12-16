/**
 * Стратегия генерации объявлений для песка.
 * Выделена отдельно, чтобы легко добавить другие материалы (щебень и т.д.).
 */

import { generateDescription } from '../descriptionGenerator.js';
import { getSandType } from '../../constants/sandTypes.js';
import { VARIATION_PARAMETERS, FIXED_PARAMETERS, FLAGSHIP_PARAMETERS, generatePrice } from '../../constants/parameters.js';

// Конфигурация дубль-чека для песка
export const SAND_DUPLICATE_CONFIG = {
  mainFields: [
    'title',
    'bulkMaterialSubType',
    'color',
    'priceFor',
    'price',
    'address',
    'block1Variant',
    'photoLink',
    'latinReplacements'
  ],
  block7Path: 'block7',
  block7Fields: ['volume', 'truck', 'xpc', 'gp', 'density', 'module', 'fraction', 'pnr', 'psi'],
  minMainDifferences: 3,
  minBlock7Differences: 5
};

const DEFAULT_SAND_TYPE_ID = 'karier_neseyan_nemyt_pesok';

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Формирует одно объявление по песку.
 * @param {Object} params
 * @param {string} params.materialId - ID типа песка (sandTypeId)
 * @param {string[]} params.titles
 * @param {string[]} params.addresses
 * @param {string[]} params.photos
 * @param {boolean} [params.isFlagship=false] - Флагманское объявление (используются точные характеристики)
 * @returns {Object} объявление
 */
export function buildSandAd({ materialId, titles = [], addresses = [], photos = [], isFlagship = false } = {}) {
  const sandTypeId = materialId || DEFAULT_SAND_TYPE_ID;
  const sandType = getSandType(sandTypeId);

  const title = titles.length ? randomChoice(titles) : 'Песок';
  const address = addresses.length ? randomChoice(addresses) : 'Адрес не указан';
  const photoLink = photos.length ? randomChoice(photos) : '';

  // Для флагманского объявления используем точные значения
  const priceFor = isFlagship 
    ? FLAGSHIP_PARAMETERS.PRICE_FOR 
    : randomChoice(VARIATION_PARAMETERS.PRICE_FOR);
  
  const color = isFlagship 
    ? FLAGSHIP_PARAMETERS.COLOR 
    : randomChoice(VARIATION_PARAMETERS.COLOR);
  
  // Для флагманского объявления используем точную базовую цену без вариаций
  const price = sandType
    ? (isFlagship 
        ? sandType.basePrice 
        : generatePrice(sandType.basePrice))
    : 0;

  const { description, latinReplacements, blockOrder, separators, block7Params, block1Variant } =
    generateDescription(sandTypeId, sandType?.displayName || 'Песок карьерный');

  return {
    title,
    description,
    latinReplacements,
    blockOrder,
    separators,
    block7: block7Params,
    block1Variant,
    bulkMaterialSubType: FIXED_PARAMETERS.BULK_MATERIAL_SUBTYPE,
    color,
    priceFor,
    price,
    address,
    photoLink,
    fixed: {
      minSaleQuantity: FIXED_PARAMETERS.MIN_SALE_QUANTITY,
      availability: FIXED_PARAMETERS.AVAILABILITY,
      packagingType: FIXED_PARAMETERS.PACKAGING_TYPE,
      compactionCoefficient: sandType?.compactionCoefficient
    }
  };
}

export const sandStrategy = {
  name: 'sand',
  duplicateConfig: SAND_DUPLICATE_CONFIG,
  buildAd: buildSandAd
};
