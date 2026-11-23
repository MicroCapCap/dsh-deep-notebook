const h = React.createElement;
const { useEffect, useRef, useState } = React;
const PANEL = 'deep-notebook';
const FORMATS = [
  ['report', 'Report', 'Turn evidence into a brief'],
  ['audio', 'Audio overview', 'Listen to a narrated summary'],
  ['guide', 'Study guide', 'Review key ideas and questions'],
  ['flashcards', 'Flashcards', 'Practice active recall'],
  ['quiz', 'Quiz', 'Test your understanding'],
  ['map', 'Mind map', 'Explore related concepts'],
  ['table', 'Data table', 'Compare findings in rows'],
  ['slides', 'Slide deck', 'Present your findings'],
  ['infographic', 'Infographic', 'See the main facts at a glance'],
  ['timeline', 'Timeline', 'Put events in order'],
];
const STUDIO_ICONS = {
  report: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
  audio: 'M3 10v4m4-7v10m5-14v18m5-14v10m4-7v4',
  guide: 'M3 5h4a5 5 0 0 1 5 5v10a5 5 0 0 0-5-5H3zm18 0h-4a5 5 0 0 0-5 5v10a5 5 0 0 1 5-5h4z',
  flashcards: 'M6 6h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm2-3h10M8 10h8m-8 4h5',
  quiz: 'M6 3h12v18H6zM9 8l1.2 1.2L13 6.5M9 14l1.2 1.2L13 12.5M15 8h.1m-.1 6h.1',
  map: 'M9 3h6v5H9zM3 16h6v5H3zm12 0h6v5h-6zM12 8v4m-6 4v-4h12v4',
  table: 'M3 5h18v14H3zM3 10h18M3 14h18M9 10v9m6-9v9',
  slides: 'M3 4h18v12H3zM12 16v5m-3 0h6M7 12l3-3 3 2 4-4',
  infographic: 'M4 20h16M6 16v-3m4 3V8m4 8v-5m4 5V5',
  timeline: 'M3 18 8 13l4 2 6-8m-3 0h3v3M3 21h18',
};
const KIND = { paste: 'Pasted text', file: 'File', web: 'Website', excerpt: 'Search excerpt', session: 'Harness chat', note: 'Notebook note' };
const FILE_TYPES = '.txt,.md,.markdown,.csv,.tsv,.json,.xml,.log,.rtf,.srt,.vtt,.pdf,.docx,.pptx,.xlsx,.epub';
const DOCUMENT_TYPES = /\.(?:pdf|docx|pptx|xlsx|epub)$/i;

function NotebookIcon({ size = 20 }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M6 3.5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Zm2 0v17M11.5 9h5M11.5 13h5M11.5 17h3' }));
}

function StudioIcon({ kind, size = 17 }) {
  const path = STUDIO_ICONS[kind];
  return path ? h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: path })) : h(NotebookIcon, { size });
}

const inject = ['slots', 'locale', 'layout', 'uiWorkspace', 'sessions', 'workspaces', 'remote', 'remote.session'];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(PANEL, { en: { label: 'Deep Notebook' }, zh: { label: '深度笔记本' } }));
  const t = ctx.locale.bind(PANEL);
  const navigation = notebookNavigation(ctx);
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL, locale: PANEL, inject: () => ({ navigation }),
  }, NotebookPage));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: PANEL, locale: PANEL, inject: () => ({ navigation, label: t('label') }),
  }, NotebookSidebarPortal));
  ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
    name: 'sidebar.panellist.actions', id: PANEL, order: -10, locale: PANEL,
  }, ({ onDismiss }) => h(DnMenuItem, {
    icon: h(NotebookIcon, { size: 16 }), onSelect: () => { onDismiss(); navigation.open({ kind: 'library' }); },
  }, t('label'))));
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item', id: PANEL, order: 140, locale: PANEL,
  }, function LinkSessionMenu({ sessionId, displayTitle, useMenuOpenState }) {
    const [, setMenuOpen] = useMenuOpenState();
    return h(DnMenuItem, {
      icon: h(NotebookIcon, { size: 16 }),
      onSelect: () => { setMenuOpen(false); navigation.open({ kind: 'link-session', sessionId, displayTitle }); },
    }, 'Add to notebook…');
  }));
}

async function request(op, fields = {}, signal) {
  const send = globalThis.__DSH_TRANSPORT__?.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await send('api/deep-notebook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...fields, op }), signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.error || `Notebook host unavailable (HTTP ${response.status}).`);
  return payload.value;
}

function cls(...classes) {
  return classes.filter(Boolean).join(' ');
}

function button(label, click, options = {}) {
  const { variant = '', className, ...props } = options;
  return h('button', { type: 'button', className: cls('dn-button', variant && `dn-${variant}`, className), onClick: click, ...props }, label);
}

function field(label, input) {
  return h('label', { className: 'dn-field' }, h('span', null, label), input);
}

function submit(handler) {
  return (event) => { event.preventDefault(); handler(); };
}

function status(message, variant = 'muted') {
  return h('p', { className: `dn-${variant}`, role: variant === 'error' ? 'alert' : 'status' }, message);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function filename(title) {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '') || 'notebook';
}

function download(title, extension, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.download = `${filename(title)}.${extension}`;
  anchor.href = url;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function citationList(citations, open) {
  return citations?.length ? h('div', { className: 'dn-citations' },
    citations.map((citation) => button(`[${citation.number}] ${citation.title}`, () => open(citation),
      { key: citation.number, variant: 'citation', title: `Line ${citation.line}` }))) : null;
}

function plainMath(value) {
  return String(value ?? '')
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$1')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|mathbb|mathcal)\{([^{}]*)\}/g, '$1')
    .replace(/\\left|\\right/g, '')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\leq?/g, '≤')
    .replace(/\\geq?/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\approx/g, '≈')
    .replace(/\\(?:to|rightarrow|Rightarrow)/g, '→')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\prod/g, '∏')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\[,;:!]/g, ' ')
    .replace(/\^\{([^{}]+)\}/g, '^$1')
    .replace(/_\{([^{}]+)\}/g, '_$1')
    .replace(/\\[a-zA-Z]+/g, '');
}

function inline(value, citations, open) {
  const index = new Map((citations ?? []).map((citation) => [citation.number, citation]));
  return (plainMath(value).match(/\[\d{1,4}\]|\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`]+`|[^\[\*`]+|./gu) ?? []).map((part, key) => {
    const citation = /^\[(\d+)\]$/.exec(part);
    if (citation && index.has(Number(citation[1]))) {
      const passage = index.get(Number(citation[1]));
      return button(part, () => open(passage), { key, variant: 'inline-cite', title: `${passage.title}, line ${passage.line}`, 'aria-label': `Citation ${citation[1]}: ${passage.title}` });
    }
    if (part.startsWith('**') && part.endsWith('**')) return h('strong', { key }, part.slice(2, -2));
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return h('em', { key }, part.slice(1, -1));
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return h('code', { key }, part.slice(1, -1));
    return part;
  });
}

function RichText({ value, citations, open }) {
  const blocks = [];
  let list = [];
  let ordered = false;
  let code = null;
  const flush = () => {
    if (list.length) blocks.push(h(ordered ? 'ol' : 'ul', { key: blocks.length }, list));
    list = [];
  };
  const lines = String(value ?? '').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\x60{3}/.test(line)) {
      flush();
      if (code === null) code = [];
      else {
        blocks.push(h('pre', { key: blocks.length }, code.join('\n')));
        code = null;
      }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    const pipeRow = /^\s*\|(.+)\|\s*$/.exec(line);
    const divider = index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1]) && lines[index + 1].includes('-');
    if (pipeRow && divider) {
      flush();
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const header = cells(line);
      const body = [];
      let cursor = index + 2;
      while (cursor < lines.length && /^\s*\|.*\|\s*$/.test(lines[cursor])) {
        body.push(cells(lines[cursor]));
        cursor += 1;
      }
      blocks.push(h('div', { key: blocks.length, className: 'dn-md-table-wrap' },
        h('table', { className: 'dn-md-table' },
          h('thead', null, h('tr', null, header.map((cell, order) => h('th', { key: order }, inline(cell, citations, open))))),
          h('tbody', null, body.map((row, rowIndex) => h('tr', { key: rowIndex },
            row.map((cell, order) => h('td', { key: order }, inline(cell, citations, open)))))))));
      index = cursor - 1;
      continue;
    }
    const bullet = /^\s*((?:[-*+])|(?:\d+\.))\s+(.*)$/.exec(line);
    if (bullet) {
      const nextOrdered = bullet[1].endsWith('.');
      if (list.length && ordered !== nextOrdered) flush();
      ordered = nextOrdered;
      list.push(h('li', { key: list.length }, inline(bullet[2], citations, open)));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) blocks.push(h(`h${Math.min(5, heading[1].length + 1)}`, { key: blocks.length }, inline(heading[2], citations, open)));
    else if (/^[-*_]{3,}$/.test(line.trim())) blocks.push(h('hr', { key: blocks.length }));
    else if (line.startsWith('> ')) blocks.push(h('blockquote', { key: blocks.length }, inline(line.slice(2), citations, open)));
    else blocks.push(h('p', { key: blocks.length }, inline(line, citations, open)));
  }  flush();
  if (code !== null) blocks.push(h('pre', { key: blocks.length }, code.join('\n')));
  return h('div', { className: 'dn-rich' }, blocks);
}

function Dialog({ title, close, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      previous?.focus?.();
    };
  }, []);
  const titleId = React.useId();
  return h('dialog', {
    ref, className: cls('dn-dialog', wide && 'dn-wide'), 'aria-labelledby': titleId,
    onCancel: (event) => { event.preventDefault(); close(); },
  },
  h('header', { className: 'dn-dialog-head' }, h('h2', { id: titleId }, title), button('×', close, { variant: 'icon', 'aria-label': 'Close' })),
  h('div', { className: 'dn-dialog-body' }, children));
}

function FormDialog({ modal, close, book, models, onRun }) {
  const editing = modal.mode === 'settings';
  const note = modal.mode === 'note';
  const [title, setTitle] = useState(modal.title ?? (editing ? book.title : modal.note?.title ?? ''));
  const [body, setBody] = useState(note ? modal.note?.body ?? modal.body ?? '' : editing ? book.instructions : '');
  const [selection, setSelection] = useState(editing && book.model ? JSON.stringify([book.model.provider, book.model.id]) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (editing) {
        const [provider, id] = selection ? JSON.parse(selection) : [];
        await onRun('settings', { title, instructions: body, model: selection ? { provider, id } : null });
      } else if (note) {
        await onRun('save-note', { title, body, noteId: modal.note?.id, messageId: modal.messageId });
      } else if (modal.mode === 'source-rename') {
        await onRun('source-update', { title, sourceId: modal.sourceId });
      }
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const headings = { settings: 'Notebook settings', note: modal.note ? 'Edit note' : 'Save note', 'source-rename': 'Rename source' };
  return h(Dialog, { title: headings[modal.mode], close: () => { if (!busy) close(); } },
    h('form', { className: 'dn-form', onSubmit: submit(save) },
      field('Title', h('input', { value: title, onChange: (e) => setTitle(e.target.value), required: true, autoFocus: true, maxLength: modal.mode === 'source-rename' ? 180 : 140 })),
      note && field('Note', h('textarea', { value: body, onChange: (e) => setBody(e.target.value), required: true, rows: 9, maxLength: 600000 })),
      editing && field('Course style', h('textarea', {
        value: body, onChange: (e) => setBody(e.target.value), rows: 5, maxLength: 3500,
        placeholder: 'Example: Short lessons, intuition before formulas, one worked example. Do not add global answer-format sections.',
      })),
      editing && h('p', { className: 'dn-muted' }, 'Used by every session in this notebook. It takes precedence over global answer-format instructions.'),
      editing && field('Model for planning and Studio', h('select', { value: selection, onChange: (e) => setSelection(e.target.value) },
        h('option', { value: '' }, 'Automatic'),
        selection && !models?.some((m) => JSON.stringify([m.provider, m.id]) === selection)
          ? h('option', { value: selection }, book.model?.name || 'Saved model') : null,
        models?.map((model) => {
          const value = JSON.stringify([model.provider, model.id]);
          return h('option', { key: value, value }, `${model.name} · ${model.provider}`);
        }))),
      error && status(error, 'error'),
      h('div', { className: 'dn-actions' }, button('Cancel', close, { disabled: busy }),
        button(busy ? 'Saving…' : 'Save', undefined, { type: 'submit', variant: 'primary', disabled: busy }))));
}

function asBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function SourcesDialog({ close, send }) {
  const [tab, setTab] = useState('Files');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [session, setSession] = useState('');
  const [sessions, setSessions] = useState(null);
  const [results, setResults] = useState(null);
  const [imported, setImported] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const input = useRef();
  async function perform(task) {
    setBusy(true);
    setError('');
    try { await task(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function add(fields, shouldClose = true) {
    await send('add-source', fields);
    if (shouldClose) close();
  }
  function changeTab(next) {
    setError('');
    setTab(next);
    if (next === 'Harness chat' && sessions === null) {
      void perform(async () => setSessions(await send('sessions', {}, false)));
    }
  }
  async function addFiles(files) {
    if (busy || !files.length) return;
    await perform(async () => {
      const failures = [];
      for (const file of files) {
        try {
          if (file.size > 12 * 1024 * 1024) throw new Error('Exceeds 12 MB.');
          if (DOCUMENT_TYPES.test(file.name)) {
            await add({ kind: 'document', title: file.name, base64: await asBase64(file) }, false);
          } else {
            if (!FILE_TYPES.split(',').some((extension) => file.name.toLowerCase().endsWith(extension))) throw new Error('Unsupported file extension.');
            await add({ kind: 'file', title: file.name, body: await file.text() }, false);
          }
          setImported((names) => [...names, file.name]);
        } catch (err) {
          failures.push(`${file.name}: ${err.message}`);
        }
      }
      if (failures.length) throw new Error(failures.join('\n'));
    });
  }
  const tabs = ['Files', 'Paste text', 'Website', 'Discover', 'Harness chat'];
  const confirm = (label, task, disabled) => h('form', { className: 'dn-form', onSubmit: submit(() => perform(task)) },
    tab === 'Paste text' && h(React.Fragment, null,
      field('Source title', h('input', { required: true, maxLength: 180, value: title, onChange: (e) => setTitle(e.target.value) })),
      field('Text', h('textarea', { required: true, rows: 8, maxLength: 600000, value: body, onChange: (e) => setBody(e.target.value) }))),
    tab === 'Website' && field('Public page URL', h('input', { type: 'url', required: true, value: url, placeholder: 'https://example.com/article', onChange: (e) => setUrl(e.target.value) })),
    tab === 'Discover' && field('Research topic', h('input', { required: true, maxLength: 400, value: query, onChange: (e) => setQuery(e.target.value), placeholder: 'What would you like to research?' })),
    tab === 'Harness chat' && field('Recent conversations', h('select', { value: session, onChange: (e) => setSession(e.target.value), required: true },
      h('option', { value: '' }, sessions?.length ? 'Choose a conversation' : 'No conversations available'),
      sessions?.map((item) => h('option', { key: item.id, value: item.id }, `${item.title}${item.date ? ` · ${formatDate(item.date)}` : ''}`)))),
    h('div', { className: 'dn-actions' }, button(busy ? 'Working…' : label, undefined, { type: 'submit', variant: 'primary', disabled: busy || disabled })));
  return h(Dialog, { title: 'Add sources', close: () => { if (!busy) close(); }, wide: true },
    h('div', { className: 'dn-tabs', 'aria-label': 'Import method' },
      tabs.map((item) => button(item, () => changeTab(item), { key: item, variant: tab === item ? 'tab active' : 'tab', 'aria-pressed': tab === item, disabled: busy }))),
    tab === 'Files' && h('div', {
      className: cls('dn-drop', dragging && 'dn-drag'), onDragOver: (e) => { e.preventDefault(); setDragging(true); },
      onDragLeave: () => setDragging(false),
      onDrop: (e) => { e.preventDefault(); setDragging(false); void addFiles(Array.from(e.dataTransfer.files)); },
    },
    h('input', { ref: input, type: 'file', hidden: true, accept: FILE_TYPES, multiple: true, onChange: (e) => { void addFiles(Array.from(e.target.files)); e.target.value = ''; } }),
    h('span', { className: 'dn-drop-mark', 'aria-hidden': true }, '↑'),
    h('strong', null, 'Drop files here'),
    h('small', null, 'PDF, Word, PowerPoint, Excel, ePub, Markdown, CSV, or text · up to 12 MB each'),
    button(busy ? 'Importing…' : 'Choose files', () => input.current.click(), { disabled: busy, variant: 'primary' })),
    tab === 'Paste text' && confirm('Add text', () => add({ kind: 'paste', title, body })),
    tab === 'Website' && confirm('Import page', () => add({ kind: 'web', url })),
    tab === 'Discover' && confirm('Find sources', async () => setResults(await send('discover', { query }, false))),
    tab === 'Harness chat' && confirm('Import transcript', () => add({ kind: 'session', sessionId: session, title: sessions?.find((item) => item.id === session)?.title }), !session),
    tab === 'Discover' && results && (results.length ? h('div', { className: 'dn-results' }, results.map((result) => h('article', { key: result.url },
      h('div', null, h('strong', null, result.title), h('small', null, result.url), result.excerpt && h('p', null, result.excerpt)),
      button(imported.includes(result.url) ? 'Added' : 'Import', () => perform(async () => {
        await add({ ...result, kind: 'web' }, false);
        setImported((items) => [...items, result.url]);
      }), { disabled: busy || imported.includes(result.url) })))) : status('No web sources found. Try a different query.')),
    imported.some((item) => !/^https?:/.test(item)) && h('p', { className: 'dn-success', role: 'status' }, `Imported: ${imported.filter((item) => !/^https?:/.test(item)).join(', ')}`),
    error && status(error, 'error'));
}

function Evidence({ book, change, send, openSource, openPassage, onClose }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const selected = book.sources.filter((source) => source.enabled).length;
  async function search() {
    setWorking(true);
    setError('');
    try { setHits(await send('find', { query, scope: book.sources.map((source) => source.id) })); }
    catch (err) { setError(err.message); }
    finally { setWorking(false); }
  }
  return h('aside', { className: 'dn-evidence' },
    h('div', { className: 'dn-pane-head' },
      h('div', null, h('h2', null, 'Sources'), h('small', null, `${selected} of ${book.sources.length} selected`)),
      h('div', { className: 'dn-pane-actions' },
        button('+ Add', () => change({ mode: 'sources' }), { variant: 'small', 'aria-label': 'Add sources' }),
        onClose && button('×', onClose, { variant: 'icon', 'aria-label': 'Close sources' }))),
    book.sources.length ? h(React.Fragment, null,
      h('form', { className: 'dn-source-search', onSubmit: submit(search) },
        h('input', {
          value: query, onChange: (event) => { setQuery(event.target.value); setHits(null); }, required: true, maxLength: 400,
          placeholder: 'Find a passage…', 'aria-label': 'Search notebook sources',
        }),
        button(working ? '…' : '⌕', undefined, { type: 'submit', variant: 'icon', disabled: working, 'aria-label': 'Search sources' })),
      error && status(error, 'error'),
      hits ? h('div', { className: 'dn-scroll dn-source-list' },
        h('div', { className: 'dn-list-actions' }, h('span', null, `${hits.length} passages`), button('Clear', () => { setHits(null); setQuery(''); }, { variant: 'text' })),
        hits.map((hit) => button(h(React.Fragment, null, h('strong', null, hit.title), h('small', null, `Line ${hit.line}`), h('span', null, hit.text.trim().slice(0, 160))), () => openPassage(hit),
          { key: `${hit.sourceId}-${hit.start}`, variant: 'hit' }))) :
        h('div', { className: 'dn-scroll dn-source-list' },
          h('div', { className: 'dn-list-actions' },
            h('span', null, 'Include in answers'),
            button(selected === book.sources.length ? 'Clear' : 'Select all',
              () => void send('select-all', { enabled: selected !== book.sources.length }).catch((err) => setError(err.message)), { variant: 'text' })),
          book.sources.map((source) => h('div', { className: 'dn-source-row', key: source.id },
            h('input', {
              type: 'checkbox', checked: source.enabled, 'aria-label': `Include ${source.title}`,
              onChange: (event) => void send('source-update', { sourceId: source.id, enabled: event.target.checked }).catch((err) => setError(err.message)),
            }),
            button(h(React.Fragment, null, h('strong', null, source.title),
              h('small', null, `${KIND[source.kind] ?? source.kind}${source.truncated ? ' · Truncated' : ''}`)), () => openSource(source.id), { variant: 'source' }))))) :
      h('div', { className: 'dn-pane-empty' }, h(NotebookIcon, { size: 27 }), h('strong', null, 'Start with a source'), h('p', null, 'Import a document, a public page, or a Harness conversation.')));
}

function IdeasPane({ book, openSession, openSessionNative, change }) {
  const sessions = book.sessions ?? [];
  const chats = book.chats ?? [];
  return h('section', { className: 'dn-conversation', 'aria-label': 'Notebook sessions' },
    h('div', { className: 'dn-pane-head dn-convo-head' },
      h('div', null, h('h2', null, 'Sessions'), h('small', { className: 'dn-model-name' }, 'Each conversation runs in its own Harness session')),
      h('div', { className: 'dn-convo-control' },
        button('New Session', () => openSession({ kind: 'chat' }), { variant: 'small' }))),
    h('div', { className: 'dn-chat-scroll dn-scroll' },
      sessions.length
        ? h('div', { className: 'dn-starters' }, sessions.map((session) =>
          button(h(React.Fragment, null, session.title, h('span', { 'aria-hidden': true }, '↗')),
            () => openSessionNative(session.id), { key: session.id, variant: 'starter' })))
        : h('div', { className: 'dn-chat-empty' },
          h('div', { className: 'dn-emblem' }, h(NotebookIcon, { size: 29 })),
          h('h3', null, 'Start a conversation'),
          h('p', null, 'Ask about the selected sources. Each conversation opens as a Harness session.')),
      chats.length > 0 && h('div', { className: 'dn-past-chat-list' },
        h('h3', null, 'Earlier conversations'),
        chats.map((chat) => button(chat.title, () => change({ mode: 'archive-chat', chat }), { key: chat.id, variant: 'text' })))));
}

function ArchiveChatDialog({ chat, close }) {
  return h(Dialog, { title: chat.title, close, wide: true },
    h('p', { className: 'dn-muted' }, 'Saved before the notebook moved to Harness sessions. Read-only.'),
    (chat.messages ?? []).map((message) => h('article', { key: message.id, className: cls('dn-message', message.role === 'user' && 'dn-user-message') },
      h('strong', null, message.role === 'user' ? 'You' : 'Notebook'),
      message.role === 'user'
        ? h('p', { className: 'dn-user-text' }, message.text)
        : h(RichText, { value: message.text, citations: message.citations, open: () => {} }))));
}

function Studio({ book, change }) {
  const [tab, setTab] = useState('Studio');
  const ready = book.sources.some((source) => source.enabled);
  return h('aside', { className: 'dn-studio' },
    h('div', { className: 'dn-pane-head' },
      h('div', { className: 'dn-tabs', 'aria-label': 'Saved materials' }, ['Studio', 'Notes'].map((item) => button(item, () => setTab(item), {
        key: item, variant: tab === item ? 'tab active' : 'tab', 'aria-pressed': tab === item,
      }))),
      tab === 'Notes' && button('+ Note', () => change({ mode: 'note' }), { variant: 'small' })),
    h('div', { className: 'dn-scroll dn-studio-body' },
      tab === 'Studio' ? h(React.Fragment, null,
        h('div', { className: 'dn-formats', 'aria-label': 'Studio formats' }, FORMATS.map(([kind, title, description]) =>
          button(h(React.Fragment, null, h('span', { className: 'dn-format-icon' }, h(StudioIcon, { kind })), h('strong', null, title)),
            () => change({ mode: 'generate', kind, title }), { key: kind, variant: 'format', disabled: !ready, title: description }))),
        h('div', { className: 'dn-saved' },
          h('h3', null, 'Saved artifacts'),
          book.artifacts.length ? book.artifacts.map((artifact) => {
            const format = FORMATS.find(([kind]) => kind === artifact.kind);
            return button(h(React.Fragment, null, h('span', { className: 'dn-saved-icon' }, h(StudioIcon, { kind: artifact.kind })),
              h('span', null, h('strong', null, artifact.title), h('small', null, `${format?.[1]} · ${formatDate(artifact.created)}`))),
            () => change({ mode: 'artifact', artifact }), { key: artifact.id, variant: 'saved-item' });
          }) : status(ready ? 'Choose a format to create an artifact.' : 'Select a source to create an artifact.'))) :
        h('div', { className: 'dn-notes' },
          book.notes.length ? book.notes.map((note) => button(h(React.Fragment, null, h('strong', null, note.title), h('small', null, note.body.slice(0, 120))), () => change({ mode: 'read-note', note }),
            { key: note.id, variant: 'hit' })) : status('Write a note or save an answer from the conversation.'))));
}

function GenerateDialog({ modal, close, send, showArtifact }) {
  const [focus, setFocus] = useState('');
  const [title, setTitle] = useState(modal.title);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef();
  async function generate() {
    const controller = new AbortController();
    current.current = controller;
    setError('');
    setBusy(true);
    try {
      const next = await send('generate', { kind: modal.kind, title, prompt: focus }, controller.signal);
      showArtifact(next.artifacts[0]);
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const dismiss = () => { current.current?.abort(); close(); };
  useEffect(() => () => current.current?.abort(), []);
  return h(Dialog, { title: `Create ${modal.title.toLowerCase()}`, close: dismiss },
    h('form', { className: 'dn-form', onSubmit: submit(generate) },
      field('Title', h('input', { value: title, onChange: (event) => setTitle(event.target.value), maxLength: 140, required: true, disabled: busy })),
      field('Focus (optional)', h('textarea', { value: focus, onChange: (event) => setFocus(event.target.value), rows: 4, maxLength: 6000, disabled: busy, placeholder: 'Add a topic, audience, or level of detail.' })),
      busy && status('Creating from the selected sources…'), error && status(error, 'error'),
      h('div', { className: 'dn-actions' }, button(busy ? 'Stop' : 'Cancel', dismiss),
        button(busy ? 'Creating…' : 'Generate', undefined, { type: 'submit', variant: 'primary', disabled: busy }))));
}

function csvCell(value) {
  const cell = String(value ?? '');
  return `"${(/^[\s\uFEFF]*[=+@-]/u.test(cell) ? "'" + cell : cell).replace(/"/g, '""')}"`;
}

function exportArtifact(artifact) {
  const { title, data, kind, citations } = artifact;
  if (kind === 'table') {
    const rows = [data.columns, ...data.rows];
    if (citations.length) {
      rows.push([], ['Citation', 'Source', 'Line', 'URL', 'Passage']);
      for (const citation of citations) rows.push([`[${citation.number}]`, citation.title, citation.line, citation.url, citation.text]);
    }
    download(title, 'csv', '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  } else if (kind === 'slides') {
    download(title, 'html', slideDocument(artifact), 'text/html;charset=utf-8');
  } else if (typeof data === 'string') {
    download(title, 'md', `# ${title}\n\n${data}${evidenceMarkdown(citations)}`, 'text/markdown;charset=utf-8');
  } else download(title, 'json', JSON.stringify(artifact, null, 2), 'application/json');
}

function evidenceMarkdown(citations) {
  return citations?.length ? '\n\n### Evidence\n\n' + citations.map((c) =>
    `- [${c.number}] ${c.title} (line ${c.line})${c.url ? ' · ' + c.url : ''}\n\n${c.text.trim().split('\n').map((line) => '> ' + line).join('\n')}`).join('\n\n') : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (symbol) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[symbol]);
}

function slideDocument(artifact) {
  const escape = escapeHtml;
  const slides = artifact.data.slides.map(({ title, points, notes }) => `<section><h2>${escape(title)}</h2><ul>${points.map((point) => `<li>${escape(point)}</li>`).join('')}</ul>${notes ? `<details><summary>Speaker notes</summary><p>${escape(notes)}</p></details>` : ''}</section>`).join('');
  const evidence = artifact.citations.map((c) => `<details><summary>[${c.number}] ${escape(c.title)} · line ${c.line}</summary><p>${escape(c.text)}</p></details>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><title>${escape(artifact.title)}</title><style>body{background:#111b24;color:#e9f2f0;font:18px/1.65 system-ui;max-width:63rem;margin:auto;padding:2rem}section{min-height:65vh;padding:3vw;margin:2rem 0;background:#1b2b37;border:1px solid #40545d;border-radius:20px;break-after:page}h2{font-size:clamp(2rem,5vw,4rem);color:#9cdec4;line-height:1.15}li{margin:1rem 0}details{margin:.7rem 0}summary{cursor:pointer}@media print{body,section{background:white;color:black}h2{color:black}}</style><h1>${escape(artifact.title)}</h1>${slides}<h2>Evidence</h2>${evidence}</html>`;
}

function exportNotebook(book, format) {
  if (format === 'json') return download(book.title, 'json', JSON.stringify({ version: 2, notebook: book }, null, 2), 'application/json');
  const sources = book.sources.map((source) => `### ${source.title}\n\n${source.url ? source.url + '\n\n' : ''}${source.body}`).join('\n\n');
  const chats = book.chats.map((chat) => `### ${chat.title}\n\n${chat.messages.map((message) => `#### ${message.role === 'user' ? 'You' : 'Notebook'}\n\n${message.text}${evidenceMarkdown(message.citations)}`).join('\n\n')}`).join('\n\n');
  const transcripts = (book.transcripts ?? []).map((session) =>
    `### ${session.title}\n\n_Session ${session.id} · ${session.kind}_\n\n${session.text}`).join('\n\n');
  const notes = book.notes.map((note) => `### ${note.title}\n\n${note.body}${evidenceMarkdown(note.citations)}`).join('\n\n');
  const artifacts = book.artifacts.map((artifact) => `### ${artifact.title}\n\n${typeof artifact.data === 'string' ? artifact.data : JSON.stringify(artifact.data, null, 2)}${evidenceMarkdown(artifact.citations)}`).join('\n\n');
  const links = book.sessions?.length ? '\n\n## Sessions\n\n' + book.sessions.map((session) => `- ${session.title} (${session.id})`).join('\n') : '';
  const study = book.study ? '\n\n' + studyMarkdown(book.study) : '';
  return download(book.title, 'md', `# ${book.title}\n\n${book.instructions ? book.instructions + '\n\n' : ''}## Sources\n\n${sources}\n\n## Conversations\n\n${chats}${transcripts ? '\n\n## Harness sessions\n\n' + transcripts : ''}${links}${study}\n\n## Notes\n\n${notes}\n\n## Artifacts\n\n${artifacts}`, 'text/markdown;charset=utf-8');
}

function StudyCards({ data, quiz, render }) {
  const questions = quiz ? data.questions : data.cards;
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState({});
  const question = questions[index];
  const chosen = answers[index];
  const count = Object.keys(answers).length;
  const correct = questions.reduce((sum, item, position) => sum + Number(answers[position] === item.answer), 0);
  function move(next) { setIndex(next); setRevealed(false); }
  return h('section', { className: 'dn-study' },
    h('div', { className: 'dn-study-progress' }, h('span', null, `${quiz ? 'Question' : 'Card'} ${index + 1} of ${questions.length}`),
      quiz && h('small', null, count ? `${correct} correct · ${count} answered` : 'Pick an answer')),
    h('progress', { 'aria-label': 'Study progress', value: quiz ? count : index + 1, max: questions.length }),
    h('h3', null, render(quiz ? question.question : question.front)),
    quiz ? h('div', { className: 'dn-quiz-options' }, question.options.map((option, i) =>
      button(render(option), () => setAnswers({ ...answers, [index]: i }), {
        key: i, disabled: chosen != null, variant: chosen == null ? '' : i === question.answer ? 'correct' : i === chosen ? 'incorrect' : '',
      }))) : button(revealed ? 'Hide answer' : 'Reveal answer', () => setRevealed(!revealed), { variant: 'primary' }),
    (quiz ? chosen != null : revealed) && h('div', { className: 'dn-reveal', 'aria-live': 'polite' },
      quiz && h('strong', null, chosen === question.answer ? 'Correct' : `Correct answer: ${question.options[question.answer]}`),
      h('p', null, render(quiz ? question.explanation : question.back))),
    h('div', { className: 'dn-actions' },
      quiz && button('Reset quiz', () => { setAnswers({}); move(0); }, { disabled: !count }),
      button('Previous', () => move(index - 1), { disabled: index === 0 }),
      button('Next', () => move(index + 1), { disabled: index === questions.length - 1 })));
}

function AudioOverview({ value }) {
  const synth = globalThis.speechSynthesis;
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => synth?.cancel(), [synth]);
  function toggle() {
    if (playing) { synth.cancel(); setPlaying(false); return; }
    setError('');
    const speech = new SpeechSynthesisUtterance(value.replace(/\[\d+\]/g, ''));
    speech.onend = () => setPlaying(false);
    speech.onerror = (event) => {
      setPlaying(false);
      if (!['canceled', 'interrupted'].includes(event.error)) setError('Speech playback is unavailable. The full script is below.');
    };
    setPlaying(true);
    synth.speak(speech);
  }
  return h('div', { className: 'dn-audio' }, synth ? button(playing ? 'Stop playback' : '▶ Play overview', toggle, { variant: 'primary' }) :
    status('Speech playback is unavailable on this system.'), error && status(error, 'error'));
}

function SlideViewer({ data, render }) {
  const [slide, setSlide] = useState(0);
  const frame = useRef();
  const current = data.slides[slide];
  return h('div', { ref: frame, className: 'dn-slide-view', tabIndex: 0, onKeyDown: (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setSlide((number) => Math.max(0, Math.min(number + (event.key === 'ArrowRight' ? 1 : -1), data.slides.length - 1)));
  } },
  h('div', { className: 'dn-slide-frame' },
    h('small', null, `Slide ${slide + 1} / ${data.slides.length}`),
    h('h3', null, render(current.title)), h('ul', null, current.points.map((point, index) => h('li', { key: index }, render(point))))),
  h('div', { className: 'dn-actions' },
    button('Previous', () => setSlide(slide - 1), { disabled: slide === 0 }),
    button('Next', () => setSlide(slide + 1), { disabled: slide === data.slides.length - 1 })),
  current.notes && h('details', { className: 'dn-details' }, h('summary', null, 'Speaker notes'), h('p', null, render(current.notes))));
}

function ArtifactView({ artifact, open }) {
  const { kind, data, citations } = artifact;
  const render = (value) => inline(value, citations, open);
  switch (kind) {
    case 'flashcards': return h(StudyCards, { data, render });
    case 'quiz': return h(StudyCards, { data, quiz: true, render });
    case 'map': return h('div', { className: 'dn-mindmap' }, h('h3', null, render(data.root)),
      data.branches.map((branch, index) => h('details', { key: index, className: 'dn-details' },
        h('summary', null, render(branch.title)), h('ul', null, branch.items.map((item, i) => h('li', { key: i }, render(item)))))));
    case 'table': return h('div', { className: 'dn-table-scroll' }, h('table', null,
      h('thead', null, h('tr', null, data.columns.map((column, i) => h('th', { key: i, scope: 'col' }, render(column))))),
      h('tbody', null, data.rows.map((row, n) => h('tr', { key: n }, row.map((cell, i) => h('td', { key: i }, render(cell))))))));
    case 'slides': return h(SlideViewer, { data, render });
    case 'infographic': return h('section', { className: 'dn-infographic' }, h('h3', null, render(data.title)),
      h('div', null, data.items.map((item, i) => h('article', { key: i },
        h('small', null, render(item.label)), h('strong', null, render(item.value)), h('p', null, render(item.detail))))));
    case 'timeline': return h('ol', { className: 'dn-timeline' }, data.events.map((event, i) => h('li', { key: i },
      h('small', null, render(event.date)), h('h3', null, render(event.title)), h('p', null, render(event.detail)))));
    default: return h(React.Fragment, null, kind === 'audio' && h(AudioOverview, { value: data }),
      h(RichText, { value: data, citations, open }));
  }
}

function Confirmation({ modal, close, send }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try { await send(modal.op, modal.fields); close(); } catch (err) { setError(err.message); setBusy(false); }
  }
  return h(Dialog, { title: modal.title, close: () => { if (!busy) close(); } },
    modal.detail && h('p', { className: 'dn-record-title' }, modal.detail),
    error && status(error, 'error'),
    h('div', { className: 'dn-actions' }, button('Cancel', close, { disabled: busy }),
      button(busy ? 'Deleting…' : 'Delete', confirm, { variant: 'danger', disabled: busy })));
}

function RenameDialog({ modal, close, send }) {
  const [title, setTitle] = useState(modal.title ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault();
    const value = title.trim();
    if (!value) { setError('Enter a notebook name.'); return; }
    setBusy(true);
    setError('');
    try {
      await send('rename', { title: value, ...(modal.id ? { id: modal.id } : {}) });
      close();
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
    }
  }
  return h(Dialog, { title: 'Rename notebook', close: () => { if (!busy) close(); } },
    h('form', { className: 'dn-form', onSubmit: save },
      field('Notebook name', h('input', {
        value: title, maxLength: 140, autoFocus: true, required: true,
        onChange: (event) => setTitle(event.target.value),
      })),
      error && status(error, 'error'),
      h('div', { className: 'dn-actions' }, button('Cancel', close, { disabled: busy }),
        button(busy ? 'Saving…' : 'Save', undefined, { type: 'submit', variant: 'primary', disabled: busy || !title.trim() }))));
}

function courseStyle(book) {
  const style = String(book?.instructions ?? '').trim();
  return `\nAnswer in English unless my course style explicitly asks for another language.${style
    ? `\nMy course style (this takes precedence over any global answer-format rules): ${style}`
    : ''}\n`;
}

function lessonPrompt(unit, book) {
  const study = book?.study ?? {};
  return `Teach me the lesson "${unit.title}".

My learning goal: ${study.goal || 'not set'}
My level: ${study.level || 'intermediate'}
Objective: ${unit.objective}
Topics: ${(unit.topics ?? []).join(', ')}
About ${unit.minutes} minutes.
${courseStyle(book)}
Teach it in whatever form fits it best — clear prose, tables, a worked example, common mistakes, and key takeaways. Use brief.md, memory.md, and your tools whenever they help. End by asking if I want a quick quiz.`;
}

function quizPrompt(unit, book) {
  return `Quiz me on this lesson${unit?.topics?.[0] ? ` (${unit.topics[0]})` : ''}. Use the question tool (ask_user_question) with clickable multiple-choice options. Ask me how many questions I want, or default to 5. You can ask one at a time and explain after each answer, or ask the whole batch and then explain everything I missed. Never reveal an answer before I answer, and do not shorten explanations. When the quiz ends, report the score with the notebook skill.
${courseStyle(book)}`;
}

function planPrompt(book) {
  const study = book.study ?? {};
  const units = (study.plan?.units ?? []).map((unit, index) =>
    `${index + 1}. ${unit.title} (${unit.minutes} min${unit.completed ? ', completed' : ''}) — ${unit.objective}`).join('\n');
  return `My learning goal: ${study.goal || 'not set'}
Level: ${study.level || 'intermediate'}
Daily time: ${study.dailyMinutes || 20} minutes${study.examDate ? `\nTarget date: ${study.examDate}` : ''}
${courseStyle(book)}
My lesson plan:
${units || 'No lesson plan yet.'}

Show me this week's priorities day by day. Ask me to adjust the pace or order if needed.`;
}

function setupPrompt(book) {
  return `Help me set up my "${book.title}" notebook. Ask me what I want to be able to do, my level, how many minutes I can study each day, and whether I have a deadline. When we agree on the goal, record it with the notebook skill (action "goal"), then tell me to return to the notebook.
${courseStyle(book)}`;
}

function quizFromTopicsPrompt(book, kind) {
  const topics = (book.study?.map?.topics ?? []).map((topic) => topic.title).join('; ');
  const intro = kind === 'diagnostic' ? 'Quiz me to find my starting point' : 'Give me a practice quiz';
  return `${intro}${topics ? ` on: ${topics}` : ''}. Use the question tool (ask_user_question) with clickable multiple-choice options. Ask me how many questions I want, or default to 5. You can ask one at a time and explain after each answer, or ask the whole batch and then explain everything I missed. Never reveal an answer before I answer, and do not shorten explanations. When the quiz ends, report the score with the notebook skill.
${courseStyle(book)}`;
}

function NotebookPage({ navigation }) {
  const [library, setLibrary] = useState(null);
  const [book, setBook] = useState(null);
  const [modal, setModal] = useState(null);
  const [passage, setPassage] = useState(null);
  const [models, setModels] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const current = useRef('');
  const changed = useRef(0);
  const menu = useRef();
  const autoChat = useRef(false);
  const autoArchive = useRef('');
  const id = book?.id;
  const { intent } = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot);
  const panelState = React.useSyncExternalStore(
    (listener) => navigation.panel.subscribe(listener), () => navigation.panel.getSnapshot(),
  );

  async function refresh() {
    const list = await request('list');
    setLibrary(list);
    return list;
  }
  function openBook(item) {
    current.current = item?.id ?? '';
    changed.current++;
    setBook(item);
    navigation.select(current.current, '');
    setPassage(null);
    setActive(null);
    setSourcesOpen(false);
    setCreating(false);
  }
  async function load(notebookId, afterLoad) {
    const token = ++changed.current;
    setLoading(true);
    setError('');
    try {
      const data = await request('get', { id: notebookId });
      if (token === changed.current) {
        setLoading(false);
        openBook(data);
        afterLoad?.();
      }
    } catch (err) {
      if (token === changed.current) setError(err.message);
    } finally {
      if (token === changed.current) setLoading(false);
    }
  }
  async function refreshCurrent() {
    if (!current.current) return;
    try {
      const data = await request('get', { id: current.current });
      if (data?.id === current.current) setBook(data);
    } catch { /* The banner already carries a hard failure. */ }
  }
  useEffect(() => {
    const controller = new AbortController();
    request('list', {}, controller.signal).then((list) => {
      setLibrary(list);
      if (list.length && !current.current && changed.current === 0 && !navigation.snapshot().intent) void load(list[0].id);
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => { controller.abort(); changed.current++; };
  }, []);

  const wasActive = useRef(false);
  useEffect(() => {
    const activeNow = panelState.activePanelId === PANEL;
    if (activeNow && !wasActive.current && current.current) void refreshCurrent();
    wasActive.current = activeNow;
  }, [panelState.activePanelId]);

  useEffect(() => {
    if (!book?.study?.building) return;
    const timer = setInterval(() => { void refreshCurrent(); }, 2500);
    return () => clearInterval(timer);
  }, [book?.id, book?.study?.building]);

  useEffect(() => {
    if (!intent) return;
    setError('');
    setModal(null);
    if (intent.kind === 'book') {
      if (intent.newChat) autoChat.current = true;
      if (intent.action === 'archive' && intent.chatId) autoArchive.current = intent.chatId;
      void load(intent.id, intent.action === 'sessions' ? () => setModal({ mode: 'sessions' }) : undefined);
    } else {
      openBook(null);
      setLoading(false);
      if (intent.kind === 'create') startCreate();
      if (intent.kind === 'memory') setModal({ mode: 'memory', scope: 'global' });
      if (intent.kind === 'link-session') {
        setModal({ mode: 'link-session', session: { id: intent.sessionId, title: intent.displayTitle } });
      }
    }
  }, [intent]);

  useEffect(() => {
    if (!book || !autoChat.current) return;
    autoChat.current = false;
    void openSession({ kind: 'chat' });
  }, [book?.id]);

  useEffect(() => {
    if (!book || !autoArchive.current) return;
    const chat = (book.chats ?? []).find((item) => item.id === autoArchive.current);
    if (!chat) return;
    autoArchive.current = '';
    setModal({ mode: 'archive-chat', chat });
  }, [book?.id]);

  async function action(op, fields = {}, signal) {
    const original = current.current;
    if (op === 'delete') {
      const target = fields.id ? library?.find((item) => item.id === fields.id) : book;
      const workspaceId = target?.workspaceId;
      if (workspaceId) {
        try {
          await navigation.deleteWorkspace(workspaceId);
        } catch (reason) {
          throw new Error(`Close this notebook’s session first, then delete the notebook. ${reason.message}`);
        }
      }
    }
    try {
      const value = await request(op, { id: original, ...fields }, signal);
      if (signal?.aborted) return value;
      if (op === 'create' || op === 'sample') openBook(value);
      else if (current.current === original && op === 'delete') openBook(null);
      else if (current.current === original && value?.id === original) setBook(value);
      if (['create', 'sample', 'delete', 'rename', 'settings', 'add-source', 'source-delete', 'session-attach', 'session-link', 'session-unlink', 'workspace-attach'].includes(op)) {
        navigation.refresh();
        void refresh().catch((err) => setError(err.message));
      }
      return value;
    } catch (err) {
      if (!signal?.aborted) setError(err.message);
      throw err;
    }
  }

  async function ensureWorkspace() {
    if (!book) throw new Error('Open a notebook first.');
    const prepared = await request('prepare-agent', { id: book.id });
    if (!prepared?.workspace) throw new Error('The notebook workspace is unavailable.');
    const workspace = await navigation.createWorkspace({ path: prepared.workspace });
    const workspaceId = workspace?.workspaceId ?? workspace?.id ?? '';
    if (!workspaceId) throw new Error('Harness did not return a workspace for this notebook.');
    try { await navigation.renameWorkspace(workspaceId, book.title); } catch { /* Keep the generated title. */ }
    if (book.workspaceId !== workspaceId) await action('workspace-attach', { workspaceId });
    return workspaceId;
  }

  async function openSession({ kind = 'chat', unitId = '', title = '', prompt = '', forcePrompt = false }) {
    if (!book) return;
    setError('');
    try {
      const workspaceId = await ensureWorkspace();
      let session = kind === 'chat' ? null : (book.sessions ?? []).find((item) =>
        item.kind === kind && (kind === 'lesson' ? (item.unitId ?? '') === unitId : true));
      const created = !session;
      if (created) {
        const sessionId = await navigation.createSession({ workspaceId });
        const sessionTitle = title
          || (kind === 'lesson' ? 'Lesson' : kind === 'plan' ? 'Study plan'
            : kind === 'setup' ? 'Notebook setup' : kind === 'agent' ? 'Study agent' : 'New Session');
        await action('session-attach', { sessionId, title: sessionTitle, kind, unitId, workspaceId });
        session = { id: sessionId, prompted: false };
      }
      const needsPrompt = Boolean(prompt) && (created || forcePrompt || session.prompted === false);
      if (needsPrompt) {
        await navigation.promptSession(session.id, prompt);
        if (session.prompted === false) {
          await action('session-attach', { sessionId: session.id, title: title || session.title || 'Session', kind, unitId, workspaceId, prompted: true });
        }
      }
      setActive(null);
      setSourcesOpen(false);
      navigation.openSession(session.id);
      void refreshCurrent();
    } catch (reason) {
      setError(reason.message);
    }
  }

  function openReview(cards) {
    const due = (cards ?? book?.study?.cards ?? [])
      .filter((card) => !card.due || Date.parse(card.due) <= Date.now())
      .slice(0, 24);
    setActive({ mode: 'review', cards: due });
    setPassage(null);
    setSourcesOpen(false);
  }
  function startCreate() {
    setCreating(true);
    setCreateError('');
    setModal(null);
    setBook(null);
    setActive(null);
    setSourcesOpen(false);
    current.current = '';
  }
  async function createNotebook(fields) {
    setCreateBusy(true);
    setCreateError('');
    try {
      const value = await action('create', { title: fields.title, goal: fields.goal, mode: fields.mode });
      setCreating(false);
      openBook(value);
    } catch (reason) {
      setCreateError(reason.message);
    } finally {
      setCreateBusy(false);
    }
  }
  async function startAgentSession() {
    if (!book) return;
    setModal({ mode: 'agent-starting' });
    await openSession({ kind: 'agent', title: `${book.title} — Study agent` });
    setModal(null);
  }
  function toggleSources() {
    if (book?.mode === 'ideas') { setSourcesOpen(!sourcesOpen); return; }
    setModal({ mode: 'sources' });
  }
  async function createCards() {
    try {
      const result = await action('study-generate', { kind: 'study-cards', topic: '', count: 12 });
      const due = (result?.study?.cards ?? []).filter((card) => !card.due || Date.parse(card.due) <= Date.now()).slice(0, 24);
      if (due.length) setActive({ mode: 'review', cards: due });
    } catch { /* The banner carries the error. */ }
  }
  function showSettings() {
    if (menu.current) menu.current.open = false;
    setModal({ mode: 'settings' });
    request('models').then(setModels).catch((err) => setError(err.message));
  }
  async function openSource(sourceId) {
    setModal({ mode: 'source-loading' });
    try {
      const source = await request('source', { id, sourceId });
      setModal((currentModal) => currentModal?.mode === 'source-loading' ? { mode: 'source', source } : currentModal);
    } catch (err) {
      setModal((currentModal) => currentModal?.mode === 'source-loading' ? null : currentModal);
      setError(err.message);
    }
  }
  async function exportCurrent(format) {
    if (menu.current) menu.current.open = false;
    try { exportNotebook(await request('export', { id }), format); } catch (err) { setError(err.message); }
  }
  const close = () => setModal(null);
  function show(mode) {
    return () => { if (menu.current) menu.current.open = false; setModal(mode); };
  }
  const manage = h('details', { ref: menu, className: 'dn-menu dn-header-menu' },
    h('summary', { title: 'Notebook options', 'aria-label': 'Notebook options' }, '⋯'),
    h('div', null, button('Notebook settings', showSettings),
      book?.study?.goal && button('Edit study goal', show({ mode: 'study-goal' })),
      book?.study?.map && button('Learning map', show({ mode: 'study-map' })),
      button('Learner memory', show({ mode: 'memory' })),
      button('Work with the agent', startAgentSession),
      button('Rename notebook', () => setModal({ mode: 'book-rename', title: book?.title })),
      button('Linked Harness sessions', show({ mode: 'sessions' })),
      button('Export Markdown', () => exportCurrent('md')),
      button('Export JSON', () => exportCurrent('json')),
      button('Delete notebook', show({ mode: 'confirm', title: 'Delete this notebook?', detail: book?.title, op: 'delete' }), { variant: 'danger' })));
  let overlay = null;
  if (modal?.mode === 'sources') overlay = h(SourcesDialog, { close, send: (op, fields) => action(op, fields) });
  else if (modal?.mode === 'sessions' && book || modal?.mode === 'link-session') {
    overlay = h(SessionLinksDialog, {
      key: modal.mode, book, books: library, initialSession: modal.session, close,
      link: async (notebookId, sessionId) => {
        const next = await action('session-link', { id: notebookId, sessionId });
        if (modal.session) openBook(next);
      },
      unlink: (sessionId) => action('session-unlink', { sessionId }),
      openSession: (sessionId) => { close(); navigation.openSession(sessionId); },
    });
  }
  else if (modal?.mode === 'generate') overlay = h(GenerateDialog, { modal, close, send: action, showArtifact: (artifact) => setModal({ mode: 'artifact', artifact }) });
  else if (modal?.mode === 'memory') overlay = h(MemoryDialog, { book, close, send: action, initialScope: modal.scope });
  else if (modal?.mode === 'archive-chat') overlay = h(ArchiveChatDialog, { chat: modal.chat, close });
  else if (modal?.mode === 'confirm') overlay = h(Confirmation, { modal, close, send: action });
  else if (modal?.mode === 'book-rename') overlay = h(RenameDialog, { modal, close, send: action });
  else if (modal?.mode === 'study-goal') overlay = h(StudyGoalDialog, { book, close, send: action });
  else if (modal?.mode === 'study-map') overlay = h(StudyMapDialog, { book, close });
  else if (modal?.mode === 'agent-starting') overlay = h(Dialog, { title: 'Study agent', close: () => {} },
    status('Preparing the notebook workspace and starting a Harness session…'));
  else if (modal?.mode === 'source-loading') overlay = h(Dialog, { title: 'Source', close }, status('Opening source…'));
  else if (modal?.mode === 'source') {
    const { source } = modal;
    overlay = h(Dialog, { title: source.title, close, wide: true },
      h('p', { className: 'dn-muted' }, [KIND[source.kind], source.truncated ? 'Excerpt truncated' : '', source.url].filter(Boolean).join(' · ')),
      h('pre', { className: 'dn-passage' }, source.body),
      h('div', { className: 'dn-actions' },
        button('Rename', () => setModal({ mode: 'source-rename', title: source.title, sourceId: source.id })),
        button('Remove', () => setModal({ mode: 'confirm', title: 'Remove this source?', detail: source.title, op: 'source-delete', fields: { sourceId: source.id } }), { variant: 'danger' })));
  } else if (modal?.mode === 'read-note') {
    const { note } = modal;
    overlay = h(Dialog, { title: note.title, close, wide: true },
      h(RichText, { value: note.body, citations: note.citations, open: setPassage }), citationList(note.citations, setPassage),
      h('div', { className: 'dn-actions' },
        button('Use as source', async () => {
          try { await action('add-source', { kind: 'note', title: note.title, body: note.body }); close(); } catch (err) { setModal({ ...modal, error: err.message }); }
        }),
        button('Edit', () => setModal({ mode: 'note', note })),
        button('Delete', () => setModal({ mode: 'confirm', title: 'Delete this note?', detail: note.title, op: 'note-delete', fields: { noteId: note.id } }), { variant: 'danger' })),
      modal.error && status(modal.error, 'error'));
  } else if (modal?.mode === 'artifact') {
    const { artifact } = modal;
    overlay = h(Dialog, { title: artifact.title, close, wide: true },
      h(ArtifactView, { artifact, open: setPassage }), citationList(artifact.citations, setPassage),
      h('div', { className: 'dn-actions' },
        button('Export', () => exportArtifact(artifact), { variant: 'primary' }),
        button('Delete', () => setModal({ mode: 'confirm', title: 'Delete this artifact?', detail: artifact.title, op: 'artifact-delete', fields: { artifactId: artifact.id } }), { variant: 'danger' })));
  } else if (modal) overlay = h(FormDialog, { modal, close, book, models, onRun: action });

  let focusView = null;
  if (book && active?.mode === 'review') {
    focusView = h(ReviewView, {
      key: 'review', book, cards: active.cards, send: action,
      close: () => setActive(null), onCreate: createCards, openPassage: setPassage,
      onDiscuss: (card) => openSession({
        kind: 'chat', title: `Card · ${card.topic || 'Review'}`,
        prompt: `Let's review this flashcard together.\n\nFront: ${card.front}\n\nBack: ${card.back}\n\nCheck whether I understand it and ask me one follow-up question.`,
      }),
    });
  }

  return h('div', { className: 'dn-app' },
    h('style', null, stylesheet),
    !focusView && h('header', { className: cls('dn-header', book && 'dn-book-header') },
      h('div', { className: 'dn-brand-row' },
        book
          ? h(React.Fragment, null,
            button(h(NotebookIcon, { size: 20 }), () => openBook(null), { variant: 'icon dn-home', title: 'Notebook library', 'aria-label': 'Notebook library' }),
            h('div', { className: 'dn-title-block' }, h('h1', null, book.title)))
          : button(h(React.Fragment, null, h('span', { className: 'dn-brand-icon' }, h(NotebookIcon, { size: 22 })), h('span', null, 'Deep Notebook')),
            () => openBook(null), { variant: 'brand', title: 'Notebook library' })),
      h('div', { className: 'dn-header-actions' },
        book && button(sourcesOpen ? 'Close sources' : 'Add sources', toggleSources, { variant: 'pill', 'aria-expanded': sourcesOpen }),
        book && manage,
        !book && !creating && button('+ New notebook', startCreate, { variant: 'primary' }))),
    error && h('div', { className: 'dn-banner', role: 'alert' }, h('span', null, error),
      button('×', () => setError(''), { variant: 'icon', 'aria-label': 'Dismiss error' })),
    creating ? h(CreateNotebookPage, {
      onCreate: createNotebook, onCancel: () => setCreating(false), busy: createBusy, error: createError,
    }) :
    book ? (focusView ? h('div', { className: 'dn-focus-shell', key: `focus-${book.id}` }, focusView) :
      book.mode === 'ideas'
        ? h('div', { className: cls('dn-workspace', sourcesOpen && 'dn-sources-open'), key: book.id },
          h(Evidence, { book, change: setModal, send: action, openSource, openPassage: setPassage, onClose: sourcesOpen ? () => setSourcesOpen(false) : undefined }),
          h('div', { className: 'dn-center' },
            h(IdeasPane, {
              book, openSession, change: setModal,
              openSessionNative: navigation.openSession,
            })),
          h(Studio, { book, change: setModal }))
        : h('div', { className: 'dn-workspace dn-study-mode dn-gemini-surface', key: book.id },
          h('div', { className: 'dn-center' },
            h(StudyPanel, {
              book, send: action, openPassage: setPassage,
              openSession, openReview,
              onAgent: startAgentSession, openSessionNative: navigation.openSession,
              onArchiveChat: (chat) => setModal({ mode: 'archive-chat', chat }),
            })))) :
      h('main', { className: 'dn-library' },
        h('div', { className: 'dn-library-title' }, h('h1', null, 'Your notebooks'),
          button('Learner memory', () => setModal({ mode: 'memory', scope: 'global' }), { variant: 'pill' })),
        library?.length ? h('section', { className: 'dn-library-grid', 'aria-label': 'Notebooks' }, library.map((item) =>
          h('div', { key: item.id, className: 'dn-library-row' },
            button(h(React.Fragment, null,
              h('span', { className: 'dn-card-icon' }, h(NotebookIcon, { size: 23 })),
              h('span', { className: 'dn-card-info' }, h('strong', null, item.title),
                h('small', null, `${item.sources} ${item.sources === 1 ? 'source' : 'sources'} · ${item.chats} earlier ${item.chats === 1 ? 'conversation' : 'conversations'}`)),
              h('span', { className: 'dn-card-date' }, formatDate(item.updated))), () => load(item.id), { variant: 'book-card', disabled: loading }),
            h('details', { className: 'dn-menu dn-library-menu' },
              h('summary', { title: 'Notebook options', 'aria-label': `Options for ${item.title}` }, '⋯'),
              h('div', null,
                button('Rename', () => setModal({ mode: 'book-rename', title: item.title, id: item.id })),
                button('Delete notebook', () => setModal({
                  mode: 'confirm', title: 'Delete this notebook?', detail: item.title,
                  op: 'delete', fields: { id: item.id },
                }), { variant: 'danger' })))))) :
          library && h('section', { className: 'dn-library-empty' }, h('h2', null, 'Start learning'),
            h('p', null, 'Create a notebook with a learning goal, or open a sample with three documents.'),
            h('div', { className: 'dn-actions' },
              button('Try a sample', () => {
                setLoading(true);
                void action('sample').catch(() => {}).finally(() => setLoading(false));
              }, { disabled: loading }),
              button('Create notebook', startCreate, { variant: 'primary' }))),
        (loading || (!library && !error)) && status('Opening notebooks…'),
        !library && error && button('Retry', () => { setError(''); void refresh().catch((err) => setError(err.message)); })),
    overlay,
    passage && h(Dialog, { title: passage.title, close: () => setPassage(null), wide: true },
      h('p', { className: 'dn-muted' }, `Source passage · Line ${passage.line}`),
      h('pre', { className: 'dn-passage' }, passage.text),
      h('div', { className: 'dn-actions' },
        book?.sources.some((source) => source.id === passage.sourceId) &&
          button('Read full source', () => { setPassage(null); void openSource(passage.sourceId); }),
        passage.url && h('a', { href: passage.url, target: '_blank', rel: 'noreferrer', className: 'dn-button' }, 'Open website'))));
}
