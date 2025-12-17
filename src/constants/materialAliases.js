/**
 * Алиасы материалов и городов для генерации коротких уникальных ID объявлений.
 * Формат adId: {material}_{city}_{date}-{time}_{counter}
 * Пример: s00_bron_241210-125501_01 (12:55:01)
 */

// Алиасы материалов (короткие коды)
export const MATERIAL_ALIASES = {
  // Песок
  karier_neseyan_nemyt_pesok: 's00',
  karier_seyan_nemyt_pesok: 's01',
  'karier_seyan_myt_pesok_1.5': 's15',
  karier_seyan_myt_pesok_2: 's20',
  'karier_seyan_myt_pesok_2.5': 's25',
  // Щебень вторичный
  scheben_vtorichnyi_40_70: 'r00-4070',
  // Щебень известковый (добавить при необходимости)
  // scheben_izvestkovyi_40_70: 'r01-4070',
  // Щебень гранитный (добавить при необходимости)
  // scheben_granitnyi_40_70: 'r02-4070'
};

// Алиасы утверждённых адресов Avito (короткие коды для имён файлов)
// ВАЖНО: Ключи должны ТОЧНО совпадать с адресами из plan.json
export const CITY_ALIASES = {
  'Бронницы, Магистральная ул., 3': 'bron',
  'Чехов, ул. Чехова, 20Бк5': 'cheh',
  'Подольск, ул. Лапшенкова, 3': 'pdls',
  'Троицк, Индустриальная ул., 1': 'troi',
  'Домодедово, Станционная ул., 26к3': 'dmd'
};

/**
 * Получить алиас материала
 * @param {string} materialId - ID материала (например, 'karier_neseyan_nemyt_pesok')
 * @returns {string} - короткий алиас (например, 's00') или исходный ID
 */
export function getMaterialAlias(materialId) {
  if (!materialId) return 'unk';
  return MATERIAL_ALIASES[materialId] || materialId.substring(0, 3);
}

/**
 * Получить алиас адреса (строгая проверка по утверждённым адресам Avito)
 * @param {string} address - полный адрес из plan.json
 * @returns {string} - короткий алиас (например, 'dmd')
 * @throws {Error} - если адрес не найден в CITY_ALIASES
 */
export function getCityAlias(address) {
  if (!address) {
    throw new Error('❌ Адрес не указан в plan.json');
  }
  
  // Ищем ТОЧНОЕ совпадение с утверждённым адресом
  const alias = CITY_ALIASES[address];
  
  if (!alias) {
    const availableAddresses = Object.keys(CITY_ALIASES);
    throw new Error(
      `❌ Адрес не найден в списке утверждённых адресов Avito!\n\n` +
      `Указан: "${address}"\n\n` +
      `Доступные адреса (${availableAddresses.length}):\n` +
      availableAddresses.map((a, i) => `  ${i + 1}. ${a}`).join('\n') +
      `\n\n💡 Проверьте адрес в plan.json или добавьте его в CITY_ALIASES (src/constants/materialAliases.js)`
    );
  }
  
  return alias;
}

/**
 * Парсит DateBegin из plan.json в объект Date
 * @param {string} str - дата в формате "DD.MM.YYYY HH:MM" или "DD.MM.YYYY"
 * @returns {Date|null}
 */
function parseDateBegin(str) {
  if (!str) return null;
  // Формат: "10.12.2025 21:06" или "10.12.2025"
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [_, dd, MM, yyyy, HH = '00', mm = '00', ss = '00'] = m;
  return new Date(`${yyyy}-${MM}-${dd}T${HH}:${mm}:${ss}`);
}

/**
 * Форматирует дату и время в короткий формат DDMMYY-HHmmss
 * @param {Date|string} date - объект Date или строка DateBegin
 * @returns {string} - например, "101224-210600" для 10 декабря 2024 21:06:00
 */
function formatDateLabel(date) {
  const d = typeof date === 'string' ? parseDateBegin(date) : date;
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '000000-000000';
  
  const yy = String(d.getFullYear()).substring(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  const SS = String(d.getSeconds()).padStart(2, '0');
  return `${dd}${mm}${yy}-${HH}${MM}${SS}`;
}

/**
 * Генерирует уникальный ID объявления
 * @param {string} materialId - ID материала
 * @param {string} address - адрес объявления
 * @param {Date|string} dateBegin - дата начала публикации (с временем)
 * @param {number} counter - порядковый номер (1-999)
 * @returns {string} - например, "s00_bron_241210-125501_01"
 */
export function generateAdId(materialId, address, dateBegin, counter) {
  const matAlias = getMaterialAlias(materialId);
  const cityAlias = getCityAlias(address);
  const dateLabel = formatDateLabel(dateBegin);
  const counterStr = String(counter).padStart(2, '0');
  return `${matAlias}_${cityAlias}_${dateLabel}_${counterStr}`;
}

/**
 * Парсит adId обратно в компоненты
 * @param {string} adId - ID объявления (например, "s00_bron_161225-125501_01")
 * @returns {Object|null} - {materialAlias, cityAlias, dateLabel, counter} или null
 */
export function parseAdId(adId) {
  if (!adId || typeof adId !== 'string') return null;
  const parts = adId.split('_');
  if (parts.length !== 4) return null;
  
  const counter = parseInt(parts[3], 10);
  if (isNaN(counter)) return null;
  
  // dateLabel может быть в формате "DDMMYY-HHmmss" или "DDMMYY" (для обратной совместимости)
  const dateLabel = parts[2];
  
  return {
    materialAlias: parts[0],
    cityAlias: parts[1],
    dateLabel,
    counter
  };
}

/**
 * Парсит dateLabel обратно в объект Date
 * @param {string} dateLabel - дата в формате "DDMMYY-HHmmss" или "DDMMYY"
 * @returns {Date|null}
 */
export function parseDateLabel(dateLabel) {
  if (!dateLabel || typeof dateLabel !== 'string') return null;
  
  // Формат с временем: DDMMYY-HHmmss
  const withTimeMatch = dateLabel.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (withTimeMatch) {
    const [, dd, mm, yy, HH, MM, SS] = withTimeMatch;
    const yyyy = 2000 + parseInt(yy, 10);
    return new Date(yyyy, parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(HH, 10), parseInt(MM, 10), parseInt(SS, 10));
  }
  
  // Формат без времени: DDMMYY (для обратной совместимости)
  const withoutTimeMatch = dateLabel.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (withoutTimeMatch) {
    const [, dd, mm, yy] = withoutTimeMatch;
    const yyyy = 2000 + parseInt(yy, 10);
    return new Date(yyyy, parseInt(mm, 10) - 1, parseInt(dd, 10), 0, 0, 0);
  }
  
  return null;
}
