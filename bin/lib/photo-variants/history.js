import fs from 'fs';
import path from 'path';
import { DEFAULT_PHOTOS_ROOT } from './constants.js';

export function loadHistory(materialPath) {
  if (!materialPath) return [];
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json');
  if (!fs.existsSync(historyPath)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    return Array.isArray(json.hashes) ? json.hashes : [];
  } catch {
    return [];
  }
}

export function saveHistory(materialPath, hashes) {
  if (!materialPath) return;
  const historyPath = path.join(DEFAULT_PHOTOS_ROOT, materialPath, 'hashes.json');
  try {
    fs.writeFileSync(historyPath, JSON.stringify({ hashes }, null, 2), 'utf8');
  } catch (e) {
    console.warn(`Не удалось сохранить хэши истории для ${materialPath}: ${e.message}`);
  }
}
