import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NotebookError } from './errors.js';

export const MEMORY_KINDS = new Set([
  'profile', 'goal', 'preference', 'strength', 'weakness', 'misconception', 'strategy', 'fact',
]);
export const GLOBAL_KINDS = new Set(['profile', 'goal', 'preference', 'strength', 'weakness', 'misconception']);

const MAX_TOPIC = 140;
const MAX_TITLE = 240;
const MAX_BODY = 4000;

const SCHEMA = `
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    kind TEXT NOT NULL,
    topic TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.7,
    source TEXT NOT NULL DEFAULT '',
    notebook_id TEXT NOT NULL DEFAULT '',
    notebook_title TEXT NOT NULL DEFAULT '',
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    last_used TEXT,
    uses INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS memories_fingerprint ON memories(fingerprint);
  CREATE INDEX IF NOT EXISTS memories_kind ON memories(kind);
  CREATE INDEX IF NOT EXISTS memories_topic ON memories(topic);
  CREATE INDEX IF NOT EXISTS memories_notebook ON memories(notebook_id);
  CREATE TABLE IF NOT EXISTS topic_contrib (
    notebook_id TEXT NOT NULL,
    notebook_title TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    topic TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    correct INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    lessons INTEGER NOT NULL DEFAULT 0,
    last TEXT NOT NULL,
    PRIMARY KEY (notebook_id, key)
  );
  CREATE TABLE IF NOT EXISTS topic_stats (
    key TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    correct INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    lessons INTEGER NOT NULL DEFAULT 0,
    last TEXT NOT NULL,
    notebooks TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

function text(value, label, max, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string') throw new NotebookError(`${label} must be text.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max) {
    throw new NotebookError(`${label} must have ${optional ? 'at most' : '1 to'} ${max.toLocaleString()} characters.`);
  }
  return result;
}

export function memoryKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function fingerprint(kind, topic, title) {
  return createHash('sha1').update(`${kind}|${memoryKey(topic)}|${memoryKey(title)}`).digest('hex');
}

function now() {
  return new Date().toISOString();
}

function toRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    topic: row.topic,
    subject: row.subject,
    title: row.title,
    body: row.body,
    confidence: row.confidence,
    source: row.source,
    notebookId: row.notebook_id,
    notebookTitle: row.notebook_title,
    created: row.created,
    updated: row.updated,
    lastUsed: row.last_used,
    uses: row.uses,
  };
}

function masteryFor(correct, total) {
  if (!total) return 0;
  return Math.round(100 * (correct / total) * Math.min(1, total / 4));
}

function stateFor(correct, total) {
  if (!total) return 'not-started';
  const accuracy = correct / total;
  if ((total >= 3 && accuracy >= 0.75) || (total >= 2 && accuracy >= 0.85)) return 'strength';
  if (accuracy < 0.6) return 'focus';
  return 'developing';
}

function trimBody(value, max = 700) {
  const body = String(value ?? '').replace(/\s+/g, ' ').trim();
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}

function scoreRow(row, query, topics) {
  const topic = memoryKey(row.topic);
  let score = 0;
  for (const item of topics ?? []) {
    const key = memoryKey(item);
    if (topic === key) score += 8;
    else if (topic.includes(key) || key.includes(topic)) score += 4;
  }
  const words = String(query ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  if (words.length) {
    const haystack = memoryKey(`${row.topic} ${row.title} ${row.body}`);
    for (const word of words) if (haystack.includes(word)) score += word.length > 3 ? 2 : 1;
  }
  if (row.kind === 'misconception') score += 1;
  if (row.kind === 'weakness') score += 0.5;
  return score;
}

export class MemoryStore {
  constructor(path, { scope = 'notebook' } = {}) {
    this.path = path;
    this.scope = scope;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  add(input) {
    const kind = MEMORY_KINDS.has(input?.kind) ? input.kind : 'fact';
    const topic = text(input?.topic ?? 'General', 'Memory topic', MAX_TOPIC);
    const body = text(input?.body, 'Memory text', MAX_BODY);
    const title = text(input?.title ?? body.slice(0, 120), 'Memory title', MAX_TITLE);
    const confidence = Number(input?.confidence);
    const stamp = now();
    const value = {
      id: randomUUID(),
      fingerprint: fingerprint(kind, topic, title),
      kind,
      topic,
      subject: text(input?.subject ?? '', 'Memory subject', 200, true),
      title,
      body,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
      source: text(input?.source ?? '', 'Memory source', 240, true),
      notebookId: text(input?.notebookId ?? '', 'Notebook id', 120, true),
      notebookTitle: text(input?.notebookTitle ?? '', 'Notebook title', 200, true),
      created: stamp,
      updated: stamp,
    };
    this.db.prepare(`
      INSERT INTO memories (id, fingerprint, kind, topic, subject, title, body, confidence, source,
        notebook_id, notebook_title, created, updated, last_used, uses)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
      ON CONFLICT(fingerprint) DO UPDATE SET
        body = CASE WHEN excluded.body <> '' THEN excluded.body ELSE memories.body END,
        confidence = MAX(memories.confidence, excluded.confidence),
        subject = CASE WHEN excluded.subject <> '' THEN excluded.subject ELSE memories.subject END,
        source = CASE WHEN excluded.source <> '' THEN excluded.source ELSE memories.source END,
        notebook_id = CASE WHEN excluded.notebook_id <> '' THEN excluded.notebook_id ELSE memories.notebook_id END,
        notebook_title = CASE WHEN excluded.notebook_title <> '' THEN excluded.notebook_title ELSE memories.notebook_title END,
        updated = excluded.updated
    `).run(value.id, value.fingerprint, value.kind, value.topic, value.subject, value.title, value.body,
      value.confidence, value.source, value.notebookId, value.notebookTitle, value.created, value.updated);
    return this.getByFingerprint(value.fingerprint);
  }

  getByFingerprint(value) {
    return toRecord(this.db.prepare('SELECT * FROM memories WHERE fingerprint = ?').get(value));
  }

  get(id) {
    return toRecord(this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
  }

  update(id, input) {
    const row = this.get(id);
    if (!row) throw new NotebookError('Memory was removed or could not be found.', 404);
    const kind = MEMORY_KINDS.has(input?.kind) ? input.kind : row.kind;
    const topic = text(input?.topic ?? row.topic, 'Memory topic', MAX_TOPIC);
    const title = text(input?.title ?? row.title, 'Memory title', MAX_TITLE);
    const body = text(input?.body ?? row.body, 'Memory text', MAX_BODY);
    const confidence = Number(input?.confidence);
    try {
      this.db.prepare(`UPDATE memories SET fingerprint = ?, kind = ?, topic = ?, title = ?, body = ?,
        confidence = ?, updated = ? WHERE id = ?`).run(
        fingerprint(kind, topic, title), kind, topic, title, body,
        Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : row.confidence,
        now(), id,
      );
    } catch (error) {
      if (/UNIQUE|CONSTRAINT/i.test(String(error?.code ?? error?.message ?? ''))) {
        throw new NotebookError('Another memory already uses that kind, topic, and headline.', 409);
      }
      throw error;
    }
    return this.get(id);
  }

  list({ kinds, limit = 250 } = {}) {
    const allowed = Array.isArray(kinds) && kinds.length ? kinds.filter((kind) => MEMORY_KINDS.has(kind)) : null;
    const rows = allowed
      ? this.db.prepare(`SELECT * FROM memories WHERE kind IN (${allowed.map(() => '?').join(',')})
          ORDER BY updated DESC LIMIT ?`).all(...allowed, Math.max(1, Math.min(1000, limit)))
      : this.db.prepare('SELECT * FROM memories ORDER BY updated DESC LIMIT ?').all(Math.max(1, Math.min(1000, limit)));
    return rows.map(toRecord);
  }

  profile(limit = 8) {
    return this.list({ kinds: ['profile', 'goal', 'preference'], limit });
  }

  search(query, { limit = 12, topics = [] } = {}) {
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY updated DESC LIMIT 1000').all().map(toRecord);
    return rows
      .map((row) => ({ row, score: scoreRow(row, query, topics) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.row.updated.localeCompare(a.row.updated))
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map((item) => item.row);
  }

  context({ query = '', topics = [], limit = 10 } = {}) {
    const rows = this.search(query, { limit, topics });
    const ids = rows.map((row) => row.id);
    if (ids.length) {
      const stamp = now();
      this.db.prepare(`UPDATE memories SET last_used = ?, uses = uses + 1
        WHERE id IN (${ids.map(() => '?').join(',')})`).run(stamp, ...ids);
    }
    return rows;
  }

  remove(id) {
    const row = this.db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
    if (!row) throw new NotebookError('Memory was removed or could not be found.', 404);
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return true;
  }

  removeByFingerprint(value) {
    this.db.prepare('DELETE FROM memories WHERE fingerprint = ?').run(value);
  }

  removeKindTopic(kind, topic, notebookId = '') {
    if (notebookId) {
      this.db.prepare('DELETE FROM memories WHERE kind = ? AND lower(topic) = lower(?) AND notebook_id = ?')
        .run(kind, topic, notebookId);
    } else {
      this.db.prepare('DELETE FROM memories WHERE kind = ? AND lower(topic) = lower(?)').run(kind, topic);
    }
  }

  clear() {
    this.db.prepare('DELETE FROM memories').run();
    this.db.prepare('DELETE FROM topic_contrib').run();
    this.db.prepare('DELETE FROM topic_stats').run();
  }

  recordTopic({ notebookId, notebookTitle = '', subject = '', topic, correct = 0, total = 0, lessons = 0, at = now() }) {
    const name = text(topic, 'Topic', MAX_TOPIC);
    const key = memoryKey(name);
    const owner = text(notebookId ?? '', 'Notebook id', 120, true) || this.path;
    const correctValue = Math.max(0, Math.round(Number(correct) || 0));
    const totalValue = Math.max(0, Math.round(Number(total) || 0));
    const lessonValue = Math.max(0, Math.round(Number(lessons) || 0));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO topic_contrib (notebook_id, notebook_title, key, topic, subject, correct, total, lessons, last)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(notebook_id, key) DO UPDATE SET
          notebook_title = CASE WHEN excluded.notebook_title <> '' THEN excluded.notebook_title ELSE topic_contrib.notebook_title END,
          topic = excluded.topic,
          subject = CASE WHEN excluded.subject <> '' THEN excluded.subject ELSE topic_contrib.subject END,
          correct = topic_contrib.correct + excluded.correct,
          total = topic_contrib.total + excluded.total,
          lessons = topic_contrib.lessons + excluded.lessons,
          last = excluded.last
      `).run(owner, text(notebookTitle ?? '', 'Notebook title', 200, true), key, name,
        text(subject ?? '', 'Subject', 200, true), correctValue, totalValue, lessonValue, at);
      this.recomputeTopic(key);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recomputeTopic(key) {
    const rows = this.db.prepare('SELECT * FROM topic_contrib WHERE key = ?').all(key);
    if (!rows.length) {
      this.db.prepare('DELETE FROM topic_stats WHERE key = ?').run(key);
      return;
    }
    const correct = rows.reduce((sum, row) => sum + row.correct, 0);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const lessons = rows.reduce((sum, row) => sum + row.lessons, 0);
    const last = rows.reduce((value, row) => row.last > value ? row.last : value, '');
    const topic = rows[rows.length - 1].topic;
    const names = [...new Set(rows.map((row) => row.notebook_title || row.notebook_id).filter(Boolean))];
    const label = rows.find((row) => row.subject)?.subject || '';
    this.db.prepare(`
      INSERT INTO topic_stats (key, topic, subject, correct, total, lessons, last, notebooks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        topic = excluded.topic,
        subject = CASE WHEN excluded.subject <> '' THEN excluded.subject ELSE topic_stats.subject END,
        correct = excluded.correct,
        total = excluded.total,
        lessons = excluded.lessons,
        last = excluded.last,
        notebooks = excluded.notebooks
    `).run(key, topic, label, correct, total, lessons, last, JSON.stringify(names));
  }

  topicStats(limit = 24) {
    return this.db.prepare('SELECT * FROM topic_stats ORDER BY total DESC, last DESC LIMIT ?')
      .all(Math.max(1, Math.min(200, limit)))
      .map((row) => {
        let notebooks = [];
        try { notebooks = JSON.parse(row.notebooks); } catch { /* Keep an empty list. */ }
        return {
          topic: row.topic,
          subject: row.subject,
          correct: row.correct,
          total: row.total,
          lessons: row.lessons,
          accuracy: row.total ? row.correct / row.total : 0,
          mastery: masteryFor(row.correct, row.total),
          state: stateFor(row.correct, row.total),
          last: row.last,
          notebooks,
        };
      });
  }

  metaGet(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
  }

  metaSet(key, value = '1') {
    this.db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }

  removeNotebook(notebookId) {
    if (!notebookId) return;
    const keys = this.db.prepare('SELECT DISTINCT key FROM topic_contrib WHERE notebook_id = ?').all(notebookId).map((row) => row.key);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM memories WHERE notebook_id = ?').run(notebookId);
      this.db.prepare('DELETE FROM topic_contrib WHERE notebook_id = ?').run(notebookId);
      for (const key of keys) this.recomputeTopic(key);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  markdown({ limit = 80 } = {}) {
    const rows = this.list({ limit });
    const stats = this.topicStats(24);
    const lines = ['# Learner memory', ''];
    const groups = [
      ['goal', 'Goals'], ['preference', 'Preferences'], ['profile', 'Profile'],
      ['strength', 'Strengths'], ['weakness', 'Focus areas'], ['misconception', 'Misconceptions'],
      ['strategy', 'What works'], ['fact', 'Notes'],
    ];
    for (const [kind, title] of groups) {
      const items = rows.filter((row) => row.kind === kind);
      if (!items.length) continue;
      lines.push(`## ${title}`, '');
      for (const item of items) {
        lines.push(`- **${item.topic}** — ${item.title}${item.notebookTitle ? ` (${item.notebookTitle})` : ''}`,
          `  ${trimBody(item.body, 600)}`);
      }
      lines.push('');
    }
    if (stats.length) {
      lines.push('## Mastery', '', '| Topic | Accuracy | Questions | Lessons | Notebooks |', '| --- | ---: | ---: | ---: | --- |');
      for (const item of stats) {
        const names = item.notebooks.length ? item.notebooks.join(', ') : '—';
        lines.push(`| ${item.topic.replaceAll('|', '/')} | ${Math.round(item.accuracy * 100)}% | ${item.total} | ${item.lessons} | ${names.replaceAll('|', '/')} |`);
      }
      lines.push('');
    }
    if (lines.length === 2) lines.push('No learner memories yet.', '');
    return lines.join('\n');
  }

  brief(limit = 40) {
    const rows = this.list({ limit });
    const stats = this.topicStats(12);
    const lines = [];
    for (const row of rows) lines.push(`- [${row.kind}] ${row.topic}: ${row.title} — ${trimBody(row.body, 300)}`);
    if (stats.length) {
      lines.push('', 'Mastery:');
      for (const item of stats) {
        lines.push(`- ${item.topic}: ${Math.round(item.accuracy * 100)}% over ${item.total} questions${item.lessons ? `, ${item.lessons} lessons` : ''}`);
      }
    }
    return lines.join('\n');
  }

  close() {
    try { this.db.close(); } catch { /* Already closed. */ }
  }
}

export class LearnerMemory {
  constructor(root) {
    this.root = root;
    this.dir = join(root, 'learner');
    mkdirSync(this.dir, { recursive: true });
    this.global = new MemoryStore(join(this.dir, 'memory.sqlite'), { scope: 'global' });
    this.books = new Map();
  }

  notebook(bookId, folder) {
    if (this.books.has(bookId)) return this.books.get(bookId);
    const store = new MemoryStore(join(folder, 'memory.sqlite'), { scope: 'notebook' });
    this.books.set(bookId, store);
    return store;
  }

  hasNotebook(bookId) {
    return this.books.has(bookId);
  }

  context(book, query = '') {
    const topics = (book.study?.map?.topics ?? []).map((item) => item.title);
    const profile = this.global.profile(8);
    const acrossNotebooks = this.global.context({ query, topics, limit: 10 });
    const thisNotebook = this.hasNotebook(book.id)
      ? this.books.get(book.id).context({ query, topics, limit: 10 })
      : [];
    const mastery = this.global.topicStats(12);
    assertSize({ profile, acrossNotebooks, thisNotebook, mastery });
    return { profile, acrossNotebooks, thisNotebook, mastery };
  }

  rememberAttempt(book, assessment, answers) {
    if (!assessment?.data?.questions?.length || !Array.isArray(answers)) return;
    const store = this.hasNotebook(book.id) ? this.books.get(book.id) : null;
    if (!store) return;
    const byTopic = new Map();
    let wrong = 0;
    for (const [index, item] of assessment.data.questions.entries()) {
      const topic = item.topic || 'General';
      const chosen = item.options[answers[index]];
      const correct = item.answer === answers[index];
      const summary = byTopic.get(memoryKey(topic)) ?? { topic, correct: 0, total: 0 };
      summary.correct += correct ? 1 : 0;
      summary.total += 1;
      byTopic.set(memoryKey(topic), summary);
      if (!correct && wrong < 4) {
        wrong += 1;
        const body = `Question: ${item.question}\nChosen: ${chosen ?? '—'}\nCorrect: ${item.options[item.answer]}\n${item.explanation ?? ''}`;
        const value = {
          kind: 'misconception', topic, title: item.question.slice(0, 240), body: body.slice(0, 4000),
          confidence: 0.65, source: `Quiz: ${book.title}`, subject: book.title,
          notebookId: book.id, notebookTitle: book.title,
        };
        store.add(value);
        this.global.add(value);
      }
    }
    this.rememberTopics(book, [...byTopic.values()]);
    this.global.metaSet(`backfill:${book.id}:${assessment.id}`);
    this.writeGlobalFile();
  }

  rememberTopics(book, topics) {
    const store = this.hasNotebook(book.id) ? this.books.get(book.id) : null;
    if (!store) return;
    for (const summary of topics ?? []) {
      if (!summary?.topic || !summary.total) continue;
      store.recordTopic({ notebookId: book.id, notebookTitle: book.title, subject: book.title, ...summary });
      this.global.recordTopic({ notebookId: book.id, notebookTitle: book.title, subject: book.title, ...summary });
      const accuracy = summary.correct / summary.total;
      const title = `${book.title}: ${summary.topic}`;
      const body = `Accuracy ${Math.round(accuracy * 100)}% across ${summary.total} question${summary.total === 1 ? '' : 's'} in ${book.title}.`;
      if (summary.total >= 3 && accuracy >= 0.75) {
        const value = { kind: 'strength', topic: summary.topic, title, body, confidence: 0.7,
          source: 'Quiz results', subject: book.title, notebookId: book.id, notebookTitle: book.title };
        store.removeKindTopic('weakness', summary.topic, book.id);
        this.global.removeKindTopic('weakness', summary.topic, book.id);
        store.add(value);
        this.global.add(value);
      } else if (summary.total >= 3 && accuracy < 0.6) {
        const value = { kind: 'weakness', topic: summary.topic, title, body, confidence: 0.7,
          source: 'Quiz results', subject: book.title, notebookId: book.id, notebookTitle: book.title };
        store.removeKindTopic('strength', summary.topic, book.id);
        this.global.removeKindTopic('strength', summary.topic, book.id);
        store.add(value);
        this.global.add(value);
      }
    }
    this.writeGlobalFile();
  }

  rememberLesson(book, unit) {
    const store = this.hasNotebook(book.id) ? this.books.get(book.id) : null;
    if (!store || !unit) return;
    for (const topic of unit.topics ?? []) {
      store.recordTopic({ notebookId: book.id, notebookTitle: book.title, subject: book.title, topic, lessons: 1 });
      this.global.recordTopic({ notebookId: book.id, notebookTitle: book.title, subject: book.title, topic, lessons: 1 });
    }
    store.add({
      kind: 'fact', topic: unit.topics?.[0] || 'Lesson', title: `Completed: ${unit.title}`,
      body: `${unit.objective ?? ''}\nTopics: ${(unit.topics ?? []).join(', ')}`,
      confidence: 1, source: 'Lesson', subject: book.title, notebookId: book.id, notebookTitle: book.title,
    });
    this.writeGlobalFile();
  }

  rememberGoal(book) {
    if (!book?.study?.goal) return;
    const study = book.study;
    this.global.add({
      kind: 'goal', topic: 'Learning goal', title: `${book.title}: learning goal`,
      body: `${study.goal}\nLevel: ${study.level ?? 'intermediate'} · Daily: ${study.dailyMinutes ?? 20} min${study.examDate ? ` · Target: ${study.examDate}` : ''}`,
      confidence: 1, source: 'Notebook setup', subject: book.title,
      notebookId: book.id, notebookTitle: book.title,
    });
    this.writeGlobalFile();
  }

  rememberPreferences(book) {
    const value = fingerprint('preference', 'Preferences', `${book.title}: preferences`);
    if (!book?.instructions?.trim()) {
      this.global.removeByFingerprint(value);
    } else {
      this.global.add({
        kind: 'preference', topic: 'Preferences', title: `${book.title}: preferences`,
        body: book.instructions, confidence: 0.9, source: 'Notebook settings',
        subject: book.title, notebookId: book.id, notebookTitle: book.title,
      });
    }
    this.writeGlobalFile();
  }

  rememberExtracted(book, items) {
    const store = this.hasNotebook(book.id) ? this.books.get(book.id) : null;
    if (!store || !Array.isArray(items)) return [];
    const saved = [];
    for (const item of items.slice(0, 6)) {
      if (!item || !MEMORY_KINDS.has(item.kind) || typeof item.body !== 'string' || !item.body.trim()) continue;
      const value = {
        kind: item.kind, topic: item.topic || 'General', title: item.title || item.body.slice(0, 120),
        body: item.body, confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.6,
        source: 'Conversation', subject: book.title, notebookId: book.id, notebookTitle: book.title,
      };
      try {
        saved.push(store.add(value));
        if (GLOBAL_KINDS.has(value.kind)) this.global.add(value);
      } catch { /* Skip a malformed extracted memory. */ }
    }
    this.writeGlobalFile();
    return saved;
  }

  list(scope, book, folder) {
    const store = scope === 'global' ? this.global : book && folder ? this.notebook(book.id, folder) : null;
    if (!store) return { memories: [], topics: [] };
    return { memories: store.list(), topics: store.topicStats(24) };
  }

  save(scope, book, input, folder) {
    const store = scope === 'global' ? this.global : book && folder ? this.notebook(book.id, folder) : null;
    if (!store) throw new NotebookError('Open a notebook first.');
    if (input.memoryId) {
      const value = store.update(input.memoryId, input);
      this.writeGlobalFile();
      return value;
    }
    const value = store.add({
      ...input,
      notebookId: scope === 'global' ? input.notebookId ?? book?.id : book?.id,
      notebookTitle: scope === 'global' ? input.notebookTitle ?? book?.title : book?.title,
      subject: input.subject ?? book?.title,
    });
    this.writeGlobalFile();
    return value;
  }

  remove(scope, book, memoryId, folder) {
    const store = scope === 'global' ? this.global : book && folder ? this.notebook(book.id, folder) : null;
    if (!store) throw new NotebookError('Open a notebook first.');
    const result = store.remove(memoryId);
    this.writeGlobalFile();
    return result;
  }

  removeNotebook(bookId) {
    this.global.removeNotebook(bookId);
    const store = this.books.get(bookId);
    if (store) {
      try { store.close(); } catch { /* Already closed. */ }
      this.books.delete(bookId);
    }
    this.writeGlobalFile();
  }

  writeGlobalFile() {
    try { writeFileSync(join(this.dir, 'memory.md'), this.global.markdown()); } catch { /* Best effort. */ }
  }

  writeNotebookFile(folder, book) {
    try {
      const store = this.books.get(book.id);
      const lines = ['# Learner memory', '', 'This file is generated by Deep Notebook for the study agent.', ''];
      if (store) lines.push('## This notebook', '', store.markdown(), '');
      lines.push('## Across notebooks', '', this.global.brief(30), '');
      writeFileSync(join(folder, 'workspace', 'memory.md'), lines.join('\n'));
    } catch { /* Best effort. */ }
  }

  brief(book) {
    const store = this.books.get(book.id);
    const lines = [];
    if (store) lines.push('### This notebook', '', store.brief(30), '');
    lines.push('### Across notebooks', '', this.global.brief(20), '');
    return lines.join('\n');
  }

  close() {
    this.global.close();
    for (const store of this.books.values()) store.close();
    this.books.clear();
  }
}

function assertSize(value) {
  const size = JSON.stringify(value).length;
  if (size > 60_000) {
    // The prompt budget is more important than completeness.
    value.acrossNotebooks = value.acrossNotebooks.slice(0, 6);
    value.thisNotebook = value.thisNotebook.slice(0, 6);
    value.mastery = value.mastery.slice(0, 8);
  }
}
