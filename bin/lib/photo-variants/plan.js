import fs from 'fs';
import path from 'path';
import { DEFAULT_PHOTOS_ROOT } from './constants.js';
import { formatAddressLabel, sanitizeName } from './utils.js';

export function collectSourcesFromPlan(plan, aliases = { materials: {}, photos: {} }) {
  if (!plan || !Array.isArray(plan.tasks)) return [];
  const tasks = plan.tasks || [];
  const photoAliases = aliases.photos || {};
  const materialAliases = aliases.materials || {};
  const folders = new Map();
  const addrCounts = new Map();

  tasks.forEach((t) => {
    const materialId = materialAliases[t.materialId] || t.materialId;
    const photoKey = t.photoKey || materialId;
    const slots = t.slots && t.slots.length ? t.slots : [{ locations: t.locations }];
    slots.forEach((slot) => {
      const locs = (slot.locations && slot.locations.length ? slot.locations : [{ address: 'default' }]) || [
        { address: 'default' }
      ];
      locs.forEach((loc) => {
        const addrRaw = loc.address || 'default';
        const addrFormatted = formatAddressLabel(addrRaw);
        const safeAddress = sanitizeName(addrFormatted);
        const countKey = `${materialId || ''}|${safeAddress}`;
        const addCount = Number(loc.count) || Number(slot.count) || Number(t.count) || 0;
        addrCounts.set(countKey, (addrCounts.get(countKey) || 0) + addCount);
        const resolved =
          photoAliases[photoKey] || path.join(DEFAULT_PHOTOS_ROOT, materialId || photoKey, 'originals');
        const folderKey = `${resolved}|${safeAddress}`;
        folders.set(folderKey, {
          materialId,
          name: t.materialId || materialId,
          address: safeAddress,
          folder: resolved
        });
      });
    });
  });

  const sources = [];
  folders.forEach((info) => {
    if (fs.existsSync(info.folder)) {
      const files = fs
        .readdirSync(info.folder)
        .filter((name) => name.match(/\.(jpg|jpeg|png|webp)$/i))
        .map((name) => ({
          path: path.join(info.folder, name),
          materialId: info.materialId,
          name: info.name,
          address: info.address,
          count: addrCounts.get(`${info.materialId || ''}|${info.address}`) || 0
        }));
      sources.push(...files);
    }
  });
  return sources;
}
