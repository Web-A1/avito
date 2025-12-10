import fs from 'fs';

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
  const normalized = raw.replace(/\s+/g, ' ');
  const prefixes = [/^московская\s+обл\./i, /^московская\s+область/i];
  const hasPrefix = prefixes.some((rx) => rx.test(normalized));
  if (hasPrefix) {
    const withoutPrefix = normalized.replace(/^московская\s+обл\.\s*,?/i, '').replace(/^московская\s+область\s*,?/i, '');
    const city = withoutPrefix.replace(/^,\s*/, '').trim();
    if (city) return `${city}, МО`;
  }
  return normalized;
}
