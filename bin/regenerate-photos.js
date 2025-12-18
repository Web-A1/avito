#!/usr/bin/env node
/**
 * Скрипт для точечной перегенерации фото и обновления ссылок в XML
 * 
 * Использование:
 *   # По ссылкам на Яндекс.Диск (рекомендуется указывать и ссылку, и имя файла)
 *   node bin/regenerate-photos.js --xml output/ads_17.12.xml \
 *     --urls https://yadi.sk/d/xxx https://yadi.sk/d/yyy \
 *     --file-names s00_bron_171225_01.jpg s00_cheh_171225_01.jpg
 *   
 *   # Только по ссылкам
 *   node bin/regenerate-photos.js --xml output/ads_17.12.xml --urls https://yadi.sk/d/xxx
 *   
 *   # Только по именам файлов
 *   node bin/regenerate-photos.js --xml output/ads_17.12.xml --file-names s00_bron_171225_01.jpg
 *   
 *   # По adId
 *   node bin/regenerate-photos.js --xml output/ads_17.12.xml --ad-ids s00_bron_171225_01
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { parseAdId, parseDateLabel } from '../src/constants/materialAliases.js';
import { generatePhotoForOldAd } from './build-feed.js';
import { findLatestPhotosLinks } from '../src/utils/photosLinksReader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PHOTOS_ROOT = path.resolve(__dirname, '..', 'data', 'photos');
const DEFAULT_DISK_ROOT = 'Cursor_for_Avito';
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'output');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    xml: '',
    urls: [],
    adIds: [],
    fileNames: [],
    photosLinks: '',
    diskRoot: process.env.YANDEX_DISK_ROOT || DEFAULT_DISK_ROOT,
    photosRoot: DEFAULT_PHOTOS_ROOT,
    outputDir: DEFAULT_OUTPUT_DIR
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--xml' && args[i + 1]) {
      opts.xml = args[++i];
    } else if (arg === '--urls' && args[i + 1]) {
      // Собираем все URL до следующего флага
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts.urls.push(args[++i]);
      }
    } else if (arg === '--ad-ids' && args[i + 1]) {
      // Собираем все adId до следующего флага
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts.adIds.push(args[++i]);
      }
    } else if (arg === '--file-names' && args[i + 1]) {
      // Собираем все имена файлов до следующего флага
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts.fileNames.push(args[++i]);
      }
    } else if (arg === '--photos-links' && args[i + 1]) {
      opts.photosLinks = args[++i];
    } else if (arg === '--disk-root' && args[i + 1]) {
      opts.diskRoot = args[++i];
    } else if (arg === '--photos-root' && args[i + 1]) {
      opts.photosRoot = args[++i];
    } else if (arg === '--output-dir' && args[i + 1]) {
      opts.outputDir = args[++i];
    }
  }
  
  // Проверка: можно указать только один способ определения объявлений
  const methodsCount = [opts.urls.length, opts.adIds.length, opts.fileNames.length].filter(c => c > 0).length;
  if (methodsCount === 0) {
    throw new Error('Укажите один из параметров: --urls, --ad-ids или --file-names');
  }
  
  // Разрешаем комбинацию --urls и --file-names для более надежной работы
  // Если указаны оба, используем оба для определения adId (приоритет файлу)
  if (opts.urls.length > 0 && opts.fileNames.length > 0) {
    if (opts.urls.length !== opts.fileNames.length) {
      throw new Error('Количество URL должно совпадать с количеством имен файлов');
    }
  }
  
  return opts;
}

/**
 * Нормализует URL Яндекс.Диска к единому виду
 * Преобразует disk.yandex.ru → yadi.sk (так как в photos_links.json хранятся как yadi.sk)
 */
function normalizeYandexDiskUrl(url) {
  if (!url) return url;
  
  // Убираем пробелы и trailing slash
  let normalized = url.trim().replace(/\/$/, '');
  
  // Преобразуем disk.yandex.ru → yadi.sk (оба домена ведут на один ресурс)
  normalized = normalized.replace(/https?:\/\/disk\.yandex\.ru\//gi, 'https://yadi.sk/');
  normalized = normalized.replace(/https?:\/\/disk\.yandex\.com\//gi, 'https://yadi.sk/');
  
  return normalized;
}

/**
 * Загружает photos_links.json и создаёт маппинг public_url → avitoId
 */
function loadUrlToAdIdMapping(photosLinksPath) {
  try {
    if (!photosLinksPath || !fs.existsSync(photosLinksPath)) {
      return {};
    }
    
    const data = JSON.parse(fs.readFileSync(photosLinksPath, 'utf8'));
    const mapping = {};
    
    if (data.items && Array.isArray(data.items)) {
      data.items.forEach(item => {
        if (!item.public_url) return;
        // При отсутствии avitoId используем имя файла без расширения как adId
        const adId = item.avitoId || (item.file ? item.file.replace(/\.(jpg|jpeg|png|webp)$/i, '') : null);
        if (!adId) return;
        // Нормализуем URL (приводим к единому виду yadi.sk)
        const normalizedUrl = normalizeYandexDiskUrl(item.public_url);
        mapping[normalizedUrl] = adId;
      });
    }
    
    return mapping;
  } catch (e) {
    console.warn(`   ⚠️  Не удалось прочитать photos_links: ${e.message}`);
    return {};
  }
}

function httpRequest(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function retryWithBackoff(fn, maxRetries = 3, operationName = 'операция') {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorMsg = error.message || String(error);
      const isRetryable = 
        errorMsg.includes('HTTP 500') || 
        errorMsg.includes('HTTP 502') || 
        errorMsg.includes('HTTP 503') || 
        errorMsg.includes('HTTP 429') ||
        errorMsg.includes('ECONNRESET') ||
        errorMsg.includes('ETIMEDOUT') ||
        errorMsg.includes('ENOTFOUND') ||
        errorMsg.includes('timeout');
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const delay = attempt * 1000;
      console.log(`   ⚠️  ${operationName}: попытка ${attempt}/${maxRetries} не удалась, повтор через ${delay}мс...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function ensureFolder(token, diskPath) {
  const url = `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(diskPath)}`;
  try {
    await httpRequest(url, { method: 'PUT', headers: { Authorization: `OAuth ${token}` } });
  } catch (e) {
    if (!String(e.message).includes('409')) throw e;
  }
}

async function uploadAndPublishPhoto(token, localPath, diskPath) {
  try {
    const uploadUrl = `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(diskPath)}&overwrite=true`;
    const uploadUrlRes = await retryWithBackoff(
      () => httpRequest(uploadUrl, { method: 'GET', headers: { Authorization: `OAuth ${token}` } }),
      3,
      'Получение URL для загрузки'
    );
    const { href } = JSON.parse(uploadUrlRes.data);
    
    const fileBody = fs.readFileSync(localPath);
    await retryWithBackoff(
      () => httpRequest(href, { method: 'PUT', headers: { 'Content-Length': fileBody.length } }, fileBody),
      3,
      'Загрузка файла'
    );
    
    const publishUrl = `https://cloud-api.yandex.net/v1/disk/resources/publish?path=${encodeURIComponent(diskPath)}`;
    await retryWithBackoff(
      () => httpRequest(publishUrl, { method: 'PUT', headers: { Authorization: `OAuth ${token}` } }),
      5,
      'Публикация файла'
    );
    
    const infoUrl = `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(diskPath)}`;
    const info = await retryWithBackoff(
      () => httpRequest(infoUrl, { method: 'GET', headers: { Authorization: `OAuth ${token}` } }),
      3,
      'Получение публичного URL'
    );
    const json = JSON.parse(info.data);
    return json.public_url || '';
  } catch (err) {
    throw new Error(`${err.message} (путь: ${diskPath})`);
  }
}

function extractAdIdsFromXml(xmlContent) {
  const adIds = [];
  // Ищем все <Id>...</Id> теги
  const idRegex = /<Id>([^<]+)<\/Id>/g;
  let match;
  while ((match = idRegex.exec(xmlContent)) !== null) {
    adIds.push(match[1]);
  }
  return adIds;
}

/**
 * Заменяет старую ссылку на новую в XML (по URL, а не по adId)
 */
function updatePhotoLinkInXmlByUrl(xmlContent, oldUrl, newUrl) {
  // Нормализуем URL для поиска (преобразуем disk.yandex.ru → yadi.sk, убираем trailing slash)
  const normalizedOldUrl = normalizeYandexDiskUrl(oldUrl);
  
  // Ищем все теги <Image url="..."/> и заменяем те, где URL совпадает (после нормализации)
  const imageRegex = /<Image\s+url\s*=\s*"([^"]+)"\s*\/?>/gi;
  
  // Экранируем новый URL для XML
  const escapedNewUrl = newUrl
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  
  let found = false;
  const newContent = xmlContent.replace(imageRegex, (match, urlInXml) => {
    const normalizedUrlInXml = normalizeYandexDiskUrl(urlInXml);
    if (normalizedUrlInXml === normalizedOldUrl) {
      found = true;
      return `<Image url="${escapedNewUrl}"/>`;
    }
    return match;
  });
  
  if (!found) {
    throw new Error(`Не найдена ссылка ${normalizedOldUrl} в XML`);
  }
  
  return newContent;
}

/**
 * Заменяет ссылку в XML по adId
 */
function updatePhotoLinkInXmlByAdId(xmlContent, adId, newUrl) {
  // Экранируем adId для использования в regex
  const escapedAdId = adId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Находим блок <Ad>...</Ad> для этого adId
  // Используем более точный regex, который останавливается на следующем <Ad> или конце файла
  // Важно: используем негативный lookahead, чтобы не захватить следующий блок <Ad>
  const adRegex = new RegExp(
    `(<Ad>(?:(?!<\\/Ad>)[\\s\\S])*?<Id>\\s*${escapedAdId}\\s*<\\/Id>(?:(?!<\\/Ad>)[\\s\\S])*?<Images>)((?:(?!<\\/Images>)[\\s\\S])*?)(<\\/Images>(?:(?!<\\/Ad>)[\\s\\S])*?<\\/Ad>)`,
    'g'
  );
  
  const match = adRegex.exec(xmlContent);
  if (!match) {
    throw new Error(`Не найден блок <Ad> для adId: ${adId}`);
  }
  
  // Проверяем, что тег <Images> найден
  if (!match[2] && match[2] !== '') {
    throw new Error(`Не найден тег <Images> для adId: ${adId}`);
  }
  
  // Экранируем URL для XML (только специальные символы XML)
  // URL уже может содержать &, но мы должны экранировать только если это не часть сущности
  const escapedUrl = newUrl
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  
  // Заменяем все <Image url="..."/> на один новый URL
  // Учитываем возможные пробелы и разные форматы
  const imagesBlock = match[2];
  const newImagesBlock = imagesBlock.replace(
    /<Image\s+url\s*=\s*"[^"]*"\s*\/?>/gi,
    `<Image url="${escapedUrl}"/>`
  );
  
  // Если не нашлось ни одного Image тега, добавляем новый
  const finalImagesBlock = newImagesBlock.trim() || `<Image url="${escapedUrl}"/>`;
  
  // Используем replace с функцией-заменой, чтобы избежать проблем с состоянием regex
  // Создаем новый regex для replace (без флага 'g', чтобы заменить только первое вхождение)
  const replaceRegex = new RegExp(
    `(<Ad>(?:(?!<\\/Ad>)[\\s\\S])*?<Id>\\s*${escapedAdId}\\s*<\\/Id>(?:(?!<\\/Ad>)[\\s\\S])*?<Images>)((?:(?!<\\/Images>)[\\s\\S])*?)(<\\/Images>(?:(?!<\\/Ad>)[\\s\\S])*?<\\/Ad>)`
  );
  
  return xmlContent.replace(replaceRegex, `$1${finalImagesBlock}$3`);
}

async function main() {
  try {
    const opts = parseArgs();
    
    if (!opts.xml) {
      throw new Error('Укажите --xml путь к XML файлу');
    }
    
    if (!fs.existsSync(opts.xml)) {
      throw new Error(`XML файл не найден: ${opts.xml}`);
    }
    
    // Определяем список объявлений для обработки
    let itemsToProcess = [];
    
    if (opts.urls.length > 0 || opts.fileNames.length > 0) {
      // Режим работы по ссылкам и/или именам файлов
      // Если указаны оба, используем имена файлов для определения adId (более надежно)
      
      let photosLinksPath = opts.photosLinks;
      if (!photosLinksPath && opts.urls.length > 0) {
        photosLinksPath = findLatestPhotosLinks(opts.outputDir);
      }
      
      const urlToAdIdMapping = {};
      if (photosLinksPath && fs.existsSync(photosLinksPath)) {
        console.log(`📋 Загрузка маппинга из: ${photosLinksPath}`);
        Object.assign(urlToAdIdMapping, loadUrlToAdIdMapping(photosLinksPath));
      }
      
      // Если указаны имена файлов, используем их для определения adId
      if (opts.fileNames.length > 0) {
        if (opts.urls.length > 0 && opts.urls.length !== opts.fileNames.length) {
          throw new Error('Количество URL должно совпадать с количеством имен файлов');
        }
        
        // Используем имена файлов для определения adId
        for (let i = 0; i < opts.fileNames.length; i++) {
          const fileName = opts.fileNames[i];
          const adId = fileName.replace(/\.(jpg|jpeg|png|webp)$/i, '');
          
          // Если указан URL, используем его как oldUrl
          let oldUrl = null;
          if (opts.urls.length > i) {
            oldUrl = normalizeYandexDiskUrl(opts.urls[i]);
            // Проверяем, что URL соответствует adId (если есть маппинг)
            if (urlToAdIdMapping[oldUrl] && urlToAdIdMapping[oldUrl] !== adId) {
              console.warn(`   ⚠️  URL ${oldUrl} соответствует другому adId: ${urlToAdIdMapping[oldUrl]}, используем переданный adId: ${adId}`);
            }
          } else if (Object.keys(urlToAdIdMapping).length > 0) {
            // Пытаемся найти URL по adId в обратном маппинге
            const foundUrl = Object.entries(urlToAdIdMapping).find(([url, id]) => id === adId)?.[0];
            if (foundUrl) {
              oldUrl = foundUrl;
            }
          }
          
          itemsToProcess.push({ adId, oldUrl });
        }
      } else {
        // Только URL (без имен файлов)
        if (!photosLinksPath || !fs.existsSync(photosLinksPath)) {
          throw new Error(`Не найден photos_links.json. Укажите путь через --photos-links или убедитесь, что файл существует в ${opts.outputDir}`);
        }
        
        // Преобразуем URL в adId
        for (const url of opts.urls) {
          // Нормализуем URL (преобразуем disk.yandex.ru → yadi.sk)
          const normalizedUrl = normalizeYandexDiskUrl(url);
          const adId = urlToAdIdMapping[normalizedUrl];
          
          if (!adId) {
            throw new Error(`Не найден adId для URL: ${normalizedUrl}\nПроверьте, что URL присутствует в photos_links.json\nИсходный URL: ${url}`);
          }
          
          itemsToProcess.push({ adId, oldUrl: normalizedUrl });
        }
      }
    } else if (opts.adIds.length > 0) {
      itemsToProcess = opts.adIds.map(adId => ({ adId }));
    }
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Перегенерация фото для ${itemsToProcess.length} объявлений`);
    console.log(`${'═'.repeat(60)}\n`);
    
    // Читаем XML
    console.log(`Чтение XML файла: ${opts.xml}`);
    let xmlContent = fs.readFileSync(opts.xml, 'utf8');
    
    // Проверяем, что все adId существуют в XML
    const existingAdIds = extractAdIdsFromXml(xmlContent);
    const missingAdIds = itemsToProcess.filter(item => !existingAdIds.includes(item.adId));
    if (missingAdIds.length > 0) {
      throw new Error(`Следующие adId не найдены в XML: ${missingAdIds.map(i => i.adId).join(', ')}`);
    }
    
    console.log(`✅ Все ${itemsToProcess.length} adId найдены в XML\n`);
    
    // Получаем токен Яндекс.Диска
    const token = process.env.YANDEX_DISK_TOKEN;
    if (!token) {
      throw new Error('YANDEX_DISK_TOKEN не найден в окружении');
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    // Обрабатываем каждое объявление
    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      const { adId, oldUrl } = item;
      
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`[${i + 1}/${itemsToProcess.length}] Обработка: ${adId}`);
      if (oldUrl) {
        console.log(`   Старая ссылка: ${oldUrl}`);
      }
      console.log(`${'─'.repeat(60)}`);
      
      try {
        // Парсим adId для получения materialId и address
        const parsed = parseAdId(adId);
        if (!parsed) {
          throw new Error(`Не удалось распарсить adId: ${adId}`);
        }
        
        // Определяем materialId из алиаса
        const { MATERIAL_ALIASES, CITY_ALIASES } = await import('../src/constants/materialAliases.js');
        const materialId = Object.entries(MATERIAL_ALIASES).find(([id, alias]) => alias === parsed.materialAlias)?.[0];
        if (!materialId) {
          throw new Error(`Не найден materialId для алиаса: ${parsed.materialAlias}`);
        }
        
        // Определяем address из алиаса
        const address = Object.entries(CITY_ALIASES).find(([addr, alias]) => alias === parsed.cityAlias)?.[0];
        if (!address) {
          throw new Error(`Не найден address для алиаса: ${parsed.cityAlias}`);
        }
        
        console.log(`   materialId: ${materialId}`);
        console.log(`   address: ${address}`);
        
        // Генерируем новое фото
        console.log(`\n   Генерация фото...`);
        const photoPath = await generatePhotoForOldAd(
          adId,
          materialId,
          address,
          opts.photosRoot,
          'NERUDA',
          null, // адаптивный opacity
          0.03  // patternOpacity
        );
        console.log(`   ✅ Фото создано: ${path.basename(photoPath)}`);
        
        // Загружаем на Яндекс.Диск
        console.log(`\n   Загрузка на Яндекс.Диск...`);
        const { formatAddressLabel, sanitizeName } = await import('./lib/photo-variants/utils.js');
        const safeAddress = sanitizeName(formatAddressLabel(address));
        
        // Определяем дату для папки на диске
        // Формат должен быть "DD.MM" (как в build-feed.js используется formatDateLabel(opts.date))
        // Если в adId есть dateLabel, преобразуем его в формат "DD.MM"
        let dateLabel = null;
        if (parsed.dateLabel) {
          // Парсим dateLabel из adId (формат "DDMMYY-HHmmss" или "DDMMYY")
          const dateFromLabel = parseDateLabel(parsed.dateLabel);
          if (dateFromLabel) {
            const pad = (n) => String(n).padStart(2, '0');
            dateLabel = `${pad(dateFromLabel.getDate())}.${pad(dateFromLabel.getMonth() + 1)}`;
          }
        }
        // Если не удалось определить из adId, используем текущую дату
        if (!dateLabel) {
          const now = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          dateLabel = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}`;
        }
        
        const rootPath = `disk:/${opts.diskRoot}`;
        const materialPath = `${rootPath}/${materialId}`;
        const addressPath = `${materialPath}/${safeAddress}`;
        const datePath = `${addressPath}/${dateLabel}`;
        
        await ensureFolder(token, rootPath);
        await ensureFolder(token, materialPath);
        await ensureFolder(token, addressPath);
        await ensureFolder(token, datePath);
        
        const remotePath = `${datePath}/${adId}.jpg`;
        const newPublicUrl = await uploadAndPublishPhoto(token, photoPath, remotePath);
        console.log(`   ✅ Фото загружено: ${newPublicUrl}`);
        
        // Обновляем ссылку в XML
        console.log(`\n   Обновление ссылки в XML...`);
        try {
          if (oldUrl) {
            // Пытаемся заменить по старому URL
            xmlContent = updatePhotoLinkInXmlByUrl(xmlContent, oldUrl, newPublicUrl);
            console.log(`   ✅ Ссылка обновлена по URL`);
          } else {
            // Заменяем по adId
            xmlContent = updatePhotoLinkInXmlByAdId(xmlContent, adId, newPublicUrl);
            console.log(`   ✅ Ссылка обновлена по adId`);
          }
        } catch (urlError) {
          // Если не удалось обновить по URL, пробуем по adId
          if (oldUrl && urlError.message.includes('Не найдена ссылка')) {
            console.warn(`   ⚠️  Ссылка ${oldUrl} не найдена в XML, используем adId для обновления`);
            xmlContent = updatePhotoLinkInXmlByAdId(xmlContent, adId, newPublicUrl);
            console.log(`   ✅ Ссылка обновлена по adId`);
          } else {
            throw urlError;
          }
        }
        
        // Удаляем локальный файл
        fs.unlinkSync(photoPath);
        console.log(`   ✅ Локальный файл удален`);
        
        successCount++;
        
        // Задержка между загрузками
        if (i < itemsToProcess.length - 1) {
          const delay = 300 + Math.random() * 200;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (err) {
        console.error(`\n   ❌ Ошибка: ${err.message}`);
        if (err.stack) {
          console.error(`   Stack: ${err.stack}`);
        }
        errorCount++;
      }
    }
    
    // Сохраняем обновленный XML
    if (successCount > 0) {
      const backupPath = opts.xml + '.backup';
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`Создание резервной копии: ${backupPath}`);
      fs.copyFileSync(opts.xml, backupPath);
      
      console.log(`Сохранение обновленного XML: ${opts.xml}`);
      fs.writeFileSync(opts.xml, xmlContent, 'utf8');
      
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`✅ ГОТОВО`);
      console.log(`${'═'.repeat(60)}`);
      console.log(`   Успешно обработано: ${successCount}`);
      if (errorCount > 0) {
        console.log(`   Ошибок: ${errorCount}`);
      }
      console.log(`   Резервная копия: ${backupPath}`);
      console.log(`   Обновленный XML: ${opts.xml}`);
    } else {
      console.log(`\n❌ Не удалось обработать ни одного объявления`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Ошибка: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
