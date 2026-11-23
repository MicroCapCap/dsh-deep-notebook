const MEMORY_KIND_LABELS = {
  profile: 'Profile',
  goal: 'Goal',
  preference: 'Preference',
  strength: 'Strength',
  weakness: 'Focus area',
  misconception: 'Misconception',
  strategy: 'What works',
  fact: 'Note',
};

function MemoryKind({ kind }) {
  return h('span', { className: `dn-memory-kind dn-memory-${kind}` }, MEMORY_KIND_LABELS[kind] ?? kind);
}

function MemoryDialog({ book, close, send, initialScope }) {
  const [scope, setScope] = useState(book ? initialScope ?? 'notebook' : 'global');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [draft, setDraft] = useState({ kind: 'fact', topic: '', title: '', body: '' });

  async function load(next = scope) {
    setBusy(true);
    setError('');
    try {
      const value = await send('memory-list', { scope: next });
      setData(value ?? { memories: [], topics: [] });
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(scope); }, [scope]);

  function startAdd() {
    setForm(null);
    setDraft({ kind: scope === 'global' ? 'preference' : 'fact', topic: '', title: '', body: '' });
    setForm('new');
  }

  function startEdit(memory) {
    setForm(memory.id);
    setDraft({ kind: memory.kind, topic: memory.topic, title: memory.title, body: memory.body });
  }

  async function save(event) {
    event.preventDefault();
    if (!draft.body.trim()) { setError('Write the memory first.'); return; }
    setBusy(true);
    setError('');
    try {
      await send('memory-save', {
        scope, memoryId: form === 'new' ? undefined : form,
        kind: draft.kind, topic: draft.topic, title: draft.title, body: draft.body,
      });
      setForm(null);
      await load();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  async function forget(memory) {
    if (!window.confirm(`Forget "${memory.title}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await send('memory-delete', { scope, memoryId: memory.id });
      await load();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  const topics = data?.topics ?? [];
  const memories = data?.memories ?? [];
  const groups = ['goal', 'preference', 'profile', 'strength', 'weakness', 'misconception', 'strategy', 'fact'];
  return h(Dialog, { title: 'Learner memory', close: () => { if (!busy) close(); }, wide: true },
    h('div', { className: 'dn-memory-head' },
      h('p', { className: 'dn-muted' },
        scope === 'global'
          ? 'What Deep Notebook remembers across all notebooks: goals, preferences, strengths, focus areas, and misconceptions.'
          : 'What this notebook knows about your learning. Quiz mistakes and completed lessons are added automatically.'),
      h('div', { className: 'dn-memory-tabs', role: 'tablist' },
        book && button('This notebook', () => { setForm(null); setScope('notebook'); }, {
          variant: scope === 'notebook' ? 'tab active' : 'tab', role: 'tab', 'aria-selected': scope === 'notebook',
        }),
        button('Across notebooks', () => { setForm(null); setScope('global'); }, {
          variant: scope === 'global' ? 'tab active' : 'tab', role: 'tab', 'aria-selected': scope === 'global',
        }),
        button('Add memory', startAdd, { variant: 'small', disabled: busy }))),
    form && h('form', { className: 'dn-form dn-memory-form', onSubmit: save },
      h('div', { className: 'dn-memory-form-grid' },
        field('Kind', h('select', {
          value: draft.kind, onChange: (event) => setDraft({ ...draft, kind: event.target.value }),
        }, Object.entries(MEMORY_KIND_LABELS).map(([value, label]) => h('option', { key: value, value }, label)))),
        field('Topic', h('input', {
          value: draft.topic, maxLength: 140, placeholder: 'e.g. Softmax weights',
          onChange: (event) => setDraft({ ...draft, topic: event.target.value }),
        }))),
      field('Headline', h('input', {
        value: draft.title, maxLength: 240, placeholder: 'A short label',
        onChange: (event) => setDraft({ ...draft, title: event.target.value }),
      })),
      field('Memory', h('textarea', {
        value: draft.body, rows: 4, maxLength: 4000, required: true,
        placeholder: 'What should future sessions know?',
        onChange: (event) => setDraft({ ...draft, body: event.target.value }),
      })),
      h('div', { className: 'dn-actions' },
        button('Cancel', () => setForm(null), { disabled: busy }),
        button(busy ? 'Saving…' : 'Save memory', undefined, { type: 'submit', variant: 'primary', disabled: busy }))),
    error && status(error, 'error'),
    topics.length > 0 && h('section', { className: 'dn-memory-mastery' },
      h('h3', null, scope === 'global' ? 'Mastery across notebooks' : 'Mastery in this notebook'),
      h('div', { className: 'dn-memory-mastery-grid' }, topics.map((item) =>
        h('div', { key: item.topic, className: `dn-memory-topic dn-topic-${item.state}` },
          h('strong', null, item.topic),
          h('span', null, item.total
            ? `${Math.round(item.accuracy * 100)}% · ${item.total} question${item.total === 1 ? '' : 's'}${item.lessons ? ` · ${item.lessons} lesson${item.lessons === 1 ? '' : 's'}` : ''}`
            : `${item.lessons} lesson${item.lessons === 1 ? '' : 's'} completed`),
          item.notebooks.length > 1 && h('small', null, item.notebooks.join(' · ')))))),
    !data && !error && status('Opening learner memory…'),
    data && !memories.length && h('div', { className: 'dn-memory-empty' },
      h('strong', null, 'Nothing remembered yet'),
      h('p', null, scope === 'global'
        ? 'Take a quiz or tell the notebook a preference, and it will start building a picture across notebooks.'
        : 'Submit a quiz or finish a lesson; mistakes and strengths will appear here automatically.')),
    memories.length > 0 && h('section', { className: 'dn-memory-list' }, groups.map((kind) => {
      const items = memories.filter((item) => item.kind === kind);
      if (!items.length) return null;
      return h('div', { key: kind, className: 'dn-memory-group' },
        h('h3', null, MEMORY_KIND_LABELS[kind]),
        items.map((item) => h('article', { key: item.id, className: 'dn-memory-row' },
          h('div', { className: 'dn-memory-row-head' },
            h(MemoryKind, { kind: item.kind }),
            h('strong', null, item.topic),
            h('span', { className: 'dn-memory-date' }, formatDate(item.updated))),
          h('h4', null, item.title),
          h('p', null, item.body),
          h('div', { className: 'dn-memory-row-foot' },
            h('small', null, [item.notebookTitle, item.source].filter(Boolean).join(' · ')),
            h('div', null,
              button('Edit', () => startEdit(item), { variant: 'text', disabled: busy }),
              button('Forget', () => void forget(item), { variant: 'text dn-danger-text', disabled: busy }))))));
    })));
}
