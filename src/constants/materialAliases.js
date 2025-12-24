/**
 * Алиасы материалов и городов для генерации коротких уникальных ID объявлений.
 * Формат adId: {sourceBase}_{city}_{date}-{time}_{counter}
 * Пример: s00_1_dmd_241210-125501_1 (12:55:01)
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
  scheben_vtorichnyi_5_20: 'r00-0520',
  scheben_vtorichnyi_40_70: 'r00-4070',
  // Щебень известковый (добавить при необходимости)
  // scheben_izvestkovyi_40_70: 'r01-4070',
  // Щебень гранитный (добавить при необходимости)
  // scheben_granitnyi_40_70: 'r02-4070'
};

// Алиасы утверждённых адресов Avito (короткие коды для имён файлов)
// ВАЖНО: Ключи должны ТОЧНО совпадать с адресами из plan.json и выгрузки Авито
export const CITY_ALIASES = {
  'Московская обл., Бронницы, Магистральная ул., 3': 'bron',
  'Московская обл., Чехов, ул. Чехова, 20Бк5': 'cheh',
  'Московская обл., Подольск, ул. Лапшенкова, 3': 'pdls',
  'Москва, Троицк, Индустриальная ул., 1': 'troi',
  'Московская обл., Домодедово, Станционная ул., 26к3': 'dmd'
};

// SellerAddressID из кабинета Авито для каждой локации
export const SELLER_ADDRESS_IDS = {
  'Московская обл., Бронницы, Магистральная ул., 3': '101431441',
  'Московская обл., Чехов, ул. Чехова, 20Бк5': '101431415',
  'Московская обл., Подольск, ул. Лапшенкова, 3': '101431383',
  'Москва, Троицк, Индустриальная ул., 1': '101431339',
  'Московская обл., Домодедово, Станционная ул., 26к3': '101392452'
};

// Дополнительные варианты написания адресов → каноническая форма
const SELLER_ADDRESS_ALIASES = {
  'Бронницы, Магистральная ул., 3': 'Московская обл., Бронницы, Магистральная ул., 3',
  'Чехов, ул. Чехова, 20Бк5': 'Московская обл., Чехов, ул. Чехова, 20Бк5',
  'Подольск, Лапшенкова, 3': 'Московская обл., Подольск, ул. Лапшенкова, 3',
  'Троицк,Индустриальная улица, 1': 'Москва, Троицк, Индустриальная ул., 1',
  'Троицк, Индустриальная улица, 1': 'Москва, Троицк, Индустриальная ул., 1',
  'Домодедово, ул. Станционная': 'Московская обл., Домодедово, Станционная ул., 26к3',
  'Московская обл., Домодедово, Станционная ул.': 'Московская обл., Домодедово, Станционная ул., 26к3'
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
 * Получить SellerAddressID для указанного адреса (с поддержкой алиасов)
 * @param {string} address - полный адрес или алиас
 * @returns {string} - SellerAddressID из кабинета Авито
 */
export function getSellerAddressId(address) {
  if (!address) {
    throw new Error('❌ Адрес не указан для SellerAddressID');
  }

  const cleaned = String(address).trim();
  const canonical = SELLER_ADDRESS_ALIASES[cleaned] || cleaned;
  const sellerAddressId = SELLER_ADDRESS_IDS[canonical];

  if (!sellerAddressId) {
    const availableAddresses = Object.keys(SELLER_ADDRESS_IDS);
    throw new Error(
      `❌ SellerAddressID не найден для адреса "${address}".\n\n` +
      `Доступные адреса (${availableAddresses.length}):\n` +
      availableAddresses.map((a, i) => `  ${i + 1}. ${a}`).join('\n')
    );
  }

  return sellerAddressId;
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

function sanitizeAdIdPart(str = '') {
  return (
    String(str || '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'photo'
  );
}

function resolveSourceBase(sourceBase, materialId) {
  if (sourceBase && typeof sourceBase === 'string') {
    return sanitizeAdIdPart(sourceBase);
  }
  if (materialId) {
    return sanitizeAdIdPart(getMaterialAlias(materialId));
  }
  return 'photo';
}

/**
 * Генерирует уникальный ID объявления
 * @param {Object|string} params - объект с параметрами или материал/alias для обратной совместимости
 * @param {string} [params.sourceBase] - basename исходника (s00_1)
 * @param {string} [params.materialId] - ID материала (используется как фолбэк для basename)
 * @param {string} [params.address] - адрес объявления
 * @param {Date|string} [params.dateBegin] - дата начала публикации (с временем)
 * @param {number} [params.counter] - порядковый номер (1-999)
 * @returns {string} - например, "s00_1_dmd_241210-125501_1"
 */
export function generateAdId(materialIdOrParams, address, dateBegin, counter) {
  if (materialIdOrParams && typeof materialIdOrParams === 'object') {
    const { sourceBase, materialId, address: addr, dateBegin: date, counter: cnt } = materialIdOrParams;
    const cityAlias = getCityAlias(addr);
    const dateLabel = formatDateLabel(date);
    const base = resolveSourceBase(sourceBase || materialId, materialId);
    const counterStr = String(cnt ?? 1);
    return `${base}_${cityAlias}_${dateLabel}_${counterStr}`;
  }

  const cityAlias = getCityAlias(address);
  const dateLabel = formatDateLabel(dateBegin);
  const base = resolveSourceBase(undefined, materialIdOrParams);
  const counterStr = String(counter ?? 1);
  return `${base}_${cityAlias}_${dateLabel}_${counterStr}`;
}

/**
 * Парсит adId обратно в компоненты
 * @param {string} adId - ID объявления (например, "s00_bron_161225-125501_01")
 * @returns {Object|null} - {sourceBase, materialAlias, cityAlias, dateLabel, counter} или null
 */
export function parseAdId(adId) {
  if (!adId || typeof adId !== 'string') return null;
  const parts = adId.split('_');
  if (parts.length < 4) return null;

  const counter = parseInt(parts.pop(), 10);
  if (isNaN(counter)) return null;

  const dateLabel = parts.pop();
  const cityAlias = parts.pop();
  const sourceBase = parts.join('_');
  if (!sourceBase || !cityAlias || !dateLabel) return null;

  // Материал может содержать дефисы (r00-0520), поэтому делим только по первому подчёркиванию
  const materialAlias = sourceBase.split('_')[0] || sourceBase;

  return {
    sourceBase,
    materialAlias,
    cityAlias,
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
