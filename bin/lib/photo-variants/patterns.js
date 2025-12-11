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

export function pickTextPalette(stats, forcedColor) {
  const lc = forcedColor ? forcedColor.trim().toLowerCase() : '';
  const isDarkForced = lc === '#000' || lc === 'black' || lc === '000000';
  if (forcedColor) {
    return { fill: forcedColor, stroke: 'rgba(0,0,0,0)', mode: 'custom' };
  }
  const channels = stats?.channels || [];
  const means = channels.slice(0, 3).map((c) => c?.mean || 128);
  const avg = means.reduce((sum, v) => sum + v, 0) / (means.length || 1);
  if (avg >= 170) return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'bright' };
  if (avg <= 110) return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'dark' };
  return { fill: 'rgba(255,255,255,1)', stroke: 'rgba(0,0,0,0)', mode: 'mid' };
}

export function buildTextPatternSvg(width, height, text, opacity, fillColor, strokeColor, mode = 'mid') {
  const fontSize = Math.round(width * randomBetween(0.022, 0.032));
  const wordWidthFactor = 4.8;
  const cellSize = Math.round(fontSize * wordWidthFactor * randomBetween(0.94, 1.02));
  const tileW = cellSize * 2.7;
  const tileH = cellSize * 1.65;
  const rotation = Math.random() < 0.5 ? randomBetween(-22, -18) : randomBetween(18, 22);
  const modeSettings =
    {
      bright: { boost: 1.5, fillMin: 0.5, fillMax: 0.8, strokeMin: 0, strokeMax: 0, strokeW: 0 },
      mid: { boost: 0.85, fillMin: 0.28, fillMax: 0.5, strokeMin: 0, strokeMax: 0, strokeW: 0 },
      dark: { boost: 0.85, fillMin: 0.32, fillMax: 0.62, strokeMin: 0, strokeMax: 0, strokeW: 0 },
      custom: { boost: 1.0, fillMin: 0.4, fillMax: 0.7, strokeMin: 0, strokeMax: 0, strokeW: 0 }
    }[mode] || { boost: 1.0, fillMin: 0.4, fillMax: 0.7, strokeMin: 0, strokeMax: 0, strokeW: 0 };
  const fillOpacity = Math.min(modeSettings.fillMax, Math.max(modeSettings.fillMin, opacity * 1.5 * modeSettings.boost));
  const strokeOpacity = strokeColor
    ? Math.min(modeSettings.strokeMax, Math.max(modeSettings.strokeMin, opacity * 2.6 * modeSettings.boost))
    : 0;
  const strokeWidth = modeSettings.strokeW ? Math.max(0.6, fontSize * modeSettings.strokeW) : 0;
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

