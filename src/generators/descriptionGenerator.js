/**
 * Генератор описаний объявлений
 * 
 * Собирает все 7 блоков в единое описание с применением:
 * - Замены латиницы
 * - Разделителей
 * - Порядка блоков 4-6
 */

import { replaceLatin } from '../algorithms/latinReplacer.js';
import { generateSeparators } from '../algorithms/separatorGenerator.js';
import { generateFullBlockOrder, BLOCK_IDS } from '../algorithms/blockOrderGenerator.js';
import { generateBlock7Params } from '../generators/block7Generator.js';
import {
  BLOCK_3_CALL_TO_ACTION_HTML,
  BLOCK_4_ADVANTAGES_HTML,
  BLOCK_5_WORK_HOURS_HTML,
  BLOCK_6_ASSORTMENT_HTML,
  BLOCK_7_TEMPLATE_HTML
} from '../constants/blocks.js';
import {
  BLOCK_1_NEMYTYY_NESEYANYY,
  BLOCK_2_NEMYTYY_NESEYANYY_HTML,
  BLOCK_1_SEYANYY_NEMYTYY,
  BLOCK_2_SEYANYY_NEMYTYY_HTML,
  getBlock1SeyanyyMytyy,
  BLOCK_2_SEYANYY_MYTYY_FINE_HTML,
  BLOCK_2_SEYANYY_MYTYY_MEDIUM_HTML,
  BLOCK_2_SEYANYY_MYTYY_COARSE_HTML
} from '../constants/block1And2.js';
import { getBlock2WithHeading } from '../constants/block1And2.js';

/**
 * Получает текст Блока 1 для типа песка
 * @param {string} sandTypeId - ID типа песка
 * @param {number} module - Модуль крупности (для мытого песка)
 * @returns {string} Текст Блока 1
 */
function getBlock1(sandTypeId, module = null) {
  if (sandTypeId === 'karier_neseyan_nemyt_pesok') {
    const variants = BLOCK_1_NEMYTYY_NESEYANYY;
    return variants[Math.floor(Math.random() * variants.length)];
  }
  
  if (sandTypeId === 'karier_seyan_nemyt_pesok') {
    const variants = BLOCK_1_SEYANYY_NEMYTYY;
    return variants[Math.floor(Math.random() * variants.length)];
  }
  
  // Для мытого песка нужен модуль крупности
  if (sandTypeId === 'karier_seyan_myt_pesok_1.5') {
    const moduleRange = '1.0–1.5';
    const size = 'мелкий';
    const variants = getBlock1SeyanyyMytyy(moduleRange, size);
    return variants[Math.floor(Math.random() * variants.length)];
  }
  
  if (sandTypeId === 'karier_seyan_myt_pesok_2') {
    const moduleRange = '1.5–2.0';
    const size = 'средний';
    const variants = getBlock1SeyanyyMytyy(moduleRange, size);
    return variants[Math.floor(Math.random() * variants.length)];
  }
  
  if (sandTypeId === 'karier_seyan_myt_pesok_2.5') {
    const moduleRange = '2.0–2.5';
    const size = 'крупный';
    const variants = getBlock1SeyanyyMytyy(moduleRange, size);
    return variants[Math.floor(Math.random() * variants.length)];
  }
  
  // Fallback
  return BLOCK_1_NEMYTYY_NESEYANYY[0];
}

/**
 * Получает текст Блока 2 для типа песка
 * @param {string} sandTypeId - ID типа песка
 * @returns {string} Текст Блока 2 в HTML формате
 */
function getBlock2(sandTypeId) {
  return getBlock2WithHeading(sandTypeId);
}

/**
 * Собирает блоки в правильном порядке
 * @param {Object} blocks - Объект с блоками
 * @param {Array<string>} blockOrder - Порядок блоков
 * @returns {Array<string>} Массив блоков в правильном порядке
 */
function assembleBlocks(blocks, blockOrder) {
  return blockOrder.map(blockId => blocks[blockId] || '');
}

/**
 * Генерирует полное описание объявления
 * @param {string} sandTypeId - ID типа песка
 * @param {string} sandTypeDisplayName - Отображаемое название типа песка
 * @returns {Object} {description: string, latinReplacements: string, block7Params: Object}
 */
export function generateDescription(sandTypeId, sandTypeDisplayName) {
  // 1. Генерируем параметры Блока 7 (чтобы получить модуль крупности для Блока 1)
  const block7Params = generateBlock7Params(sandTypeId, sandTypeDisplayName);
  const module = block7Params.module;
  
  // 2. Генерируем разделители (6 штук)
  const separators = generateSeparators();
  
  // 3. Генерируем порядок блоков 4-6
  const blockOrder = generateFullBlockOrder();
  
  // 4. Получаем тексты блоков
  const block1 = `<p>${getBlock1(sandTypeId, module)}</p>`;
  const block2 = getBlock2(sandTypeId);
  const block3 = BLOCK_3_CALL_TO_ACTION_HTML;
  const block4 = `<p>${BLOCK_4_ADVANTAGES_HTML}</p>`;
  const block5 = BLOCK_5_WORK_HOURS_HTML;
  const block6 = BLOCK_6_ASSORTMENT_HTML;
  
  // 5. Форматируем Блок 7 из уже сгенерированных параметров
  const block7 = BLOCK_7_TEMPLATE_HTML(block7Params);
  
  // 6. Собираем блоки в объект
  const blocks = {
    [BLOCK_IDS.BLOCK_1]: block1,
    [BLOCK_IDS.BLOCK_2]: block2,
    [BLOCK_IDS.BLOCK_3]: block3,
    [BLOCK_IDS.BLOCK_4]: block4,
    [BLOCK_IDS.BLOCK_5]: block5,
    [BLOCK_IDS.BLOCK_6]: block6,
    [BLOCK_IDS.BLOCK_7]: block7
  };
  
  // 7. Собираем блоки в правильном порядке
  const orderedBlocks = assembleBlocks(blocks, blockOrder);
  
  // 8. Объединяем блоки с разделителями
  let description = orderedBlocks[0]; // Блок 1
  for (let i = 1; i < orderedBlocks.length; i++) {
    description += separators[i - 1] + orderedBlocks[i];
  }
  
  // 9. Применяем замену латиницы
  const { text: descriptionWithLatin, latinReplacements } = replaceLatin(
    description,
    sandTypeId,
    5, // minPercent
    10 // maxPercent
  );
  
  return {
    description: descriptionWithLatin,
    latinReplacements: latinReplacements,
    blockOrder: blockOrder,
    separators: separators,
    block7Params: block7Params,
    block1Variant: block1
  };
}
