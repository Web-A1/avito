/**
 * Генератор XML для Авито.
 * Принимает массив объявлений и возвращает строку XML (<Ads><Ad>…</Ad></Ads>).
 */

import { FIXED_PARAMETERS, CONTACT_PARAMETERS } from '../constants/parameters.js';

function escapeXml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapCdata(content = '') {
  return `<![CDATA[${content}]]>`;
}

function formatImages(images = []) {
  // Avito требует минимум одно изображение для каждого объявления
  if (!images.length || !images[0]) {
    throw new Error('Объявление должно содержать хотя бы одно изображение. Убедитесь, что фото загружены на Яндекс.Диск и маппинг фото корректен.');
  }
  return `<Images>${images.map((url) => `<Image url="${escapeXml(url)}"/>`).join('')}</Images>`;
}

function formatAd(ad, idx, dateLabel = '') {
  const existingId = ad.Id || ad.id;
  // Приоритет: adId из генерации фото → existingId из Excel → fallback
  const id = ad.adId || existingId || `sand_${dateLabel}_${idx + 1}`;
  const fixed = ad.fixed || {};
  const images = ad.photoLink ? [ad.photoLink] : [];
  const description = wrapCdata(ad.description || '');
  const bulkMaterialType = ad.bulkMaterialType || 'Песок';
  const bulkMaterialSubType = ad.bulkMaterialSubType || FIXED_PARAMETERS.BULK_MATERIAL_SUBTYPE;
  const packagingType = ad.packagingType || FIXED_PARAMETERS.PACKAGING_TYPE;
  const availability = ad.availability || FIXED_PARAMETERS.AVAILABILITY;
  const compactionCoefficient =
    ad.compactionCoefficient ?? fixed.compactionCoefficient ?? '';
  const minSaleQuantity = ad.minSaleQuantity ?? FIXED_PARAMETERS.MIN_SALE_QUANTITY;
  const dateBegin = ad.dateBegin;

  // Для щебня определяем RubbleType, Fraction, FlakinessIndex, ConcreteGrade, FrostResistance
  let rubbleTypeXml = '';
  let fractionXml = '';
  let flakinessIndexXml = '';
  let concreteGradeXml = '';
  let frostResistanceXml = '';
  if (bulkMaterialType === 'Щебень, гравий' && bulkMaterialSubType === 'Щебень') {
    // RubbleType: извлекаем из title или description, или используем значение из ad
    const rubbleType = ad.rubbleType || extractRubbleTypeFromText(ad.title || '', ad.description || '');
    if (rubbleType) {
      rubbleTypeXml = `<RubbleType>${escapeXml(rubbleType)}</RubbleType>`;
    }
    
    // Fraction: извлекаем из description или используем значение из ad
    const fraction = ad.fraction || extractFractionFromText(ad.description || '');
    if (fraction) {
      fractionXml = `<Fraction>${escapeXml(fraction)}</Fraction>`;
    }
    
    // FlakinessIndex: только из явного поля объявления (не извлекаем из описания)
    // Значение может быть в формате "3 группа" или просто число
    let flakinessIndex = ad.flakinessIndex || ad.flakinessindex;
    if (flakinessIndex) {
      // Если значение уже содержит "группа", используем как есть, иначе форматируем
      const flakinessValue = String(flakinessIndex).includes('группа') 
        ? String(flakinessIndex) 
        : `${flakinessIndex} группа`;
      flakinessIndexXml = `<FlakinessIndex>${escapeXml(flakinessValue)}</FlakinessIndex>`;
    }
    
    // ConcreteGrade: только из явного поля объявления (не извлекаем из описания)
    const concreteGrade = ad.concreteGrade || ad.concretegrade;
    if (concreteGrade) {
      concreteGradeXml = `<ConcreteGrade>${escapeXml(String(concreteGrade))}</ConcreteGrade>`;
    }
    
    // FrostResistance: только из явного поля объявления (не извлекаем из описания)
    const frostResistance = ad.frostResistance || ad.frostresistance;
    if (frostResistance) {
      frostResistanceXml = `<FrostResistance>${escapeXml(String(frostResistance))}</FrostResistance>`;
    }
  }

  // Опциональные поля из Excel
  const avitoId = ad.AvitoId || ad.avitoid || ad.avitoId;
  const avitoDateEnd = ad.avitoDateEnd || ad.avitodateend || ad.dateEnd;
  // ListingFee: из объявления или значение по умолчанию "Package"
  const listingFee = ad.listingFee || ad.listingfee || CONTACT_PARAMETERS.LISTING_FEE;
  // ManagerName: из объявления или значение по умолчанию "Владимир"
  const managerName = ad.managerName || ad.managername || CONTACT_PARAMETERS.MANAGER_NAME;

  return `
    <Ad>
      <Id>${escapeXml(id)}</Id>
      ${avitoId ? `<AvitoId>${escapeXml(String(avitoId))}</AvitoId>` : ''}
      ${dateBegin ? `<DateBegin>${escapeXml(dateBegin)}</DateBegin>` : ''}
      ${avitoDateEnd ? `<DateEnd>${escapeXml(String(avitoDateEnd))}</DateEnd>` : ''}
      <ListingFee>${escapeXml(String(listingFee))}</ListingFee>
      <ManagerName>${escapeXml(managerName)}</ManagerName>
      <ContactPhone>${escapeXml(CONTACT_PARAMETERS.CONTACT_PHONE)}</ContactPhone>
      <Category>Ремонт и строительство</Category>
      <Address>${escapeXml(ad.address || '')}</Address>
      <Title>${escapeXml(ad.title || '')}</Title>
      <Description>${description}</Description>
      ${ad.price ? `<Price>${ad.price}</Price>` : ''}
      ${formatImages(images)}
      <ContactMethod>${escapeXml(CONTACT_PARAMETERS.CONTACT_METHOD)}</ContactMethod>
      <EMail>${escapeXml(CONTACT_PARAMETERS.EMAIL)}</EMail>
      <CompanyName>${escapeXml(CONTACT_PARAMETERS.COMPANY_NAME)}</CompanyName>
      <PackagingType>${escapeXml(packagingType)}</PackagingType>
      <CompactionCoefficient>${compactionCoefficient}</CompactionCoefficient>
      <MinSaleQuantity>${minSaleQuantity}</MinSaleQuantity>
      <PriceFor>${escapeXml(ad.priceFor || '')}</PriceFor>
      <GoodsType>Стройматериалы</GoodsType>
      <AdType>Товар от производителя</AdType>
      <Condition>Новое</Condition>
      <Availability>${escapeXml(availability)}</Availability>
      <GoodsSubType>Сыпучие материалы</GoodsSubType>
      <BulkMaterialType>${escapeXml(bulkMaterialType)}</BulkMaterialType>
      <BulkMaterialSubType>${escapeXml(bulkMaterialSubType)}</BulkMaterialSubType>
      ${rubbleTypeXml}
      ${fractionXml}
      ${flakinessIndexXml}
      ${concreteGradeXml}
      ${frostResistanceXml}
      ${ad.color ? `<Color>${escapeXml(ad.color)}</Color>` : ''}
      <TargetAudience>${escapeXml(CONTACT_PARAMETERS.TARGET_AUDIENCE)}</TargetAudience>
    </Ad>`;
}

// Извлекает тип щебня из текста (Title или Description)
function extractRubbleTypeFromText(title, description) {
  const text = (title + ' ' + description).toLowerCase();
  
  // Маппинг ключевых слов на типы щебня
  const rubbleTypeMap = {
    'вторичный': 'Вторичный',
    'гравийный': 'Гравийный',
    'гранитный': 'Гранитный',
    'известняковый': 'Известняковый',
    'известковый': 'Известняковый',
    'бутовый': 'Бутовый',
    'мраморный': 'Мраморный'
  };
  
  for (const [keyword, type] of Object.entries(rubbleTypeMap)) {
    if (text.includes(keyword)) {
      return type;
    }
  }
  
  return null;
}

// Извлекает фракцию из текста (Description)
function extractFractionFromText(description) {
  // Паттерны для поиска фракции: "40–70 мм", "40-70 мм", "40-70", "40–70"
  const fractionPatterns = [
    /(\d+)[–-](\d+)\s*мм/i,  // "40–70 мм" или "40-70 мм"
    /(\d+)[–-](\d+)/i         // "40–70" или "40-70"
  ];
  
  for (const pattern of fractionPatterns) {
    const match = description.match(pattern);
    if (match) {
      const min = match[1];
      const max = match[2];
      // Форматируем как "40–70 мм" (с длинным тире)
      return `${min}–${max} мм`;
    }
  }
  
  // Если не найдено, возвращаем null
  return null;
}

// Извлекает индекс лещадности (FlakinessIndex) из текста
function extractFlakinessIndexFromText(description) {
  // Паттерны для поиска: "3 группа", "группа 3", "лещадность 3", "FlakinessIndex: 3"
  const patterns = [
    /(?:лещадность|flakinessindex)[\s:]*(\d+)\s*(?:группа|group)?/i,
    /(\d+)\s*группа\s*(?:лещадности|лещадность)?/i,
    /группа\s*(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const group = match[1];
      return `${group} группа`;
    }
  }
  
  return null;
}

// Извлекает марку бетона (ConcreteGrade) из текста
function extractConcreteGradeFromText(description) {
  // Паттерны для поиска: "М300"/"M300", "М-300"/"M-300", "марка М300", "ConcreteGrade: M300"
  const patterns = [
    // "марка" с учётом возможных латинских замен букв, например мaркa
    /(?:м[\u0430a][рp]к[\u0430a]|concretegrade|grade)[\s:]*[МM][\s-]*(\d{2,3})/iu,
    // Свободное вхождение, но только если перед "M" нет букв/цифр (чтобы не ловить "объем 20")
    /(?<![a-zA-Z\u0400-\u04FF0-9])[МM][\s-]*(\d{2,3})(?![a-zA-Z\u0400-\u04FF0-9])/iu
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const numericValue = Number(match[1]);
      if (Number.isNaN(numericValue) || numericValue < 100) {
        continue;
      }
      // Для совместимости с Авито используем латинскую букву "M" (а не кириллическую "М")
      // в значении ConcreteGrade, например "M300".
      return `M${numericValue}`;
    }
  }
  
  return null;
}

// Извлекает морозостойкость (FrostResistance) из текста
function extractFrostResistanceFromText(description) {
  // Паттерны для поиска: "F100", "F-100", "морозостойкость F100", "FrostResistance: F100"
  const patterns = [
    /(?:морозостойкость|frostresistance)[\s:]*[Ff][\s-]*(\d+)/i,
    /[Ff][\s-]*(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      return `F${match[1]}`;
    }
  }
  
  return null;
}

/**
 * Генерирует XML строку из списка объявлений.
 * @param {Object[]} ads - массив объявлений
 * @param {string} dateLabel - метка даты для Id (например, "05.12")
 * @returns {string} XML строка
 */
export function generateXml(ads = [], dateLabel = '') {
  const adsXml = ads.map((ad, idx) => formatAd(ad, idx, dateLabel)).join('');
  return `<Ads formatVersion="3" target="Avito.ru">${adsXml}\n</Ads>`;
}
