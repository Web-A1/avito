/**
 * Генератор технических характеристик (Блок 7) для песка.
 */

import { BLOCK_7_TEMPLATE_HTML } from '../../../constants/blocks.js';
import { getSandType } from '../../../constants/sandTypes.js';
import { randomInRange, randomWithStep } from '../../../constants/parameters.js';
import { BLOCK_7_RANGES } from '../../../constants/parameters.js';
import { getRandomTruckBrand, generateTruckNumber } from '../../../constants/trucks.js';

function generateVolume() {
  return randomInRange(BLOCK_7_RANGES.VOLUME.min, BLOCK_7_RANGES.VOLUME.max);
}

function generateXPC() {
  return randomWithStep(BLOCK_7_RANGES.XPC.min, BLOCK_7_RANGES.XPC.max, BLOCK_7_RANGES.XPC.step);
}

function generateGP() {
  return randomWithStep(BLOCK_7_RANGES.GP.min, BLOCK_7_RANGES.GP.max, BLOCK_7_RANGES.GP.step);
}

function generateDensity(sandTypeId) {
  const sandType = getSandType(sandTypeId);
  if (!sandType || !sandType.densityRange) {
    return randomInRange(1350, 1450);
  }

  return randomInRange(sandType.densityRange.min, sandType.densityRange.max);
}

function generateModule(sandTypeId) {
  const sandType = getSandType(sandTypeId);
  if (!sandType || !sandType.moduleRange) {
    return parseFloat(randomInRange(1.000, 3.000, 3).toFixed(3));
  }

  const { min, max, precision } = sandType.moduleRange;
  return parseFloat(randomInRange(min, max, precision).toFixed(precision));
}

function generateFraction(sandTypeId, module) {
  const sandType = getSandType(sandTypeId);
  if (!sandType || !sandType.fractionRange) {
    return parseFloat(module.toFixed(2));
  }

  const { min, max, precision } = sandType.fractionRange;
  const fraction = randomInRange(min, max, precision);
  return parseFloat(fraction.toFixed(precision));
}

function generatePNR() {
  return randomWithStep(BLOCK_7_RANGES.PNR.min, BLOCK_7_RANGES.PNR.max, BLOCK_7_RANGES.PNR.step);
}

function generatePSI() {
  return randomWithStep(BLOCK_7_RANGES.PSI.min, BLOCK_7_RANGES.PSI.max, BLOCK_7_RANGES.PSI.step);
}

export function generateBlock7Params(sandTypeId, sandTypeDisplayName) {
  const module = generateModule(sandTypeId);

  const params = {
    sandType: sandTypeDisplayName,
    volume: generateVolume(),
    truckBrand: getRandomTruckBrand(),
    truckNumber: generateTruckNumber(),
    truck: '',
    xpc: generateXPC(),
    gp: generateGP(),
    density: generateDensity(sandTypeId),
    module: module,
    fraction: generateFraction(sandTypeId, module),
    pnr: generatePNR(),
    psi: generatePSI()
  };
  params.truck = `${params.truckBrand} ${params.truckNumber}`;

  return params;
}

export function generateBlock7(sandTypeId, sandTypeDisplayName) {
  const params = generateBlock7Params(sandTypeId, sandTypeDisplayName);
  return BLOCK_7_TEMPLATE_HTML(params);
}

export function generateBlock7ForDuplicateCheck(sandTypeId, sandTypeDisplayName) {
  const params = generateBlock7Params(sandTypeId, sandTypeDisplayName);

  return {
    volume: params.volume,
    truck: params.truck,
    xpc: params.xpc,
    gp: params.gp,
    density: params.density,
    module: params.module,
    fraction: params.fraction,
    pnr: params.pnr,
    psi: params.psi
  };
}






