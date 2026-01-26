/**
 * Генератор XML для Авито.
 * Принимает массив объявлений и возвращает строку XML (<Ads><Ad>…</Ad></Ads>).
 */

import { FIXED_PARAMETERS, CONTACT_PARAMETERS } from '../constants/parameters.js';
import { getSellerAddressId } from '../constants/materialAliases.js';

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
  const isGenerated = !!(ad.adId || ad.materialId || ad.material);
  const category = isGenerated ? 'Ремонт и строительство' : (ad.category || ad.Category || '');
  const goodsType = isGenerated ? 'Стройматериалы' : (ad.goodsType || ad.goodstype || '');
  const goodsSubType = isGenerated ? 'Сыпучие материалы' : (ad.goodsSubType || ad.goodssubtype || '');
  const adType = isGenerated ? 'Товар от производителя' : (ad.adType || ad.adtype || '');
  const condition = isGenerated ? 'Новое' : (ad.condition || ad.Condition || '');
  const serviceType = ad.serviceType || ad.servicetype || '';
  const serviceSubtype = ad.serviceSubtype || ad.servicesubtype || '';
  const wasteType = ad.wasteType || ad.wastetype || '';
  const categoryRaw = String(category || '').toLowerCase();
  const isServiceAd =
    !isGenerated && (categoryRaw.includes('услуг') || serviceType || serviceSubtype || wasteType);
  const resolvedCategory = category || (isServiceAd ? '' : 'Ремонт и строительство');
  const resolvedGoodsType = goodsType || (isServiceAd ? '' : 'Стройматериалы');
  const resolvedGoodsSubType = goodsSubType || (isServiceAd ? '' : 'Сыпучие материалы');
  const resolvedAdType = adType || (isServiceAd ? '' : 'Товар от производителя');
  const resolvedCondition = condition || (isServiceAd ? '' : 'Новое');
  const bulkMaterialType = ad.bulkMaterialType || '';
  const bulkMaterialSubType = ad.bulkMaterialSubType || '';
  if (isGenerated && !bulkMaterialType) {
    throw new Error('BulkMaterialType обязателен для новых объявлений');
  }
  const packagingType = isServiceAd
    ? ad.packagingType || ''
    : ad.packagingType || FIXED_PARAMETERS.PACKAGING_TYPE;
  const availability = isServiceAd
    ? ad.availability || ''
    : ad.availability || FIXED_PARAMETERS.AVAILABILITY;
  const compactionCoefficient =
    ad.compactionCoefficient ?? fixed.compactionCoefficient ?? '';
  const minSaleQuantity = isServiceAd
    ? ad.minSaleQuantity ?? ''
    : ad.minSaleQuantity ?? FIXED_PARAMETERS.MIN_SALE_QUANTITY;
  const priceFor = isServiceAd ? ad.priceFor || '' : ad.priceFor || '';
  const dateBegin = ad.dateBegin;
  const sellerAddressId = getSellerAddressId(ad.address || ad.location || '');

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
  // AdStatus: из объявления или значение по умолчанию "Free"
  const adStatus = ad.adStatus || ad.adstatus || CONTACT_PARAMETERS.AD_STATUS;
  // InternetCalls: из объявления или значение по умолчанию "Да"
  const internetCalls = ad.internetCalls || ad.internetcalls || CONTACT_PARAMETERS.INTERNET_CALLS;
  // ManagerName: из объявления или значение по умолчанию "Владимир"
  const managerName = ad.managerName || ad.managername || CONTACT_PARAMETERS.MANAGER_NAME;
  const contactPhone = ad.contactPhone || ad.contactphone || CONTACT_PARAMETERS.CONTACT_PHONE;
  const contactMethod = ad.contactMethod || ad.contactmethod || CONTACT_PARAMETERS.CONTACT_METHOD;
  const email = ad.email || ad.eMail || CONTACT_PARAMETERS.EMAIL;
  const companyName = ad.companyName || ad.companyname || CONTACT_PARAMETERS.COMPANY_NAME;
  const targetAudience =
    ad.targetAudience || ad.targetaudience || CONTACT_PARAMETERS.TARGET_AUDIENCE;
  const sameDayPickup = ad.sameDayPickup || ad.samedaypickup || '';
  const performersOnTheTeam = ad.performersOnTheTeam || ad.performersontheteam || '';
  const workExperience = ad.workExperience || ad.workexperience || '';
  const workWithLegalEntities =
    ad.workWithLegalEntities || ad.workwithlegalentities || '';
  const workDays = ad.workDays || ad.workdays || '';
  const workTimeFrom = ad.workTimeFrom || ad.worktimefrom || '';
  const workTimeTo = ad.workTimeTo || ad.worktimeto || '';
  const minimumOrderAmount = ad.minimumOrderAmount || ad.minimumorderamount || '';
  const callsDevices = ad.callsDevices || ad.callsdevices || '';
  const promo = ad.promo || '';
  const promoAutoOptions = ad.promoAutoOptions || ad.promoautooptions || '';
  const promoManualOptions = ad.promoManualOptions || ad.promomanualoptions || '';
  const roomType = ad.roomType || ad.roomtype || '';
  const latitude = ad.latitude || ad.Latitude || '';
  const longitude = ad.longitude || ad.Longitude || '';
  const addressValue = ad.address || ad.Address || '';
  // Delivery: для услуг не добавляем; для товаров подставляем дефолт, если пусто
  const workDaysValue = isServiceAd
    ? normalizeWorkDays(workDays || CONTACT_PARAMETERS.SERVICE_WORK_DAYS)
    : workDays;
  const roomTypeValue = isServiceAd
    ? roomType || CONTACT_PARAMETERS.SERVICE_ROOM_TYPE
    : roomType;
  const delivery = isServiceAd ? ad.delivery || '' : ad.delivery || CONTACT_PARAMETERS.DELIVERY;
  return `
    <Ad>
      <Id>${escapeXml(id)}</Id>
      ${avitoId ? `<AvitoId>${escapeXml(String(avitoId))}</AvitoId>` : ''}
      ${dateBegin ? `<DateBegin>${escapeXml(dateBegin)}</DateBegin>` : ''}
      ${avitoDateEnd ? `<DateEnd>${escapeXml(String(avitoDateEnd))}</DateEnd>` : ''}
      <ListingFee>${escapeXml(String(listingFee))}</ListingFee>
      <AdStatus>${escapeXml(String(adStatus))}</AdStatus>
      <ManagerName>${escapeXml(managerName)}</ManagerName>
      <ContactPhone>${escapeXml(contactPhone)}</ContactPhone>
      ${resolvedCategory ? `<Category>${escapeXml(resolvedCategory)}</Category>` : ''}
      <SellerAddressID>${escapeXml(sellerAddressId)}</SellerAddressID>
      ${isServiceAd && addressValue ? `<Address>${escapeXml(addressValue)}</Address>` : ''}
      ${isServiceAd && latitude ? `<Latitude>${escapeXml(String(latitude))}</Latitude>` : ''}
      ${isServiceAd && longitude ? `<Longitude>${escapeXml(String(longitude))}</Longitude>` : ''}
      <Title>${escapeXml(ad.title || '')}</Title>
      <Description>${description}</Description>
      ${ad.price ? `<Price>${ad.price}</Price>` : ''}
      ${formatImages(images)}
      <ContactMethod>${escapeXml(contactMethod)}</ContactMethod>
      ${delivery ? `<Delivery>${escapeXml(String(delivery))}</Delivery>` : ''}
      <InternetCalls>${escapeXml(String(internetCalls))}</InternetCalls>
      <EMail>${escapeXml(email)}</EMail>
      <CompanyName>${escapeXml(companyName)}</CompanyName>
      ${serviceType ? `<ServiceType>${escapeXml(serviceType)}</ServiceType>` : ''}
      ${serviceSubtype ? `<ServiceSubtype>${escapeXml(serviceSubtype)}</ServiceSubtype>` : ''}
      ${wasteType ? `<WasteType>${escapeXml(wasteType)}</WasteType>` : ''}
      ${sameDayPickup ? `<SameDayPickup>${escapeXml(String(sameDayPickup))}</SameDayPickup>` : ''}
      ${performersOnTheTeam ? `<PerformersOnTheTeam>${escapeXml(String(performersOnTheTeam))}</PerformersOnTheTeam>` : ''}
      ${workExperience ? `<WorkExperience>${escapeXml(String(workExperience))}</WorkExperience>` : ''}
      ${workWithLegalEntities ? `<WorkWithLegalEntities>${escapeXml(String(workWithLegalEntities))}</WorkWithLegalEntities>` : ''}
      ${workDaysValue ? `<WorkDays>${escapeXml(String(workDaysValue))}</WorkDays>` : ''}
      ${workTimeFrom ? `<WorkTimeFrom>${escapeXml(String(workTimeFrom))}</WorkTimeFrom>` : ''}
      ${workTimeTo ? `<WorkTimeTo>${escapeXml(String(workTimeTo))}</WorkTimeTo>` : ''}
      ${minimumOrderAmount ? `<MinimumOrderAmount>${escapeXml(String(minimumOrderAmount))}</MinimumOrderAmount>` : ''}
      ${callsDevices ? `<CallsDevices>${escapeXml(String(callsDevices))}</CallsDevices>` : ''}
      ${promo ? `<Promo>${escapeXml(String(promo))}</Promo>` : ''}
      ${promoAutoOptions ? `<PromoAutoOptions>${escapeXml(String(promoAutoOptions))}</PromoAutoOptions>` : ''}
      ${promoManualOptions ? `<PromoManualOptions>${escapeXml(String(promoManualOptions))}</PromoManualOptions>` : ''}
      ${roomTypeValue ? `<RoomType>${escapeXml(String(roomTypeValue))}</RoomType>` : ''}
      ${!isServiceAd ? `<PackagingType>${escapeXml(packagingType)}</PackagingType>` : ''}
      ${!isServiceAd ? `<CompactionCoefficient>${compactionCoefficient}</CompactionCoefficient>` : ''}
      ${!isServiceAd ? `<MinSaleQuantity>${minSaleQuantity}</MinSaleQuantity>` : ''}
      ${!isServiceAd ? `<PriceFor>${escapeXml(priceFor)}</PriceFor>` : ''}
      ${!isServiceAd ? `<GoodsType>${escapeXml(resolvedGoodsType)}</GoodsType>` : ''}
      ${!isServiceAd ? `<AdType>${escapeXml(resolvedAdType)}</AdType>` : ''}
      ${!isServiceAd ? `<Condition>${escapeXml(resolvedCondition)}</Condition>` : ''}
      ${!isServiceAd ? `<Availability>${escapeXml(availability)}</Availability>` : ''}
      ${!isServiceAd ? `<GoodsSubType>${escapeXml(resolvedGoodsSubType)}</GoodsSubType>` : ''}
      ${!isServiceAd ? `<BulkMaterialType>${escapeXml(bulkMaterialType)}</BulkMaterialType>` : ''}
      ${!isServiceAd ? `<BulkMaterialSubType>${escapeXml(bulkMaterialSubType)}</BulkMaterialSubType>` : ''}
      ${!isServiceAd ? rubbleTypeXml : ''}
      ${!isServiceAd ? fractionXml : ''}
      ${!isServiceAd ? flakinessIndexXml : ''}
      ${!isServiceAd ? concreteGradeXml : ''}
      ${!isServiceAd ? frostResistanceXml : ''}
      ${ad.color ? `<Color>${escapeXml(ad.color)}</Color>` : ''}
      ${!isServiceAd ? `<TargetAudience>${escapeXml(targetAudience)}</TargetAudience>` : ''}
    </Ad>`;
}

function normalizeWorkDays(value = '') {
  const raw = String(value || '').toLowerCase();
  if (!raw) return '';
  const map = {
    'пн': 'пн.',
    'вт': 'вт.',
    'ср': 'ср.',
    'чт': 'чт.',
    'пт': 'пт.',
    'сб': 'сб.',
    'вс': 'вс.'
  };
  const tokens = raw
    .replace(/\./g, '')
    .split(/[^а-яa-z]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
  const days = [];
  for (const t of tokens) {
    const key = t.slice(0, 2);
    if (map[key]) days.push(map[key]);
  }
  const unique = [...new Set(days)];
  return unique.length ? unique.join(' | ') : String(value || '');
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
