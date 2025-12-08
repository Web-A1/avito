/**
 * Константы для параметров генерации объявлений
 * Все диапазоны значений для технических характеристик и других параметров
 */

// Диапазоны для технических характеристик (Блок 7)
export const BLOCK_7_RANGES = {
  // Объем (м³)
  VOLUME: {
    min: 1000,
    max: 100000
  },
  
  // Содержание ХПЧ (без единицы изменения - только значение)
  XPC: {
    min: 0.01,
    max: 9.99,
    step: 0.01 // шаг 0.01
  },
  
  // Содержание ГП (%)
  GP: {
    min: 0.1,
    max: 2.0,
    step: 0.1 // шаг 0.1%
  },
  
  // Коэффициент ПНР
  PNR: {
    min: 0.50,
    max: 1.00,
    step: 0.05 // шаг 0.05
  },
  
  // Коэффициент 𝜓
  PSI: {
    min: 0.10,
    max: 3.00,
    step: 0.01 // шаг 0.01
  }
};

// Параметры для вариаций объявлений
export const VARIATION_PARAMETERS = {
  // PriceFor (единица измерения цены)
  PRICE_FOR: ['м³', 'тонну'],
  
  // Color (цвет песка)
  COLOR: ['Белый', 'Жёлтый', 'Серый'],
  
  // Кратность цены
  PRICE_STEP: 50
};

// Фиксированные параметры
export const FIXED_PARAMETERS = {
  // Минимальный заказ (м³)
  MIN_SALE_QUANTITY: 20,
  
  // Доступность
  AVAILABILITY: 'В наличии',
  
  // Форма продажи
  PACKAGING_TYPE: 'Россыпью',
  
  // BulkMaterialSubType (на начальном этапе)
  BULK_MATERIAL_SUBTYPE: 'Карьерный'
};

/**
 * Генерирует случайное число в диапазоне
 * @param {number} min - Минимальное значение
 * @param {number} max - Максимальное значение
 * @param {number} precision - Количество знаков после запятой (опционально)
 * @returns {number} Случайное число
 */
export function randomInRange(min, max, precision = 0) {
  const value = Math.random() * (max - min) + min;
  return precision > 0 ? parseFloat(value.toFixed(precision)) : Math.floor(value);
}

/**
 * Генерирует случайное число с шагом
 * @param {number} min - Минимальное значение
 * @param {number} max - Максимальное значение
 * @param {number} step - Шаг
 * @returns {number} Случайное число с учетом шага
 */
export function randomWithStep(min, max, step) {
  const steps = Math.floor((max - min) / step) + 1;
  const randomStep = Math.floor(Math.random() * steps);
  return parseFloat((min + randomStep * step).toFixed(step.toString().split('.')[1]?.length || 0));
}

/**
 * Генерирует цену от basePrice до basePrice+100 с шагом 30
 * @param {number} basePrice - Базовая цена
 * @returns {number} Случайная цена в заданном диапазоне
 */
export function generatePrice(basePrice) {
  const priceStep = 30;
  const maxDelta = 100;
  const stepsCount = Math.floor(maxDelta / priceStep);
  const stepIndex = Math.floor(Math.random() * (stepsCount + 1));
  const delta = stepIndex * priceStep;
  const price = basePrice + delta;
  return Math.min(price, basePrice + maxDelta);
}
