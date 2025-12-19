/**
 * Константы для типов щебня
 * Здесь описываем только то, что уже согласовано по бизнесу:
 * - ID материала (совпадает с plan.json и MATERIAL_ALIASES)
 * - Человекочитаемое имя
 * - Базовая цена за тонну (₽/т), кратно 10
 * - Насыпная плотность (т/м³) для корректного пересчёта
 *
 * Любые дополнительные диапазоны/поля (ценовые вилки, марки бетона и т.п.)
 * будем добавлять позже, когда появится точное ТЗ, чтобы не придумывать значения.
 */

export const RUBBLE_TYPES = {
  // Щебень вторичный 5–20 мм
  scheben_vtorichnyi_5_20: {
    id: 'scheben_vtorichnyi_5_20',
    name: 'Щебень вторичный 5–20 мм',
    displayName: 'Щебень вторичный фракция 5–20 мм',
    basePricePerTonne: 1110, // ₽/т (согласовано, кратно 10)
    bulkDensityTPerM3: 1.35, // т/м³ (для пересчёта в ₽/м³ при необходимости)
    compactionCoefficient: 1.35, // Коэффициент уплотнения (совпадает с насыпной плотностью)
    defaultConcreteGrade: 400, // Базовая марка по прочности для вторичного щебня (используем для обязательного поля)
    defaultFrostResistance: 150, // Базовая морозостойкость (из допустимых значений Авито)
    defaultFlakinessIndex: 2 // Базовая группа лещадности
  },

  // Щебень вторичный 40–70 мм
  scheben_vtorichnyi_40_70: {
    id: 'scheben_vtorichnyi_40_70',
    name: 'Щебень вторичный 40–70 мм',
    displayName: 'Щебень вторичный фракция 40–70 мм',
    basePricePerTonne: 1200, // ₽/т (согласовано, кратно 10)
    bulkDensityTPerM3: 1.25, // т/м³ (для пересчёта в ₽/м³ при необходимости)
    compactionCoefficient: 1.25, // Коэффициент уплотнения (совпадает с насыпной плотностью)
    defaultConcreteGrade: 400,
    defaultFrostResistance: 150,
    defaultFlakinessIndex: 3
  }
};

/**
 * Получить тип щебня по ID
 * @param {string} id - ID типа щебня
 * @returns {Object|null} Объект с параметрами типа щебня или null
 */
export function getRubbleType(id) {
  return RUBBLE_TYPES[id] || null;
}

/**
 * Получить все типы щебня
 * @returns {Object} Объект со всеми типами щебня
 */
export function getAllRubbleTypes() {
  return RUBBLE_TYPES;
}

