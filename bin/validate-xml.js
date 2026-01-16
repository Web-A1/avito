#!/usr/bin/env node
/**
 * Скрипт валидации XML фида для Avito
 * Проверяет:
 * - Уникальность заголовков и описаний
 * - Наличие всех обязательных полей
 * - Дополнительные проверки (длина, валидность значений, дубли)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { getSellerAddressId } from '../src/constants/materialAliases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Допустимые значения полей
const ALLOWED_CATEGORIES = ['Ремонт и строительство'];
const ALLOWED_GOODS_TYPES = ['Стройматериалы'];
const ALLOWED_GOODS_SUB_TYPES = ['Сыпучие материалы'];
const ALLOWED_AD_TYPES = ['Товар от производителя', 'Товар приобретен на продажу'];
const ALLOWED_CONDITIONS = ['Новое', 'Б/у'];
const ALLOWED_BULK_MATERIAL_TYPES = ['Песок', 'Щебень, гравий'];
const ALLOWED_BULK_MATERIAL_SUB_TYPES_SAND = [
  'Речной',
  'Карьерный',
  'Морской',
  'Кварцевый',
  'Перлитовый',
  'Керамзитовый',
  'Мраморный',
  'Доломитовый',
  'Термозитный'
];
const ALLOWED_BULK_MATERIAL_SUB_TYPES_RUBBLE = ['Щебень', 'Гравий'];
const ALLOWED_RUBBLE_TYPES = ['Гранитный', 'Гравийный', 'Известняковый', 'Вторичный', 'Бутовый', 'Мраморный', 'Другой'];
const ALLOWED_FRACTIONS = [
  '5–20 мм', '20–40 мм', '40–70 мм', '70–250 мм',
  '5-20 мм', '20-40 мм', '40-70 мм', '70-250 мм',
  '5–20', '20–40', '40–70', '70–250',
  '5-20', '20-40', '40-70', '70-250'
];
const ALLOWED_PACKAGING_TYPES = ['Россыпью'];
const ALLOWED_COLORS = ['Белый', 'Серый', 'Жёлтый', 'Чёрный', 'Коричневый'];
const ALLOWED_PRICE_FOR = ['м³', 'тонну'];
const ALLOWED_AVAILABILITY = ['В наличии'];
const ALLOWED_INTERNET_CALLS = ['Да', 'Нет'];
const ALLOWED_AD_STATUS = [
  'Free',
  'Highlight',
  'XL',
  'x2_1',
  'x2_7',
  'x5_1',
  'x5_7',
  'x10_1',
  'x10_7',
  'x15_1',
  'x15_7',
  'x20_1',
  'x20_7'
];

// Простой XML парсер для извлечения данных из <Ad> элементов
function parseXML(xmlString) {
  const ads = [];
  
  // Извлекаем все <Ad> блоки
  const adMatches = xmlString.match(/<Ad>([\s\S]*?)<\/Ad>/g);
  if (!adMatches) {
    return ads;
  }

  for (const adBlock of adMatches) {
    const ad = {};
    
    // Извлекаем значения полей
    const fieldPatterns = {
      Id: /<Id>(.*?)<\/Id>/,
      Category: /<Category>(.*?)<\/Category>/,
      Title: /<Title>(.*?)<\/Title>/,
      Description: /<Description><!\[CDATA\[([\s\S]*?)\]\]><\/Description>/,
      SellerAddressID: /<SellerAddressID>(.*?)<\/SellerAddressID>/,
      Price: /<Price>(.*?)<\/Price>/,
      GoodsType: /<GoodsType>(.*?)<\/GoodsType>/,
      AdType: /<AdType>(.*?)<\/AdType>/,
      Condition: /<Condition>(.*?)<\/Condition>/,
      GoodsSubType: /<GoodsSubType>(.*?)<\/GoodsSubType>/,
      BulkMaterialType: /<BulkMaterialType>(.*?)<\/BulkMaterialType>/,
      BulkMaterialSubType: /<BulkMaterialSubType>(.*?)<\/BulkMaterialSubType>/,
      ServiceType: /<ServiceType>(.*?)<\/ServiceType>/,
      ServiceSubtype: /<ServiceSubtype>(.*?)<\/ServiceSubtype>/,
      WasteType: /<WasteType>(.*?)<\/WasteType>/,
      PackagingType: /<PackagingType>(.*?)<\/PackagingType>/,
      CompactionCoefficient: /<CompactionCoefficient>(.*?)<\/CompactionCoefficient>/,
      MinSaleQuantity: /<MinSaleQuantity>(.*?)<\/MinSaleQuantity>/,
      PriceFor: /<PriceFor>(.*?)<\/PriceFor>/,
      Delivery: /<Delivery>(.*?)<\/Delivery>/,
      InternetCalls: /<InternetCalls>(.*?)<\/InternetCalls>/,
      Color: /<Color>(.*?)<\/Color>/,
      Availability: /<Availability>(.*?)<\/Availability>/,
      AdStatus: /<AdStatus>(.*?)<\/AdStatus>/,
      DateBegin: /<DateBegin>(.*?)<\/DateBegin>/,
      RubbleType: /<RubbleType>(.*?)<\/RubbleType>/,
      Fraction: /<Fraction>(.*?)<\/Fraction>/
    };

    for (const [field, pattern] of Object.entries(fieldPatterns)) {
      const match = adBlock.match(pattern);
      if (match) {
        ad[field] = match[1].trim();
      }
    }

    // Извлекаем изображения
    const imageMatches = adBlock.match(/<Image url="(.*?)"\/>/g);
    if (imageMatches) {
      ad.Images = imageMatches.map(img => {
        const urlMatch = img.match(/url="(.*?)"/);
        return urlMatch ? urlMatch[1] : null;
      }).filter(Boolean);
    } else {
      ad.Images = [];
    }

    if (ad.Id) {
      ads.push(ad);
    }
  }

  return ads;
}

function isServiceAdRecord(ad) {
  const categoryRaw = String(ad.Category || '').toLowerCase();
  return (
    categoryRaw.includes('услуг') ||
    !!ad.ServiceType ||
    !!ad.ServiceSubtype ||
    !!ad.WasteType
  );
}

// Извлекает только блоки 1-6 из описания, исключая блок 7 (технические характеристики)
// Блок 7 всегда идет в конце описания и содержит технические параметры
// Блок 7 начинается с названия материала и двоеточия, затем идут маркеры: "объем:", "самосвал:", "содержание ХПЧ:"
function extractBlocks1To6(description) {
  if (!description || typeof description !== 'string') return '';
  
  // Ищем начало блока 7 по маркерам технических характеристик
  // Эти маркеры всегда присутствуют в блоке 7 и уникальны для него
  const block7Markers = [
    // Маркеры технических характеристик (в любом порядке)
    /(?:объем:|самосвал:|содержание\s+хпч:|насыпная\s+плотность|модуль\s+а:|фракция\s+а:|коэф\s+пнр:|коэф\s+[ψ𝜓])/i
  ];
  
  // Ищем первый маркер блока 7
  let block7StartIndex = -1;
  for (const marker of block7Markers) {
    const match = description.match(marker);
    if (match && match.index !== undefined) {
      // Находим начало тега <p> который содержит этот маркер
      // Ищем последний <p> перед найденным маркером
      const beforeMarker = description.substring(0, match.index);
      const lastPTag = beforeMarker.lastIndexOf('<p>');
      if (lastPTag !== -1) {
        block7StartIndex = lastPTag;
        break;
      }
    }
  }
  
  // Если блок 7 найден, обрезаем описание до его начала
  if (block7StartIndex !== -1) {
    return description.substring(0, block7StartIndex);
  }
  
  // Если блок 7 не найден, возвращаем всё описание (на случай, если структура отличается)
  return description;
}

// Извлекает блоки 1 и 2 из описания (по HTML-структуре: <p>... и <p><strong>...</strong></p><ol>...)
function extractBlocks1And2(description) {
  if (!description || typeof description !== 'string') {
    return { block1: '', block2: '' };
  }

  const blocks1To6 = extractBlocks1To6(description);
  const block2StartMatch = blocks1To6.match(/<p>\s*<strong>[\s\S]*?<\/strong>\s*<\/p>\s*<ol>/i);
  const block2StartIndex = block2StartMatch && block2StartMatch.index !== undefined
    ? block2StartMatch.index
    : -1;

  let block2 = '';
  if (block2StartIndex !== -1) {
    const block2EndIndex = blocks1To6.indexOf('</ol>', block2StartIndex);
    if (block2EndIndex !== -1) {
      block2 = blocks1To6.substring(block2StartIndex, block2EndIndex + '</ol>'.length);
    }
  }

  let block1 = '';
  const beforeBlock2 = block2StartIndex !== -1 ? blocks1To6.slice(0, block2StartIndex) : blocks1To6;
  const block1Match = beforeBlock2.match(/<p>[\s\S]*?<\/p>/i);
  if (block1Match) {
    block1 = block1Match[0];
  }

  return { block1, block2 };
}

function normalizeHtmlText(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[\s\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Нормализация текста для сравнения описаний (строгая проверка уникальности)
// Удаляет HTML теги, нормализует пробелы, приводит к нижнему регистру
// ВАЖНО: нормализует только блоки 1-6, блок 7 (технические характеристики) исключается
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  
  // Сначала извлекаем только блоки 1-6 (исключаем блок 7)
  const blocks1To6 = extractBlocks1To6(text);
  
  return normalizeHtmlText(blocks1To6);
}

function loadPlan(planPath) {
  try {
    const raw = readFileSync(planPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function checkDateBeginAgainstPlan(ads, planPath) {
  const errors = [];
  const warnings = [];

  const plan = loadPlan(planPath);
  if (!plan) {
    warnings.push({
      adIndex: '-',
      adId: '-',
      type: 'plan_missing',
      message: `Не удалось прочитать план: ${planPath}`
    });
    return { errors, warnings };
  }

  const queue = plan.publicationQueue || [];
  if (!queue.length) {
    warnings.push({
      adIndex: '-',
      adId: '-',
      type: 'plan_queue_missing',
      message: `В плане отсутствует publicationQueue`
    });
    return { errors, warnings };
  }

  const adsWithDate = ads.filter(ad => ad.DateBegin);
  if (adsWithDate.length !== queue.length) {
    errors.push({
      adIndex: '-',
      adId: '-',
      type: 'date_begin_count_mismatch',
      message: `Количество объявлений с DateBegin в XML (${adsWithDate.length}) не совпадает с publicationQueue (${queue.length})`
    });
  }

  const expectedMaterial = {
    sand: 'Песок',
    rubble: 'Щебень'
  };

  const len = Math.min(queue.length, adsWithDate.length);
  for (let i = 0; i < len; i++) {
    const planItem = queue[i];
    const ad = adsWithDate[i];
    const issues = [];

    if (planItem.DateBegin !== ad.DateBegin) {
      issues.push(`DateBegin план: ${planItem.DateBegin}, xml: ${ad.DateBegin}`);
    }
    if (planItem.location && ad.SellerAddressID) {
      try {
        const expectedSellerAddressId = getSellerAddressId(planItem.location);
        if (expectedSellerAddressId !== ad.SellerAddressID) {
          issues.push(`Адрес план: "${planItem.location}", SellerAddressID xml: "${ad.SellerAddressID}"`);
        }
      } catch (err) {
        issues.push(`Ошибка проверки адреса для "${planItem.location}": ${err.message}`);
      }
    }
    const expectedType = expectedMaterial[planItem.material];
    if (expectedType && ad.BulkMaterialType && !ad.BulkMaterialType.includes(expectedType)) {
      issues.push(`Материал план: ${expectedType}, xml BulkMaterialType: ${ad.BulkMaterialType}`);
    }

    if (issues.length > 0) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'date_begin_mismatch',
        message: issues.join(' | ')
      });
    }
  }

  return { errors, warnings };
}

// Определяет, является ли объявление старым (из Excel)
// Старые объявления имеют формат: r00-4070_cheh_031225_01 или s00_dmd_031225_01
// Новые объявления имеют формат: s00_bron_201225-125501_01 (с временем HHmmss)
function isOldAd(adId) {
  if (!adId) return false;
  
  // Старые объявления могут содержать дефис в начале (r00-4070)
  if (adId.includes('-') && /^r\d+-\d+/.test(adId)) {
    return true;
  }
  
  // Проверяем дату в формате DDMMYY или DDMMYY-HHmmss
  // Ищем паттерн даты: 6 цифр подряд (DDMMYY), возможно с дефисом и временем после
  // Новый формат: s00_cheh_171225-125501_01 (дата с временем)
  // Старый формат: s00_cheh_031225_01 (только дата)
  const dateMatch = adId.match(/(\d{2})(\d{2})(\d{2})(?:-(\d{6}))?/);
  if (dateMatch) {
    const [, dd, mm, yy, time] = dateMatch;
    
    // Если есть время (новый формат), это новое объявление
    if (time) {
      return false;
    }
    
    // Если дата начинается с 0 (031225), это старый формат
    // Если дата начинается с 1 или 2 (161225, 201225), это новый формат
    // Также проверяем: если день меньше 10 (начинается с 0), это старый формат
    if (dd.startsWith('0') || parseInt(dd, 10) < 10) {
      return true;
    }
  }
  
  return false;
}

// Проверка уникальности
function checkUniqueness(ads) {
  const errors = [];
  const warnings = [];
  
  const ids = new Map();
  const descriptions = new Map();
  
  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    
    // Проверка уникальности Id
    if (ids.has(ad.Id)) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'duplicate_id',
        message: `Дублирующийся Id: "${ad.Id}". Первое вхождение на позиции ${ids.get(ad.Id)}`
      });
    } else {
      ids.set(ad.Id, i + 1);
    }
    
    // Проверка уникальности Description (критично - описания должны быть уникальными)
    // ВАЖНО: Проверяется уникальность только блоков 1-6, блок 7 (технические характеристики) исключается
    // Нормализация удаляет HTML теги и нормализует пробелы для строгой проверки
    const normalizedDesc = normalizeText(ad.Description || '');
    if (normalizedDesc && descriptions.has(normalizedDesc)) {
      const firstOccurrence = descriptions.get(normalizedDesc);
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'duplicate_description',
        message: `КРИТИЧНО: Дублирующееся описание (после нормализации HTML и пробелов). Первое вхождение на позиции ${firstOccurrence}, текущее на позиции ${i + 1}. Описания должны быть уникальными!`
      });
    } else if (normalizedDesc) {
      descriptions.set(normalizedDesc, i + 1);
    }
  }
  
  return { errors, warnings };
}

// Проверка обязательных полей
function checkRequiredFields(ads) {
  const errors = [];
  
  const baseRequiredFields = [
    'Id',
    'Category',
    'Title',
    'Description',
    'SellerAddressID',
    'Price',
    'Images',
    'AdStatus',
    'InternetCalls'
    // DateBegin - опциональное поле (не проверяем обязательность, только формат если присутствует)
  ];
  
  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    const missingFields = [];
    let requiredFields = [...baseRequiredFields];
    const isServiceAd = isServiceAdRecord(ad);
    if (isServiceAd) {
      requiredFields.push('ServiceType');
    } else {
      requiredFields.push(
        'GoodsType',
        'AdType',
        'Condition',
        'GoodsSubType',
        'BulkMaterialType',
        'BulkMaterialSubType',
        'PackagingType',
        'CompactionCoefficient',
        'MinSaleQuantity',
        'PriceFor',
        'Delivery'
      );
    }
    
    // DateBegin - опциональное поле (не проверяем обязательность)
    
    // Для щебня и гравия добавляем обязательные поля
    if (!isServiceAd && ad.BulkMaterialType === 'Щебень, гравий') {
      // Fraction обязателен для всех типов щебня/гравия
      requiredFields.push('Fraction');
      
      // RubbleType обязателен только для щебня
      if (ad.BulkMaterialSubType === 'Щебень') {
        requiredFields.push('RubbleType');
      }
    }
    
    for (const field of requiredFields) {
      if (field === 'Images') {
        if (!ad.Images || ad.Images.length === 0) {
          missingFields.push(field);
        }
      } else if (!ad[field] || ad[field].trim() === '') {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'missing_fields',
        message: `Отсутствуют обязательные поля: ${missingFields.join(', ')}`,
        missingFields
      });
    }
  }
  
  return errors;
}

// Проверка формата и длины
function checkFormatAndLength(ads) {
  const errors = [];
  const warnings = [];
  
  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    
    // Проверка длины Title
    if (ad.Title && ad.Title.length > 100) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'title_too_long',
        message: `Заголовок превышает 100 символов: ${ad.Title.length} символов`
      });
    }
    
    // Проверка длины Description
    if (ad.Description && ad.Description.length > 7500) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'description_too_long',
        message: `Описание превышает 7500 символов: ${ad.Description.length} символов`
      });
    }
    
    // Проверка формата Id (более гибкий паттерн)
    const idPattern = /^[a-z0-9_-]+(_[0-9]{2}\.[0-9]{2}_[0-9]+|[a-z0-9_-]+)$/i;
    // Проверяем только базовую структуру (не строго, так как формат может варьироваться)
    if (ad.Id && ad.Id.trim().length === 0) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'empty_id',
        message: `Id не может быть пустым`
      });
    }
    
    // Проверка Price
    if (ad.Price) {
      const price = parseFloat(ad.Price);
      if (isNaN(price) || price <= 0) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'invalid_price',
          message: `Некорректная цена: "${ad.Price}"`
        });
      }
    }
    
    // Проверка формата DateBegin (dd.MM.yyyy HH:mm)
    if (ad.DateBegin) {
      const dateBeginPattern = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;
      if (!dateBeginPattern.test(ad.DateBegin)) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'invalid_date_begin_format',
          message: `Некорректный формат DateBegin: "${ad.DateBegin}". Ожидается формат: "dd.MM.yyyy HH:mm"`
        });
      } else {
        // Проверка валидности даты
        const match = ad.DateBegin.match(dateBeginPattern);
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const year = parseInt(match[3], 10);
        const hour = parseInt(match[4], 10);
        const minute = parseInt(match[5], 10);
        
        if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
          errors.push({
            adIndex: i + 1,
            adId: ad.Id,
            type: 'invalid_date_begin_value',
            message: `Некорректные значения в DateBegin: "${ad.DateBegin}"`
          });
        }
      }
    }
    
    // Проверка URL изображений
    if (ad.Images && ad.Images.length > 0) {
      for (const imgUrl of ad.Images) {
        try {
          const url = new URL(imgUrl);
          if (!['http:', 'https:'].includes(url.protocol)) {
            errors.push({
              adIndex: i + 1,
              adId: ad.Id,
              type: 'invalid_image_url',
              message: `Некорректный URL изображения: "${imgUrl}"`
            });
          }
        } catch (e) {
          errors.push({
            adIndex: i + 1,
            adId: ad.Id,
            type: 'invalid_image_url',
            message: `Некорректный URL изображения: "${imgUrl}"`
          });
        }
      }
    }
  }
  
  return { errors, warnings };
}

// Проверка значений полей
function checkFieldValues(ads) {
  const errors = [];
  const warnings = [];
  
  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    const isServiceAd = isServiceAdRecord(ad);
    
    // Проверка Category
    if (!isServiceAd && ad.Category && !ALLOWED_CATEGORIES.includes(ad.Category)) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_category',
        message: `Недопустимая категория: "${ad.Category}". Допустимые: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }
    
    // Проверка GoodsType
    if (!isServiceAd && ad.GoodsType && !ALLOWED_GOODS_TYPES.includes(ad.GoodsType)) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_goods_type',
        message: `Недопустимый тип товара: "${ad.GoodsType}". Допустимые: ${ALLOWED_GOODS_TYPES.join(', ')}`
      });
    }
    
    // Проверка GoodsSubType
    if (!isServiceAd && ad.GoodsSubType && !ALLOWED_GOODS_SUB_TYPES.includes(ad.GoodsSubType)) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_goods_sub_type',
        message: `Недопустимый подтип товара: "${ad.GoodsSubType}". Допустимые: ${ALLOWED_GOODS_SUB_TYPES.join(', ')}`
      });
    }
    
    // Проверка AdType - всегда должно быть "Товар от производителя"
    if (!isServiceAd && ad.AdType && ad.AdType !== 'Товар от производителя') {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_ad_type',
        message: `Недопустимый тип объявления: "${ad.AdType}". Должно быть всегда "Товар от производителя"`
      });
    }
    
    // Проверка Condition - всегда должно быть "Новое"
    if (!isServiceAd && ad.Condition && ad.Condition !== 'Новое') {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_condition',
        message: `Недопустимое состояние: "${ad.Condition}". Должно быть всегда "Новое"`
      });
    }
    
    // Проверка BulkMaterialType
    if (!isServiceAd && ad.BulkMaterialType && !ALLOWED_BULK_MATERIAL_TYPES.includes(ad.BulkMaterialType)) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_bulk_material_type',
        message: `Недопустимый тип сыпучего материала: "${ad.BulkMaterialType}". Допустимые: ${ALLOWED_BULK_MATERIAL_TYPES.join(', ')}`
      });
    }
    
    // Проверка BulkMaterialSubType
    if (!isServiceAd && ad.BulkMaterialType === 'Песок') {
      if (ad.BulkMaterialSubType && !ALLOWED_BULK_MATERIAL_SUB_TYPES_SAND.includes(ad.BulkMaterialSubType)) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'invalid_bulk_material_sub_type',
          message: `Недопустимый подтип песка: "${ad.BulkMaterialSubType}". Допустимые: ${ALLOWED_BULK_MATERIAL_SUB_TYPES_SAND.join(', ')}`
        });
      }
    } else if (!isServiceAd && ad.BulkMaterialType === 'Щебень, гравий') {
      if (ad.BulkMaterialSubType && !ALLOWED_BULK_MATERIAL_SUB_TYPES_RUBBLE.includes(ad.BulkMaterialSubType)) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'invalid_bulk_material_sub_type',
          message: `Недопустимый подтип щебня/гравия: "${ad.BulkMaterialSubType}". Допустимые: ${ALLOWED_BULK_MATERIAL_SUB_TYPES_RUBBLE.join(', ')}`
        });
      }
      
      // Проверка RubbleType для щебня
      if (ad.BulkMaterialSubType === 'Щебень') {
        if (ad.RubbleType && !ALLOWED_RUBBLE_TYPES.includes(ad.RubbleType)) {
          errors.push({
            adIndex: i + 1,
            adId: ad.Id,
            type: 'invalid_rubble_type',
            message: `Недопустимый тип щебня: "${ad.RubbleType}". Допустимые: ${ALLOWED_RUBBLE_TYPES.join(', ')}`
          });
        }
        
        // Проверка Fraction для щебня
        if (ad.Fraction) {
          // Нормализуем формат фракции для сравнения (приводим к единому виду)
          const normalizedFraction = ad.Fraction.replace(/-/g, '–').trim();
          const isValid = ALLOWED_FRACTIONS.some(allowed => {
            const normalizedAllowed = allowed.replace(/-/g, '–').trim();
            return normalizedFraction === normalizedAllowed || normalizedFraction.includes(allowed.split(' ')[0]);
          });
          
          if (!isValid) {
            warnings.push({
              adIndex: i + 1,
              adId: ad.Id,
              type: 'invalid_fraction',
              message: `Недопустимая фракция: "${ad.Fraction}". Рекомендуемый формат: "40–70 мм" (одно из значений: 5–20, 20–40, 40–70, 70–250 мм)`
            });
          }
        }
      }
    }
    
    // Проверка PackagingType - всегда должно быть "Россыпью"
    if (!isServiceAd && ad.PackagingType && ad.PackagingType !== 'Россыпью') {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_packaging_type',
        message: `Недопустимый тип упаковки: "${ad.PackagingType}". Должно быть всегда "Россыпью"`
      });
    }
    
    // Проверка Color
    if (!isServiceAd && ad.Color && !ALLOWED_COLORS.includes(ad.Color)) {
      warnings.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_color',
        message: `Недопустимый цвет: "${ad.Color}". Допустимые: ${ALLOWED_COLORS.join(', ')}`
      });
    }
    
    // Проверка PriceFor
    if (!isServiceAd && ad.PriceFor && !ALLOWED_PRICE_FOR.includes(ad.PriceFor)) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_price_for',
        message: `Недопустимая единица измерения цены: "${ad.PriceFor}". Допустимые: ${ALLOWED_PRICE_FOR.join(', ')}`
      });
    }
    
    // Проверка Availability
    if (!isServiceAd && (!ad.Availability || ad.Availability.trim() === '')) {
      warnings.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'missing_availability',
        message: `Рекомендуется указать Availability. Допустимые значения: ${ALLOWED_AVAILABILITY.join(', ')}`
      });
    } else if (!isServiceAd && !ALLOWED_AVAILABILITY.includes(ad.Availability)) {
      warnings.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_availability',
        message: `Недопустимое значение наличия: "${ad.Availability}". Допустимые: ${ALLOWED_AVAILABILITY.join(', ')}`
      });
    }

    // Проверка InternetCalls
    if (ad.InternetCalls && !ALLOWED_INTERNET_CALLS.includes(ad.InternetCalls)) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_internet_calls',
        message: `Недопустимое значение InternetCalls: "${ad.InternetCalls}". Допустимые: ${ALLOWED_INTERNET_CALLS.join(', ')}`
      });
    }

    // Проверка AdStatus
    if (ad.AdStatus && !ALLOWED_AD_STATUS.includes(ad.AdStatus)) {
      errors.push({
        adIndex: i + 1,
        adId: ad.Id,
        type: 'invalid_ad_status',
        message: `Недопустимое значение AdStatus: "${ad.AdStatus}". Допустимые: ${ALLOWED_AD_STATUS.join(', ')}`
      });
    }
    
    // Проверка CompactionCoefficient - должно быть числом
    if (!isServiceAd && ad.CompactionCoefficient) {
      const coeff = parseFloat(ad.CompactionCoefficient);
      if (isNaN(coeff)) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'invalid_compaction_coefficient',
          message: `Некорректный коэффициент уплотнения: "${ad.CompactionCoefficient}". Должно быть числом`
        });
      }
    }
    
    // Проверка MinSaleQuantity - 10..20 шаг 2
    if (!isServiceAd && ad.MinSaleQuantity) {
      const qty = parseFloat(ad.MinSaleQuantity);
      const inRange = !isNaN(qty) && qty >= 10 && qty <= 20 && (qty - 10) % 2 === 0;
      if (!inRange) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'invalid_min_sale_quantity',
          message: `Некорректное минимальное количество: "${ad.MinSaleQuantity}". Ожидается 10–20 с шагом 2`
        });
      }
    }
  }
  
  return { errors, warnings };
}

// Проверка соответствия Title/Description типу материала
function checkMaterialConsistency(ads) {
  const errors = [];
  const warnings = [];
  
  const sandKeywords = ['песок', 'песка', 'песком', 'песчаный'];
  const rubbleKeywords = ['щебень', 'щебня', 'щебнем', 'щебеночный', 'гравий', 'гравия', 'гравием', 'гравийный'];
  const serviceKeywords = ['вывоз', 'услуг', 'услуга', 'аренда', 'демонтаж', 'уборка', 'снег', 'мусор'];
  
  // Ключевые слова, которые указывают на раздел ассортимента (игнорируем их)
  const assortmentKeywords = ['ассортимент', 'товаров в наличии', 'в наличии'];
  
  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    const bulkType = ad.BulkMaterialType;
    const title = (ad.Title || '').toLowerCase();
    let description = (ad.Description || '').toLowerCase();
    const { block1, block2 } = extractBlocks1And2(ad.Description || '');
    const block1And2Text = normalizeHtmlText(`${block1} ${block2}`);
    
    // Удаляем раздел ассортимента из проверки (всё после "Ассортимент товаров в наличии")
    const assortmentIndex = description.indexOf('ассортимент товаров в наличии');
    if (assortmentIndex > 0) {
      description = description.substring(0, assortmentIndex);
    }
    
    // Берем только первые 500 символов описания для проверки (основной контент)
    const mainDescription = description.substring(0, 500);
    
    const isServiceAd =
      serviceKeywords.some(kw => title.includes(kw)) ||
      serviceKeywords.some(kw => mainDescription.includes(kw));

    if (bulkType === 'Песок') {
      const hasSandInTitle = sandKeywords.some(kw => title.includes(kw));
      const hasSandInDesc = sandKeywords.some(kw => mainDescription.includes(kw));
      const hasRubbleInTitle = rubbleKeywords.some(kw => title.includes(kw));
      const hasRubbleInMainDesc = rubbleKeywords.some(kw => mainDescription.includes(kw));
      const hasRubbleInBlock1And2 = rubbleKeywords.some(kw => block1And2Text.includes(kw));
      
      // Критично: если в заголовке упоминается щебень/гравий вместо песка
      if (hasRubbleInTitle && !hasSandInTitle) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'material_mismatch',
          message: `Title mismatch (adId=${ad.Id}): BulkMaterialType="Песок", но в Title упоминается щебень/гравий: "${ad.Title}"`
        });
      }
      // Критично: если в блоках 1/2 упоминается щебень/гравий
      if (hasRubbleInBlock1And2) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'material_mismatch',
          message: `Block1/2 mismatch (adId=${ad.Id}): BulkMaterialType="Песок", но в блоках 1/2 упоминается щебень/гравий`
        });
      }
      // Предупреждение: если в основном описании упоминается щебень/гравий как основной материал
      else if (hasRubbleInMainDesc && !hasSandInDesc) {
        warnings.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'material_mismatch',
          message: `Несоответствие: BulkMaterialType="Песок", но в основном описании упоминается щебень/гравий`
        });
      }
      // Предупреждение: если нет упоминания песка
      else if (!hasSandInTitle && !hasSandInDesc && !isServiceAd) {
        warnings.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'material_keyword_missing',
          message: `BulkMaterialType="Песок", но в Title/Description нет упоминания песка`
        });
      }
    } else if (bulkType === 'Щебень, гравий') {
      const hasRubbleInTitle = rubbleKeywords.some(kw => title.includes(kw));
      const hasRubbleInMainDesc = rubbleKeywords.some(kw => mainDescription.includes(kw));
      const hasSandInTitle = sandKeywords.some(kw => title.includes(kw));
      const hasSandInMainDesc = sandKeywords.some(kw => mainDescription.includes(kw));
      const hasSandInBlock1And2 = sandKeywords.some(kw => block1And2Text.includes(kw));
      
      // Критично: если в заголовке упоминается песок вместо щебня/гравия
      if (hasSandInTitle && !hasRubbleInTitle) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'material_mismatch',
          message: `Title mismatch (adId=${ad.Id}): BulkMaterialType="Щебень, гравий", но в Title упоминается песок: "${ad.Title}"`
        });
      }
      // Критично: если в блоках 1/2 упоминается песок
      if (hasSandInBlock1And2) {
        errors.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'material_mismatch',
          message: `Block1/2 mismatch (adId=${ad.Id}): BulkMaterialType="Щебень, гравий", но в блоках 1/2 упоминается песок`
        });
      }
      // Предупреждение: если в основном описании упоминается песок как основной материал
      else if (hasSandInMainDesc && !hasRubbleInMainDesc) {
        warnings.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'material_mismatch',
          message: `Несоответствие: BulkMaterialType="Щебень, гравий", но в основном описании упоминается песок`
        });
      }
      // Предупреждение: если нет упоминания щебня/гравия
      else if (!hasRubbleInTitle && !hasRubbleInMainDesc && !isServiceAd) {
        warnings.push({
          adIndex: i + 1,
          adId: ad.Id,
          type: 'material_keyword_missing',
          message: `BulkMaterialType="Щебень, гравий", но в Title/Description нет упоминания щебня/гравия`
        });
      }
    }
  }
  
  return { errors, warnings };
}

// Главная функция валидации
function validateXML(xmlFilePath) {
  let xmlString;
  try {
    xmlString = readFileSync(xmlFilePath, 'utf-8');
  } catch (error) {
    console.error(`   Ошибка чтения файла: ${error.message}`);
    process.exit(1);
  }
  
  // Проверка структуры XML
  if (!xmlString.includes('<Ads')) {
    console.error('   Файл не является валидным XML фидом Avito (отсутствует корневой элемент <Ads>)');
    process.exit(1);
  }
  
  const formatVersionMatch = xmlString.match(/formatVersion="(\d+)"/);
  if (!formatVersionMatch || formatVersionMatch[1] !== '3') {
    console.warn('   Предупреждение: formatVersion не равен "3"');
  }
  
  // Парсинг объявлений
  const ads = parseXML(xmlString);
  console.log(`   Найдено объявлений: ${ads.length}`);
  
  if (ads.length === 0) {
    console.error('   Не найдено объявлений в файле');
    process.exit(1);
  }
  
  // Выполнение всех проверок
  const allErrors = [];
  const allWarnings = [];
  
  console.log('');
  console.log('   Выполнение проверок:');
  console.log('   ────────────────────────────────────────────────────────────');
  
  // 1. Проверка уникальности
  console.log('   1. Проверка уникальности...');
  const { errors: uniquenessErrors, warnings: uniquenessWarnings } = checkUniqueness(ads);
  allErrors.push(...uniquenessErrors);
  allWarnings.push(...uniquenessWarnings);
  console.log('      Проверено');
  
  // 2. Проверка обязательных полей
  console.log('   2. Проверка обязательных полей...');
  const requiredErrors = checkRequiredFields(ads);
  allErrors.push(...requiredErrors);
  console.log('      Проверено');
  
  // 3. Проверка формата и длины
  console.log('   3. Проверка формата и длины...');
  const { errors: formatErrors, warnings: formatWarnings } = checkFormatAndLength(ads);
  allErrors.push(...formatErrors);
  allWarnings.push(...formatWarnings);
  console.log('      Проверено');
  
  // 4. Проверка значений полей
  console.log('   4. Проверка значений полей...');
  const { errors: valueErrors, warnings: valueWarnings } = checkFieldValues(ads);
  allErrors.push(...valueErrors);
  allWarnings.push(...valueWarnings);
  console.log('      Проверено');
  
  // 5. Проверка соответствия материала
  console.log('   5. Проверка соответствия материала...');
  const { errors: materialErrors, warnings: materialWarnings } = checkMaterialConsistency(ads);
  allErrors.push(...materialErrors);
  allWarnings.push(...materialWarnings);
  console.log('      Проверено');

  // 6. Сверка DateBegin с plan.json
  console.log('   6. Сверка DateBegin с plan.json...');
  const { errors: planErrors, warnings: planWarnings } = checkDateBeginAgainstPlan(ads, planFilePath);
  allErrors.push(...planErrors);
  allWarnings.push(...planWarnings);
  console.log('      Проверено');
  
  console.log('   ────────────────────────────────────────────────────────────');
  console.log('');
  
  // Вывод результатов
  if (allErrors.length === 0 && allWarnings.length === 0) {
    console.log('   Результат: Все проверки пройдены успешно');
    return;
  }
  
  if (allErrors.length > 0) {
    console.log(`   КРИТИЧЕСКИЕ ОШИБКИ (${allErrors.length}):`);
    console.log('');
    allErrors.forEach((error, idx) => {
      console.log(`      ${idx + 1}. [Объявление #${error.adIndex}, Id: ${error.adId}]`);
      console.log(`         Тип: ${error.type}`);
      console.log(`         ${error.message}`);
      if (idx < allErrors.length - 1) {
        console.log('');
      }
    });
  }
  
  if (allWarnings.length > 0) {
    if (allErrors.length > 0) {
      console.log('');
    }
    console.log(`   ПРЕДУПРЕЖДЕНИЯ (${allWarnings.length}):`);
    console.log('');
    allWarnings.forEach((warning, idx) => {
      console.log(`      ${idx + 1}. [Объявление #${warning.adIndex}, Id: ${warning.adId}]`);
      console.log(`         Тип: ${warning.type}`);
      console.log(`         ${warning.message}`);
      if (idx < allWarnings.length - 1) {
        console.log('');
      }
    });
  }
  
  console.log('');
  
  if (allErrors.length > 0) {
    console.log(`   Валидация завершена с ошибками. Исправьте ${allErrors.length} критических ошибок перед загрузкой в Avito.`);
    process.exit(1);
  } else {
    console.log(`   Валидация завершена с предупреждениями. Рекомендуется исправить ${allWarnings.length} предупреждений.`);
  }
}

// Запуск скрипта
const xmlFilePath = process.argv[2] || resolve(__dirname, '../output/ads_16.12.xml');
const planFilePath = process.argv[3] || resolve(__dirname, '../data/plan.json');

if (!xmlFilePath) {
  console.error('Использование: node bin/validate-xml.js <путь_к_xml_файлу>');
  process.exit(1);
}

validateXML(xmlFilePath);
