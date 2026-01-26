#!/usr/bin/env node
/**
 * Небольшой HTTP-сервер для plan-builder:
 *   - отдаёт index.html
 *   - эндпоинт /api/count-current — запускает bin/count-current-materials.js --json
 *
 * Запуск: node tools/plan-builder/server.js
 * После запуска открывайте http://localhost:3000
 */
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import fs from 'fs/promises';
import fsSync from 'fs';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import xlsx from 'xlsx';
import { readCurrentAdsFromXlsx } from '../../src/utils/currentAdsReader.js';
import { CITY_ALIASES } from '../../src/constants/materialAliases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const INDEX_PATH = path.join(__dirname, 'index.html');

const MATERIALS = [
  { id: 'karier_neseyan_nemyt_pesok', material: 'sand' },
  { id: 'karier_seyan_nemyt_pesok', material: 'sand' },
  { id: 'karier_seyan_myt_pesok_1.5', material: 'sand' },
  { id: 'karier_seyan_myt_pesok_2', material: 'sand' },
  { id: 'karier_seyan_myt_pesok_2.5', material: 'sand' },
  { id: 'scheben_vtorichnyi_5_20', material: 'rubble' },
  { id: 'scheben_vtorichnyi_40_70', material: 'rubble' }
];
const MATERIAL_TYPE_BY_ID = new Map(MATERIALS.map((m) => [m.id, m.material]));
const LOCATIONS = [
  'Московская обл., Бронницы, Магистральная ул., 3',
  'Московская обл., Чехов, ул. Чехова, 20Бк5',
  'Московская обл., Подольск, ул. Лапшенкова, 3',
  'Москва, Троицк, Индустриальная ул., 1',
  'Московская обл., Домодедово, Станционная ул., 26к3'
];

function normalizeAddress(address) {
  return String(address || '')
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/\uFFFD/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALL_LOCATION_NAMES = LOCATIONS.map(normalizeAddress);
const RUBBLE_LOCATION_NAMES = ALL_LOCATION_NAMES.filter(
  (name) => name.includes('Подольск') || name.includes('Домодедово')
);
const ALLOWED_BY_TYPE = {
  sand: new Set(ALL_LOCATION_NAMES),
  rubble: new Set(RUBBLE_LOCATION_NAMES)
};

function sanitizePlan(plan) {
  if (!plan || !Array.isArray(plan.publicationQueue)) return { plan, removed: [] };
  const removed = [];
  const cleanedQueue = plan.publicationQueue
    .map((item) => {
      const location = normalizeAddress(item.location);
      const materialType = MATERIAL_TYPE_BY_ID.get(item.materialId) || 'sand';
      const allowed = ALLOWED_BY_TYPE[materialType] || ALLOWED_BY_TYPE.sand;
      if (!allowed.has(location)) {
        removed.push(item.location);
        return null;
      }
      return { ...item, location };
    })
    .filter(Boolean);

  const counts = new Map();
  const order = [];
  cleanedQueue.forEach((item) => {
    const key = `${item.materialId}::${item.location}`;
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const tasks = order.map((key) => {
    const [materialId, location] = key.split('::');
    const count = counts.get(key) || 0;
    const material = MATERIAL_TYPE_BY_ID.get(materialId) || 'sand';
    return {
      material,
      materialId,
      count,
      locations: [{ address: location, count }]
    };
  });

  return {
    plan: {
      ...plan,
      tasks,
      publicationQueue: cleanedQueue
    },
    removed: Array.from(new Set(removed)).filter(Boolean)
  };
}

function findSingleXlsx(dir) {
  const files = fsSync.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xlsx'));
  if (files.length === 0) {
    throw new Error(`Нет .xlsx в ${dir}`);
  }
  if (files.length > 1) {
    throw new Error(`Нашлось несколько .xlsx в ${dir}, укажите нужный вручную`);
  }
  return path.join(dir, files[0]);
}

function buildCityNames() {
  const names = new Set();
  Object.keys(CITY_ALIASES).forEach((addr) => {
    const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts[1]) names.add(parts[1]);
  });
  return Array.from(names);
}

function hasLocality(address, cityNames) {
  const text = String(address || '').toLowerCase();
  return cityNames.some((city) => text.includes(city.toLowerCase()));
}

function detectHeaderRow(rows = []) {
  if (rows.length >= 2) {
    const headerRow1 = rows[1] || [];
    if (headerRow1.some((cell) =>
      String(cell || '').toLowerCase().includes('уникальный идентификатор объявления')
    )) {
      return { headerRowIndex: 1, dataStartIndex: 2 };
    }
  }
  if (rows.length >= 1) {
    const headerRow0 = rows[0] || [];
    if (headerRow0.some((cell) =>
      String(cell || '').toLowerCase() === 'id' ||
      String(cell || '').toLowerCase() === 'avitoid'
    )) {
      return { headerRowIndex: 0, dataStartIndex: 1 };
    }
  }
  return { headerRowIndex: -1, dataStartIndex: -1 };
}

function toKey(header = '') {
  return header
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .toLowerCase();
}

function runCountScript() {
  return new Promise((resolve, reject) => {
    const script = path.join(ROOT, 'bin', 'count-current-materials.js');
    execFile(
      'node',
      [script, '--json'],
      { cwd: ROOT, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new Error(stderr?.toString() || error.message || 'count script failed')
          );
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Не удалось распарсить вывод count-current-materials.js: ${e.message}`));
        }
      }
    );
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Слишком большой запрос'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(data || '{}');
        resolve(parsed);
      } catch (e) {
        reject(new Error('Некорректный JSON'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/count-current') {
      const data = await runCountScript();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return;
    }

    if (req.url === '/api/check-addresses') {
      const currentDir = path.join(ROOT, 'data', 'current');
      const xlsxPath = findSingleXlsx(currentDir);
      const cityNames = buildCityNames();
      const workbook = xlsx.readFile(xlsxPath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      const { headerRowIndex, dataStartIndex } = detectHeaderRow(rows);
      if (headerRowIndex === -1) {
        throw new Error('Не удалось найти заголовки в Excel');
      }
      const headers = (rows[headerRowIndex] || []).map((h) => toKey(String(h || '')));
      const addressIdx = headers.findIndex((h) => h === 'адрес' || h === 'address');
      if (addressIdx === -1) {
        throw new Error('Не найден столбец Address/Адрес в Excel');
      }
      const bad = [];
      for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        const addr = String(row[addressIdx] || '').trim();
        if (!addr) continue;
        if (!hasLocality(addr, cityNames)) {
          bad.push({
            address: addr,
            row: i + 1
          });
        }
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          file: path.basename(xlsxPath),
          total: rows.length - dataStartIndex,
          issues: bad,
          issueCount: bad.length
        })
      );
      return;
    }

    if (req.url === '/api/save-plan' && req.method === 'POST') {
      const rawPlan = await readJsonBody(req);
      const { plan, removed } = sanitizePlan(rawPlan);
      const planPath = path.join(ROOT, 'data', 'plan.json');
      await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, path: planPath, removedInvalidLocations: removed }));
      return;
    }

    if (req.url === '/api/current-ids') {
      const currentDir = path.join(ROOT, 'data', 'current');
      const xlsxPath = findSingleXlsx(currentDir);
      const ads = await readCurrentAdsFromXlsx(xlsxPath);
      const ids = Array.from(
        new Set(
          (ads || [])
            .map((a) => a.Id || a.AvitoId)
            .filter(Boolean)
            .map((v) => String(v))
        )
      );
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ total: ids.length, ids }));
      return;
    }

    if (req.url === '/api/save-update-rules' && req.method === 'POST') {
      const rules = await readJsonBody(req);
      const rulesPath = path.join(ROOT, 'update_old_ads.json');
      await fs.writeFile(rulesPath, JSON.stringify(rules, null, 2), 'utf-8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, path: rulesPath }));
      return;
    }

    // Отдаём index.html (и всё, что находится рядом с ним)
    let filePath = INDEX_PATH;
    if (req.url && req.url !== '/' && !req.url.startsWith('/api/')) {
      const safePath = req.url.split('?')[0].replace(/^\//, '');
      filePath = path.join(__dirname, safePath);
    }
    const content = await readFile(filePath);
    res.statusCode = 200;
    const ext = path.extname(filePath);
    const mime =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.js'
          ? 'application/javascript; charset=utf-8'
          : ext === '.css'
            ? 'text/css; charset=utf-8'
            : 'text/plain; charset=utf-8';
    res.setHeader('Content-Type', mime);
    res.end(content);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Ошибка: ${e.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Plan-builder server запущен: http://localhost:${PORT}`);
});
