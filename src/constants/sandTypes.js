/**
 * Константы для типов песка
 * Все типы песка и их параметры
 */

export const SAND_TYPES = {
  // Немытый несеяный карьерный песок
  'karier_neseyan_nemyt_pesok': {
    id: 'karier_neseyan_nemyt_pesok',
    name: 'Немытый несеяный карьерный песок',
    displayName: 'Песок карьерный немытый',
    compactionCoefficient: 1.40, // т/м³
    basePrice: 280, // ₽/т (≈380₽/м³)
    priceRange: { min: 250, max: 300, step: 50 }, // ₽/т
    densityRange: { min: 1350, max: 1450 }, // кг/м³
    moduleRange: { min: 1.000, max: 3.000, precision: 3 }, // до тысячных
    fractionRange: { min: 1.00, max: 3.00, precision: 2 } // до сотых
  },
  
  // Сеяный немытый карьерный песок
  'karier_seyan_nemyt_pesok': {
    id: 'karier_seyan_nemyt_pesok',
    name: 'Сеяный немытый карьерный песок',
    displayName: 'Песок карьерный сеяный немытый',
    compactionCoefficient: 1.70, // т/м³
    basePrice: 240, // ₽/т (≈400₽/м³)
    priceRange: { min: 250, max: 350, step: 50 }, // ₽/т
    densityRange: { min: 1650, max: 1750 }, // кг/м³
    moduleRange: { min: 1.450, max: 1.550, precision: 3 }, // до тысячных
    fractionRange: { min: 1.45, max: 1.55, precision: 2 } // до сотых
  },
  
  // Сеяный мытый карьерный песок (мелкий МК 1.0-1.5)
  'karier_seyan_myt_pesok_1.5': {
    id: 'karier_seyan_myt_pesok_1.5',
    name: 'Сеяный мытый карьерный песок (мелкий)',
    displayName: 'Песок карьерный сеяный мытый',
    moduleOfCoarseness: { min: 1.0, max: 1.5 },
    compactionCoefficient: 1.60, // т/м³
    basePrice: 430, // ₽/т
    priceRange: { min: 400, max: 500, step: 50 }, // ₽/т
    densityRange: { min: 1550, max: 1650 }, // кг/м³
    moduleRange: { min: 1.100, max: 1.500, precision: 3 }, // до тысячных
    fractionRange: { min: 1.10, max: 1.50, precision: 2 } // до сотых
  },
  
  // Сеяный мытый карьерный песок (средний МК 1.5-2.0)
  'karier_seyan_myt_pesok_2': {
    id: 'karier_seyan_myt_pesok_2',
    name: 'Сеяный мытый карьерный песок (средний)',
    displayName: 'Песок карьерный сеяный мытый',
    moduleOfCoarseness: { min: 1.5, max: 2.0 },
    compactionCoefficient: 1.60, // т/м³
    basePrice: 580, // ₽/т
    priceRange: { min: 550, max: 650, step: 50 }, // ₽/т
    densityRange: { min: 1550, max: 1650 }, // кг/м³
    moduleRange: { min: 1.500, max: 2.000, precision: 3 }, // до тысячных
    fractionRange: { min: 1.50, max: 2.00, precision: 2 } // до сотых
  },
  
  // Сеяный мытый карьерный песок (крупный МК 2.0-2.5)
  'karier_seyan_myt_pesok_2.5': {
    id: 'karier_seyan_myt_pesok_2.5',
    name: 'Сеяный мытый карьерный песок (крупный)',
    displayName: 'Песок карьерный сеяный мытый',
    moduleOfCoarseness: { min: 2.0, max: 2.5 },
    compactionCoefficient: 1.60, // т/м³
    basePrice: 680, // ₽/т
    priceRange: { min: 650, max: 750, step: 50 }, // ₽/т
    densityRange: { min: 1550, max: 1650 }, // кг/м³
    moduleRange: { min: 2.000, max: 2.500, precision: 3 }, // до тысячных
    fractionRange: { min: 2.00, max: 2.50, precision: 2 } // до сотых
  }
};

/**
 * Получить тип песка по ID
 * @param {string} id - ID типа песка
 * @returns {Object|null} Объект с параметрами типа песка
 */
export function getSandType(id) {
  return SAND_TYPES[id] || null;
}

/**
 * Получить все типы песка
 * @returns {Object} Объект со всеми типами песка
 */
export function getAllSandTypes() {
  return SAND_TYPES;
}
