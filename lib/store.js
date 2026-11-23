import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NotebookError } from './errors.js';
import { LearnerMemory } from './memory.js';

export { NotebookError };

export const MAX_SOURCE = 600_000;
const MAX_BOOK = 48 * 1024 * 1024;
export const STUDY_VERSION = 2;
export const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);

export function text(value, label, max, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string') throw new NotebookError(`${label} must be text.`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max) {
    throw new NotebookError(`${label} must have ${optional ? 'at most' : '1 to'} ${max.toLocaleString()} characters.`);
  }
  return result;
}

export function find(items, id, label) {
  const match = items.find((item) => item.id === id);
  if (!match) throw new NotebookError(`${label} was removed or could not be found.`, 404);
  return match;
}

export function record(fields) {
  return { ...fields, id: randomUUID(), created: new Date().toISOString() };
}

export function newChat(title = 'New conversation') {
  return record({ title, messages: [] });
}

export function newStudy(goal = '') {
  return {
    version: STUDY_VERSION,
    goal,
    level: 'intermediate',
    dailyMinutes: 20,
    examDate: '',
    diagnostic: null,
    test: null,
    practice: null,
    map: null,
    plan: null,
    attempts: [],
    cards: [],
    reviews: [],
    sessions: [],
    threads: [],
  };
}

export function normalizeStudy(study) {
  if (!study) return null;
  study.version = STUDY_VERSION;
  study.goal ??= '';
  if (!LEVELS.has(study.level)) study.level = 'intermediate';
  if (!Number.isInteger(study.dailyMinutes)) study.dailyMinutes = 20;
  study.examDate ??= '';
  study.diagnostic ??= null;
  study.test ??= null;
  study.practice ??= null;
  study.map ??= null;
  study.plan ??= null;
  study.attempts ??= [];
  study.cards ??= [];
  study.reviews ??= [];
  study.sessions ??= [];
  study.threads ??= [];
  study.building ??= '';
  study.buildingAt ??= '';
  study.buildError ??= '';
  study.goalTopics ??= [];
  if (!Array.isArray(study.threads)) study.threads = [];
  for (const thread of study.threads) {
    thread.messages ??= [];
    if (!Array.isArray(thread.messages)) thread.messages = [];
    thread.status ??= 'open';
    thread.kind ??= 'lesson';
    thread.data ??= {};
  }
  return study;
}

export function normalizeBook(book) {
  book.version ??= 3;
  book.mode ??= 'study';
  if (!['study', 'ideas'].includes(book.mode)) book.mode = 'study';
  book.instructions ??= '';
  book.model ??= null;
  book.sources ??= [];
  book.chats ??= [];
  book.sessions ??= [];
  book.workspaceId ??= book.agentWorkspaceId ?? '';
  book.importedRecords ??= [];
  for (const session of book.sessions) {
    session.kind ??= 'linked';
    session.title ||= 'Session';
    session.unitId ??= '';
    session.prompted ??= true;
  }
  book.notes ??= [];
  book.artifacts ??= [];
  if (book.study) normalizeStudy(book.study);
  return book;
}

export function migrateDatabase(oldPath, newPath) {
  if (existsSync(newPath) || !existsSync(oldPath)) return false;
  mkdirSync(dirname(newPath), { recursive: true });
  const source = new DatabaseSync(oldPath);
  try {
    source.exec(`VACUUM INTO '${newPath.replaceAll("'", "''")}'`);
    return true;
  } finally {
    source.close();
  }
}

export function metadata(book) {
  const { sources, ...detail } = book;
  return {
    ...detail,
    sessions: book.sessions ?? [],
    sources: sources.map(({ body, ...source }) => ({ ...source, length: body.length })),
  };
}

const INDEX_SCHEMA = `
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS notebook_index (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    updated TEXT NOT NULL,
    created TEXT NOT NULL,
    sources INTEGER NOT NULL,
    chats INTEGER NOT NULL,
    folder TEXT NOT NULL,
    agent_workspace TEXT
  );
`;

const BOOK_SCHEMA = `
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS notebook (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, updated TEXT NOT NULL,
    sources INTEGER NOT NULL, chats INTEGER NOT NULL, data TEXT NOT NULL
  );
`;

function safeName(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
}

function slug(value, fallback = 'notebook') {
  const name = safeName(value).replace(/ /g, '-').slice(0, 48).replace(/^-+|-+$/g, '');
  return name || fallback;
}

function atomicWrite(path, content) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}

function briefText(book, memory = '') {
  const study = book.study ?? {};
  const lines = [
    `# ${book.title}`,
    '',
    '> Workspace brief for the Deep Notebook study agent. Read this before working in this folder.',
    '',
    '## Learning goal',
    '',
    study.goal ? study.goal : 'No study goal has been set yet.',
    '',
    `Level: ${study.level ?? 'intermediate'} · Daily time: ${study.dailyMinutes ?? 20} min${study.examDate ? ` · Target date: ${study.examDate}` : ''}`,
    '',
    'Answer in English unless the course style explicitly asks for another language.',
    '',
    '## Learning map',
    '',
  ];
  for (const topic of study.map?.topics ?? []) {
    lines.push(`### ${topic.title}`, '', topic.summary ?? '');
    for (const objective of topic.objectives ?? []) lines.push(`- ${objective.title}${objective.description ? ` — ${objective.description}` : ''}`);
    lines.push('');
  }
  if (!(study.map?.topics?.length)) lines.push('No learning map yet.', '');
  lines.push('## Lesson plan', '');
  const units = study.plan?.units ?? [];
  if (units.length) {
    units.forEach((unit, index) => lines.push(`${index + 1}. ${unit.title} (${unit.minutes} min${unit.completed ? ', completed' : ''}) — ${unit.objective}`));
  } else lines.push('No lesson plan yet.');
  lines.push('', '## Sources', '');
  if (book.sources.length) {
    for (const source of book.sources) lines.push(`- ${source.enabled ? '[selected]' : '[not selected]'} ${source.title} (${source.kind})`);
    lines.push('', 'Selected sources are mirrored under `sources/` when this brief is prepared.');
  } else lines.push('No sources yet.');
  if (book.instructions) lines.push('', '## Course style', '', book.instructions,
    '', 'This notebook’s course style takes precedence over global answer-format instructions when they conflict.');
  if (memory) lines.push('', '## Learner memory', '', memory);
  lines.push(
    '',
    '## Working rules',
    '',
    '- Treat this folder as your working directory for this notebook.',
    '- Read `AGENTS.md` and `memory.md` before working; they are generated from the notebook goal and learner memory.',
    '- Do not edit or delete `../notebook.sqlite` or `../memory.sqlite`; they are the notebook state owned by Deep Notebook.',
    '- Write finished outputs to `exports/` and scratch files to `agent/`.',
    '- Source mirrors under `sources/` can be stale; ask for a refresh from Deep Notebook when accuracy matters.',
    '',
  );
  return lines.join('\n');
}

export class NotebookStore {
  constructor(root) {
    this.root = root;
    this.books = join(root, 'notebooks');
    mkdirSync(this.books, { recursive: true });
    this.connections = new Map();
    this.learner = new LearnerMemory(root);
    this.index = new DatabaseSync(join(root, 'index.sqlite'));
    this.index.exec(INDEX_SCHEMA);
    const columns = this.index.prepare('PRAGMA table_info(notebook_index)').all().map((column) => column.name);
    if (!columns.includes('agent_workspace')) this.index.exec('ALTER TABLE notebook_index ADD COLUMN agent_workspace TEXT');
    this.migrateLegacy();
    this.syncIndex();
    this.backfillMemory();
  }

  backfillMemory() {
    for (const row of this.index.prepare('SELECT id FROM notebook_index').all()) {
      try {
        const book = this.get(row.id);
        this.rememberGoal(book);
        this.rememberPreferences(book);
        this.writeMeta(book);
        const memory = this.memory(book.id);
        for (const attempt of book.study?.attempts ?? []) {
          const key = `backfill:${book.id}:${attempt.assessmentId ?? attempt.id}`;
          if (this.learner.global.metaGet(key)) continue;
          for (const item of attempt.topics ?? []) {
            const stats = {
              notebookId: book.id, notebookTitle: book.title, subject: book.title,
              topic: item.topic, correct: item.correct, total: item.total, at: attempt.created,
            };
            memory.recordTopic(stats);
            this.learner.global.recordTopic(stats);
            const accuracy = item.total ? item.correct / item.total : 0;
            const kind = item.total >= 2 && accuracy >= 0.75 ? 'strength'
              : item.total >= 2 && accuracy < 0.6 ? 'weakness' : null;
            if (kind) {
              const value = {
                kind, topic: item.topic, title: `${book.title}: ${item.topic}`,
                body: `Imported from earlier study history: ${item.correct} of ${item.total} correct in ${book.title}.`,
                confidence: 0.6, source: 'Earlier study history', subject: book.title,
                notebookId: book.id, notebookTitle: book.title,
              };
              memory.removeKindTopic(kind === 'strength' ? 'weakness' : 'strength', item.topic, book.id);
              this.learner.global.removeKindTopic(kind === 'strength' ? 'weakness' : 'strength', item.topic, book.id);
              memory.add(value);
              this.learner.global.add(value);
            }
          }
          this.learner.global.metaSet(key);
        }
      } catch { /* Keep the rest of the library usable if one notebook cannot be read. */ }
    }
    this.learner.writeGlobalFile();
  }

  folderName(title, id) {
    return `${slug(title)}-${id.slice(0, 8)}`;
  }

  folderPath(id) {
    const row = this.index.prepare('SELECT folder FROM notebook_index WHERE id = ?').get(id);
    if (!row) return null;
    const path = resolve(this.books, row.folder);
    const root = resolve(this.books) + sep;
    if (!path.startsWith(root)) throw new NotebookError('Notebook path is invalid.', 500);
    return path;
  }

  workspacePath(id) {
    const folder = this.folderPath(id);
    if (!folder) throw new NotebookError('Notebook was removed or could not be found.', 404);
    return join(folder, 'workspace');
  }

  memory(id) {
    const folder = this.folderPath(id);
    if (!folder) throw new NotebookError('Notebook was removed or could not be found.', 404);
    return this.learner.notebook(id, folder);
  }

  memoryContext(book, query = '') {
    this.memory(book.id);
    return this.learner.context(book, query);
  }

  rememberGoal(book) {
    this.learner.rememberGoal(book);
  }

  rememberPreferences(book) {
    this.learner.rememberPreferences(book);
  }

  rememberAttempt(book, assessment, answers) {
    this.memory(book.id);
    this.learner.rememberAttempt(book, assessment, answers);
  }

  rememberLesson(book, unit) {
    this.memory(book.id);
    this.learner.rememberLesson(book, unit);
  }

  rememberTopics(book, topics) {
    this.memory(book.id);
    this.learner.rememberTopics(book, topics);
  }

  rememberExtracted(book, items) {
    this.memory(book.id);
    return this.learner.rememberExtracted(book, items);
  }

  memoryList(scope, book) {
    return this.learner.list(scope, book, book ? this.folderPath(book.id) : null);
  }

  memorySave(scope, book, input) {
    return this.learner.save(scope, book, input, book ? this.folderPath(book.id) : null);
  }

  memoryRemove(scope, book, memoryId) {
    return this.learner.remove(scope, book, memoryId, book ? this.folderPath(book.id) : null);
  }

  bookDb(id) {
    if (this.connections.has(id)) return this.connections.get(id);
    const folder = this.folderPath(id);
    if (!folder || !existsSync(folder)) throw new NotebookError('Notebook was removed or could not be found.', 404);
    const path = join(folder, 'notebook.sqlite');
    const db = new DatabaseSync(path);
    db.exec(BOOK_SCHEMA);
    const value = { db, path };
    this.connections.set(id, value);
    return value;
  }

  ensureWorkspace(id) {
    const folder = this.folderPath(id);
    if (!folder) return;
    for (const name of [
      'workspace', 'workspace/sources', 'workspace/exports', 'workspace/agent',
      'workspace/agent/records', 'workspace/.agents/skills/notebook',
    ]) {
      mkdirSync(join(folder, name), { recursive: true });
    }
  }

  writeMeta(book) {
    try {
      const folder = this.folderPath(book.id);
      if (!folder) return;
      this.ensureWorkspace(book.id);
      this.memory(book.id);
      const memory = this.learner.brief(book);
      atomicWrite(join(folder, 'meta.json'), JSON.stringify({
        id: book.id, title: book.title, mode: book.mode, created: book.created, updated: book.updated,
      }, null, 2));
      atomicWrite(join(folder, 'workspace', 'brief.md'), briefText(book, memory));
      this.learner.writeNotebookFile(folder, book);
      this.writeAgentInstructions(folder, book);
    } catch { /* Workspace files are a convenience; the notebook database remains canonical. */ }
  }

  writeAgentInstructions(folder, book) {
    const marker = '<!-- deep-notebook:generated -->';
    const agentsPath = join(folder, 'workspace', 'AGENTS.md');
    try {
      if (!existsSync(agentsPath) || readFileSync(agentsPath, 'utf8').includes(marker)) {
        atomicWrite(agentsPath, `${marker}
# Deep Notebook tutor

You are the tutor for the Deep Notebook notebook **${book.title}**. Each conversation in this folder is a study session with one learner.

## Before you teach

Answer in English. Use another language only when the course style below explicitly asks for it.

- Read \`brief.md\` for the learning goal, level, learning map, lesson plan, and source list.
- Read \`memory.md\` for what this learner already knows: strengths, focus areas, misconceptions, and preferences.

## How to teach

- **Lesson**: teach the requested lesson in whatever form fits it best — clear prose, tables, a worked example, common mistakes, and key takeaways. Build on what \`memory.md\` says they already know. End by offering a quick quiz.
- **Quiz**: use the question tool so the learner can click options. Ask one question at a time, or several in one batch, and wait for the answers. Say whether each answer is right and explain it fully; never shorten an explanation. Never reveal the answer before the learner answers. When the quiz ends, report the score.
- **Study plan**: use the lesson plan in \`brief.md\`, the learner's daily time and target date, and completed lessons to propose this week's priorities.
- **Follow-up questions**: answer directly, with a short example when it helps.

Use \`sources/\` when accuracy matters and name the file a fact comes from. Use the workspace files and your tools whenever they help.

## Course style

${book.instructions || 'No course style has been set for this notebook.'}

When this course style conflicts with a global answer-format instruction, this notebook's course style wins.

## Report back

Deep Notebook updates progress and learner memory only from your reports. When a goal is agreed, a quiz ends, or the learner reveals something durable about how they learn, follow the \`notebook\` skill (\`.agents/skills/notebook/SKILL.md\`). Lesson completion is set by the learner in the notebook, never by the tutor.

## Rules

- Do not edit or delete \`../notebook.sqlite\`, \`../memory.sqlite\`, or anything outside this folder.
- \`brief.md\`, \`memory.md\`, \`AGENTS.md\`, and \`sources/\` are written by Deep Notebook. Read them; do not edit them.
- Put your own files in \`exports/\` or \`agent/\`.
`);
      }
    } catch { /* The instructions are best effort. */ }

    const skillPath = join(folder, 'workspace', '.agents', 'skills', 'notebook', 'SKILL.md');
    try {
      atomicWrite(skillPath, `---
name: notebook
description: Report results to Deep Notebook — the agreed learning goal, a finished quiz score, or a durable fact about the learner. Use after a goal is agreed, when a quiz ends, or when the learner reveals a stable preference, strength, or misconception.
---
<!-- deep-notebook:generated -->

# Report to Deep Notebook

Deep Notebook reads JSON files in \`agent/records/\` in this folder and then removes them. Write one record per file with the file tool, for example \`agent/records/2026-11-23-quiz-1.json\`.

## Record shapes

Set a learning goal, after the learner agrees:

\`\`\`json
{"action":"goal","goal":"what the learner wants to be able to do","level":"beginner|intermediate|advanced","dailyMinutes":20,"examDate":"YYYY-MM-DD or empty","topics":["short topic title"]}
\`\`\`

A finished quiz:

\`\`\`json
{"action":"quiz_result","title":"Lesson or quiz title","correct":3,"total":5,"topics":[{"topic":"exact lesson topic","correct":2,"total":3}]}
\`\`\`

\`topics\` uses the lesson plan's topic names. Report each quiz once, when it ends.

## Quizzing

Use the question tool (ask_user_question) so the learner can click options. Never reveal the answer in the question or the option text.

- One at a time: ask one multiple-choice question, wait for the answer, say whether it is right, explain it fully, then ask the next.
- Batch: ask several multiple-choice questions in one question-tool call, wait for all answers, then explain every missed question fully before moving on. If the tool's limit means the quiz needs more questions than fit in one call, ask the next batch after the first; never drop questions or shorten explanations.
- 3–4 plausible options, exactly one correct; reuse the exact topic names from \`brief.md\`.
- Ask how many questions the learner wants, or default to 5. Do not shorten explanations to save space.
- When the last question is explained, write one \`quiz_result\` record.

Something worth remembering, used sparingly and only for durable facts:

\`\`\`json
{"action":"memory","scope":"notebook|global","kind":"strength|weakness|misconception|preference|goal|strategy|fact","topic":"short concept name","text":"one or two sentences"}
\`\`\`

## Rules

- Write record text in English unless the course style explicitly asks for another language.
- Valid JSON in one file; no comments, no markdown fences.
- Do not edit or delete files in \`agent/records/\`; Deep Notebook removes them after reading.
- After writing the file, tell the learner in one sentence what you recorded.
`);
    } catch { /* The skill is best effort. */ }
  }

  prepareAgent(id) {
    const book = this.get(id);
    this.ensureWorkspace(id);
    const folder = this.folderPath(id);
    const sourcesDir = join(folder, 'workspace', 'sources');
    rmSync(sourcesDir, { recursive: true, force: true });
    mkdirSync(sourcesDir, { recursive: true });
    const mirrors = [];
    book.sources.filter((source) => source.enabled).forEach((source, index) => {
      const name = `${String(index + 1).padStart(2, '0')}-${slug(source.title, 'source')}.md`;
      const content = [
        '---',
        `title: ${JSON.stringify(source.title)}`,
        `kind: ${source.kind}`,
        '---',
        '',
        source.body,
        '',
      ].join('\n');
      try {
        writeFileSync(join(sourcesDir, name), content, 'utf8');
        mirrors.push({ title: source.title, file: `sources/${name}` });
      } catch { /* Skip an unwritable mirror. */ }
    });
    const brief = briefText(book, this.learner.brief(book));
    try {
      atomicWrite(join(folder, 'workspace', 'brief.md'), brief);
      atomicWrite(join(folder, 'workspace', 'sources', 'index.json'), JSON.stringify(mirrors, null, 2));
      this.learner.writeNotebookFile(folder, book);
      this.writeAgentInstructions(folder, book);
    } catch { /* The brief is best-effort. */ }
    return { workspace: this.workspacePath(id), brief, sources: mirrors };
  }

  list() {
    return this.index.prepare(`SELECT id, title, mode, created, updated, sources, chats,
      agent_workspace AS workspaceId FROM notebook_index ORDER BY updated DESC`).all();
  }

  get(id) {
    if (typeof id !== 'string') throw new NotebookError('Select a notebook first.');
    const { db } = this.bookDb(id);
    const row = db.prepare('SELECT data FROM notebook WHERE id = ?').get(id);
    if (!row) throw new NotebookError('Notebook was removed or could not be found.', 404);
    return normalizeBook(JSON.parse(row.data));
  }

  save(book) {
    normalizeBook(book);
    book.updated = new Date().toISOString();
    const serialized = JSON.stringify(book);
    if (Buffer.byteLength(serialized) > MAX_BOOK) {
      throw new NotebookError('This notebook is full. Remove some content or start a new notebook.', 413);
    }
    let folder = this.folderPath(book.id);
    if (!folder) {
      folder = this.folderName(book.title, book.id);
      mkdirSync(join(this.books, folder), { recursive: true });
      this.index.prepare(`INSERT INTO notebook_index (id, title, mode, updated, created, sources, chats, folder, agent_workspace)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        book.id, book.title, book.mode, book.updated, book.created ?? book.updated,
        book.sources.length, book.chats.length, folder, book.workspaceId ?? null,
      );
      this.writeMeta(book);
    }
    const { db } = this.bookDb(book.id);
    db.prepare(`
      INSERT INTO notebook (id, title, updated, sources, chats, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated = excluded.updated,
        sources = excluded.sources, chats = excluded.chats, data = excluded.data
    `).run(book.id, book.title, book.updated, book.sources.length, book.chats.length, serialized);
    this.index.prepare(`
      UPDATE notebook_index SET title = ?, mode = ?, updated = ?, sources = ?, chats = ?,
        agent_workspace = ? WHERE id = ?
    `).run(book.title, book.mode, book.updated, book.sources.length, book.chats.length,
      book.workspaceId ?? null, book.id);
    this.writeMeta(book);
    return book;
  }

  create(title, goal = '', mode = 'study') {
    const study = newStudy(goal);
    return this.save(record({ title, mode, instructions: '', model: null, sources: [], chats: [], sessions: [], notes: [], artifacts: [], workspaceId: '', study }));
  }

  update(id, action) {
    const { db } = this.bookDb(id);
    db.exec('BEGIN IMMEDIATE');
    try {
      const book = this.get(id);
      action(book);
      this.save(book);
      db.exec('COMMIT');
      return book;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  delete(id) {
    this.get(id);
    const folder = this.folderPath(id);
    try { this.learner.removeNotebook(id); } catch { /* Keep deleting the notebook even if memory cleanup fails. */ }
    const connection = this.connections.get(id);
    if (connection) {
      try { connection.db.close(); } catch { /* Already closed. */ }
      this.connections.delete(id);
    }
    this.index.prepare('DELETE FROM notebook_index WHERE id = ?').run(id);
    if (folder) {
      const target = resolve(folder);
      if (target.startsWith(resolve(this.books) + sep)) rmSync(target, { recursive: true, force: true });
    }
  }

  syncIndex() {
    if (!existsSync(this.books)) return;
    const seen = new Set();
    for (const entry of readdirSync(this.books)) {
      const folder = join(this.books, entry);
      try {
        if (!statSync(folder).isDirectory()) continue;
        const path = join(folder, 'notebook.sqlite');
        if (!existsSync(path)) continue;
        const db = new DatabaseSync(path);
        const row = db.prepare('SELECT id, title, updated, sources, chats, data FROM notebook LIMIT 1').get();
        db.close();
        if (!row) continue;
        let data;
        try { data = JSON.parse(row.data); } catch { data = {}; }
        seen.add(row.id);
        this.index.prepare(`
          INSERT INTO notebook_index (id, title, mode, updated, created, sources, chats, folder, agent_workspace)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, mode = excluded.mode,
            updated = excluded.updated, created = excluded.created, sources = excluded.sources,
            chats = excluded.chats, folder = excluded.folder, agent_workspace = excluded.agent_workspace
        `).run(
          row.id, row.title, data.mode === 'ideas' ? 'ideas' : 'study',
          row.updated, data.created ?? row.updated, row.sources, row.chats, entry,
          data.workspaceId ?? data.agentWorkspaceId ?? null,
        );
      } catch { /* Ignore an unreadable folder and keep the rest of the index usable. */ }
    }
    for (const row of this.index.prepare('SELECT id, folder FROM notebook_index').all()) {
      if (!seen.has(row.id)) this.index.prepare('DELETE FROM notebook_index WHERE id = ?').run(row.id);
    }
  }

  migrateLegacy() {
    const legacy = join(this.root, 'notebooks.sqlite');
    const indexed = this.index.prepare('SELECT COUNT(*) AS count FROM notebook_index').get().count;
    if (!existsSync(legacy) || indexed > 0) return;
    const db = new DatabaseSync(legacy);
    try {
      const rows = db.prepare('SELECT id, title, updated, sources, chats, data FROM notebook').all();
      for (const row of rows) {
        let book;
        try { book = normalizeBook(JSON.parse(row.data)); } catch { continue; }
        const folder = this.folderName(row.title, row.id);
        mkdirSync(join(this.books, folder), { recursive: true });
        this.index.prepare(`INSERT OR REPLACE INTO notebook_index (id, title, mode, updated, created, sources, chats, folder, agent_workspace)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          row.id, row.title, book.mode, row.updated, book.created ?? row.updated,
          row.sources, row.chats, folder, book.workspaceId ?? null,
        );
        const connection = new DatabaseSync(join(this.books, folder, 'notebook.sqlite'));
        connection.exec(BOOK_SCHEMA);
        connection.prepare('INSERT OR REPLACE INTO notebook (id, title, updated, sources, chats, data) VALUES (?, ?, ?, ?, ?, ?)')
          .run(row.id, row.title, row.updated, row.sources, row.chats, row.data);
        connection.close();
        this.ensureWorkspace(row.id);
        this.writeMeta(book);
      }
    } finally {
      db.close();
    }
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      renameSync(legacy, join(this.root, `notebooks.legacy-${stamp}.sqlite`));
    } catch { /* Keep the legacy file if it cannot be renamed. */ }
  }

  close() {
    for (const { db } of this.connections.values()) {
      try { db.close(); } catch { /* Already closed. */ }
    }
    this.connections.clear();
    try { this.learner.close(); } catch { /* Already closed. */ }
    this.index.close();
  }
}
