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

// Размер aHash (32×32 = 1024 бита вместо 16×16 = 256 бит)
// Увеличен для детекции мелких различий между вариантами
// При 32×32 паттерны, crop shift и мелкие трансформации становятся видны
export const HASH_SIZE = 32;

// Порог уникализации по aHash
// Пропорционален HASH_SIZE: при 32×32 используем ~40 (вместо 10 для 16×16)
// Это ~4% от общего числа бит (40/1024 ≈ 10/256)
export const HASH_THRESHOLD = 40;
