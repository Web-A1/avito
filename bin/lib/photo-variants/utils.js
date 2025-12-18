import fs from 'fs';
import path from 'path';

export function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function formatLabelDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(d.getDate());
  const MM = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${dd}.${MM}.${yyyy} ${hh}-${mm}-${ss}`;
}

export async function loadImageBuffer(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Файл не найден: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

export function clampOpacity(value, min = 0.02, max = 0.15) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeName(str = '') {
  return (
    str
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase() || 'default'
  );
}

export function formatAddressLabel(addr = '') {
  const raw = String(addr || '').trim();
  if (!raw) return 'default';
  // Только нормализуем пробелы, адрес оставляем как в источнике
  return raw.replace(/\s+/g, ' ');
}

/**
 * Находит последний (самый свежий) Excel файл в директории
 * @param {string} dir - путь к директории
 * @returns {string|null} - полный путь к файлу или null
 */
export function findLatestExcel(dir) {
  if (!fs.existsSync(dir)) return null;
  
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('~')) // игнорируем временные файлы Excel
    .map(f => ({
      name: f,
      path: path.join(dir, f),
      stat: fs.statSync(path.join(dir, f))
    }))
    .sort((a, b) => b.stat.mtime - a.stat.mtime); // сортируем по дате модификации (новые первые)
  
  return files.length > 0 ? files[0].path : null;
}
