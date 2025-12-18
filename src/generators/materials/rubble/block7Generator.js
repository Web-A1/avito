/**
 * Генератор технических характеристик (Блок 7) для щебня.
 * Аналогичен песку: рандомные параметры в правдоподобных диапазонах
 * для усиления уникальности описаний.
 */

import { RUBBLE_BLOCK_7_TEMPLATE_HTML } from '../../../constants/blocks.js';
import { getRubbleType } from '../../../constants/rubbleTypes.js';
import { randomInRange } from '../../../constants/parameters.js';
import { BLOCK_7_RANGES } from '../../../constants/parameters.js';
import { getRandomTruckBrand, generateTruckNumber } from '../../../constants/trucks.js';

const DEFAULT_RUBBLE_TYPE_ID = 'scheben_vtorichnyi_40_70';

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRubbleVolume() {
  return randomInRange(BLOCK_7_RANGES.VOLUME.min, BLOCK_7_RANGES.VOLUME.max);
}

export function generateRubbleBlock7Params(rubbleTypeId, options = {}) {
  const { isFlagship = false } = options;
  const id = rubbleTypeId || DEFAULT_RUBBLE_TYPE_ID;
  const rubbleType = getRubbleType(id) || getRubbleType(DEFAULT_RUBBLE_TYPE_ID);

  const fraction =
    id === 'scheben_vtorichnyi_5_20'
      ? '5–20'
      : id === 'scheben_vtorichnyi_40_70'
      ? '40–70'
      : '';

  const volume = generateRubbleVolume();

  const truckBrand = getRandomTruckBrand();
  const truckNumber = generateTruckNumber();
  const truck = `${truckBrand} ${truckNumber}`;

  // Марка бетона: для флагманского объявления — фиксированное значение,
  // для остальных — диапазон в рамках допустимых значений Авито (M300, M400, M600).
  const concreteGrade = isFlagship ? 400 : pickRandom([300, 400, 600]);
  const frostResistance = pickRandom([100, 150, 200, 300]);
  const flakinessIndex = pickRandom([1, 2, 3, 4]);

  const baseDensity = rubbleType?.bulkDensityTPerM3 || 1.3;
  const density = parseFloat(
    randomInRange(baseDensity * 0.9, baseDensity * 1.1, 2).toFixed(2)
  );

  const compactionCoefficient = parseFloat(
    randomInRange(1.2, 1.6, 2).toFixed(2)
  );

  return {
    fraction,
    volume,
    truckBrand,
    truckNumber,
    truck,
    concreteGrade,
    frostResistance,
    flakinessIndex,
    density,
    compactionCoefficient
  };
}

export function generateRubbleBlock7(rubbleTypeId) {
  const params = generateRubbleBlock7Params(rubbleTypeId);
  return RUBBLE_BLOCK_7_TEMPLATE_HTML(params);
}


