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
      const dateBegin = slot.DateBegin || t.DateBegin || '';
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
          address: addrFormatted,  // Исходный адрес для getCityAlias()
          safeAddress,              // Нормализованный для путей
          folder: resolved,
          dateBegin
        });
      });
    });
  });

  const sources = [];
  folders.forEach((info) => {
    if (fs.existsSync(info.folder)) {
      const allFiles = fs
        .readdirSync(info.folder)
        .filter((name) => name.match(/\.(jpg|jpeg|png|webp)$/i));
      
      // Ищем флагманский исходник (с "fs" в имени)
      const flagshipFile = allFiles.find((name) => name.toLowerCase().includes('fs'));
      const flagshipPath = flagshipFile ? path.join(info.folder, flagshipFile) : null;
      
      // Общий count для локации делим между всеми исходниками
      const totalCount = addrCounts.get(`${info.materialId || ''}|${info.safeAddress}`) || 0;
      const countPerSource = allFiles.length > 0 ? Math.floor(totalCount / allFiles.length) : 0;
      const remainder = totalCount % allFiles.length;
      
      // ВСЕ файлы (включая флагманский) - он тоже генерирует варианты
      const files = allFiles.map((name, idx) => ({
        path: path.join(info.folder, name),
        materialId: info.materialId,
        name: info.name,
        address: info.address,           // Исходный адрес
        safeAddress: info.safeAddress,   // Нормализованный
        dateBegin: info.dateBegin,
        // Делим count между исходниками: первые получают +1 если есть остаток
        count: countPerSource + (idx < remainder ? 1 : 0),
        flagshipSource: flagshipPath     // Путь к флагманскому исходнику (для первого фото)
      }));
      sources.push(...files);
    }
  });
  return sources;
}

