/**
 * Генератор технических характеристик (Блок 7) для щебня.
 * Аналогичен песку: рандомные параметры в правдоподобных диапазонах
 * для усиления уникальности описаний.
 */

import { RUBBLE_BLOCK_7_TEMPLATE_HTML } from '../../../constants/blocks.js';
import { getRubbleType } from '../../../constants/rubbleTypes.js';
import { randomInRange, randomWithStep, BLOCK_7_RANGES } from '../../../constants/parameters.js';
import { getRandomTruckBrand, generateTruckNumber } from '../../../constants/trucks.js';

const DEFAULT_RUBBLE_TYPE_ID = 'scheben_vtorichnyi_40_70';

const FRACTION_ID_TO_LABEL = {
  scheben_vtorichnyi_5_20: '5–20',
  scheben_vtorichnyi_40_70: '40–70'
};

const DEFAULT_RANDOM_LIMITS = {
  xpc: { min: 0.1, max: 1.0, step: 0.01 }, // содержание ХПЧ
  gp: { min: 0.1, max: 1.5, step: 0.1 }, // содержание ГП
  densityKgM3: { min: 1200, max: 1500, precision: 1 }, // насыпная плотность в кг/м³
  module: { min: 1.4, max: 3.2, precision: 3 },
  fractionA: { min: 2.0, max: 4.0, precision: 3 },
  pnr: { min: 0.6, max: 1.0, step: 0.05 },
  psi: { min: 0.3, max: 1.5, step: 0.01 }
};

export function generateRubbleBlock7Params(rubbleTypeId, options = {}) {
  const { materialLabel: customLabel, fractionLabel: customFraction } = options;
  const id = rubbleTypeId || DEFAULT_RUBBLE_TYPE_ID;
  const rubbleType = getRubbleType(id) || getRubbleType(DEFAULT_RUBBLE_TYPE_ID);

  const productFraction = customFraction || FRACTION_ID_TO_LABEL[id] || FRACTION_ID_TO_LABEL[DEFAULT_RUBBLE_TYPE_ID];
  const materialLabel =
    customLabel || (productFraction ? `Щебень вторичный ${productFraction}` : 'Щебень вторичный');

  const volume = randomInRange(BLOCK_7_RANGES.VOLUME.min, BLOCK_7_RANGES.VOLUME.max);

  const truckBrand = getRandomTruckBrand();
  const truckNumber = generateTruckNumber();
  const truck = `${truckBrand} ${truckNumber}`;

  const densityKgM3 = parseFloat(
    randomInRange(
      DEFAULT_RANDOM_LIMITS.densityKgM3.min,
      DEFAULT_RANDOM_LIMITS.densityKgM3.max,
      DEFAULT_RANDOM_LIMITS.densityKgM3.precision
    ).toFixed(DEFAULT_RANDOM_LIMITS.densityKgM3.precision)
  );

  const module = parseFloat(
    randomInRange(
      DEFAULT_RANDOM_LIMITS.module.min,
      DEFAULT_RANDOM_LIMITS.module.max,
      DEFAULT_RANDOM_LIMITS.module.precision
    ).toFixed(DEFAULT_RANDOM_LIMITS.module.precision)
  );

  const fraction = parseFloat(
    randomInRange(
      DEFAULT_RANDOM_LIMITS.fractionA.min,
      DEFAULT_RANDOM_LIMITS.fractionA.max,
      DEFAULT_RANDOM_LIMITS.fractionA.precision
    ).toFixed(DEFAULT_RANDOM_LIMITS.fractionA.precision)
  );

  const xpc = randomWithStep(DEFAULT_RANDOM_LIMITS.xpc.min, DEFAULT_RANDOM_LIMITS.xpc.max, DEFAULT_RANDOM_LIMITS.xpc.step);
  const gp = randomWithStep(DEFAULT_RANDOM_LIMITS.gp.min, DEFAULT_RANDOM_LIMITS.gp.max, DEFAULT_RANDOM_LIMITS.gp.step);
  const pnr = randomWithStep(DEFAULT_RANDOM_LIMITS.pnr.min, DEFAULT_RANDOM_LIMITS.pnr.max, DEFAULT_RANDOM_LIMITS.pnr.step);
  const psi = randomWithStep(DEFAULT_RANDOM_LIMITS.psi.min, DEFAULT_RANDOM_LIMITS.psi.max, DEFAULT_RANDOM_LIMITS.psi.step);

  return {
    materialLabel,
    productFraction,
    volume,
    truckBrand,
    truckNumber,
    truck,
    xpc,
    gp,
    density: densityKgM3,
    module,
    fraction,
    pnr,
    psi
  };
}

export function generateRubbleBlock7(rubbleTypeId) {
  const params = generateRubbleBlock7Params(rubbleTypeId);
  return RUBBLE_BLOCK_7_TEMPLATE_HTML(params);
}
