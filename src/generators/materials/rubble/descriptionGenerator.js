/**
 * Генератор описаний объявлений для щебня (7 блоков).
 * По аналогии с generateDescription для песка.
 */

import { replaceLatin } from '../../../algorithms/latinReplacer.js';
import { generateSeparators } from '../../../algorithms/separatorGenerator.js';
import { generateFullBlockOrder, BLOCK_IDS } from '../../../algorithms/blockOrderGenerator.js';
import { generateRubbleBlock7Params } from './block7Generator.js';
import {
  BLOCK_3_CALL_TO_ACTION_HTML,
  BLOCK_4_ADVANTAGES_HTML,
  BLOCK_5_WORK_HOURS_HTML,
  BLOCK_6_ASSORTMENT_RUBBLE_HTML,
  RUBBLE_BLOCK_7_TEMPLATE_HTML
} from '../../../constants/blocks.js';
import {
  BLOCK_1_SHEBEN_VTORICHNYI_5_20,
  BLOCK_1_SHEBEN_VTORICHNYI_40_70,
  BLOCK_2_SHEBEN_VTORICHNYI_5_20_HTML,
  BLOCK_2_SHEBEN_VTORICHNYI_5_20_HEADINGS,
  BLOCK_2_SHEBEN_VTORICHNYI_40_70_HTML,
  BLOCK_2_SHEBEN_VTORICHNYI_40_70_HEADINGS,
  getBlock2Intro
} from '../../../constants/block1And2.js';

function getRubbleBlock1(rubbleTypeId) {
  if (rubbleTypeId === 'scheben_vtorichnyi_5_20') {
    const variants = BLOCK_1_SHEBEN_VTORICHNYI_5_20;
    return variants[Math.floor(Math.random() * variants.length)];
  }

  if (rubbleTypeId === 'scheben_vtorichnyi_40_70') {
    const variants = BLOCK_1_SHEBEN_VTORICHNYI_40_70;
    return variants[Math.floor(Math.random() * variants.length)];
  }

  return BLOCK_1_SHEBEN_VTORICHNYI_5_20[0];
}

function getRubbleBlock2(rubbleTypeId) {
  if (rubbleTypeId === 'scheben_vtorichnyi_5_20') {
    const heading =
      BLOCK_2_SHEBEN_VTORICHNYI_5_20_HEADINGS[
        Math.floor(Math.random() * BLOCK_2_SHEBEN_VTORICHNYI_5_20_HEADINGS.length)
      ];
    const intro = getBlock2Intro(rubbleTypeId);
    return `${intro ? `<p><strong>${intro}</strong></p>` : ''}<p>${heading}</p>${BLOCK_2_SHEBEN_VTORICHNYI_5_20_HTML}<p>Минимальный объём поставки — 20 м³ (1 самосвал)</p>`;
  }

  if (rubbleTypeId === 'scheben_vtorichnyi_40_70') {
    const heading =
      BLOCK_2_SHEBEN_VTORICHNYI_40_70_HEADINGS[
        Math.floor(Math.random() * BLOCK_2_SHEBEN_VTORICHNYI_40_70_HEADINGS.length)
      ];
    const intro = getBlock2Intro(rubbleTypeId);
    return `${intro ? `<p><strong>${intro}</strong></p>` : ''}<p>${heading}</p>${BLOCK_2_SHEBEN_VTORICHNYI_40_70_HTML}<p>Минимальный объём поставки — 20 м³ (1 самосвал)</p>`;
  }

  const heading =
    BLOCK_2_SHEBEN_VTORICHNYI_5_20_HEADINGS[
      Math.floor(Math.random() * BLOCK_2_SHEBEN_VTORICHNYI_5_20_HEADINGS.length)
    ];
  const intro = getBlock2Intro('scheben_vtorichnyi_5_20');
  return `${intro ? `<p><strong>${intro}</strong></p>` : ''}<p>${heading}</p>${BLOCK_2_SHEBEN_VTORICHNYI_5_20_HTML}<p>Минимальный объём поставки — 20 м³ (1 самосвал)</p>`;
}

function assembleBlocks(blocks, blockOrder) {
  return blockOrder.map((blockId) => blocks[blockId] || '');
}

export function generateRubbleDescription(rubbleTypeId, options = {}) {
  const typeId = rubbleTypeId || 'scheben_vtorichnyi_40_70';

  const block7Params = generateRubbleBlock7Params(typeId, options);

  const separators = generateSeparators();

  const blockOrder = generateFullBlockOrder();

  const block1Text = getRubbleBlock1(typeId);
  const block1 = `<p>${block1Text}</p>`;
  const block2 = getRubbleBlock2(typeId);
  const block3 = BLOCK_3_CALL_TO_ACTION_HTML;
  const block4 = BLOCK_4_ADVANTAGES_HTML;
  const block5 = BLOCK_5_WORK_HOURS_HTML;
  const block6 = BLOCK_6_ASSORTMENT_RUBBLE_HTML;
  const block7 = RUBBLE_BLOCK_7_TEMPLATE_HTML(block7Params);

  const blocks = {
    [BLOCK_IDS.BLOCK_1]: block1,
    [BLOCK_IDS.BLOCK_2]: block2,
    [BLOCK_IDS.BLOCK_3]: block3,
    [BLOCK_IDS.BLOCK_4]: block4,
    [BLOCK_IDS.BLOCK_5]: block5,
    [BLOCK_IDS.BLOCK_6]: block6,
    [BLOCK_IDS.BLOCK_7]: block7
  };

  const orderedBlocks = assembleBlocks(blocks, blockOrder);

  let description = orderedBlocks[0];
  for (let i = 1; i < orderedBlocks.length; i++) {
    description += separators[i - 1] + orderedBlocks[i];
  }

  const { text: descriptionWithLatin, latinReplacements } = replaceLatin(
    description,
    typeId,
    5,
    10
  );

  return {
    description: descriptionWithLatin,
    latinReplacements,
    blockOrder,
    separators,
    block7Params,
    block1Variant: block1
  };
}
