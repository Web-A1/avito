import sharp from 'sharp';
import { EDGE_ALPHA_THRESHOLD, EDGE_STRIP_FRACTION } from './constants.js';

export async function hasEmptyEdges(sharpInstance, width, height) {
  try {
    const stats = await sharpInstance.clone().stats();
    const alpha = stats.channels && stats.channels[3];
    if (!alpha) return false;
    if (alpha.min >= EDGE_ALPHA_THRESHOLD) return false;

    const strip = Math.max(1, Math.floor(width * EDGE_STRIP_FRACTION));
    const stripH = Math.max(1, Math.floor(height * EDGE_STRIP_FRACTION));
    const samples = [];
    const areas = [
      { left: 0, top: 0, width: strip, height },
      { left: width - strip, top: 0, width: strip, height },
      { left: 0, top: 0, width, height: stripH },
      { left: 0, top: height - stripH, width, height: stripH }
    ];
    for (const area of areas) {
      const { data } = await sharpInstance
        .clone()
        .ensureAlpha()
        .extract(area)
        .extractChannel(3)
        .resize(16, 16, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      samples.push(avg);
    }
    return samples.some((avg) => avg < EDGE_ALPHA_THRESHOLD);
  } catch (e) {
    console.warn(`Не удалось проверить углы: ${e.message}`);
    return false;
  }
}
