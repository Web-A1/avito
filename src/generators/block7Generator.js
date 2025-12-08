/**
 * Генератор технических характеристик (Блок 7)
 * 
 * Генерирует все 9 параметров Блока 7:
 * 1. Объем (м³)
 * 2. Самосвал (марка + номер)
 * 3. ХПЧ (%)
 * 4. ГП (%)
 * 5. Плотность (кг/м³)
 * 6. Модуль крупности
 * 7. Фракция
 * 8. ПНР (коэффициент)
 * 9. 𝜓 (коэффициент)
 */

import { BLOCK_7_TEMPLATE_HTML } from '../constants/blocks.js';
import { getSandType } from '../constants/sandTypes.js';
import { randomInRange, randomWithStep } from '../constants/parameters.js';
import { BLOCK_7_RANGES } from '../constants/parameters.js';
import { getRandomTruckBrand, generateTruckNumber } from '../constants/trucks.js';

/**
 * Генерирует объем (м³)
 * @returns {number} Объем от 1000 до 100000 м³
 */
function generateVolume() {
  return randomInRange(BLOCK_7_RANGES.VOLUME.min, BLOCK_7_RANGES.VOLUME.max);
}

/**
 * Генерирует содержание ХПЧ (%)
 * Любые случайные цифры до 3, с округлением до сотых
 * @returns {number} ХПЧ от 0.01 до 9.99, округление до сотых
 */
function generateXPC() {
  return randomWithStep(BLOCK_7_RANGES.XPC.min, BLOCK_7_RANGES.XPC.max, BLOCK_7_RANGES.XPC.step);
}

/**
 * Генерирует содержание ГП (%)
 * @returns {number} ГП от 0.1% до 2.0%, шаг 0.1%
 */
function generateGP() {
  return randomWithStep(BLOCK_7_RANGES.GP.min, BLOCK_7_RANGES.GP.max, BLOCK_7_RANGES.GP.step);
}

/**
 * Генерирует плотность (кг/м³) в зависимости от типа песка
 * @param {string} sandTypeId - ID типа песка
 * @returns {number} Плотность в кг/м³
 */
function generateDensity(sandTypeId) {
  const sandType = getSandType(sandTypeId);
  if (!sandType || !sandType.densityRange) {
    // Значение по умолчанию, если тип не найден
    return randomInRange(1350, 1450);
  }
  
  return randomInRange(sandType.densityRange.min, sandType.densityRange.max);
}

/**
 * Генерирует модуль крупности в зависимости от типа песка
 * @param {string} sandTypeId - ID типа песка
 * @returns {number} Модуль крупности (до тысячных)
 */
function generateModule(sandTypeId) {
  const sandType = getSandType(sandTypeId);
  if (!sandType || !sandType.moduleRange) {
    // Значение по умолчанию
    return parseFloat(randomInRange(1.000, 3.000, 3).toFixed(3));
  }
  
  const { min, max, precision } = sandType.moduleRange;
  return parseFloat(randomInRange(min, max, precision).toFixed(precision));
}

/**
 * Генерирует фракцию в зависимости от типа песка
 * Фракция соответствует диапазону модуля крупности, округление до сотых
 * @param {string} sandTypeId - ID типа песка
 * @param {number} module - Модуль крупности (для согласованности)
 * @returns {number} Фракция (до сотых)
 */
function generateFraction(sandTypeId, module) {
  const sandType = getSandType(sandTypeId);
  if (!sandType || !sandType.fractionRange) {
    // Значение по умолчанию, округление модуля до сотых
    return parseFloat(module.toFixed(2));
  }
  
  const { min, max, precision } = sandType.fractionRange;
  // Генерируем фракцию в том же диапазоне, что и модуль
  const fraction = randomInRange(min, max, precision);
  return parseFloat(fraction.toFixed(precision));
}

/**
 * Генерирует коэффициент ПНР
 * @returns {number} ПНР от 0.50 до 1.00, шаг 0.05
 */
function generatePNR() {
  return randomWithStep(BLOCK_7_RANGES.PNR.min, BLOCK_7_RANGES.PNR.max, BLOCK_7_RANGES.PNR.step);
}

/**
 * Генерирует коэффициент 𝜓
 * @returns {number} 𝜓 от 0.10 до 2.00, шаг 0.10
 */
function generatePSI() {
  // Исправляем: в документации указано до 2.00, но в parameters.js указано до 3.00
  // Используем значение из документации (до 2.00)
  return randomWithStep(0.10, 2.00, 0.10);
}

/**
 * Генерирует все параметры Блока 7
 * @param {string} sandTypeId - ID типа песка
 * @param {string} sandTypeDisplayName - Отображаемое название типа песка (для шаблона)
 * @returns {Object} Объект со всеми параметрами Блока 7
 */
export function generateBlock7Params(sandTypeId, sandTypeDisplayName) {
  // Генерируем модуль крупности
  const module = generateModule(sandTypeId);
  
  // Генерируем все параметры
  const params = {
    sandType: sandTypeDisplayName,
    volume: generateVolume(),
    truckBrand: getRandomTruckBrand(),
    truckNumber: generateTruckNumber(),
    xpc: generateXPC(),
    gp: generateGP(),
    density: generateDensity(sandTypeId),
    module: module,
    fraction: generateFraction(sandTypeId, module),
    pnr: generatePNR(),
    psi: generatePSI()
  };
  
  return params;
}

/**
 * Генерирует и форматирует Блок 7 в HTML формате
 * @param {string} sandTypeId - ID типа песка
 * @param {string} sandTypeDisplayName - Отображаемое название типа песка
 * @returns {string} Отформатированный Блок 7 в HTML
 */
export function generateBlock7(sandTypeId, sandTypeDisplayName) {
  const params = generateBlock7Params(sandTypeId, sandTypeDisplayName);
  return BLOCK_7_TEMPLATE_HTML(params);
}

/**
 * Генерирует параметры Блока 7 для проверки дублей
 * Возвращает объект с параметрами для сравнения
 * @param {string} sandTypeId - ID типа песка
 * @param {string} sandTypeDisplayName - Отображаемое название типа песка
 * @returns {Object} Параметры Блока 7 для проверки дублей
 */
export function generateBlock7ForDuplicateCheck(sandTypeId, sandTypeDisplayName) {
  const params = generateBlock7Params(sandTypeId, sandTypeDisplayName);
  
  // Возвращаем только параметры для проверки дублей (9 параметров)
  return {
    volume: params.volume,
    truck: `${params.truckBrand} ${params.truckNumber}`, // Марка + номер как один параметр
    xpc: params.xpc,
    gp: params.gp,
    density: params.density,
    module: params.module,
    fraction: params.fraction,
    pnr: params.pnr,
    psi: params.psi
  };
}


