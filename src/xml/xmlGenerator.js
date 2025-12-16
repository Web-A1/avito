/**
 * Генератор XML для Авито.
 * Принимает массив объявлений и возвращает строку XML (<Ads><Ad>…</Ad></Ads>).
 */

import { FIXED_PARAMETERS } from '../constants/parameters.js';

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

  // Для щебня определяем RubbleType и Fraction
  let rubbleTypeXml = '';
  let fractionXml = '';
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
  }

  return `
    <Ad>
      <Id>${escapeXml(id)}</Id>
      <Category>Ремонт и строительство</Category>
      <Title>${escapeXml(ad.title || '')}</Title>
      <Description>${description}</Description>
      <Address>${escapeXml(ad.address || '')}</Address>
      ${ad.price ? `<Price>${ad.price}</Price>` : ''}
      ${formatImages(images)}
      <GoodsType>Стройматериалы</GoodsType>
      <AdType>Товар от производителя</AdType>
      <Condition>Новое</Condition>
      <GoodsSubType>Сыпучие материалы</GoodsSubType>
      <BulkMaterialType>${escapeXml(bulkMaterialType)}</BulkMaterialType>
      <BulkMaterialSubType>${escapeXml(bulkMaterialSubType)}</BulkMaterialSubType>
      ${rubbleTypeXml}
      ${fractionXml}
      <PackagingType>${escapeXml(packagingType)}</PackagingType>
      <CompactionCoefficient>${compactionCoefficient}</CompactionCoefficient>
      <MinSaleQuantity>${minSaleQuantity}</MinSaleQuantity>
      <PriceFor>${escapeXml(ad.priceFor || '')}</PriceFor>
      ${ad.color ? `<Color>${escapeXml(ad.color)}</Color>` : ''}
      <Availability>${escapeXml(availability)}</Availability>
      ${dateBegin ? `<DateBegin>${escapeXml(dateBegin)}</DateBegin>` : ''}
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
