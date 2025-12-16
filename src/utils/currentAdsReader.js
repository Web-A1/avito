/**
 * Утилита для чтения выгрузки текущих объявлений из XLSX.
 * Использует пакет `xlsx` (sheetjs). Если пакет не установлен, бросит подсказку.
 *
 * Ожидаемый формат: первая строка — заголовки. Важные столбцы:
 * Id, Title, Address, Price, PriceFor, Color, BulkMaterialSubType, Description.
 * Если не указано имя листа, выбирается подходящий автоматически:
 *  - лист с явным заголовком Id (или max по числу строк, если Id не найден).
 * Неизвестные столбцы тоже сохраняются как ключи (в camelCase).
 */

function toKey(header = '') {
  // Сохраняем кириллицу/латиницу/цифры, пробелы -> underscore
  return header
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .toLowerCase();
}

function normalizeExistingAd(ad = {}) {
  // Маппинг русских и английских заголовков в поля
  const map = {
    id: ad['уникальный_идентификатор_объявления'] || ad['id'] || ad['avitoid'],
    title: ad['название_объявления'] || ad['title'],
    description: ad['описание_объявления'] || ad['description'],
    price: ad['цена'] || ad['price'],
    priceFor: ad['цена_за'] || ad['pricefor'],
    address: ad['адрес'] || ad['address'],
    color: ad['цвет'] || ad['color'],
    bulkMaterialSubType: ad['подтип_сыпучих_материалов'] || ad['bulkmaterialsubtype'],
    bulkMaterialType: ad['тип_сыпучих_материалов'] || ad['bulkmaterialtype'],
    packagingType: ad['форма_продажи'] || ad['packagingtype'],
    availability: ad['доступность'] || ad['availability'],
    compactionCoefficient: ad['коэффициент_уплотнения'] || ad['compactioncoefficient'],
    minSaleQuantity: ad['минимальный_заказ'] || ad['minsalequantity']
  };

  let photoLink = '';
  let photoLinks = [];
  const photos = ad['ссылки_на_фото'] || ad['photolinks'] || ad['photolink'] || ad['imageurls'];
  if (typeof photos === 'string') {
    photoLinks = photos
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (photoLinks.length) {
      photoLink = photoLinks[Math.floor(Math.random() * photoLinks.length)];
    }
  }

  // Для английского формата используем AvitoId как Id, если Id не найден
  const finalId = map.id || ad['avitoid'] || ad['id'];
  
  return {
    // сохраняем сырые поля тоже
    ...ad,
    Id: finalId ? String(finalId) : undefined,
    AvitoId: ad['avitoid'] ? String(ad['avitoid']) : undefined,
    title: map.title,
    description: map.description,
    price: map.price,
    priceFor: map.priceFor,
    address: map.address,
    color: map.color,
    bulkMaterialSubType: map.bulkMaterialSubType,
    bulkMaterialType: map.bulkMaterialType,
    packagingType: map.packagingType,
    availability: map.availability,
    compactionCoefficient: map.compactionCoefficient,
    minSaleQuantity: map.minSaleQuantity,
    photoLink,
    photoLinks,
    block1Variant: 'existing',
    latinReplacements: ''
  };
}

function looksLikeAdsSheet(rows = []) {
  if (!rows || rows.length < 1) return false;
  
  // Проверяем формат с русскими заголовками (строка 1)
  if (rows.length >= 2) {
    const headerRow1 = rows[1] || [];
    if (headerRow1.some((cell) =>
      String(cell || '').toLowerCase().includes('уникальный идентификатор объявления')
    )) {
      return true;
    }
  }
  
  // Проверяем формат с английскими заголовками (строка 0)
  const headerRow0 = rows[0] || [];
  const hasId = headerRow0.some((cell) => 
    String(cell || '').toLowerCase() === 'id' || 
    String(cell || '').toLowerCase() === 'avitoid'
  );
  const hasTitle = headerRow0.some((cell) => 
    String(cell || '').toLowerCase() === 'title'
  );
  
  return hasId && hasTitle;
}

function parseAdsFromSheet(rows = []) {
  let headerRowIndex = -1;
  let dataStartIndex = -1;
  
  // Определяем формат: русские заголовки (строка 1) или английские (строка 0)
  if (rows.length >= 2) {
    const headerRow1 = rows[1] || [];
    if (headerRow1.some((cell) =>
      String(cell || '').toLowerCase().includes('уникальный идентификатор объявления')
    )) {
      // Формат с русскими заголовками: строка 1 - заголовки, строка 2+ - данные
      headerRowIndex = 1;
      dataStartIndex = 2;
    }
  }
  
  // Если не нашли русские заголовки, проверяем английские
  if (headerRowIndex === -1 && rows.length >= 1) {
    const headerRow0 = rows[0] || [];
    if (headerRow0.some((cell) => 
      String(cell || '').toLowerCase() === 'id' || 
      String(cell || '').toLowerCase() === 'avitoid'
    )) {
      // Формат с английскими заголовками: строка 0 - заголовки, строка 1+ - данные
      headerRowIndex = 0;
      dataStartIndex = 1;
    }
  }
  
  if (headerRowIndex === -1) {
    return [];
  }
  
  const headers = (rows[headerRowIndex] || []).map(toKey);
  const ads = [];
  
  for (let i = dataStartIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const firstCell = String(row[0] || '').toLowerCase();
    if (firstCell.includes('обязательный') || firstCell.includes('подробнее')) continue;
    const ad = {};
    headers.forEach((key, idx) => {
      if (!key) return;
      ad[key] = row[idx];
    });
    ads.push(normalizeExistingAd(ad));
  }
  return ads;
}

export async function readCurrentAdsFromXlsx(filePath, sheetName) {
  let xlsx;
  try {
    const mod = await import('xlsx');
    xlsx = mod.default || mod;
  } catch (err) {
    throw new Error(
      'Пакет "xlsx" не установлен. Установите командой: npm install xlsx (или pnpm/yarn add xlsx).'
    );
  }

  const workbook = xlsx.readFile(filePath);
  const ads = [];

  const sheetNames = sheetName ? [sheetName] : workbook.SheetNames;
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    if (!looksLikeAdsSheet(rows)) continue;
    ads.push(...parseAdsFromSheet(rows));
  }

  return ads;
}
