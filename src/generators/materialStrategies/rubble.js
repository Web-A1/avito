/**
 * Стратегия генерации объявлений для щебня.
 * По аналогии с песком: 7-блочная структура описания,
 * рандомный техблок (Блок 7) и дубль-чек по основным полям + параметрам Блока 7.
 */

import { getRubbleType } from '../../constants/rubbleTypes.js';
import { generateRubbleDescription } from '../materials/rubble/descriptionGenerator.js';

const DEFAULT_RUBBLE_TYPE_ID = 'scheben_vtorichnyi_40_70';

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Конфигурация дубль-чека для щебня (по аналогии с песком).
export const RUBBLE_DUPLICATE_CONFIG = {
  mainFields: [
    'title',
    'rubbleType',
    'fraction',
    'color',
    'priceFor',
    'price',
    'address',
    'photoLink'
  ],
  // Используем техпараметры Блока 7 для дополнительной уникализации
  block7Path: 'block7',
  block7Fields: [
    'volume',
    'truck',
    'concreteGrade',
    'frostResistance',
    'flakinessIndex',
    'density',
    'compactionCoefficient'
  ],
  minMainDifferences: 3,
  minBlock7Differences: 5
};

/**
 * Формирует одно объявление по щебню (минимальный рабочий вариант).
 * @param {Object} params
 * @param {string} params.materialId - ID типа щебня (rubbleTypeId)
 * @param {string[]} params.titles
 * @param {string[]} params.addresses
 * @param {string[]} params.photos
 * @param {boolean} [params.isFlagship=false] - флагманское объявление (пока не используем отдельно)
 * @returns {Object} объявление
 */
export function buildRubbleAd({
  materialId,
  titles = [],
  addresses = [],
  photos = [],
  isFlagship = false
} = {}) {
  const rubbleTypeId = materialId || DEFAULT_RUBBLE_TYPE_ID;
  const rubbleType = getRubbleType(rubbleTypeId);

  const fraction =
    rubbleTypeId === 'scheben_vtorichnyi_5_20'
      ? '5–20 мм'
      : rubbleTypeId === 'scheben_vtorichnyi_40_70'
      ? '40–70 мм'
      : '';

  const baseTitle = rubbleType?.name || 'Щебень вторичный';

  const title =
    titles.length > 0
      ? randomChoice(titles)
      : `${baseTitle} с доставкой`;

  const address = addresses.length ? randomChoice(addresses) : 'Адрес не указан';
  const photoLink = photos.length ? randomChoice(photos) : '';

  // Цена всегда за тонну, базовая — из RUBBLE_TYPES
  const priceFor = 'тонну';
  const price = rubbleType?.basePricePerTonne ?? 0;

  // Цвет для щебня: используем базовый нейтральный вариант
  const color = 'Серый';

  // Полноценное 7-блочное описание (аналог песка)
  const {
    description,
    latinReplacements,
    blockOrder,
    separators,
    block7Params,
    block1Variant
  } = generateRubbleDescription(rubbleTypeId, { isFlagship });

  // Пробрасываем техпараметры в объявление, чтобы не зависеть от парсинга описания
  const concreteGrade = rubbleType?.defaultConcreteGrade
    ? `M${rubbleType.defaultConcreteGrade}`
    : '';
  const frostResistance = rubbleType?.defaultFrostResistance
    ? `F${rubbleType.defaultFrostResistance}`
    : '';
  const flakinessIndex = rubbleType?.defaultFlakinessIndex ?? '';

  return {
    title,
    description,
    // Эти поля важны для XML-генератора
    bulkMaterialType: 'Щебень, гравий',
    bulkMaterialSubType: 'Щебень',
    rubbleType: 'Вторичный',
    fraction,
    concreteGrade,
    frostResistance,
    flakinessIndex,
    color,
    priceFor,
    price,
    address,
    photoLink,
    latinReplacements,
    blockOrder,
    separators,
    block7: block7Params,
    block1Variant,
    fixed: {
      minSaleQuantity: 20,
      availability: 'В наличии',
      packagingType: 'Россыпью',
      // По договорённости используем коэффициент уплотнения = насыпной плотности (т/м³)
      compactionCoefficient: rubbleType?.compactionCoefficient ?? rubbleType?.bulkDensityTPerM3 ?? null
    }
  };
}

// Конфигурацию дубль-чека добавим отдельным шагом (B2),
// чтобы можно было осознанно выбрать поля для сравнения под щебень.
export const rubbleStrategy = {
  name: 'rubble',
  duplicateConfig: RUBBLE_DUPLICATE_CONFIG,
  buildAd: buildRubbleAd
};
