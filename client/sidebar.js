function notebookNavigation(ctx) {
  let state = { intent: null, bookId: '', chatId: '', revision: 0 };
  const listeners = new Set();
  const write = (next) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => state,
    panel: ctx.layout.panelInfo,
    open: (intent) => {
      ctx.layout.selectPanel(PANEL);
      write({ intent });
    },
    select: (bookId, chatId = '') => write({ bookId, chatId }),
    refresh: () => write({ revision: state.revision + 1 }),
    createSession: async (options) => {
      if (!ctx.sessions?.create) throw new Error('Harness session creation is unavailable in this build.');
      return ctx.sessions.create(options);
    },
    promptSession: async (sessionId, text) => {
      const remote = ctx.remote?.session;
      if (!remote?.prompt) throw new Error('Harness session messaging is unavailable in this build.');
      const requestId = globalThis.crypto?.randomUUID?.()
        ?? `dn-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      const result = await remote.prompt({
        requestId, sessionId, mode: 'queue',
        content: [{ type: 'text', text }],
      });
      if (result && result.ok === false) {
        throw new Error(result.error?.message ?? 'The session did not accept the message.');
      }
      return result?.value ?? result;
    },
    createWorkspace: async (input) => {
      if (!ctx.workspaces?.create) throw new Error('Harness workspace creation is unavailable in this build.');
      return ctx.workspaces.create(input);
    },
    renameWorkspace: async (workspaceId, title) => {
      if (!ctx.workspaces?.rename) return;
      return ctx.workspaces.rename(workspaceId, title);
    },
    deleteWorkspace: async (workspaceId) => {
      if (!ctx.workspaces?.delete) return;
      return ctx.workspaces.delete(workspaceId);
    },
    openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
  };
}

function useFold(name, defaultOpen = false) {
  const key = `deep-notebook.sidebar.${name}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultOpen : stored === 'open';
    } catch { return defaultOpen; }
  });
  return [open, (value) => {
    setOpen(value);
    try { localStorage.setItem(key, value ? 'open' : 'closed'); } catch { /* Optional browser preference. */ }
  }];
}

function SidebarChevron({ open }) {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
  h('path', { d: open ? 'm4.5 6 3.5 3.5L11.5 6' : 'm6 4.5 3.5 3.5L6 11.5' }));
}

function sideButton(label, activate, { icon, className, ...props } = {}) {
  return h('button', { type: 'button', className: cls('dn-side-button', className), onClick: activate, ...props },
    icon, h('span', { className: 'dn-side-text' }, label));
}

function DnMenuItem({ icon, onSelect, children }) {
  return h('button', {
    type: 'button', role: 'menuitem', className: 'dn-menu-item', onClick: onSelect,
  }, icon, h('span', null, children));
}

function SidebarNotebook({ book, navigation, state, active }) {
  const [open, setOpen] = useFold(book.id);
  const [contents, setContents] = useState(null);
  const [error, setError] = useState('');
  const groupId = React.useId();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError('');
    request('book-nav', { id: book.id }, controller.signal).then(setContents).catch((reason) => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, [open, state.revision, book.id]);
  async function renameBook() {
    const next = window.prompt('Rename notebook', book.title);
    if (next === null) return;
    const title = next.trim();
    if (!title || title === book.title) return;
    setError('');
    try {
      await request('rename', { id: book.id, title });
      navigation.refresh();
    } catch (reason) { setError(reason.message); }
  }
  async function removeBook() {
    if (!window.confirm(`Delete "${book.title}"? Its Harness sessions will be archived. This cannot be undone.`)) return;
    setError('');
    try {
      if (book.workspaceId) {
        try {
          await navigation.deleteWorkspace(book.workspaceId);
        } catch (reason) {
          setError(`Close this notebook’s sessions first, then delete the notebook. ${reason.message}`);
          return;
        }
      }
      await request('delete', { id: book.id });
      navigation.refresh();
      if (navigation.snapshot().bookId === book.id) navigation.open({ kind: 'library' });
    } catch (reason) { setError(reason.message); }
  }
  return h('div', { className: 'dn-side-book' },
    h('div', { className: cls('dn-side-book-head', active && 'dn-side-selected') },
      h('button', { className: 'dn-side-toggle', type: 'button', 'aria-expanded': open, 'aria-controls': groupId,
        'aria-label': `${open ? 'Fold' : 'Expand'} ${book.title}`, onClick: () => setOpen(!open) }, h(SidebarChevron, { open })),
      sideButton(book.title, () => navigation.open({ kind: 'book', id: book.id }), {
        icon: h(NotebookIcon, { size: 16 }), 'aria-current': active && !state.chatId ? 'page' : undefined, title: book.title,
      }),
      h('details', { className: 'dn-side-menu' },
        h('summary', { title: 'Notebook options', 'aria-label': `Options for ${book.title}` }, '⋯'),
        h('div', null,
          h('button', { type: 'button', onClick: renameBook }, 'Rename'),
          h('button', { type: 'button', className: 'dn-side-delete', onClick: removeBook }, 'Delete notebook')))),
    h('div', { id: groupId, hidden: !open, className: 'dn-side-children' },
      open && h(React.Fragment, null,
        sideButton('New Session', () => navigation.open({ kind: 'book', id: book.id, newChat: true }), { 'aria-label': 'Start a new notebook session', icon: h('span', { 'aria-hidden': true }, '+') }),
        contents?.sessions.filter((session) => session.kind !== 'linked').map((session) => sideButton(session.title, () => navigation.openSession(session.id), {
          key: session.id, title: session.title, 'aria-label': session.title, icon: h('span', { 'aria-hidden': true }, '↗'),
        })),
        contents?.chats.map((chat) => sideButton(chat.title, () => navigation.open({ kind: 'book', id: book.id, action: 'archive', chatId: chat.id }), {
          key: chat.id, title: `Earlier: ${chat.title}`, 'aria-label': `Earlier conversation: ${chat.title}`,
          icon: h('span', { 'aria-hidden': true }, '↺'),
        })),
        sideButton('Link Harness session…', () => navigation.open({ kind: 'book', id: book.id, action: 'sessions' })),
        error && h('p', { className: 'dn-side-status', role: 'alert' }, error))));
}

function NotebookSidebar({ navigation, label }) {
  const state = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot);
  const panelState = React.useSyncExternalStore(
    (listener) => navigation.panel.subscribe(listener), () => navigation.panel.getSnapshot(),
  );
  const [open, setOpen] = useFold('section', true);
  const [books, setBooks] = useState(null);
  const [error, setError] = useState('');
  const groupId = React.useId();
  const scroller = useRef(null);
  useEffect(() => {
    const element = scroller.current;
    const wheel = (event) => {
      const room = element.scrollHeight - element.clientHeight - element.scrollTop;
      if (!event.ctrlKey && (event.deltaY > 0 && room > 1 || event.deltaY < 0 && element.scrollTop > 1)) event.stopPropagation();
    };
    element.addEventListener('wheel', wheel, { passive: true });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError('');
    request('list', {}, controller.signal).then(setBooks).catch((reason) => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, [open, state.revision]);
  return h('section', { className: 'dn-sidebar', 'aria-label': label },
    h('button', { type: 'button', className: 'dn-side-heading', 'aria-expanded': open, 'aria-controls': groupId,
      onClick: () => setOpen(!open) }, label, h(SidebarChevron, { open })),
    h('div', { id: groupId, ref: scroller, hidden: !open, className: 'dn-side-scroll' },
      open && h(React.Fragment, null,
        sideButton('New notebook', () => navigation.open({ kind: 'create' }), { 'aria-label': 'New notebook', icon: h('span', { 'aria-hidden': true }, '+') }),
        books?.map((book) => h(SidebarNotebook, {
          book, state, navigation, key: book.id, active: panelState.activePanelId === PANEL && state.bookId === book.id,
        })),
        error && h('p', { className: 'dn-side-status', role: 'alert' }, error),
        sideButton('Learner memory', () => navigation.open({ kind: 'memory' }), { 'aria-label': 'Learner memory', icon: h('span', { 'aria-hidden': true }, '✦') }),
        sideButton('All notebooks', () => navigation.open({ kind: 'library' }), { 'aria-label': 'All notebooks', icon: h('span', { 'aria-hidden': true }, '⋯') }))));
}

function NativeSidebarFilter({ navigation }) {
  const state = React.useSyncExternalStore(navigation.subscribe, navigation.snapshot);
  const style = useRef(null);
  useEffect(() => {
    const element = document.createElement('style');
    element.id = 'dsh-deep-notebook-hide-native';
    document.head.append(element);
    style.current = element;
    return () => { element.remove(); style.current = null; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await request('list');
      const sessionIds = new Set();
      for (const book of list ?? []) {
        if (!book.workspaceId) continue;
        try {
          const detail = await request('get', { id: book.id });
          for (const session of detail?.sessions ?? []) sessionIds.add(session.id);
        } catch { /* Keep the rest. */ }
      }
      if (cancelled || !style.current) return;
      const workspaceIds = (list ?? []).map((book) => book.workspaceId).filter(Boolean);
      const rules = [
        ...workspaceIds.map((id) =>
          `[data-dsh-claude-part="group-section"]:has([data-row-key="workspace:${String(id).replace(/["\\\\]/g, '')}"]) { display: none !important; }`),
        ...[...sessionIds].map((id) =>
          `[data-row-key="session:${String(id).replace(/["\\\\]/g, '')}"] { display: none !important; }`),
      ];
      style.current.textContent = rules.join('\n');
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [state.revision]);
  return null;
}

function NotebookSidebarPortal({ navigation, label }) {
  const [seat, setSeat] = useState(null);
  useEffect(() => {
    const container = document.createElement('div');
    container.className = 'dn-sidebar-seat';
    let frame = 0;
    // The 0.2 shell defines fixed grid rows and has no slot between the global
    // menu and workspaces. Insert a sibling of the native workspace toolbar
    // so the section stays in its existing flex row without replacing its UI.
    function sync() {
      frame = 0;
      const header = document.querySelector('[data-sidebar-scrollport] [data-sidebar-workspace-header]');
      const area = header?.parentElement;
      if (!area) {
        if (container.isConnected) container.remove();
        setSeat(null);
        return;
      }
      if (container.parentElement !== area || container.nextElementSibling !== header) area.insertBefore(container, header);
      setSeat(container);
    }
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(sync);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sidebar-scrollport'] });
    sync();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); container.remove(); };
  }, []);
  return seat ? createPortal(h(React.Fragment, null, h('style', null, sidebarStylesheet), h(NativeSidebarFilter, { navigation }), h(NotebookSidebar, { navigation, label })), seat) : null;
}

function SessionLinksDialog({ book, books, initialSession, close, link, unlink, openSession }) {
  const [sessions, setSessions] = useState(null);
  const [sessionId, setSessionId] = useState(initialSession?.id ?? '');
  const [notebookId, setNotebookId] = useState(book?.id ?? books?.[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initialSession) return;
    const controller = new AbortController();
    request('sessions', {}, controller.signal).then(setSessions).catch((reason) => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, [initialSession]);
  async function perform(action) {
    setBusy(true);
    setError('');
    try { await action(); } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  const available = sessions?.filter((session) => !book?.sessions.some(({ id }) => id === session.id));
  return h(Dialog, { title: initialSession ? 'Add session to notebook' : 'Linked Harness sessions', close: () => { if (!busy) close(); } },
    book?.sessions.length > 0 && h('ul', { className: 'dn-linked-sessions' }, book.sessions.map((session) =>
      h('li', { key: session.id },
        button(session.title, () => openSession(session.id), { variant: 'text', title: 'Open in Harness' }),
        button('Unlink', () => perform(() => unlink(session.id)), { disabled: busy, variant: 'small', 'aria-label': `Unlink ${session.title}` })))),
    h('form', { className: 'dn-form', onSubmit: submit(() => perform(async () => {
      await link(notebookId, sessionId);
      if (initialSession) close();
      else setSessionId('');
    })) },
    initialSession ? h(React.Fragment, null,
      h('p', { className: 'dn-record-title' }, initialSession.title || 'Harness session'),
      field('Notebook', h('select', { value: notebookId, onChange: (event) => setNotebookId(event.target.value), required: true },
        h('option', { value: '' }, 'Choose a notebook'), books?.map((item) => h('option', { key: item.id, value: item.id }, item.title))))) :
      field('Recent Harness sessions', h('select', { required: true, value: sessionId, onChange: (event) => setSessionId(event.target.value) },
        h('option', { value: '' }, available ? (available.length ? 'Choose a session' : 'No unlinked sessions') : 'Loading sessions…'),
        available?.map((item) => h('option', { key: item.id, value: item.id }, item.title)))),
    error && status(error, 'error'),
    h('div', { className: 'dn-actions' }, button('Done', close, { disabled: busy }),
      button(busy ? 'Saving…' : 'Link session', undefined, { type: 'submit', variant: 'primary', disabled: busy || !notebookId || !sessionId }))));
}
