import sharp from 'sharp';
import { randomBetween, randomInt } from './utils.js';

export function createNoiseBuffer(width, height, spread = 12) {
  const size = width * height * 4;
  const data = new Uint8ClampedArray(size);
  for (let i = 0; i < size; i += 4) {
    const delta = Math.floor(randomBetween(-spread, spread));
    const val = Math.max(0, Math.min(255, 128 + delta));
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = 255;
  }
  return Buffer.from(data);
}

export function buildDotsSvg(width, height) {
  const dotsCount = randomInt(6, 14);
  const rMin = 1;
  const rMax = 3.5;
  let circles = '';
  for (let i = 0; i < dotsCount; i++) {
    const r = randomBetween(rMin, rMax);
    const cx = randomBetween(0, width);
    const cy = randomBetween(0, height);
    const opacity = randomBetween(0.04, 0.08);
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" opacity="${opacity}" />`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`);
}

export function buildGradientSvg(width, height) {
  const angle = randomBetween(0, 360);
  const start = randomBetween(0.05, 0.12);
  const end = randomBetween(0.0, 0.04);
  const color1 = `rgba(255,255,255,${start})`;
  const color2 = `rgba(0,0,0,${end})`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="g" gradientTransform="rotate(${angle})">
          <stop offset="0%" stop-color="${color1}" />
          <stop offset="100%" stop-color="${color2}" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)" />
    </svg>`
  );
}

export function buildLightSpotsSvg(width, height) {
  const spots = randomInt(3, 7);
  let circles = '';
  for (let i = 0; i < spots; i++) {
    const r = randomBetween(10, 26);
    const cx = randomBetween(0, width);
    const cy = randomBetween(0, height);
    const op = randomBetween(0.05, 0.12);
    const blur = randomBetween(2, 6);
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" opacity="${op}" filter="url(#bl${i})" />`;
    circles += `<filter id="bl${i}"><feGaussianBlur stdDeviation="${blur}" /></filter>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${circles}</svg>`);
}

/**
 * Вычисляет адаптивный opacity на основе калибровки с однотонными образцами.
 * Эталон для песка/светлых фонов:
 * - brightness ≈ 180 → opacity ~15–17%
 * - для ещё более светлых фото чуть усиливаем ВЗ, чтобы он не терялся на фоне.
 */
export function calculateAdaptiveOpacity(stats) {
  const channels = stats?.channels || [];
  const means = channels.slice(0, 3).map((c) => c?.mean ?? 128);
  const stdevs = channels.slice(0, 3).map((c) => c?.stdev ?? 0);
  
  // Средняя яркость фона
  const avgBrightness = means.reduce((sum, v) => sum + v, 0) / (means.length || 1);
  
  // Средняя детализация (standard deviation) - показатель текстуры
  const avgStdev = stdevs.reduce((sum, v) => sum + v, 0) / (stdevs.length || 1);
  
  // Визуальный контраст (для справки, не используется в расчётах)
  const watermarkBrightness = 255;
  const visualContrast = Math.abs(watermarkBrightness - avgBrightness) / 255;
  
  // ФОРМУЛА НА ОСНОВЕ КАЛИБРОВКИ С ОДНОТОННЫМИ ОБРАЗЦАМИ:
  // brightness 180 → opacity ≈15% (эталон, "норм")
  // brightness 0   → opacity ~7% (базовый уровень для чёрного)
  // НЕЛИНЕЙНАЯ кривая (степенная функция ^2.7) для плавного перехода +
  // небольшой boost для очень светлых однородных фото (как светлый песок).
  
  let baseOpacity;
  
  if (avgBrightness <= 180) {
    // Степенная функция для нелинейной кривой (^2.7):
    // Очень медленный рост для тёмных → очень быстрый рост для светлых
    // После многократной калибровки на однотонных образцах
    const ratio = avgBrightness / 180;
    baseOpacity = 0.070 + Math.pow(ratio, 2.7) * 0.080;
  } else {
    // Для очень светлых фото (> 180) заметно усиливаем ВЗ,
    // чтобы он не терялся на светлых однородных фонах.
    // brightness 180–240 → ~0.17–0.22
    const ratio = Math.min(1, (avgBrightness - 180) / 60);
    baseOpacity = 0.17 + ratio * 0.05;
  }
  
  // КОЕФФИЦИЕНТ ДЕТАЛИЗАЦИИ (для реальных фото с текстурой):
  // На тёмных фото с высокой текстурой ВЗ "прячется" → нужен больший opacity
  // На светлых фото (>150) коэффициент = 0 (ВЗ и так заметен)
  const detailFactor = (avgStdev / 50) * Math.max(0, 1 - avgBrightness / 150);
  
  // BOOST ДЛЯ ТЁМНЫХ ФОТО С НИЗКОЙ ДЕТАЛИЗАЦИЕЙ:
  // На однородных тёмных фото (низкий stdev) ВЗ плохо виден несмотря на отсутствие текстуры
  // Это происходит из-за низкого контраста на тёмном фоне
  let darkBoost = 0;
  if (avgBrightness < 95 && avgStdev < 40) {
    // Очень тёмные с низкой детализацией (земля, тени)
    darkBoost = 1.0;
  } else if (avgBrightness >= 95 && avgBrightness < 110 && avgStdev < 40) {
    // Средне-тёмные с низкой детализацией (фото 010)
    darkBoost = 0.9;
  } else if (avgBrightness < 120 && avgStdev < 45) {
    // Средне-тёмные с низкой-средней детализацией
    darkBoost = 0.7;
  } else if (avgBrightness < 105 && avgStdev >= 40 && avgStdev < 60) {
    // Средне-тёмные со средней детализацией
    darkBoost = 0.3;
  }
  
  // ДОП. BOOST ДЛЯ СРЕДНИХ ФОТО, КОТОРЫЕ ЕЩЁ ЧУТЬ НЕ ДОТЯГИВАЮТ
  // Работает только когда уже посчитанный opacity ниже 16%
  let midBoost = 0;

  // Дополнительный boost для очень светлых и достаточно однородных фото (как светлый песок):
  // если яркость > 195 и детализация низкая/средняя, немного усиливаем ВЗ.
  let brightBoost = 0;
  if (avgBrightness > 195 && avgStdev < 45) {
    brightBoost = 0.15; // +15%
  }

  const preAdjustOpacity = baseOpacity * (1 + detailFactor + darkBoost + brightBoost);
  if (
    preAdjustOpacity < 0.16 &&
    avgBrightness >= 90 &&
    avgBrightness <= 110 &&
    avgStdev >= 35 &&
    avgStdev <= 60
  ) {
    midBoost = 0.10; // +10%
  }

  // Применяем все коэффициенты к базовому opacity
  let adjustedOpacity = preAdjustOpacity * (1 + midBoost);
  
  // Специальный режим для тёплых песчаных фото (вариант A):
  // делаем водяной знак заметным, но не агрессивным (~30–35%).
  const meanR = means[0] ?? avgBrightness;
  const meanG = means[1] ?? avgBrightness;
  const meanB = means[2] ?? avgBrightness;
  const isWarmSandLike =
    meanR > meanG &&
    meanG > meanB &&
    (meanR - meanB) > 25 && // тёплый жёлто-коричневый тон (ослабили порог)
    avgBrightness >= 100; // отсечка по яркости, чтобы не ловить грязно-серые кадры

  let minOpacity;
  let maxOpacity;

  const inSandBrightnessRange = avgBrightness >= 115 && avgBrightness <= 205;
  const inSandDetailRange = avgStdev >= 25 && avgStdev <= 80; // позволяем более детализированный песок
  const sandHighDetail = avgStdev >= 60; // визуально "зернистый" песок

  // Мало детализированные средние по яркости кадры (часть немытого песка)
  const isLowDetailMidtone =
    avgBrightness >= 125 &&
    avgBrightness <= 155 &&
    avgStdev < 40;

  // Нейтральный песок/земляные кадры без ярко выраженного тёплого оттенка
  const isNeutralSandLike =
    !isWarmSandLike &&
    avgBrightness >= 95 &&
    avgBrightness <= 155 &&
    avgStdev >= 45 &&
    avgStdev <= 85 &&
    meanR - meanB >= -5 && // слегка тёплый/нейтральный тон
    meanR - meanB <= 24;

  // Рубленый/щебёночный серый фон (как вторичный щебень):
  const isRubbleLike =
    !isWarmSandLike &&
    avgBrightness >= 105 &&
    avgBrightness <= 195 &&
    avgStdev >= 18 &&
    avgStdev <= 80 &&
    Math.abs(meanR - meanG) < 12 &&
    Math.abs(meanG - meanB) < 12 &&
    (Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB)) < 18;

  if (isWarmSandLike && inSandBrightnessRange && inSandDetailRange) {
    // Тёплый песок: убираем тёмный контур, но даём уверенный диапазон.
    if (sandHighDetail) {
      // Сильно детализированный тёплый песок → более выраженный ВЗ.
      const base = Math.max(adjustedOpacity, 0.50);
      minOpacity = Math.max(0.48, base * 0.97);
      maxOpacity = Math.min(0.62, base * 1.10);
    } else {
      // Однородный/мало детализированный тёплый песок → усиленный, но без перетяга.
      const base = Math.max(adjustedOpacity, 0.40);
      minOpacity = Math.max(0.38, base * 0.96);
      maxOpacity = Math.min(0.50, base * 1.08);
    }
  } else if (isRubbleLike) {
    // Щебень/серый камень: делим на три подрежима.
    const highDetailMidBright = avgBrightness >= 118 && avgBrightness <= 130 && avgStdev >= 78;
    const softenedMidBright = !highDetailMidBright && avgBrightness >= 125 && avgBrightness <= 142 && avgStdev >= 60;
    if (highDetailMidBright) {
      // Очень детализированный средне-яркий щебень: делаем заметнее.
      const base = Math.max(adjustedOpacity, 0.58);
      minOpacity = Math.max(0.55, base * 0.96);
      maxOpacity = Math.min(0.75, base * 1.05);
    } else if (softenedMidBright) {
      // Проблемные кадры, где ВЗ "горит" — ослабляем.
      const base = Math.max(adjustedOpacity, 0.34);
      minOpacity = Math.max(0.30, base * 0.95);
      maxOpacity = Math.min(0.48, base * 1.06);
    } else {
      // Остальное: оставляем плотный ВЗ, чтобы его было видно на грубой фактуре.
      minOpacity = 1.0;
      maxOpacity = 1.0;
    }
  } else if (isLowDetailMidtone) {
    // Средняя яркость и низкая детализация (немытый песок) → уверенный ВЗ.
    const base = Math.max(adjustedOpacity, 0.38);
    minOpacity = Math.max(0.36, base * 0.96);
    maxOpacity = Math.min(0.48, base * 1.10);
  } else if (isNeutralSandLike) {
    // Нейтральный песок/земля без яркого тепла: средний диапазон.
    const base = Math.max(adjustedOpacity, 0.34 + Math.max(0, (avgStdev - 55) * 0.0025));
    minOpacity = Math.max(0.32, base * 0.95);
    maxOpacity = Math.min(0.50, base * 1.10);
  } else if (avgBrightness > 195 && avgStdev < 45) {
    // Очень светлые нейтральные фото (снег, светлый бетон и т.п.)
    const base = Math.max(adjustedOpacity, 0.44);
    minOpacity = Math.max(0.40, base * 0.95);
    maxOpacity = Math.min(0.52, base * 1.05);
  } else if (avgBrightness < 115) {
    // Тёмные кадры: по умолчанию усиливаем, чтобы ВЗ не терялся.
    const base = Math.max(adjustedOpacity, avgBrightness < 95 ? 0.32 : 0.30);
    const textureBoost =
      avgStdev >= 60 ? 0.04 :
      avgStdev >= 45 ? 0.02 : 0; // детализированные или слабодетализированные тёмные кадры
    const tunedBase = base + textureBoost;
    minOpacity = Math.max(0.30, tunedBase * 0.95);
    maxOpacity = Math.min(0.50, tunedBase * 1.12);
  } else {
    // Средние по яркости кадры (универсальный диапазон)
    const base = Math.max(adjustedOpacity, 0.30);
    minOpacity = Math.max(0.28, base * 0.95);
    maxOpacity = Math.min(0.48, base * 1.16);
  }
  
  return { minOpacity, maxOpacity, visualContrast, avgBrightness, avgStdev, detailFactor };
}

export function pickTextPalette(stats, forcedColor) {
  const lc = forcedColor ? forcedColor.trim().toLowerCase() : '';
  const isDarkForced = lc === '#000' || lc === 'black' || lc === '000000';
  if (forcedColor) {
    return { fill: forcedColor, stroke: 'rgba(0,0,0,0)', mode: 'custom' };
  }
  const channels = stats?.channels || [];
  const means = channels.slice(0, 3).map((c) => c?.mean ?? 128);
  const avg = means.reduce((sum, v) => sum + v, 0) / (means.length || 1);

  // Рубленый/щебёночный серый фон: каналы близки, без выраженного тёплого сдвига.
  const meanR = means[0];
  const meanG = means[1];
  const meanB = means[2];
  const isRubbleLike =
    avg >= 110 &&
    avg <= 170 &&
    Math.abs(meanR - meanG) < 20 &&
    Math.abs(meanG - meanB) < 20;
  const isWarmSandLike = meanR > meanG && meanG > meanB && (meanR - meanB) > 45;

  if (isRubbleLike) {
    // Щебень: только белый текст без контура, чтобы не было чёрных точек.
    return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'rubble' };
  }

  if (isWarmSandLike) {
    // Для тёплого песка убираем контур совсем, чтобы не было чёрных точек.
    return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'sand' };
  }

  if (avg >= 170) {
    // На очень светлых фонах делаем белый текст с мягким контуром.
    return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0.6)', mode: 'bright' };
  }
  if (avg <= 110) return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'dark' };
  return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'mid' };
}

export function buildTextPatternSvg(width, height, text, opacity, fillColor, strokeColor, mode = 'mid') {
  // Стабилизируем размер шрифта по отношению к фото: 1200px → 40px (как на эталонном кадре)
  const referenceDimension = 1200;
  const referenceFontSize = 40;
  const baseDimension = Math.min(width, height);
  const fontSize = Math.max(28, Math.round((baseDimension / referenceDimension) * referenceFontSize));
  const wordWidthFactor = mode === 'rubble' ? 3.2 : 4.8;
  const textWidth = fontSize * wordWidthFactor;
  // Крупная плитка: три ширины слова и щедрый запас по высоте — текст не режется даже после поворота
  const tileW = Math.round(textWidth * 3.0);
  const tileH = Math.round(fontSize * 8.4); // в 2 раза больше вертикальный шаг между строками
  const rotation = Math.random() < 0.5 ? randomBetween(-22, -18) : randomBetween(18, 22);
  // Используем переданный opacity напрямую в SVG.
  const fillOpacity = opacity;
  let strokeOpacity = 0;
  let strokeWidth = 0;
  const useShadow = false; // Убираем тени, чтобы не давали чёрных точек
  const shadowId = 'ts';
  const shadowFilter = '';
  const filterAttr = '';
  // Отключаем тёмный контур для всех режимов, чтобы исключить чёрные точки
  strokeOpacity = 0;
  strokeWidth = 0;
  const offsetX = 0;
  const offsetY = 0;
  // Расставляем строки в шахматном порядке: вторая строка смещена на полплитки
  const x1 = tileW * 0.25;
  const y1 = tileH * 0.35;
  const x2 = tileW * 0.75;
  const y2 = y1 + tileH / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        ${shadowFilter}
        <pattern id="tp" width="${tileW}" height="${tileH}" x="${offsetX}" y="${offsetY}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotation} ${tileW / 2} ${tileH / 2})">
          <text x="${x1}" y="${y1}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="${strokeColor || fillColor}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" font-weight="700" ${filterAttr}>${text}</text>
          <text x="${x2}" y="${y2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="${strokeColor || fillColor}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" font-weight="700" ${filterAttr}>${text}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#tp)" />
    </svg>`
  );
}
