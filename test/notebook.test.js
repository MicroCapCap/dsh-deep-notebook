import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { apply, createHandler } from '../lib/host.js';
import { parseArtifact, retrieve, validatedCitations } from '../lib/research.js';
import { importSession, importWeb, makeSource } from '../lib/sources.js';
import { parseStudy } from '../lib/study.js';
import { migrateDatabase, newStudy, NotebookStore } from '../lib/store.js';

const model = { provider: 'deepseek-account', id: 'test-model', name: 'Test model' };

const MAP = {
  topics: [
    { title: 'Vectors', summary: 'Represent values as vectors.', objectives: [
      { title: 'I can read a vector', description: 'Identify dimensions and entries.' },
      { title: 'I can add vectors', description: 'Add component by component.' },
    ] },
    { title: 'Attention scores', summary: 'Compare queries and keys.', objectives: [
      { title: 'I can compute a dot product', description: 'Multiply matching entries and sum.' },
      { title: 'I can scale scores', description: 'Apply the square-root factor.' },
    ] },
    { title: 'Softmax weights', summary: 'Turn scores into a distribution.', objectives: [
      { title: 'I can exponentiate scores', description: 'Apply the exponential function.' },
      { title: 'I can normalize weights', description: 'Divide by the sum.' },
    ] },
  ],
};
const PLAN = {
  units: [
    { title: 'Read vectors', objective: 'Read vector shapes', topics: ['Vectors'], minutes: 8, kind: 'concept' },
    { title: 'Score attention', objective: 'Compute scaled scores', topics: ['Attention scores'], minutes: 10, kind: 'practice' },
  ],
};
const CARDS = {
  cards: [
    { front: 'What shape is Q?', back: 'Tokens by projection width [1].', topic: 'Vectors' },
    { front: 'Why divide by sqrt(d_k)?', back: 'To keep logits in a stable range [1].', topic: 'Attention scores' },
    { front: 'What does softmax output sum to?', back: 'One [1].', topic: 'Attention scores' },
    { front: 'What is a query?', back: 'A learned projection used for matching [1].', topic: 'Vectors' },
  ],
};

function defaultStream() {
  return async function* ({ messages }) {
    const request = JSON.parse(messages[0].content[0].text);
    let text = 'Shade reduced the recorded temperature [1]. [999]';
    if (request.task?.includes('coherent topics')) text = JSON.stringify(MAP);
    else if (request.task?.includes('bite-sized lessons')) text = JSON.stringify(PLAN);
    else if (request.task?.includes('flashcards for active recall')) text = JSON.stringify(CARDS);
    yield { type: 'text-delta', text };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
}

function fixture(t, stream, sessionQuery, workspaceRegistry) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notebook-test-'));
  const root = join(dir, 'store');
  const store = new NotebookStore(root);
  const archived = [];
  const controller = new AbortController();
  t.after(() => {
    controller.abort();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const llm = {
    listProviders: () => [{ id: model.provider }],
    listModels: async () => [model],
    stream: stream ?? defaultStream(),
  };
  const handle = createHandler(store, {
    llm, getWeb: () => undefined, getSessionQuery: () => sessionQuery,
    getWorkspaceRegistry: () => workspaceRegistry,
    archiveSession: async (session) => { archived.push(session); },
    backgroundSignal: controller.signal,
  });
  const call = async (op, properties = {}, signal) => {
    const response = await handle(new Request('http://localhost/api/deep-notebook', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, ...properties }), signal,
    }));
    return { status: response.status, ...await response.json() };
  };
  async function waitFor(id, predicate, message = 'condition') {
    for (let attempt = 0; attempt < 200; attempt++) {
      const value = (await call('get', { id })).value;
      if (predicate(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${message}.`);
  }
  return { store, root, call, archived, waitFor };
}

function writeRecord(store, id, name, value) {
  const folder = store.folderPath(id);
  const dir = join(folder, 'workspace', 'agent', 'records');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value), 'utf8');
}

test('notebook lifecycle persists sources, notes, and session links', async (t) => {
  const { call, root } = fixture(t);
  const { value: book } = await call('create', { title: 'Local research' });
  const { id } = book;
  const { value: withSource } = await call('add-source', { id, kind: 'paste', title: 'July field data', body: 'Shade reduced the recorded temperature by 7 °C.' });
  const sourceId = withSource.sources[0].id;
  assert.equal('body' in withSource.sources[0], false);
  await call('save-note', { id, title: 'First observation', body: 'Shade was 7 °C cooler.' });
  await call('source-delete', { id, sourceId });
  const reopened = new NotebookStore(root);
  try {
    const saved = reopened.get(id);
    assert.equal(saved.sources.length, 0);
    assert.equal(saved.notes[0].title, 'First observation');
    assert.deepEqual(saved.notes[0].citations, []);
  } finally {
    reopened.close();
  }
});

test('prepare-agent mirrors only selected sources', async (t) => {
  const { call } = fixture(t);
  const { value: book } = await call('create', { title: 'Scope' });
  const fields = { id: book.id, kind: 'paste' };
  const { value: withPrivate } = await call('add-source', { ...fields, title: 'Private', body: 'PRIVATE SENTINEL' });
  const privateId = withPrivate.sources[0].id;
  const { value: withPublic } = await call('add-source', { ...fields, title: 'Public', body: 'An observation about trees.' });
  await call('source-update', { id: book.id, sourceId: privateId, enabled: false });
  const { value: prepared } = await call('prepare-agent', { id: book.id });
  assert.deepEqual(prepared.sources.map((item) => item.title), ['Public']);
  const files = readdirSync(join(prepared.workspace, 'sources')).filter((name) => name.endsWith('.md'));
  assert.equal(files.length, 1);
  const body = readFileSync(join(prepared.workspace, 'sources', files[0]), 'utf8');
  assert.match(body, /An observation about trees/);
  assert.doesNotMatch(body, /PRIVATE SENTINEL/);
  void withPublic;
});

test('retrieval ranks narrow passages, supports CJK and spreads over distinct sources', () => {
  const base = 'Low-frequency passages discuss sidewalks and street surface. '.repeat(45);
  const sources = [
    makeSource('Measurements', `${base}\n\nNitrogen dioxide rose by 12 µg/m³.\n\n${base}`, 'paste'),
    makeSource('社区调查', `${base}\n\n居民建议在公交车站旁种树。`, 'paste'),
    makeSource('Timeline', 'Planners will meet on Tuesday.', 'paste'),
  ];
  assert.match(retrieve(sources, 'dioxide rose')[0].text, /Nitrogen dioxide/);
  assert.match(retrieve(sources, '公交车站')[0].text, /公交车站/);
  assert.deepEqual(new Set(retrieve(sources, '', { overview: true, limit: 3 }).map((hit) => hit.title)), new Set(sources.map((source) => source.title)));
  assert.equal(retrieve(sources, 'dioxide', { overview: true, limit: 4 }).length, 4);
});

test('artifact schema and citation validation reject invalid IDs and unsafe quiz structure', () => {
  const valid = parseArtifact('quiz', '{"questions":[{"question":"One?","options":["A","B","C","D"],"answer":0,"explanation":"Evidence [1] [333]"}]}');
  const validated = validatedCitations(valid, [{ sourceId: 'id', title: 'Title', text: 'Raw passage', line: 4 }]);
  assert.deepEqual(validated.citations.map((citation) => citation.number), [1]);
  assert.doesNotMatch(validated.data.questions[0].explanation, /333/);
  assert.throws(() => parseArtifact('quiz', '{"questions":[{"question":"?", "options":["A","B","C","D"],"answer":4,"explanation":"Value"}]}'), /invalid study format/);
});

test('web import strips page scripts and imports explicit search excerpts on fetch failures', async () => {
  const signal = new AbortController().signal;
  const input = { url: 'https://example.com/research', excerpt: 'A search excerpt' };
  const web = { fetch: async () => ({ statusCode: 200, url: input.url, body: { kind: 'html', content: '<title>Sample &amp; Test</title><script>alert(1)</script><main><p>Extractable text.</p></main>' } }) };
  const source = await importWeb(web, input, signal);
  assert.equal(source.title, 'Sample & Test');
  assert.match(source.body, /Extractable text/);
  assert.doesNotMatch(source.body, /alert/);
  const fallback = await importWeb({ fetch: async () => { throw new Error(); } }, input, signal);
  assert.equal(fallback.kind, 'excerpt');
  await assert.rejects(importWeb(web, { url: 'file:///secret' }, signal), /HTTP or HTTPS/);
});

test('transcript import filters private reasoning and tool events', async () => {
  const api = {
    readSurface: async () => ({
      events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: 'Question' }] } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'Private' }, { type: 'text', text: 'Answer' }] } } },
        { type: 'tool/result', data: { output: 'Credentials' } },
      ],
    }),
  };
  const imported = await importSession(api, { sessionId: 'sample', title: 'Chat' });
  assert.match(imported.body, /Question[\s\S]*Answer/);
  assert.doesNotMatch(imported.body, /Private|Credentials/);
});

test('Cordis host registers an owner-only route through the shared connection', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notebook-host-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let registered;
  const disposers = [];
  apply({
    inject() {},
    effect(setup) { disposers.push(setup()); },
    connection: { fetch: { register(route) { registered = route; } } },
  }, { storagePath: join(dir, 'test.sqlite') });
  assert.equal(registered.path, '/api/deep-notebook');
  assert.equal(registered.requestBody, 'streaming');
  assert.deepEqual(registered.methods, ['POST']);
  for (const dispose of disposers) dispose();
});

test('book navigation lists workspace sessions without transcript text', async (t) => {
  const { call, store } = fixture(t, undefined, {
    readTitleSnapshot: async (id) => {
      if (id === 'deleted') throw new Error('Missing');
      return { title: { title: `Harness ${id}` } };
    },
  });
  const book = store.create('Research');
  store.update(book.id, (old) => {
    old.chats.push({ id: 'old-chat', title: 'Earlier conversation', messages: [{ role: 'user', text: 'Excluded from sidebar data' }] });
  });
  const id = book.id;
  await call('session-attach', { id, sessionId: 'session-lesson-1', title: 'Read vectors', kind: 'lesson', unitId: 'unit-1' });
  assert.equal((await call('session-link', { id, sessionId: 'deleted' })).status, 404);
  await call('session-link', { id, sessionId: 'one' });
  await call('session-link', { id, sessionId: 'one' });
  const { value: nav } = await call('book-nav', { id });
  assert.deepEqual(nav.sessions.map(({ title }) => title), ['Read vectors', 'Harness one']);
  assert.deepEqual(nav.chats.map(({ title }) => title), ['Earlier conversation']);
  assert.doesNotMatch(JSON.stringify(nav), /Excluded from sidebar/);
  assert.equal((await call('session-unlink', { id, sessionId: 'one' })).value.sessions.length, 1);
});

test('learner reports update progress, memory, and global mastery', async (t) => {
  const { call, store, waitFor } = fixture(t);
  const { value: book } = await call('create', { title: 'Attention', goal: 'Understand scaled dot-product attention.' });
  const id = book.id;
  const built = await waitFor(id, (value) => value.study?.map && value.study?.plan, 'the generated plan');
  assert.equal(built.study.building, '');
  assert.equal(built.study.buildError, '');

  writeRecord(store, id, 'quiz-1.json', {
    action: 'quiz_result', title: 'Read vectors quiz', correct: 1, total: 2,
    topics: [{ topic: 'Vectors', correct: 1, total: 2 }],
  });
  writeRecord(store, id, 'memory-1.json', {
    action: 'memory', scope: 'notebook', kind: 'misconception', topic: 'Softmax',
    text: 'I divided by the maximum instead of the sum.',
  });
  writeRecord(store, id, 'memory-2.json', {
    action: 'memory', scope: 'global', kind: 'preference', topic: 'Pacing',
    text: 'Short sessions with one worked example work best.',
  });
  const after = (await call('get', { id })).value;
  assert.equal(after.study.attempts.length, 1);
  assert.equal(after.study.attempts[0].correct, 1);
  assert.equal(after.study.plan.units.find((unit) => unit.title === 'Read vectors').completed, false);
  const lesson = after.study.plan.units.find((unit) => unit.title === 'Read vectors');
  const marked = await call('study-complete', { id, unitId: lesson.id });
  assert.equal(marked.value.study.plan.units.find((unit) => unit.id === lesson.id).completed, true);
  const reopened = await call('study-complete', { id, unitId: lesson.id, completed: false });
  assert.equal(reopened.value.study.plan.units.find((unit) => unit.id === lesson.id).completed, false);
  assert.equal(after.studyProgress.topics.find((topic) => topic.topic === 'Vectors').accuracy, 0.5);
  const notebookMemory = await call('memory-list', { id, scope: 'notebook' });
  assert.ok(notebookMemory.value.memories.some((item) => item.kind === 'misconception' && item.topic === 'Softmax'));
  assert.equal(notebookMemory.value.topics.find((item) => item.topic === 'Vectors').total, 2);
  const globalMemory = await call('memory-list', { scope: 'global' });
  assert.ok(globalMemory.value.memories.some((item) => item.kind === 'goal'));
  assert.ok(globalMemory.value.memories.some((item) => item.kind === 'preference' && item.topic === 'Pacing'));
  assert.equal(globalMemory.value.topics.find((item) => item.topic === 'Vectors').total, 2);
  const folder = store.folderPath(id);
  assert.equal(existsSync(join(folder, 'workspace', 'agent', 'records', 'quiz-1.json')), false);
});

test('invalid reports are quarantined and do not change the notebook', async (t) => {
  const { call, store } = fixture(t);
  const { value: book } = await call('create', { title: 'Reports' });
  writeRecord(store, book.id, 'broken.json', { action: 'quiz_result', correct: 9 });
  writeRecord(store, book.id, 'lesson.json', { action: 'lesson_done', lesson: 'Read vectors' });
  const value = (await call('get', { id: book.id })).value;
  assert.equal(value.study.attempts.length, 0);
  const folder = store.folderPath(book.id);
  assert.ok(existsSync(join(folder, 'workspace', 'agent', 'records', 'broken.json.bad')));
  assert.ok(existsSync(join(folder, 'workspace', 'agent', 'records', 'lesson.json.bad')));
});

test('study map, flashcards, spaced review, and lesson completion', async (t) => {
  const { call, waitFor } = fixture(t);
  const { value: book } = await call('create', { title: 'Attention', goal: 'Understand attention.' });
  const id = book.id;
  await waitFor(id, (value) => value.study?.map && value.study?.plan, 'the generated plan');
  const { value: withCards } = await call('study-generate', { id, kind: 'study-cards', count: 8 });
  assert.equal(withCards.study.cards.length, 4);
  assert.equal(withCards.studyProgress.cards.due, 4);
  const card = withCards.study.cards[0];
  const { value: reviewed } = await call('study-review', { id, cardId: card.id, rating: 'good' });
  const fresh = reviewed.study.cards.find((item) => item.id === card.id);
  assert.equal(fresh.interval, 1);
  assert.equal(fresh.reps, 1);
  assert.ok(Date.parse(fresh.due) > Date.now());
  const unit = reviewed.study.plan.units[0];
  const { value: completed } = await call('study-complete', { id, unitId: unit.id });
  assert.equal(completed.studyProgress.completed, 1);
});

test('a legacy single-file database is split into notebook folders with an index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notebook-legacy-'));
  try {
    const legacyDir = join(dir, 'legacy');
    mkdirSync(legacyDir, { recursive: true });
    const legacyPath = join(legacyDir, 'notebooks.sqlite');
    const id = 'legacy-book-1';
    const created = new Date().toISOString();
    const book = {
      version: 2, id, title: 'Legacy', mode: 'study', created, updated: created,
      instructions: '', model: null, sources: [], chats: [], sessions: [], notes: [], artifacts: [],
      study: { ...newStudy('Keep my progress'), attempts: [{ id: 'a', title: 'Old', correct: 1, total: 1, topics: [], created }] },
    };
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec('CREATE TABLE notebook (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated TEXT NOT NULL, sources INTEGER NOT NULL, chats INTEGER NOT NULL, data TEXT NOT NULL);');
    legacy.prepare('INSERT INTO notebook VALUES (?, ?, ?, ?, ?, ?)').run(id, 'Legacy', created, 0, 0, JSON.stringify(book));
    legacy.close();
    const root = join(dir, 'store');
    mkdirSync(root, { recursive: true });
    copyFileSync(legacyPath, join(root, 'notebooks.sqlite'));
    const store = new NotebookStore(root);
    try {
      assert.equal(store.get(id).study.attempts.length, 1);
      assert.ok(store.list().some((item) => item.id === id));
      const folder = readdirSync(join(root, 'notebooks')).find((name) => name.startsWith('Legacy-'));
      assert.ok(folder);
      assert.ok(existsSync(join(root, 'notebooks', folder, 'notebook.sqlite')));
      assert.ok(existsSync(join(root, 'notebooks', folder, 'workspace', 'brief.md')));
      assert.ok(existsSync(join(root, 'notebooks', folder, 'workspace', 'AGENTS.md')));
      assert.ok(existsSync(join(root, 'notebooks', folder, 'workspace', '.agents', 'skills', 'notebook', 'SKILL.md')));
      assert.match(readFileSync(join(root, 'notebooks', folder, 'workspace', 'brief.md'), 'utf8'), /Keep my progress/);
    } finally { store.close(); }
    assert.ok(readdirSync(root).some((name) => name.startsWith('notebooks.legacy-')));
    const original = new DatabaseSync(legacyPath);
    try { assert.equal(original.prepare('SELECT COUNT(*) AS count FROM notebook').get().count, 1); } finally { original.close(); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrateDatabase copies a legacy file without overwriting it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notebook-copy-'));
  try {
    const oldPath = join(dir, 'old', 'notebooks.sqlite');
    mkdirSync(dirname(oldPath), { recursive: true });
    const db = new DatabaseSync(oldPath);
    db.exec('CREATE TABLE notebook (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated TEXT NOT NULL, sources INTEGER NOT NULL, chats INTEGER NOT NULL, data TEXT NOT NULL);');
    db.close();
    const newPath = join(dir, 'new', 'notebooks.sqlite');
    assert.equal(migrateDatabase(oldPath, newPath), true);
    assert.ok(existsSync(newPath));
    assert.equal(migrateDatabase(oldPath, newPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('study parser accepts maps and cards with prose around the JSON', () => {
  const map = parseStudy('study-map', 'Map:\n```json\n{"topics":[{"title":"A","summary":"a","objectives":[{"title":"a1","description":"d"},{"title":"a2","description":"d"}]},{"title":"B","summary":"b","objectives":[{"title":"b1","description":"d"},{"title":"b2","description":"d"}]},{"title":"C","summary":"c","objectives":[{"title":"c1","description":"d"},{"title":"c2","description":"d"}]}]}\n```');
  assert.equal(map.topics.length, 3);
  const cards = parseStudy('study-cards', '{"cards":[{"front":"Q1","back":"A1","topic":"A"},{"front":"Q2","back":"A2","topic":"B"},{"front":"Q3","back":"A3","topic":"C"},{"front":"Q4","back":"A4","topic":"D"}]}');
  assert.equal(cards.cards.length, 4);
});

test('a goal report builds the map and plan in the background', async (t) => {
  const { call, store, waitFor } = fixture(t);
  const { value: book } = await call('create', { title: 'Gradient descent basics' });
  assert.equal(book.study.goal, '');
  const { value: ideasBook } = await call('create', { title: 'Ideas board', mode: 'ideas' });
  assert.equal(ideasBook.mode, 'ideas');
  writeRecord(store, book.id, 'goal.json', {
    action: 'goal', goal: 'Explain gradient descent and compute update steps by hand.',
    level: 'beginner', dailyMinutes: 30, examDate: '2026-12-07', topics: ['Gradients'],
  });
  const built = await waitFor(book.id, (value) => value.study?.map && value.study?.plan, 'the generated plan');
  assert.equal(built.study.goal, 'Explain gradient descent and compute update steps by hand.');
  assert.equal(built.study.level, 'beginner');
  assert.equal(built.study.dailyMinutes, 30);
  assert.equal(built.study.examDate, '2026-12-07');
  assert.equal(built.study.building, '');
});

test('notebook folders contain the workspace brief, AGENTS.md, skill, and session index', async (t) => {
  const { call, root, archived } = fixture(t);
  const { value: book } = await call('create', { title: 'Workspace notebook', mode: 'study' });
  const folder = readdirSync(join(root, 'notebooks')).find((name) => name.startsWith('Workspace-notebook-'));
  assert.ok(folder);
  assert.ok(existsSync(join(root, 'notebooks', folder, 'notebook.sqlite')));
  assert.ok(existsSync(join(root, 'notebooks', folder, 'meta.json')));
  assert.ok(existsSync(join(root, 'notebooks', folder, 'workspace', 'brief.md')));
  const agents = readFileSync(join(root, 'notebooks', folder, 'workspace', 'AGENTS.md'), 'utf8');
  assert.match(agents, /Deep Notebook tutor/);
  assert.match(agents, /notebook/);
  const skill = readFileSync(join(root, 'notebooks', folder, 'workspace', '.agents', 'skills', 'notebook', 'SKILL.md'), 'utf8');
  assert.match(skill, /quiz_result/);
  assert.match(skill, /agent\/records/);
  await call('add-source', { id: book.id, kind: 'paste', title: 'Attention notes', body: 'Attention compares every token with every other token.' });
  const { value: prepared } = await call('prepare-agent', { id: book.id });
  assert.ok(prepared.workspace.endsWith('workspace'));
  assert.match(readFileSync(join(prepared.workspace, 'brief.md'), 'utf8'), /Workspace notebook/);
  const files = readdirSync(join(prepared.workspace, 'sources'));
  const mirror = files.find((name) => name.endsWith('.md'));
  assert.ok(mirror);
  assert.match(readFileSync(join(prepared.workspace, 'sources', mirror), 'utf8'), /Attention compares/);
  await call('session-attach', { id: book.id, sessionId: 'session-test-1', title: 'Read vectors', kind: 'lesson', unitId: 'unit-1', workspaceId: 'workspace-test-1' });
  const { value: withAgent } = await call('list');
  assert.equal(withAgent.find((item) => item.id === book.id).workspaceId, 'workspace-test-1');
  await call('rename', { id: book.id, title: 'Renamed workspace' });
  const { value: renamed } = await call('list');
  assert.equal(renamed.find((item) => item.id === book.id).title, 'Renamed workspace');
  await call('delete', { id: book.id });
  assert.equal(existsSync(join(root, 'notebooks', folder)), false);
  assert.deepEqual(archived, ['session-test-1']);
});

test('quiz reports build notebook and global learner memory, and global memory survives notebook deletion', async (t) => {
  const { call, store, waitFor } = fixture(t);
  const first = await call('create', { title: 'Linear algebra', goal: 'Understand vectors.' });
  const firstBook = first.value;
  await waitFor(firstBook.id, (value) => value.study?.map, 'the map');
  writeRecord(store, firstBook.id, 'quiz-a.json', {
    action: 'quiz_result', title: 'Vectors quiz', correct: 1, total: 2,
    topics: [{ topic: 'Vectors', correct: 1, total: 2 }],
  });
  await call('get', { id: firstBook.id });
  const notebookMemory = await call('memory-list', { id: firstBook.id, scope: 'notebook' });
  assert.equal(notebookMemory.status, 200);
  assert.equal(notebookMemory.value.topics[0].topic, 'Vectors');
  assert.equal(notebookMemory.value.topics[0].total, 2);

  const globalMemory = await call('memory-list', { scope: 'global' });
  assert.ok(globalMemory.value.memories.some((item) => item.kind === 'goal' && /Understand vectors/.test(item.body)));
  assert.equal(globalMemory.value.topics[0].correct, 1);
  assert.equal(globalMemory.value.topics[0].total, 2);

  const second = await call('create', { title: 'More linear algebra', goal: 'Master vector reasoning.' });
  const secondBook = second.value;
  await waitFor(secondBook.id, (value) => value.study?.map, 'the map');
  writeRecord(store, secondBook.id, 'quiz-b.json', {
    action: 'quiz_result', title: 'Vectors quiz', correct: 2, total: 2,
    topics: [{ topic: 'Vectors', correct: 2, total: 2 }],
  });
  await call('get', { id: secondBook.id });
  const merged = await call('memory-list', { scope: 'global' });
  const vectors = merged.value.topics.find((item) => item.topic === 'Vectors');
  assert.equal(vectors.total, 4);
  assert.equal(vectors.correct, 3);
  assert.deepEqual(new Set(vectors.notebooks), new Set(['Linear algebra', 'More linear algebra']));

  await call('delete', { id: firstBook.id });
  const afterDelete = await call('memory-list', { scope: 'global' });
  const remaining = afterDelete.value.topics.find((item) => item.topic === 'Vectors');
  assert.equal(remaining.total, 2);
  assert.equal(remaining.correct, 2);
  assert.deepEqual(remaining.notebooks, ['More linear algebra']);
});

test('sessions created directly in the notebook workspace are adopted into the notebook', async (t) => {
  const registry = { get: () => ({ sessionIds: ['session-native-1'] }) };
  const { call } = fixture(t, undefined, {
    readTitleSnapshots: async () => [{ value: { title: 'Native lesson' } }],
  }, registry);
  const { value: book } = await call('create', { title: 'Adopt' });
  await call('workspace-attach', { id: book.id, workspaceId: 'workspace-adopt-1' });
  const { value: detail } = await call('get', { id: book.id });
  const session = detail.sessions.find((item) => item.id === 'session-native-1');
  assert.ok(session);
  assert.equal(session.title, 'Native lesson');
  assert.equal(session.kind, 'agent');
});

test('export includes session transcripts when the history is available', async (t) => {
  const { call } = fixture(t, undefined, {
    readSurface: async () => ({
      events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: 'Teach me vectors.' }] } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'A vector is a list of numbers.' }] } } },
      ],
    }),
  });
  const { value: book } = await call('create', { title: 'Export' });
  await call('session-attach', { id: book.id, sessionId: 'session-export-1', title: 'Read vectors', kind: 'lesson', unitId: 'unit-1' });
  const { value: exported } = await call('export', { id: book.id });
  assert.equal(exported.transcripts.length, 1);
  assert.match(exported.transcripts[0].text, /Teach me vectors/);
  assert.match(exported.transcripts[0].text, /A vector is a list of numbers/);
});

test('manual memory, preferences, and the tutor workspace files', async (t) => {
  const { call } = fixture(t);
  const { value: book } = await call('create', { title: 'Memory workspace', goal: 'Learn attention.' });
  const saved = await call('memory-save', {
    id: book.id, scope: 'notebook', kind: 'misconception', topic: 'Softmax',
    title: 'Normalization direction', body: 'I divided by the maximum instead of the sum.',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.kind, 'misconception');
  const edited = await call('memory-save', {
    id: book.id, scope: 'notebook', memoryId: saved.value.id, kind: 'misconception',
    topic: 'Softmax', title: 'Normalization direction', body: 'Divide by the sum of exponentials.',
  });
  assert.equal(edited.value.body, 'Divide by the sum of exponentials.');
  await call('settings', { id: book.id, title: 'Memory workspace', instructions: 'Use short examples and check my work.' });
  const global = await call('memory-list', { scope: 'global' });
  assert.ok(global.value.memories.some((item) => item.kind === 'preference' && /short examples/.test(item.body)));
  const { value: prepared } = await call('prepare-agent', { id: book.id });
  assert.match(readFileSync(join(prepared.workspace, 'memory.md'), 'utf8'), /Normalization direction/);
  assert.match(readFileSync(join(prepared.workspace, 'AGENTS.md'), 'utf8'), /Deep Notebook tutor|memory\.md/);
  assert.match(readFileSync(join(prepared.workspace, '.agents', 'skills', 'notebook', 'SKILL.md'), 'utf8'), /quiz_result/);
  const brief = readFileSync(join(prepared.workspace, 'brief.md'), 'utf8');
  assert.match(brief, /Normalization direction/);
});
