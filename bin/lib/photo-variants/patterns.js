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
 * Вычисляет адаптивный opacity на основе калибровки с однотонными образцами
 * Эталон: brightness 180 → opacity 15%
 * Линейная интерполяция для более тёмных фото
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
  // brightness 180 → opacity 15% (эталон, "норм")
  // brightness 0   → opacity ~7% (базовый уровень для чёрного)
  // НЕЛИНЕЙНАЯ кривая (степенная функция ^2.7) для плавного перехода
  
  let baseOpacity;
  
  if (avgBrightness <= 180) {
    // Степенная функция для нелинейной кривой (^2.7):
    // Очень медленный рост для тёмных → очень быстрый рост для светлых
    // После многократной калибровки на однотонных образцах
    const ratio = avgBrightness / 180;
    baseOpacity = 0.070 + Math.pow(ratio, 2.7) * 0.080;
  } else {
    // Для очень светлых фото (> 180) оставляем на уровне эталона
    baseOpacity = 0.15;
  }
  
  // КОЭФФИЦИЕНТ ДЕТАЛИЗАЦИИ (для реальных фото с текстурой):
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
  const preAdjustOpacity = baseOpacity * (1 + detailFactor + darkBoost);
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
  const adjustedOpacity = preAdjustOpacity * (1 + midBoost);
  
  // Диапазон для рандомизации: ±8% (уменьшили с ±15% для более стабильного результата)
  const minOpacity = Math.max(0.05, adjustedOpacity * 0.92);
  const maxOpacity = Math.min(0.8, adjustedOpacity * 1.08);
  
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
  if (avg >= 170) return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'bright' };
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
  // Используем переданный opacity напрямую в SVG, БЕЗ жёстких минимумов и лишних множителей!
  const fillOpacity = opacity; // Используем адаптивный opacity напрямую
  const strokeOpacity = 0; // Обводка не нужна
  const strokeWidth = 0; // Обводка не используется
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

