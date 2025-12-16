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
      
      // Определяем общую папку для всех адресов этого слота
      const resolved =
        photoAliases[photoKey] || path.join(DEFAULT_PHOTOS_ROOT, materialId || photoKey, 'originals');
      
      // Распределяем slot.count между адресами
      // Если у адреса указан loc.count - используем его, иначе распределяем остаток
      const totalSlotCount = Number(slot.count) || Number(t.count) || 0;
      let remainingCount = totalSlotCount;
      const locCounts = new Map();
      
      // Сначала берем явно указанные count из loc.count
      locs.forEach((loc) => {
        const locCount = Number(loc.count);
        if (locCount > 0) {
          const addr = loc.address || 'default';
          locCounts.set(addr, locCount);
          remainingCount -= locCount;
        }
      });
      
      // Если остался count, распределяем его между адресами без явного count
      if (remainingCount > 0) {
        const locsWithoutCount = locs.filter(loc => !Number(loc.count));
        if (locsWithoutCount.length > 0) {
          const perLoc = Math.floor(remainingCount / locsWithoutCount.length);
          const remainder = remainingCount % locsWithoutCount.length;
          locsWithoutCount.forEach((loc, idx) => {
            const addr = loc.address || 'default';
            locCounts.set(addr, perLoc + (idx < remainder ? 1 : 0));
          });
        } else if (locs.length > 0 && totalSlotCount > 0) {
          // Если все адреса имеют count, но slot.count больше суммы - добавляем остаток к последнему
          const lastAddr = locs[locs.length - 1].address || 'default';
          locCounts.set(lastAddr, (locCounts.get(lastAddr) || 0) + remainingCount);
        }
      }
      
      // Если ни у кого нет count и нет slot.count - используем дефолтное распределение
      if (locCounts.size === 0 && totalSlotCount === 0) {
        const perLoc = Math.floor(1 / locs.length);
        const remainder = 1 % locs.length;
        locs.forEach((loc, idx) => {
          const addr = loc.address || 'default';
          locCounts.set(addr, perLoc + (idx < remainder ? 1 : 0));
        });
      }
      
      // Создаем записи для каждого адреса
      locs.forEach((loc) => {
        const addrRaw = loc.address || 'default';
        const addrFormatted = formatAddressLabel(addrRaw);
        const safeAddress = sanitizeName(addrFormatted);
        const countKey = `${materialId || ''}|${safeAddress}`;
        const addCount = locCounts.get(addrRaw) || 0;
        addrCounts.set(countKey, (addrCounts.get(countKey) || 0) + addCount);
        
        const folderKey = `${resolved}|${safeAddress}`;
        folders.set(folderKey, {
          materialId,
          name: t.materialId || materialId,
          address: addrFormatted,  // Исходный адрес для getCityAlias()
          safeAddress,              // Нормализованный
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
