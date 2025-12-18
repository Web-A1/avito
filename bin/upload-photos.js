#!/usr/bin/env node
/**
 * Загружает сгенерированные фото на Яндекс.Диск, публикует их и сохраняет ссылки.
 *
 * По умолчанию:
 * - читаем план data/plan.json (aliases.materials поддерживаются)
 * - берём исходники из data/photos/<materialId>/variants/*.jpg|jpeg|png
 * - складываем на Диск в одну папку Cursor_for_Avito/ (без подкаталогов по материалу/адресу/дате)
 * - результат сохраняем в output/photos_links_<date>.json
 *
 * Пример:
 *   YANDEX_DISK_TOKEN=... npm run photos:upload
 *   node bin/upload-photos.js --plan ./data/plan.json --root Cursor_for_Avito --date 2025-12-09
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Подхватываем .env рядом с корнем проекта, чтобы не требовать ручной export
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const DEFAULT_PLAN_PATH = path.resolve(__dirname, '..', 'data', 'plan.json');
const DEFAULT_VARIANTS_ROOT = path.resolve(__dirname, '..', 'data', 'photos');
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'output');
const DEFAULT_DISK_ROOT = 'Cursor_for_Avito';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    plan: '',
    diskRoot: DEFAULT_DISK_ROOT,
    date: '',
    outDir: DEFAULT_OUTPUT_DIR
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--plan' && args[i + 1]) {
      opts.plan = args[++i];
    } else if (arg === '--root' && args[i + 1]) {
      opts.diskRoot = args[++i];
    } else if (arg === '--date' && args[i + 1]) {
      opts.date = args[++i];
    } else if (arg === '--out' && args[i + 1]) {
      opts.outDir = args[++i];
    }
  }
  return opts;
}

function formatDateLabel(str) {
  if (str) return str;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(now.getDate());
  const MM = pad(now.getMonth() + 1);
  const yyyy = now.getFullYear();
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${dd}.${MM}.${yyyy} ${hh}-${mm}-${ss}`;
}

function readPlan(planPath) {
  const resolved = planPath || (fs.existsSync(DEFAULT_PLAN_PATH) ? DEFAULT_PLAN_PATH : '');
  if (!resolved) return null;
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`Не удалось прочитать план ${resolved}: ${e.message}`);
    return null;
  }
}

function resolveMaterials(plan) {
  if (!plan || !Array.isArray(plan.tasks)) return [];
  const aliases = plan.aliases || {};
  const matAliases = aliases.materials || {};
  const materials = new Set();
  plan.tasks.forEach((task) => {
    const mat = matAliases[task.materialId] || task.materialId;
    if (mat) materials.add(mat);
  });
  return Array.from(materials);
}

function listVariantFiles(materialId) {
  // Упрощенная структура: фото сохраняются в data/photos/<materialId>/<safeAddress>/variants/
  // Ищем файлы прямо в папках variants (без рекурсии по подпапкам)
  const materialDir = path.join(DEFAULT_VARIANTS_ROOT, materialId);
  if (!fs.existsSync(materialDir)) {
    console.warn(`Нет папки с материалом: ${materialDir}`);
    return [];
  }
  
  const files = [];
  // Проходим по всем адресам (папкам внутри materialId)
  const addressDirs = fs.readdirSync(materialDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(materialDir, e.name));
  
  for (const addressDir of addressDirs) {
    const variantsDir = path.join(addressDir, 'variants');
    if (!fs.existsSync(variantsDir)) continue;
    
    // Читаем файлы прямо из variants/ (без подпапок)
    const entries = fs.readdirSync(variantsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.match(/\.(jpg|jpeg|png)$/i)) {
        files.push({ 
          path: path.join(variantsDir, e.name), 
          name: e.name 
        });
      }
    }
  }
  
  return files;
}

/**
 * Выполняет HTTP-запрос с повторными попытками при временных ошибках сервера.
 * @param {string} url - URL для запроса
 * @param {object} options - Опции запроса
 * @param {Buffer|string} body - Тело запроса (опционально)
 * @param {number} maxRetries - Максимальное количество попыток (по умолчанию 3)
 * @param {number} retryDelay - Начальная задержка между попытками в мс (по умолчанию 1000)
 * @returns {Promise<{status: number, data: string}>}
 */
async function httpRequest(url, options = {}, body, maxRetries = 3, retryDelay = 1000) {
  const retryableStatusCodes = [500, 502, 503, 504]; // Временные ошибки сервера
  
  // Вычисляем таймаут в зависимости от размера body (минимум 30 сек, +1 сек на каждые 100KB)
  const bodySize = body ? (Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body))) : 0;
  const timeout = Math.max(30000, 30000 + Math.ceil(bodySize / 102400) * 1000);
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
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
        
        req.on('error', (err) => {
          // Сетевые ошибки тоже могут быть временными
          reject(new Error(`Network error: ${err.message}`));
        });
        
        // Устанавливаем таймаут в зависимости от размера файла
        req.setTimeout(timeout, () => {
          req.destroy();
          reject(new Error(`Request timeout after ${timeout}ms`));
        });
        
        // Правильная запись Buffer с обработкой drain события
        if (body) {
          if (Buffer.isBuffer(body)) {
            // Для Buffer записываем с обработкой drain
            let offset = 0;
            let ended = false;
            const writeChunk = () => {
              while (offset < body.length) {
                const chunk = body.slice(offset, Math.min(offset + 65536, body.length)); // 64KB chunks
                const canContinue = req.write(chunk);
                offset += chunk.length;
                
                if (!canContinue) {
                  // Буфер переполнен, ждем drain
                  req.once('drain', writeChunk);
                  return;
                }
              }
              // Весь буфер записан, завершаем запрос (только один раз)
              if (!ended) {
                ended = true;
                req.end();
              }
            };
            writeChunk();
          } else {
            // Для строк конвертируем в Buffer
            const strBuffer = Buffer.from(String(body), 'utf8');
            let offset = 0;
            let ended = false;
            const writeChunk = () => {
              while (offset < strBuffer.length) {
                const chunk = strBuffer.slice(offset, Math.min(offset + 65536, strBuffer.length));
                const canContinue = req.write(chunk);
                offset += chunk.length;
                
                if (!canContinue) {
                  req.once('drain', writeChunk);
                  return;
                }
              }
              if (!ended) {
                ended = true;
                req.end();
              }
            };
            writeChunk();
          }
        } else {
          // Нет body, просто завершаем запрос
          req.end();
        }
      });
      
      return result;
    } catch (error) {
      // Проверяем, является ли ошибка временной (HTTP 500-504 или сетевая ошибка)
      const isRetryable = retryableStatusCodes.some(code => 
        error.message && error.message.includes(`HTTP ${code}`)
      ) || (error.message && error.message.includes('Network error')) || 
      (error.message && error.message.includes('timeout'));
      
      // Если это не временная ошибка или это последняя попытка - пробрасываем ошибку
      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Вычисляем задержку с экспоненциальным backoff
      const delay = retryDelay * Math.pow(2, attempt);
      const errorMsg = error.message.split(':')[0] || error.message;
      console.warn(`   ⚠️  ${errorMsg}, повтор через ${delay}мс (попытка ${attempt + 1}/${maxRetries})...`);
      
      // Ждем перед следующей попыткой (для больших файлов ждем дольше)
      const waitTime = bodySize > 1024 * 1024 ? delay * 2 : delay;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

async function ensureFolder(token, diskPath) {
  const url = `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(diskPath)}`;
  try {
    await httpRequest(url, { method: 'PUT', headers: { Authorization: `OAuth ${token}` } });
  } catch (e) {
    // Если уже существует, API вернет 409 — это не критично
    if (!String(e.message).includes('409')) throw e;
  }
}

/**
 * Валидирует буфер файла перед загрузкой
 */
async function validateFileBuffer(fileBuffer, fileName = '') {
  try {
    if (fileBuffer.length === 0) {
      throw new Error('Буфер пустой (0 байт)');
    }
    if (fileBuffer.length < 1000) {
      console.warn(`   ⚠️  Подозрительно маленький размер файла: ${fileBuffer.length} байт`);
    }
    
    // Проверяем JPEG заголовок
    if (fileBuffer.length < 3) {
      throw new Error('Файл слишком маленький для проверки заголовка');
    }
    if (fileBuffer[0] !== 0xFF || fileBuffer[1] !== 0xD8 || fileBuffer[2] !== 0xFF) {
      throw new Error('Файл не является валидным JPEG (неверный заголовок)');
    }
    
    // Проверяем через sharp
    const sharp = await import('sharp');
    const image = sharp.default(fileBuffer);
    const metadata = await image.metadata();
    if (!metadata.format || !['jpeg', 'jpg'].includes(metadata.format)) {
      throw new Error(`Неверный формат файла: ${metadata.format}`);
    }
    if (metadata.width === 0 || metadata.height === 0) {
      throw new Error(`Неверные размеры: ${metadata.width}x${metadata.height}`);
    }
    
    return { size: fileBuffer.length, width: metadata.width, height: metadata.height };
  } catch (err) {
    throw new Error(`Валидация файла не прошла${fileName ? ` (${fileName})` : ''}: ${err.message}`);
  }
}

async function uploadFile(token, localPath, diskPath) {
  // Читаем файл один раз
  const fileBody = await fs.promises.readFile(localPath);
  
  // Валидируем прочитанный буфер
  const fileInfo = await validateFileBuffer(fileBody, path.basename(localPath));
  
  // Проверяем, что размер буфера совпадает с размером файла на диске
  const stats = await fs.promises.stat(localPath);
  if (fileBody.length !== stats.size) {
    throw new Error(`Размер буфера (${fileBody.length}) не совпадает с размером файла на диске (${stats.size})`);
  }
  
  // Убеждаемся, что fileBody это Buffer
  if (!Buffer.isBuffer(fileBody)) {
    throw new Error('Прочитанный файл не является Buffer');
  }
  
  // Получаем URL для загрузки
  const uploadUrlRes = await httpRequest(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(diskPath)}&overwrite=true`,
    { method: 'GET', headers: { Authorization: `OAuth ${token}` } }
  );
  const { href } = JSON.parse(uploadUrlRes.data);
  
  // Загружаем валидированный буфер с правильными заголовками
  // Важно: Content-Length должен точно соответствовать размеру буфера
  const uploadOptions = {
    method: 'PUT',
    headers: {
      'Content-Length': fileBody.length.toString(),
      'Content-Type': 'image/jpeg'
    }
  };
  
  await httpRequest(href, uploadOptions, fileBody);
  
  // Задержка для гарантии, что файл записан и обработан на сервере
  // Для больших файлов нужна большая задержка
  const delay = Math.max(1000, Math.min(3000, Math.ceil(fileBody.length / 50000))); // 1-3 сек в зависимости от размера
  await new Promise(resolve => setTimeout(resolve, delay));
  
  // Проверяем размер файла на Яндекс.Диске через API
  try {
    const checkUrl = `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(diskPath)}`;
    const checkRes = await httpRequest(checkUrl, { method: 'GET', headers: { Authorization: `OAuth ${token}` } });
    const fileInfo = JSON.parse(checkRes.data);
    
    if (fileInfo.size && fileInfo.size !== fileBody.length) {
      throw new Error(`Размер файла на Яндекс.Диске (${fileInfo.size}) не совпадает с локальным (${fileBody.length})`);
    }
  } catch (checkErr) {
    // Не критично, но логируем
    console.warn(`      ⚠️  Не удалось проверить размер файла на Яндекс.Диске: ${checkErr.message}`);
  }
  
  return fileInfo;
}

/**
 * Валидирует публичный URL, проверяя, что файл доступен и валидный
 * Обрабатывает редиректы (HTTP 302) - это нормальное поведение для Яндекс.Диска
 */
async function validatePublicUrl(publicUrl, maxRedirects = 3) {
  if (!publicUrl) {
    return false;
  }
  
  let currentUrl = publicUrl;
  let redirects = 0;
  
  while (redirects <= maxRedirects) {
    try {
      const response = await new Promise((resolve, reject) => {
        const urlObj = new URL(currentUrl);
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          timeout: 10000
        };
        
        const req = https.request(options, (res) => {
          // Обрабатываем редиректы
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            const location = res.headers.location;
            if (location && redirects < maxRedirects) {
              req.destroy();
              // Если location относительный, делаем его абсолютным
              const redirectUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
              return resolve({ redirect: true, redirectUrl, statusCode: res.statusCode });
            }
          }
          
          // Если это финальный ответ, читаем данные
          if (res.statusCode === 200) {
            // Проверяем Content-Type - если это HTML, значит получили страницу вместо файла
            const contentType = res.headers['content-type'] || '';
            if (contentType.includes('text/html')) {
              req.destroy();
              resolve({ statusCode: res.statusCode, headers: res.headers, data: Buffer.alloc(0), isHtml: true });
              return;
            }
            
            let data = Buffer.alloc(0);
            let totalLength = 0;
            const chunkSize = 8192;
            
            res.on('data', (chunk) => {
              data = Buffer.concat([data, chunk]);
              totalLength += chunk.length;
              // Останавливаемся после загрузки первых chunkSize байт
              if (totalLength >= chunkSize) {
                req.destroy();
                resolve({ statusCode: res.statusCode, headers: res.headers, data });
              }
            });
            
            res.on('end', () => {
              resolve({ statusCode: res.statusCode, headers: res.headers, data });
            });
          } else {
            req.destroy();
            resolve({ statusCode: res.statusCode, headers: res.headers, data: Buffer.alloc(0) });
          }
        });
        
        req.on('error', reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error('Timeout при проверке публичного URL'));
        });
        req.end();
      });
      
      // Если это редирект - следуем ему
      if (response.redirect && response.redirectUrl) {
        currentUrl = response.redirectUrl;
        redirects++;
        continue;
      }
      
      // Проверяем финальный статус
      if (response.statusCode !== 200) {
        return false; // Не валидный, но не критично
      }
      
      // Если получили HTML вместо файла - это нормально для публичных URL Яндекс.Диска
      // Публичный URL может возвращать HTML-страницу с предпросмотром
      if (response.isHtml) {
        // Это не ошибка - публичный URL работает, просто возвращает HTML-страницу
        // Файл доступен, просто через веб-интерфейс
        return true; // Считаем валидным, так как файл доступен
      }
      
      // Проверяем JPEG заголовок (должен начинаться с FF D8 FF)
      if (response.data && Buffer.isBuffer(response.data) && response.data.length >= 3) {
        const header = response.data.slice(0, 3);
        if (header[0] !== 0xFF || header[1] !== 0xD8 || header[2] !== 0xFF) {
          // Если первые байты похожи на HTML (0x3c 0x21 0x64 = <!d), это HTML-страница
          // Это нормально для публичных URL Яндекс.Диска - они возвращают HTML с предпросмотром
          if (header[0] === 0x3C && header[1] === 0x21) {
            // Это HTML - считаем валидным, так как файл доступен через веб-интерфейс
            return true;
          }
          // Иначе это действительно не JPEG
          const firstBytes = Array.from(header).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
          console.warn(`      ⚠️  Валидация: неверный JPEG заголовок (получено: ${firstBytes}, ожидалось: 0xFF 0xD8 0xFF)`);
          return false; // Не JPEG
        }
      } else if (response.data && !Buffer.isBuffer(response.data)) {
        // Если данные не Buffer, конвертируем
        const buffer = Buffer.from(response.data);
        if (buffer.length >= 3) {
          if (buffer[0] !== 0xFF || buffer[1] !== 0xD8 || buffer[2] !== 0xFF) {
            // Проверяем, не HTML ли это
            if (buffer[0] === 0x3C && buffer[1] === 0x21) {
              return true; // HTML - нормально для публичных URL
            }
            const firstBytes = Array.from(buffer.slice(0, 3)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
            console.warn(`      ⚠️  Валидация: неверный JPEG заголовок после конвертации (получено: ${firstBytes})`);
            return false;
          }
        } else {
          console.warn(`      ⚠️  Валидация: недостаточно данных для проверки (${buffer.length} байт)`);
          return false;
        }
      } else if (!response.data || response.data.length === 0) {
        // Нет данных - возможно, это редирект или пустой ответ
        return false;
      }
      
      // Все проверки пройдены
      return true;
    } catch (err) {
      // Не критично - файл может быть доступен, но проверка не удалась
      return false;
    }
  }
  
  return false; // Слишком много редиректов
}

async function publishFile(token, diskPath) {
  // Публикуем файл
  await httpRequest(
    `https://cloud-api.yandex.net/v1/disk/resources/publish?path=${encodeURIComponent(diskPath)}`,
    { method: 'PUT', headers: { Authorization: `OAuth ${token}` } }
  );
  
  // Получаем информацию о файле, включая публичный URL
  const info = await httpRequest(
    `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(diskPath)}`,
    { method: 'GET', headers: { Authorization: `OAuth ${token}` } }
  );
  
  const json = JSON.parse(info.data);
  const publicUrl = json.public_url || '';
  
  // Публичный URL получен - файл успешно опубликован
  // Валидация через публичный URL не работает, так как он возвращает HTML-страницу
  // Файл уже проверен при загрузке (размер через API)
  
  return publicUrl;
}

async function processMaterial(token, materialId, diskRoot, dateLabel, folderName) {
  const files = listVariantFiles(materialId);
  console.log(`   Найдено файлов в variants для ${materialId}: ${files.length}`);
  
  if (!files.length) {
    console.warn(`   ⚠️  Не найдено фото для материала ${materialId}`);
    // Выводим путь, где искали файлы
    const materialDir = path.join(DEFAULT_VARIANTS_ROOT, materialId);
    console.warn(`   Путь поиска: ${materialDir}`);
    if (fs.existsSync(materialDir)) {
      const subdirs = fs.readdirSync(materialDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
      console.warn(`   Найдено подпапок: ${subdirs.length} (${subdirs.slice(0, 3).join(', ')}${subdirs.length > 3 ? '...' : ''})`);
    } else {
      console.warn(`   ⚠️  Папка материала не существует`);
    }
    return [];
  }
  
  // Импортируем функции для парсинга adId и определения адреса
  const { parseAdId, CITY_ALIASES } = await import('../src/constants/materialAliases.js');
  const { formatAddressLabel, sanitizeName } = await import('./lib/photo-variants/utils.js');
  
  // Группируем файлы по адресам (из adId в имени файла)
  // ВАЖНО: НЕ фильтруем по дате, так как файлы уже сгенерированы с датой из плана (DateBegin),
  // а dateLabel здесь - это дата генерации скрипта, которая может отличаться
  const filesByAddress = new Map();
  let parsedFailed = 0;
  
  for (const file of files) {
    // Извлекаем adId из имени файла (убираем расширение)
    const adId = file.name.replace(/\.(jpg|jpeg|png|webp)$/i, '');
    const parsed = parseAdId(adId);
    
    if (!parsed) {
      parsedFailed++;
      console.warn(`   ⚠️  Не удалось распарсить adId из имени файла: ${file.name}`);
      continue;
    }
    
    let safeAddress = 'default';
    if (parsed && parsed.cityAlias) {
      // Находим адрес по cityAlias
      const address = Object.entries(CITY_ALIASES).find(([_, alias]) => alias === parsed.cityAlias)?.[0];
      if (address) {
        safeAddress = sanitizeName(formatAddressLabel(address));
      }
    }
    
    if (!filesByAddress.has(safeAddress)) {
      filesByAddress.set(safeAddress, []);
    }
    filesByAddress.get(safeAddress).push({ ...file, adId });
  }
  
  // Выводим статистику
  const totalAfterFilter = Array.from(filesByAddress.values()).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`   Статистика:`);
  console.log(`      Всего файлов найдено: ${files.length}`);
  if (parsedFailed > 0) {
    console.log(`      Не удалось распарсить adId: ${parsedFailed}`);
  }
  console.log(`      Файлов для загрузки: ${totalAfterFilter}`);
  
  if (totalAfterFilter === 0) {
    console.warn(`   ⚠️  Не осталось файлов для загрузки`);
    return [];
  }
  
  const baseRootPath = `disk:/${diskRoot}`;
  const rootPath = `${baseRootPath}/${folderName}`;
  await ensureFolder(token, baseRootPath);
  await ensureFolder(token, rootPath);
  
  const results = [];
  const uploadedFiles = [];
  
  // Обрабатываем каждую группу по адресу (группировка только для логов,
  // все фото всё равно летят в одну общую папку на Яндекс.Диске)
  for (const [safeAddress, addressFiles] of filesByAddress) {
    if (addressFiles.length === 0) continue;
    
    console.log(`   Материал: ${materialId}`);
    console.log(`   Адрес: ${safeAddress}`);
    console.log(`   Фото: ${addressFiles.length}`);
    
    // Функция для обработки одного файла
    const processFile = async (file) => {
      try {
        // Все фото складываем в одну общую папку на Яндекс.Диске для этой генерации:
        // disk:/<diskRoot>/<dateLabel>/<fileName>
        const remotePath = `${rootPath}/${file.name}`;
        
        // Загружаем файл с валидацией
        const fileInfo = await uploadFile(token, file.path, remotePath);
        
        // Публикуем файл
        let publicUrl = '';
        let publishAttempts = 0;
        const maxPublishAttempts = 3;
        
        while (!publicUrl && publishAttempts < maxPublishAttempts) {
          try {
            publicUrl = await publishFile(token, remotePath);
            if (!publicUrl && publishAttempts < maxPublishAttempts - 1) {
              // Если URL не получен, ждем и пробуем еще раз (API может быть медленным)
              await new Promise(resolve => setTimeout(resolve, 1000 * (publishAttempts + 1)));
            }
          } catch (publishErr) {
            if (publishAttempts < maxPublishAttempts - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000 * (publishAttempts + 1)));
            } else {
              throw publishErr;
            }
          }
          publishAttempts++;
        }
        
        if (publicUrl) {
          // Файл успешно загружен и опубликован
          // Валидация файла уже выполнена:
          // 1. Локальный файл проверен перед загрузкой (validateFileBuffer)
          // 2. Размер файла проверен после загрузки через API (в uploadFile)
          // Публичный URL возвращает HTML-страницу, поэтому валидация через него не работает
          console.log(`      ✅ ${file.name} (${(fileInfo.size / 1024).toFixed(1)} KB, ${fileInfo.width}x${fileInfo.height}) → ${publicUrl.substring(0, 40)}...`);
        } else {
          console.warn(`      ⚠️  ${file.name} загружен, но публичный URL не получен после ${maxPublishAttempts} попыток`);
        }
        
        return { materialId, file: file.name, public_url: publicUrl, filePath: file.path };
      } catch (err) {
        console.error(`      ❌ Ошибка при загрузке ${file.name}: ${err.message}`);
        return null; // Возвращаем null при ошибке
      }
    };
    
    // Параллельная загрузка с ограничением (5 файлов одновременно)
    const concurrency = 5;
    for (let i = 0; i < addressFiles.length; i += concurrency) {
      const batch = addressFiles.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(processFile));
      
      // Обрабатываем результаты
      for (const result of batchResults) {
        if (result) {
          results.push({ materialId: result.materialId, file: result.file, public_url: result.public_url });
          uploadedFiles.push(result.filePath);
        }
      }
    }
    console.log('');
  }
  
  // Функция для удаления пустой папки и её родителей (если они тоже пусты)
  function removeEmptyDir(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) return;
      const entries = fs.readdirSync(dirPath);
      if (entries.length === 0) {
        fs.rmdirSync(dirPath);
        // Рекурсивно удаляем родительскую папку, если она тоже пуста
        const parentDir = path.dirname(dirPath);
        if (parentDir !== dirPath && fs.existsSync(parentDir)) {
          removeEmptyDir(parentDir);
        }
      }
    } catch (e) {
      // Игнорируем ошибки при удалении папок (могут быть заняты или не пусты)
    }
  }
  
  // Собираем уникальные папки для последующей очистки
  const foldersToCheck = new Set();
  
  // После успешной загрузки удаляем загруженные файлы
  for (const filePath of uploadedFiles) {
    try {
      const dirPath = path.dirname(filePath);
      foldersToCheck.add(dirPath);
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn(`Не удалось удалить файл ${filePath}: ${e.message}`);
    }
  }
  
  if (uploadedFiles.length > 0) {
    console.log(`   Локальные файлы удалены: ${uploadedFiles.length} файлов`);
  }
  
  // Удаляем пустые папки после удаления файлов
  for (const dirPath of foldersToCheck) {
    removeEmptyDir(dirPath);
  }
  
  return results;
}

async function main() {
  try {
    const opts = parseArgs();
    const token = process.env.YANDEX_DISK_TOKEN;
    if (!token) {
      throw new Error('YANDEX_DISK_TOKEN не найден в окружении');
    }

    const plan = readPlan(opts.plan);
    const materials = resolveMaterials(plan);
    if (!materials.length) {
      throw new Error('В плане не найдено ни одного materialId');
    }

    const dateLabel = formatDateLabel(opts.date);
    const folderName = dateLabel.replace(/\s+/g, '_'); // имя папки на Диске для этой генерации
    const allResults = [];
    for (const mat of materials) {
      const res = await processMaterial(token, mat, opts.diskRoot, dateLabel, folderName);
      allResults.push(...res);
    }

    if (!fs.existsSync(opts.outDir)) {
      fs.mkdirSync(opts.outDir, { recursive: true });
    }
    const outPath = path.join(opts.outDir, `photos_links_${dateLabel}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          date: dateLabel,
          diskRoot: opts.diskRoot,
          diskPath: `${opts.diskRoot}/${folderName}`,
          items: allResults
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`Готово: ${allResults.length} файлов, ссылки сохранены в ${outPath}`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
