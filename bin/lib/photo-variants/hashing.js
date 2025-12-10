import fs from 'fs';
import sharp from 'sharp';

export async function aHashFromBuffer(buffer, size = 16) {
  const { data } = await sharp(buffer)
    .greyscale()
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
  let bits = '';
  for (const v of data) bits += v >= avg ? '1' : '0';
  return bits;
}

export function hamming(a, b) {
  let dist = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

export function pruneByHash(variants, targetCount, origHash, warnDistance = 14) {
  if (!variants.length) return variants;
  let current = [...variants];
  while (current.length > targetCount) {
    let minDist = Infinity;
    let victimIdx = -1;
    for (let i = 0; i < current.length; i++) {
      let nearest = origHash ? hamming(current[i].hash, origHash) : Infinity;
      for (let j = 0; j < current.length; j++) {
        if (i === j) continue;
        const d = hamming(current[i].hash, current[j].hash);
        if (d < nearest) nearest = d;
      }
      if (nearest < minDist) {
        minDist = nearest;
        victimIdx = i;
      }
    }
    if (victimIdx >= 0) {
      const [victim] = current.splice(victimIdx, 1);
      try {
        fs.unlinkSync(victim.path);
      } catch (e) {
        console.warn(`Не удалось удалить файл ${victim.path}: ${e.message}`);
      }
    } else {
      break;
    }
  }
  if (current.length) {
    let minDist = Infinity;
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const d = hamming(current[i].hash, current[j].hash);
        if (d < minDist) minDist = d;
      }
    }
    if (minDist < warnDistance) {
      console.warn(
        `Внимание: минимальная дистанция между вариантами всего ${minDist}, можно поднять overshoot или диапазон трансформаций.`
      );
    }
  }
  return current;
}

export function findCloseIndices(items, historyHashes, threshold) {
  const result = [];
  for (let i = 0; i < items.length; i++) {
    let minDist = Infinity;
    historyHashes.forEach((h) => {
      const d = hamming(items[i].hash, h);
      if (d < minDist) minDist = d;
    });
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const d = hamming(items[i].hash, items[j].hash);
      if (d < minDist) minDist = d;
    }
    if (minDist < threshold) result.push({ index: i, minDist });
  }
  return result.sort((a, b) => a.minDist - b.minDist);
}
