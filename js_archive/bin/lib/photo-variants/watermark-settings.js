import fs from 'fs';
import path from 'path';

export function loadWatermarkSettings(filePath) {
  if (!filePath) return { files: {} };
  try {
    if (!fs.existsSync(filePath)) {
      return { files: {} };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      const files = data.files && typeof data.files === 'object' ? data.files : data;
      return { files };
    }
  } catch (e) {
    console.warn(`Не удалось прочитать настройки водяного знака из ${filePath}: ${e.message}`);
  }
  return { files: {} };
}

export function findWatermarkSettings(settings, inputPath) {
  if (!settings || !inputPath) return null;
  const files = settings.files || {};
  const base = path.basename(inputPath);
  const baseNoExt = base.replace(/\.[^.]+$/, '');
  return files[base] || files[baseNoExt] || files[inputPath] || null;
}
