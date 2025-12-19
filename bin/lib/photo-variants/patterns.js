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
    (meanR - meanB) > 45; // тёплый жёлто-коричневый тон

  let minOpacity;
  let maxOpacity;

  const inSandBrightnessRange = avgBrightness >= 110 && avgBrightness <= 190;
  const inSandDetailRange = avgStdev >= 25 && avgStdev <= 60;

  // Рубленый/щебёночный серый фон (как вторичный щебень):
  const isRubbleLike =
    !isWarmSandLike &&
    avgBrightness >= 90 &&
    avgBrightness <= 190 &&
    avgStdev >= 25 &&
    avgStdev <= 75 &&
    Math.abs(meanR - meanG) < 25 &&
    Math.abs(meanG - meanB) < 25;

  if (isWarmSandLike && inSandBrightnessRange && inSandDetailRange) {
    // Песок: заметный, но мягкий (~52–62%)
    const base = Math.max(adjustedOpacity, 0.54);
    minOpacity = Math.max(0.52, base * 0.96);
    maxOpacity = Math.min(0.62, base * 1.06);
  } else if (isRubbleLike) {
    // Щебень/серый камень: заметный, но ещё более деликатный ВЗ (~46–60%).
    const base = Math.max(adjustedOpacity, 0.48);
    minOpacity = Math.max(0.46, base * 0.95);
    maxOpacity = Math.min(0.60, base * 1.10);
  } else if (avgBrightness > 195 && avgStdev < 45) {
    // Очень светлые нейтральные фото (снег, светлый бетон и т.п.)
    const base = Math.max(adjustedOpacity, 0.44);
    minOpacity = Math.max(0.40, base * 0.95);
    maxOpacity = Math.min(0.52, base * 1.05);
  } else {
    // Стандартный режим для всех остальных
    minOpacity = Math.max(0.12, adjustedOpacity * 0.92);
    maxOpacity = Math.min(0.7, adjustedOpacity * 1.08);
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

  if (isRubbleLike) {
    // Для щебня используем полупрозрачные белые буквы БЕЗ тёмного контура.
    return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'rubble' };
  }

  if (avg >= 170) {
    // На очень светлых фонах делаем белый текст с тёмным контуром
    // для повышения читаемости.
    return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,1)', mode: 'bright' };
  }
  if (avg <= 110) return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'dark' };
  return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'mid' };
}

export function buildTextPatternSvg(width, height, text, opacity, fillColor, strokeColor, mode = 'mid') {
  // Минимальный размер шрифта 40px для читаемости на маленьких изображениях
  const fontSize = Math.max(40, Math.round(width * randomBetween(0.022, 0.032)));
  const wordWidthFactor = 4.8;
  const cellSize = Math.round(fontSize * wordWidthFactor * randomBetween(0.94, 1.02));
  const tileW = cellSize * 2.7;
  const tileH = cellSize * 1.65;
  const rotation = Math.random() < 0.5 ? randomBetween(-22, -18) : randomBetween(18, 22);
  // Используем переданный opacity напрямую в SVG.
  const fillOpacity = opacity;
  let strokeOpacity = 0;
  let strokeWidth = 0;
  if (mode === 'bright') {
    // На светлых фонах умеренный контур.
    strokeOpacity = 0.35;
    strokeWidth = 1.1;
  }
  const pad = fontSize * 1.1;
  const offsetX = randomBetween(-tileW * 0.5, tileW * 0.5);
  const offsetY = randomBetween(-tileH * 0.5, tileH * 0.5);
  const x1 = pad + tileW * 0.3;
  const y1 = pad + fontSize * 0.95;
  const x2 = pad + tileW * 0.7;
  const y2 = y1 + tileH / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <pattern id="tp" width="${tileW}" height="${tileH}" x="${offsetX}" y="${offsetY}" patternUnits="userSpaceOnUse" patternTransform="rotate(${rotation})">
          <text x="${x1}" y="${y1}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="${strokeColor || fillColor}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" font-weight="600">${text}</text>
          <text x="${x2}" y="${y2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${fillColor}" fill-opacity="${fillOpacity}" stroke="${strokeColor || fillColor}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" paint-order="stroke fill" font-weight="600">${text}</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#tp)" />
    </svg>`
  );
}
