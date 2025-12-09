/**
 * Алгоритм замены кириллических букв на латинские для уникализации текста
 * 
 * Требования:
 * - Процент замены: 5-10% слов (начальный этап)
 * - Обязательно заменять минимум 1 букву в ключевых словах
 * - Замены распределены по всему тексту (ключевые + неключевые слова)
 * - Разные паттерны замены для каждого объявления
 * - Формат LatinReplacements: "слово1:буква1→замена1,буква2→замена2;слово2:буква1→замена1"
 */

// Словарь замен кириллических букв на латинские (только визуально идентичные символы)
// ВАЖНО: Строчные и заглавные буквы проверяются отдельно!
// Строчные: м≠m, к≠k, в≠b, т≠t (разные по написанию)
// Заглавные: М=M, но У≠Y (разные по написанию)
const REPLACEMENT_MAP = {
  // Строчные буквы (визуально идентичные)
  'а': 'a',  // U+0430 ↔ U+0061 - идентичны
  'е': 'e',  // U+0435 ↔ U+0065 - идентичны
  'о': 'o',  // U+043E ↔ U+006F - идентичны
  'с': 'c',  // U+0441 ↔ U+0063 - идентичны
  'х': 'x',  // U+0445 ↔ U+0078 - идентичны
  'р': 'p',  // U+0440 ↔ U+0070 - идентичны
  'у': 'y',  // U+0443 ↔ U+0079 - идентичны
  // НЕ включаем строчные: м≠m, к≠k, в≠b, т≠t (разные по написанию)
  
  // Заглавные буквы (визуально идентичные)
  'А': 'A',  // U+0410 ↔ U+0041 - идентичны
  'В': 'B',  // U+0412 ↔ U+0042 - идентичны
  'С': 'C',  // U+0421 ↔ U+0043 - идентичны
  'Е': 'E',  // U+0415 ↔ U+0045 - идентичны
  'Н': 'H',  // U+041D ↔ U+0048 - идентичны
  'К': 'K',  // U+041A ↔ U+004B - идентичны
  'М': 'M',  // U+041C ↔ U+004D - идентичны
  
  'О': 'O',  // U+041E ↔ U+004F - идентичны
  'Р': 'P',  // U+0420 ↔ U+0050 - идентичны
  'Х': 'X'   // U+0425 ↔ U+0058 - идентичны
  // НЕ включаем заглавные: У≠Y (разные по написанию)
};

// Ключевые слова для каждого типа песка (обязательно заменять минимум 1 букву)
const KEYWORDS = {
  'karier_neseyan_nemyt_pesok': ['песок', 'карьерный', 'немытый'],
  'karier_seyan_nemyt_pesok': ['песок', 'карьерный', 'сеяный'],
  'karier_seyan_myt_pesok_1.5': ['песок', 'карьерный', 'сеяный', 'мытый', 'модуль', 'крупности'],
  'karier_seyan_myt_pesok_2': ['песок', 'карьерный', 'сеяный', 'мытый', 'модуль', 'крупности'],
  'karier_seyan_myt_pesok_2.5': ['песок', 'карьерный', 'сеяный', 'мытый', 'модуль', 'крупности']
};

/**
 * Извлекает слова из текста (игнорируя HTML-теги)
 * @param {string} text - Текст для обработки
 * @returns {Array} Массив объектов {word, originalIndex, isKeyword}
 */
function extractWords(text, keywords) {
  const words = [];
  // Регулярное выражение для извлечения слов (кириллица, латиница, цифры)
  // Игнорируем HTML-теги
  const wordRegex = /[а-яёА-ЯЁa-zA-Z0-9]+/g;
  const keywordSet = new Set(keywords.map(k => k.toLowerCase()));
  
  let match;
  while ((match = wordRegex.exec(text)) !== null) {
    const word = match[0];
    const lowerWord = word.toLowerCase();
    const isKeyword = keywordSet.has(lowerWord);
    
    words.push({
      word: word,
      originalIndex: match.index,
      isKeyword: isKeyword
    });
  }
  
  return words;
}

/**
 * Выбирает случайные слова для замены (5-10% от общего количества)
 * Гарантирует, что хотя бы одно ключевое слово будет выбрано
 * @param {Array} words - Массив слов
 * @param {number} minPercent - Минимальный процент замены (5%)
 * @param {number} maxPercent - Максимальный процент замены (10%)
 * @returns {Array} Массив индексов выбранных слов
 */
function selectWordsForReplacement(words, minPercent = 5, maxPercent = 10) {
  const totalWords = words.length;
  if (totalWords === 0) return [];
  
  // Вычисляем количество слов для замены
  const minWords = Math.max(1, Math.ceil(totalWords * minPercent / 100));
  const maxWords = Math.ceil(totalWords * maxPercent / 100);
  const targetCount = Math.floor(Math.random() * (maxWords - minWords + 1)) + minWords;
  
  // Разделяем на ключевые и неключевые
  const keywordIndices = [];
  const nonKeywordIndices = [];
  
  words.forEach((w, idx) => {
    if (w.isKeyword) {
      keywordIndices.push(idx);
    } else {
      nonKeywordIndices.push(idx);
    }
  });
  
  const selected = new Set();
  
  // Обязательно выбираем минимум 1 ключевое слово
  if (keywordIndices.length > 0) {
    const keywordIdx = keywordIndices[Math.floor(Math.random() * keywordIndices.length)];
    selected.add(keywordIdx);
  }
  
  // Случайно выбираем остальные слова (ключевые и неключевые)
  const allIndices = [...keywordIndices, ...nonKeywordIndices];
  while (selected.size < targetCount && selected.size < allIndices.length) {
    const randomIdx = allIndices[Math.floor(Math.random() * allIndices.length)];
    selected.add(randomIdx);
  }
  
  return Array.from(selected);
}

/**
 * Заменяет буквы в слове на латинские аналоги
 * @param {string} word - Слово для замены
 * @returns {Object} {replaced: string, replacements: Array} - Замененное слово и массив замен
 */
function replaceLettersInWord(word) {
  const replacements = [];
  let replaced = word;
  
  // Получаем доступные буквы для замены в этом слове
  const availableReplacements = [];
  for (let i = 0; i < word.length; i++) {
    const char = word[i];
    if (REPLACEMENT_MAP[char]) {
      availableReplacements.push({ index: i, original: char, replacement: REPLACEMENT_MAP[char] });
    }
  }
  
  if (availableReplacements.length === 0) {
    return { replaced: word, replacements: [] };
  }
  
  // Случайно выбираем 1-3 буквы для замены (чтобы не переборщить)
  const numReplacements = Math.min(
    Math.floor(Math.random() * 3) + 1,
    availableReplacements.length
  );
  
  // Перемешиваем и берем первые N
  const shuffled = [...availableReplacements].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, numReplacements);
  
  // Сортируем по индексу (от конца к началу, чтобы индексы не сбились при замене)
  selected.sort((a, b) => b.index - a.index);
  
  // Выполняем замены
  const chars = replaced.split('');
  selected.forEach(({ index, original, replacement }) => {
    chars[index] = replacement;
    replacements.push({ original, replacement });
  });
  
  replaced = chars.join('');
  
  return { replaced, replacements };
}

/**
 * Форматирует замены в формат LatinReplacements
 * @param {Object} keywordReplacements - Объект {слово: [{original, replacement}, ...]}
 * @returns {string} Форматированная строка
 */
function formatLatinReplacements(keywordReplacements) {
  const parts = [];
  
  for (const [word, replacements] of Object.entries(keywordReplacements)) {
    if (replacements.length > 0) {
      const replacementStr = replacements
        .map(r => `${r.original}→${r.replacement}`)
        .join(',');
      parts.push(`${word}:${replacementStr}`);
    }
  }
  
  return parts.join(';');
}

/**
 * Основная функция замены латиницы в тексте
 * @param {string} text - Текст для обработки
 * @param {string} sandTypeId - ID типа песка (для определения ключевых слов)
 * @param {number} minPercent - Минимальный процент замены (по умолчанию 5)
 * @param {number} maxPercent - Максимальный процент замены (по умолчанию 10)
 * @returns {Object} {text: string, latinReplacements: string} - Обработанный текст и формат замен
 */
export function replaceLatin(text, sandTypeId, minPercent = 5, maxPercent = 10) {
  if (!text || typeof text !== 'string') {
    return { text: text || '', latinReplacements: '' };
  }
  
  // Получаем ключевые слова для данного типа песка
  const keywords = KEYWORDS[sandTypeId] || KEYWORDS['karier_neseyan_nemyt_pesok'];
  
  // Извлекаем слова из текста
  const words = extractWords(text, keywords);
  
  if (words.length === 0) {
    return { text, latinReplacements: '' };
  }
  
  // Выбираем слова для замены
  const selectedIndices = selectWordsForReplacement(words, minPercent, maxPercent);
  
  // Выполняем замены
  let result = text;
  const keywordReplacements = {}; // Для форматирования LatinReplacements
  
  // Сортируем индексы по убыванию, чтобы не сбить позиции при замене
  const sortedIndices = [...selectedIndices].sort((a, b) => {
    return words[b].originalIndex - words[a].originalIndex;
  });
  
  sortedIndices.forEach(wordIdx => {
    const wordData = words[wordIdx];
    const { word, originalIndex, isKeyword } = wordData;
    
    // Заменяем буквы в слове
    const { replaced, replacements } = replaceLettersInWord(word);
    
    if (replacements.length > 0) {
      // Заменяем слово в тексте
      const before = result.substring(0, originalIndex);
      const after = result.substring(originalIndex + word.length);
      result = before + replaced + after;
      
      // Сохраняем замены для ключевых слов
      if (isKeyword) {
        const lowerWord = word.toLowerCase();
        if (!keywordReplacements[lowerWord]) {
          keywordReplacements[lowerWord] = [];
        }
        keywordReplacements[lowerWord].push(...replacements);
      }
    }
  });
  
  // Форматируем LatinReplacements
  const latinReplacements = formatLatinReplacements(keywordReplacements);
  
  return { text: result, latinReplacements };
}
