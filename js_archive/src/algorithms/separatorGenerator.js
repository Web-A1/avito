/**
 * Генератор разделителей для описаний объявлений
 * 
 * Требования:
 * - Между 7 блоками = 6 разделителей
 * - Каждый разделитель может быть разным вариантом
 * - Вариации: длина, пробелы, HTML-теги
 * - Приоритет: безопасные варианты (длина, пробелы, HTML) > альтернативные символы
 */

// Длина разделителя (случайная в пределах 20–30 символов)
const LENGTH_MIN = 20;
const LENGTH_MAX = 30;

// Символ линии: '_' (основной), '=' допускается только после блока 2
const DEFAULT_LINE_CHAR = '_';
const BLOCK2_LINE_CHAR = '=';

// Варианты пробелов вокруг линии (для лёгкой вариативности без лишних <br>)
const SPACE_VARIANTS = {
  NONE: '',
  START: ' ',
  END: ' ',
  BOTH: ' '
};

/**
 * Генерирует строку подчеркивания заданной длины
 * @param {number} length - Длина разделителя
 * @param {string} lineChar - Символ линии ('_', '=', '-')
 * @returns {string} Строка символов
 */
function generateLine(length, lineChar) {
  return lineChar.repeat(length);
}

/**
 * Генерирует один разделитель со случайными вариациями (HTML/пробелы),
 * но фиксированной длиной и символом линии.
 * @param {number} length
 * @param {string} lineChar
 * @returns {string} Сгенерированный разделитель
 */
export function generateSeparator(length, lineChar) {
  const line = generateLine(length, lineChar);

  // Лёгкая вариативность пробелов вокруг линии
  let spaceBefore = '';
  let spaceAfter = '';
  if (Math.random() < 0.3) {
    const variant = Math.random();
    if (variant < 0.33) {
      spaceBefore = SPACE_VARIANTS.START;
    } else if (variant < 0.66) {
      spaceAfter = SPACE_VARIANTS.END;
    } else {
      spaceBefore = SPACE_VARIANTS.START;
      spaceAfter = SPACE_VARIANTS.END;
    }
  }

  // Оборачиваем линию в <p> — единый отступ без двойных <br>
  return `<p>${spaceBefore}${line}${spaceAfter}</p>`;
}

/**
 * Генерирует 6 разделителей для объявления
 * Длина и символ линии фиксированы для всех 6 (для консистентности),
 * вариации HTML/пробелов — на каждый разделитель.
 * @returns {Array<string>} Массив из 6 разделителей
 */
export function generateSeparators() {
  const separators = [];
  const length = Math.floor(Math.random() * (LENGTH_MAX - LENGTH_MIN + 1)) + LENGTH_MIN;

  for (let i = 0; i < 6; i++) {
    const isAfterBlock2 = i === 1;
    const lineChar = isAfterBlock2 && Math.random() < 0.5 ? BLOCK2_LINE_CHAR : DEFAULT_LINE_CHAR;
    separators.push(generateSeparator(length, lineChar));
  }

  return separators;
}
