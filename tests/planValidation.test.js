import assert from 'assert';
import {
  validatePlanCounts,
  validatePlanWindows,
  validatePlanStepIntervals,
  parseDateTime,
  isWithinAllowedWindow
} from '../bin/build-feed.js';

function shouldThrow(fn, messageIncludes = '') {
  let thrown = false;
  try {
    fn();
  } catch (e) {
    thrown = true;
    if (messageIncludes && !String(e.message).includes(messageIncludes)) {
      throw new Error(`Ожидалась ошибка, содержащая "${messageIncludes}", но получено "${e.message}"`);
    }
  }
  if (!thrown) {
    throw new Error('Ожидалось исключение, но оно не было брошено');
  }
}

// validatePlanCounts: расхождение между задачами и очередью
shouldThrow(() => {
  validatePlanCounts(
    {
      tasks: [{ materialId: 'sand', count: 1, locations: [{ address: 'A', count: 1 }] }],
      publicationQueue: [{ materialId: 'sand', location: 'A' }, { materialId: 'sand', location: 'A' }]
    },
    { materials: {}, addresses: {} }
  );
}, 'План не совпадает');

// validatePlanWindows: недопустимое время
shouldThrow(() => {
  validatePlanWindows([{ DateBegin: '19.12.2025 03:00', materialId: 'sand', location: 'A' }]);
}, 'DateBegin вне допустимых окон');

// validatePlanStepIntervals: слишком маленький шаг
shouldThrow(() => {
  validatePlanStepIntervals([
    { DateBegin: '19.12.2025 07:00' },
    { DateBegin: '19.12.2025 07:02' }
  ], 5, 30);
}, 'Шаг между публикациями');

// parseDateTime + isWithinAllowedWindow: базовые проверки
const dt = parseDateTime('19.12.2025 07:15');
assert.ok(dt instanceof Date && !Number.isNaN(dt.getTime()), 'parseDateTime не вернул дату');
assert.ok(isWithinAllowedWindow(dt), 'Время должно быть в окне 07:00–10:00');

console.log('planValidation.test.js: OK');
