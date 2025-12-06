/**
 * Генератор порядка блоков для описаний объявлений
 * 
 * Требования:
 * - Блоки 1-3: всегда в начале (Вступление → Применение → Призыв к действию)
 * - Блок 7: всегда в конце (Технические характеристики)
 * - Блоки 4-6: порядок варьируется (6 вариантов)
 */

// Идентификаторы блоков
export const BLOCK_IDS = {
  BLOCK_1: 'block1', // Вступление
  BLOCK_2: 'block2', // Применение
  BLOCK_3: 'block3', // Призыв к действию
  BLOCK_4: 'block4', // Преимущества NERUDA
  BLOCK_5: 'block5', // Режим работы
  BLOCK_6: 'block6', // Ассортимент товаров
  BLOCK_7: 'block7'  // Технические характеристики
};

// Все возможные варианты порядка блоков 4-6 (6 комбинаций = 3!)
const BLOCK_ORDER_VARIANTS = [
  // Вариант 1: 4 → 5 → 6 (Преимущества → Режим → Ассортимент)
  [BLOCK_IDS.BLOCK_4, BLOCK_IDS.BLOCK_5, BLOCK_IDS.BLOCK_6],
  // Вариант 2: 4 → 6 → 5 (Преимущества → Ассортимент → Режим)
  [BLOCK_IDS.BLOCK_4, BLOCK_IDS.BLOCK_6, BLOCK_IDS.BLOCK_5],
  // Вариант 3: 5 → 4 → 6 (Режим → Преимущества → Ассортимент)
  [BLOCK_IDS.BLOCK_5, BLOCK_IDS.BLOCK_4, BLOCK_IDS.BLOCK_6],
  // Вариант 4: 5 → 6 → 4 (Режим → Ассортимент → Преимущества)
  [BLOCK_IDS.BLOCK_5, BLOCK_IDS.BLOCK_6, BLOCK_IDS.BLOCK_4],
  // Вариант 5: 6 → 4 → 5 (Ассортимент → Преимущества → Режим)
  [BLOCK_IDS.BLOCK_6, BLOCK_IDS.BLOCK_4, BLOCK_IDS.BLOCK_5],
  // Вариант 6: 6 → 5 → 4 (Ассортимент → Режим → Преимущества)
  [BLOCK_IDS.BLOCK_6, BLOCK_IDS.BLOCK_5, BLOCK_IDS.BLOCK_4]
];

/**
 * Генерирует случайный порядок блоков 4-6
 * @returns {Array<string>} Массив из 3 идентификаторов блоков в случайном порядке
 */
export function generateBlockOrder() {
  const randomIndex = Math.floor(Math.random() * BLOCK_ORDER_VARIANTS.length);
  return [...BLOCK_ORDER_VARIANTS[randomIndex]];
}

/**
 * Формирует полный порядок всех блоков для описания
 * @param {Array<string>} blocks4to6 - Порядок блоков 4-6 (результат generateBlockOrder)
 * @returns {Array<string>} Полный порядок всех 7 блоков
 */
export function getFullBlockOrder(blocks4to6) {
  return [
    BLOCK_IDS.BLOCK_1, // Вступление (всегда первый)
    BLOCK_IDS.BLOCK_2, // Применение (всегда второй)
    BLOCK_IDS.BLOCK_3, // Призыв к действию (всегда третий)
    ...blocks4to6,     // Блоки 4-6 в случайном порядке
    BLOCK_IDS.BLOCK_7  // Технические характеристики (всегда последний)
  ];
}

/**
 * Генерирует полный порядок блоков для описания (удобная функция-обертка)
 * @returns {Array<string>} Полный порядок всех 7 блоков
 */
export function generateFullBlockOrder() {
  const blocks4to6 = generateBlockOrder();
  return getFullBlockOrder(blocks4to6);
}

