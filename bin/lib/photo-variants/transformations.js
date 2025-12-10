import sharp from 'sharp';
import { randomBetween, randomInt } from './utils.js';

/**
 * Применяет полный набор геометрических и цветовых трансформаций
 * для создания уникального варианта изображения
 * 
 * @param {Buffer} buffer - Буфер исходного изображения
 * @param {Object} options - Параметры трансформации
 * @param {number} options.width - Ширина исходного изображения
 * @param {number} options.height - Высота исходного изображения
 * @param {Object} options.stats - Статистика Sharp (для flatten)
 * @param {boolean} options.smallImage - Флаг малого изображения
 * @param {number} options.zoomBoost - Коэффициент усиления зума
 * @param {number} options.angleBoost - Коэффициент усиления угла поворота
 * @returns {Promise<Object>} Результат с Sharp pipeline и метаданными
 */
export async function applyTransformations(buffer, options) {
  const { width, height, stats, smallImage, zoomBoost, angleBoost } = options;

  // 1. Расчёт всех параметров трансформации
  const params = calculateTransformParams(width, height, smallImage, zoomBoost, angleBoost);

  // 2. Применение геометрических трансформаций
  const { pipeline, finalWidth, finalHeight } = await applyGeometricTransform(
    buffer,
    params,
    stats
  );

  // 3. Цветокоррекция
  const finalPipeline = applyColorCorrection(pipeline, params);

  return {
    pipeline: finalPipeline,
    finalWidth,
    finalHeight,
    metadata: {
      angle: params.rotateDeg,
      scale: params.scale,
      flipped: params.shouldFlop,
      brightness: params.brightness,
      saturation: params.saturation,
      hue: params.hue,
      contrast: params.contrast
    }
  };
}

/**
 * Расчёт всех параметров трансформации
 */
function calculateTransformParams(width, height, smallImage, zoomBoost, angleBoost) {
  // Масштабирование
  const scaleMin = smallImage ? 0.98 : 0.96;
  const scaleMax = smallImage ? 1.02 : 1.04;
  const scale = randomBetween(scaleMin, scaleMax);
  const targetWidth = Math.max(32, Math.round(width * scale));
  const targetHeight = Math.max(32, Math.round(height * scale));

  // Поворот и отражение
  const rotateRange = (smallImage ? 7 : 9) * angleBoost;
  const rotateDeg = randomBetween(-rotateRange, rotateRange);
  const shouldFlop = Math.random() < 0.5;

  // Цветокоррекция
  const clampRange = (min, max) => [Math.max(min, 0.9), Math.min(max, 1.1)];
  const [bMin, bMax] = clampRange(0.97, 1.05);
  const [sMin, sMax] = clampRange(0.96, 1.05);
  const [cMin, cMax] = clampRange(0.97, 1.06);
  const hueRange = 5;
  const brightness = randomBetween(bMin, bMax);
  const saturation = randomBetween(sMin, sMax);
  const hue = randomInt(-hueRange, hueRange);
  const contrast = randomBetween(cMin, cMax);

  // Overscale для компенсации поворота
  const baseOverscale = smallImage ? 1.02 : 1.04;
  const overscale = Math.min(1.12, baseOverscale * zoomBoost);

  const workW = Math.max(32, Math.round(width * scale * overscale));
  const workH = Math.max(32, Math.round(height * scale * overscale));

  return {
    scale,
    targetWidth,
    targetHeight,
    rotateDeg,
    shouldFlop,
    brightness,
    saturation,
    hue,
    contrast,
    workW,
    workH,
    overscale
  };
}

/**
 * Применяет геометрические трансформации: resize, flop, rotate, flatten, crop
 */
async function applyGeometricTransform(buffer, params, stats) {
  let baseTransformed = sharp(buffer)
    .ensureAlpha()
    .resize({ width: params.workW, height: params.workH, fit: 'cover', position: 'center' });

  if (params.shouldFlop) {
    baseTransformed = baseTransformed.flop();
  }

  // Поворот на прозрачном фоне
  baseTransformed = baseTransformed.rotate(params.rotateDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } });

  // ✨ КЛЮЧЕВОЕ РЕШЕНИЕ: flatten сразу после rotate
  // Заменяет полупрозрачные пиксели (от интерполяции) на непрозрачные
  // Используем средний цвет изображения для естественного вида
  const avgColor = stats.channels.slice(0, 3).map(ch => Math.round(ch.mean));
  baseTransformed = baseTransformed.flatten({
    background: { r: avgColor[0], g: avgColor[1], b: avgColor[2] }
  });

  // КРИТИЧНО: Выполняем pipeline чтобы получить РЕАЛЬНЫЕ размеры после rotate
  // metadata() на pipeline возвращает исходные размеры, что приводит к серым углам
  const rotatedBuffer = await baseTransformed.png().toBuffer();
  baseTransformed = sharp(rotatedBuffer);

  // Теперь получаем ПРАВИЛЬНЫЕ размеры после rotate+flatten
  const rotatedMeta = await baseTransformed.metadata();
  const rotW = rotatedMeta.width || params.workW;
  const rotH = rotatedMeta.height || params.workH;

  // Вычисляем максимальный вписанный прямоугольник по формуле
  const { cropW, cropH } = calculateInscribedRectangle(
    params.workW,
    params.workH,
    params.rotateDeg,
    0.995 // минимальный safety т.к. flatten убрал все полупрозрачные пиксели
  );

  // Центрируем crop внутри повёрнутого холста
  const left = Math.max(0, Math.floor((rotW - cropW) / 2));
  const top = Math.max(0, Math.floor((rotH - cropH) / 2));
  baseTransformed = baseTransformed.extract({ left, top, width: cropW, height: cropH });

  return {
    pipeline: baseTransformed,
    finalWidth: cropW,
    finalHeight: cropH
  };
}

/**
 * Применяет цветокоррекцию
 */
function applyColorCorrection(sharpInstance, params) {
  return sharpInstance
    .modulate({ brightness: params.brightness, saturation: params.saturation, hue: params.hue })
    .linear(params.contrast, 128 * (1 - params.contrast));
}

/**
 * Расчёт максимального вписанного прямоугольника после поворота
 * 
 * @param {number} width - Ширина исходного изображения
 * @param {number} height - Высота исходного изображения
 * @param {number} angleDegrees - Угол поворота в градусах
 * @param {number} safety - Коэффициент безопасности (0.995 = отступ 0.5%)
 * @returns {Object} { cropW, cropH } - размеры вписанного прямоугольника
 */
export function calculateInscribedRectangle(width, height, angleDegrees, safety = 0.995) {
  let angleAbs = Math.abs(angleDegrees) % 180;
  if (angleAbs > 90) angleAbs = 180 - angleAbs;
  const theta = (angleAbs * Math.PI) / 180;
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const sin2 = Math.sin(2 * theta);
  const cos2 = c * c - s * s;

  let cropW, cropH;
  if (width >= height) {
    if (height <= width * sin2) {
      cropW = height / (2 * s);
      cropH = height / (2 * c);
    } else {
      cropW = (width * c - height * s) / cos2;
      cropH = (height * c - width * s) / cos2;
    }
  } else {
    if (width <= height * sin2) {
      cropW = width / (2 * c);
      cropH = width / (2 * s);
    } else {
      cropW = (width * c - height * s) / cos2;
      cropH = (height * c - width * s) / cos2;
    }
  }

  // Минимальный safety т.к. flatten убрал все полупрозрачные пиксели
  // 0.995 = отступ всего 0.5% для страховки от ошибок округления
  cropW = Math.max(1, Math.floor(cropW * safety));
  cropH = Math.max(1, Math.floor(cropH * safety));

  return { cropW, cropH };
}
