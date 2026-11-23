import { readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LEVELS, newStudy } from './store.js';
import { recordQuizAttempt } from './study.js';

const MEMORY_KINDS = new Set(['strength', 'weakness', 'misconception', 'preference', 'goal', 'strategy', 'fact']);

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Apply one reported record to the notebook. Throws when the record is invalid
 * so the caller can keep it out of the notebook.
 */
export function applyRecord(store, book, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Record must be an object.');
  const action = cleanText(value.action, 40);

  if (action === 'goal') {
    const goal = cleanText(value.goal, 1800);
    if (!goal) throw new Error('Goal is required.');
    book.study ??= newStudy();
    book.study.goal = goal;
    if (LEVELS.has(value.level)) book.study.level = value.level;
    const minutes = Number(value.dailyMinutes);
    if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 180) book.study.dailyMinutes = minutes;
    const examDate = cleanText(value.examDate, 40);
    if (!examDate) book.study.examDate = '';
    else if (/^\d{4}-\d{2}-\d{2}$/.test(examDate)) book.study.examDate = examDate;
    if (Array.isArray(value.topics)) {
      book.study.goalTopics = value.topics
        .filter((item) => typeof item === 'string' && item.trim())
        .slice(0, 8).map((item) => item.trim().slice(0, 120));
    }
    book.study.building = '';
    book.study.buildingAt = '';
    book.study.buildError = '';
    return 'goal';
  }

  if (action === 'quiz_result') {
    book.study ??= newStudy();
    const attempt = recordQuizAttempt(book.study, value);
    store.rememberTopics(book, attempt.topics);
    return 'quiz';
  }

  if (action === 'lesson_done') {
    throw new Error('Lesson completion is manual. Do not report lesson_done.');
  }

  if (action === 'memory') {
    const body = cleanText(value.text, 4000);
    if (!body) throw new Error('Memory text is required.');
    const scope = value.scope === 'global' ? 'global' : 'notebook';
    const kind = MEMORY_KINDS.has(value.kind) ? value.kind : 'fact';
    store.memorySave(scope, scope === 'global' ? null : book, {
      kind,
      topic: cleanText(value.topic, 140) || 'General',
      title: cleanText(value.title, 240) || body.slice(0, 120),
      body,
    });
    return 'memory';
  }

  throw new Error('Unknown record action.');
}

function recordFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

/**
 * Import every pending report in the notebook workspace, then remove the files
 * that were applied. Invalid files are renamed with a `.bad` suffix and left
 * for inspection.
 */
export function syncRecords(store, id) {
  const folder = store.folderPath(id);
  if (!folder) return [];
  const dir = join(folder, 'workspace', 'agent', 'records');
  const names = recordFiles(dir);
  if (!names.length) return [];

  const done = [];
  const bad = [];
  store.update(id, (book) => {
    book.importedRecords ??= [];
    const seen = new Set(book.importedRecords);
    for (const name of names) {
      if (seen.has(name)) {
        done.push({ name, action: 'seen' });
        continue;
      }
      try {
        const value = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        const action = applyRecord(store, book, value);
        book.importedRecords.push(name);
        if (book.importedRecords.length > 500) book.importedRecords = book.importedRecords.slice(-500);
        done.push({ name, action });
      } catch {
        bad.push({ name });
      }
    }
  });

  for (const item of done) {
    try { rmSync(join(dir, item.name), { force: true }); } catch { /* Retried next time. */ }
  }
  for (const item of bad) {
    try {
      const target = join(dir, `${item.name}.bad`);
      rmSync(target, { force: true });
      renameSync(join(dir, item.name), target);
    } catch { /* Leave the file in place. */ }
  }
  return done.map((item) => item.action).filter((action) => action !== 'seen');
}
