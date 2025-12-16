import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Базовые пути по умолчанию
export const DEFAULT_PHOTOS_ROOT = path.resolve(__dirname, '..', '..', '..', 'data', 'photos');
export const DEFAULT_SOURCE_DIR = path.join(DEFAULT_PHOTOS_ROOT, 'source');
export const DEFAULT_VARIANTS_DIR = path.join(DEFAULT_PHOTOS_ROOT, 'variants');
export const DEFAULT_PLAN_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'plan.json');

// Константы для проверки пустых углов
export const EDGE_ALPHA_THRESHOLD = 252;
export const EDGE_STRIP_FRACTION = 0.1;

// Размер aHash (по умолчанию 32x32)
export const HASH_SIZE = 32;

// Порог уникализации по aHash
// Увеличено с 8 до 10 для более строгих требований к уникальности
// С расширенными диапазонами трансформаций можем требовать больше различий
export const HASH_THRESHOLD = 10;
