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
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const INDEX_PATH = path.join(__dirname, 'index.html');

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

    if (req.url === '/api/save-plan' && req.method === 'POST') {
      const plan = await readJsonBody(req);
      const planPath = path.join(ROOT, 'data', 'plan.json');
      await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, path: planPath }));
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
