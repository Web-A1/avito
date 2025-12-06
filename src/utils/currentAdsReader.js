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
  // Маппинг русских заголовков в поля
  const map = {
    id: ad['уникальный_идентификатор_объявления'] || ad['id'],
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
  const photos = ad['ссылки_на_фото'] || ad['photolinks'] || ad['photolink'];
  if (typeof photos === 'string') {
    photoLinks = photos
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (photoLinks.length) {
      photoLink = photoLinks[Math.floor(Math.random() * photoLinks.length)];
    }
  }

  return {
    // сохраняем сырые поля тоже
    ...ad,
    Id: map.id ? String(map.id) : undefined,
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
  if (!rows || rows.length < 2) return false;
  const headerRow = rows[1] || [];
  return headerRow.some((cell) =>
    String(cell || '').toLowerCase().includes('уникальный идентификатор объявления')
  );
}

function parseAdsFromSheet(rows = []) {
  // Ожидаем: row0 — путь категории, row1 — заголовки, row2/3 — служебные строки, далее данные
  const headers = (rows[1] || []).map(toKey);
  const ads = [];
  for (let i = 2; i < rows.length; i++) {
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
