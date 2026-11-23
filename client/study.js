const STUDY_STATE = {
  'not-started': { label: 'Not started', tone: 'idle' },
  focus: { label: 'Focus area', tone: 'focus' },
  developing: { label: 'Developing', tone: 'developing' },
  strength: { label: 'Strength', tone: 'strength' },
};
const STUDY_LEVELS = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
const STUDY_ICONS = {
  map: 'M9 3h6v5H9zM3 16h6v5H3zm12 0h6v5h-6zM12 8v4m-6 4v-4h12v4',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  cards: 'M6 6h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm2-3h10M8 10h8m-8 4h5',
  quiz: 'M6 3h12v18H6zM9 8l1.2 1.2L13 6.5M9 14l1.2 1.2L13 12.5M15 8h.1m-.1 6h.1',
  flame: 'M12 3c2 4-1 5-1 8a4 4 0 0 0 8 0c0-2-1-3-2-4 3 7-2 13-7 13S3 15 5 11c1-2 3-3 4-5 1 2 2 3 3 4 1-3 0-5 0-7Z',
  book: 'M3 5h4a5 5 0 0 1 5 5v10a5 5 0 0 0-5-5H3zm18 0h-4a5 5 0 0 0-5 5v10a5 5 0 0 1 5-5h4z',
  idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11Z',
  cap: 'M3 9l9-4 9 4-9 4-9-4Zm3 2v5c0 1.2 2.4 3 6 3s6-1.8 6-3v-5',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6 6-6-6 6-6',
  check: 'm5 12 5 5L20 7',
  play: 'M8 5v14l11-7z',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M18 18l-2.5-2.5M18 6l-2.5 2.5M6 18l2.5-2.5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  flag: 'M5 21V4h9l-1 3h6l-2 5 2 5h-6l-1-3H5',
  refresh: 'M20 11a8 8 0 0 0-14-4L4 9m0-6v6h6m-6 4a8 8 0 0 0 14 4l2-2m0 6v-6h-6',
};

function StudyIcon({ name, size = 18 }) {
  const path = STUDY_ICONS[name] ?? STUDY_ICONS.spark;
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  }, h('path', { d: path }));
}

function stateInfo(state) {
  return STUDY_STATE[state] ?? STUDY_STATE['not-started'];
}

function percent(value) {
  return `${Math.round(Number(value ?? 0))}%`;
}

function weakTopics(progress) {
  return (progress?.topics ?? [])
    .filter((item) => item.total > 0 && item.accuracy < 0.75)
    .sort((a, b) => a.accuracy - b.accuracy || a.topic.localeCompare(b.topic))
    .slice(0, 3);
}

function unitMatchesTopic(unit, topic) {
  const key = String(topic).toLowerCase();
  return (unit.topics ?? []).some((name) => name.toLowerCase() === key || name.toLowerCase().includes(key) || key.includes(name.toLowerCase()));
}

function nextIntervalLabel(card, rating) {
  const interval = Number(card.interval ?? 0);
  const reps = Number(card.reps ?? 0);
  let days;
  if (rating === 'again') days = 0;
  else if (rating === 'hard') days = Math.max(1, Math.round(interval * 1.2));
  else if (rating === 'easy') days = reps === 0 ? 2 : reps === 1 ? 5 : Math.max(5, Math.round(interval * Number(card.ease ?? 2.5) * 1.3));
  else days = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(3, Math.round(interval * Number(card.ease ?? 2.5)));
  if (!days) return 'now';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  return `${Math.round(days / 30)} mo`;
}

function MasteryRing({ value = 0, label = 'Mastery', size = 104 }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, value)) / 100);
  return h('div', { className: 'dn-ring', style: { width: size, height: size } },
    h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': true },
      h('circle', { cx: size / 2, cy: size / 2, r: radius, fill: 'none', stroke: 'var(--dn-line)', strokeWidth: stroke }),
      h('circle', {
        cx: size / 2, cy: size / 2, r: radius, fill: 'none', stroke: 'var(--dn-primary)', strokeWidth: stroke,
        strokeLinecap: 'round', strokeDasharray: circumference, strokeDashoffset: offset,
        transform: `rotate(-90 ${size / 2} ${size / 2})`, style: { transition: 'stroke-dashoffset 500ms ease' },
      })),
    h('span', { className: 'dn-ring-value' }, h('strong', null, percent(value)), h('small', null, label)));
}

function StatePill({ state }) {
  const info = stateInfo(state);
  return h('span', { className: `dn-state-pill dn-state-${info.tone}` }, info.label);
}

function StatTile({ icon, value, label, detail }) {
  return h('div', { className: 'dn-stat-tile' },
    h('span', { className: 'dn-stat-icon' }, h(StudyIcon, { name: icon, size: 17 })),
    h('div', null, h('strong', null, value), h('span', null, label), detail && h('small', null, detail)));
}

function GoalForm({ study, busy, onSave, onCancel, autoFocus = false }) {
  const [goal, setGoal] = useState(study?.goal ?? '');
  const [level, setLevel] = useState(study?.level ?? 'intermediate');
  const [minutes, setMinutes] = useState(String(study?.dailyMinutes ?? 20));
  const [examDate, setExamDate] = useState(study?.examDate ?? '');
  const [error, setError] = useState('');
  function save(event) {
    event.preventDefault();
    if (!goal.trim()) { setError('Describe what you want to be able to do.'); return; }
    if (!Number(minutes) || Number(minutes) < 5) { setError('Choose at least 5 minutes per day.'); return; }
    setError('');
    onSave({ goal: goal.trim(), level, dailyMinutes: Number(minutes), examDate });
  }
  return h('form', { className: 'dn-goal-form', onSubmit: save },
    h('label', { className: 'dn-goal-field' }, h('span', null, 'Your learning goal'),
      h('textarea', {
        required: true, rows: 3, maxLength: 1800, value: goal, autoFocus,
        onChange: (event) => setGoal(event.target.value),
        placeholder: 'Example: Solve integration questions for my calculus midterm, including integration by parts.',
      })),
    h('details', { className: 'dn-goal-advanced' },
      h('summary', null, 'Study preferences'),
      h('div', { className: 'dn-goal-row' },
        h('label', { className: 'dn-goal-field' }, h('span', null, 'Starting level'),
          h('select', { value: level, onChange: (event) => setLevel(event.target.value) },
            Object.entries(STUDY_LEVELS).map(([value, label]) => h('option', { key: value, value }, label)))),
        h('label', { className: 'dn-goal-field' }, h('span', null, 'Minutes per day'),
          h('input', { type: 'number', min: 5, max: 180, step: 5, value: minutes, onChange: (event) => setMinutes(event.target.value) })),
        h('label', { className: 'dn-goal-field' }, h('span', null, 'Target date (optional)'),
          h('input', { type: 'date', value: examDate, onChange: (event) => setExamDate(event.target.value) })))),
    error && status(error, 'error'),
    h('div', { className: 'dn-goal-actions' },
      onCancel && button('Cancel', onCancel, { disabled: busy }),
      button(busy ? 'Saving…' : 'Save goal', undefined, { type: 'submit', variant: 'primary', disabled: busy })));
}

function StudyGoalDialog({ book, close, send }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(fields) {
    setBusy(true);
    setError('');
    try {
      await send('study-goal', fields);
      close();
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
    }
  }
  return h(Dialog, { title: 'Study goal', close: () => { if (!busy) close(); } },
    h(GoalForm, { study: book.study, busy, onSave: save, onCancel: close, autoFocus: true }),
    error && status(error, 'error'));
}

function StudyMapDialog({ book, close }) {
  const topics = book.studyProgress?.topics ?? [];
  return h(Dialog, { title: 'Learning map', close, wide: true },
    topics.length
      ? h('div', { className: 'dn-map-dialog' }, topics.map((item) => h('article', {
        key: item.topic, className: `dn-topic-card dn-topic-${stateInfo(item.state).tone}`,
      },
      h('header', null, h('h4', null, item.topic), h(StatePill, { state: item.state })),
      item.summary && h('p', null, item.summary),
      h('div', { className: 'dn-topic-bar' }, h('span', { style: { width: `${item.mastery}%` } })),
      item.objectives?.length > 0 && h('details', { className: 'dn-objectives' },
        h('summary', null, `${item.objectives.length} objectives`),
        h('ul', null, item.objectives.map((objective) => h('li', { key: objective.title },
          h('span', { className: 'dn-objective-dot', 'aria-hidden': true }),
          h('div', null, h('strong', null, objective.title), h('small', null, objective.description)))))))))
      : status('Build a learning map from your study goal first.'));
}

function ProgressGauge({ value = 0, focus = 0, size = 196 }) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, value)) / 100);
  return h('div', { className: 'dn-gauge', style: { width: size, height: size } },
    h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': true },
      h('circle', { cx: size / 2, cy: size / 2, r: radius, fill: 'none', stroke: 'var(--gem-track)', strokeWidth: stroke }),
      h('circle', {
        cx: size / 2, cy: size / 2, r: radius, fill: 'none', stroke: 'var(--gem-pink)', strokeWidth: stroke,
        strokeLinecap: 'round', strokeDasharray: circumference, strokeDashoffset: offset,
        transform: `rotate(-90 ${size / 2} ${size / 2})`, style: { transition: 'stroke-dashoffset 500ms ease' },
      })),
    h('div', { className: 'dn-gauge-center' },
      h('span', null, 'Topics you’re strong in'),
      h('strong', null, `${Math.round(value)}%`)),
    h('span', { className: 'dn-gauge-pill', title: `${focus} focus areas` }, String(focus)));
}

function CreateNotebookPage({ onCreate, onCancel, busy, error }) {
  const [mode, setMode] = useState('study');
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState('');
  function submit(event) {
    event.preventDefault();
    const value = name.trim();
    if (!value) { setLocalError('Give your notebook a name.'); return; }
    setLocalError('');
    onCreate({ title: value, goal: '', mode });
  }
  return h('main', { className: 'dn-create-page' },
    h('div', { className: 'dn-create-inner' },
      h('span', { className: 'dn-create-icon' }, h(NotebookIcon, { size: 30 })),
      h('h1', null, mode === 'study' ? 'What are you studying?' : 'What are you working on?'),
      h('div', { className: 'dn-create-cards' },
        h('button', {
          type: 'button', className: cls('dn-create-card', mode === 'ideas' && 'selected'),
          'aria-pressed': mode === 'ideas', onClick: () => setMode('ideas'),
        },
        h('span', { className: 'dn-create-card-icon' }, h(StudyIcon, { name: 'idea', size: 23 })),
        h('strong', null, 'Organize your ideas'),
        h('small', null, 'Group chats by topic and ground on your sources.'),
        mode === 'ideas' && h('span', { className: 'dn-create-check' }, h(StudyIcon, { name: 'check', size: 14 }))),
        h('button', {
          type: 'button', className: cls('dn-create-card', mode === 'study' && 'selected'),
          'aria-pressed': mode === 'study', onClick: () => setMode('study'),
        },
        h('span', { className: 'dn-create-card-icon' }, h(StudyIcon, { name: 'cap', size: 23 })),
        h('strong', null, 'Study and learn'),
        h('small', null, 'Get custom lessons and track your progress.'),
        mode === 'study' && h('span', { className: 'dn-create-check' }, h(StudyIcon, { name: 'check', size: 14 })))),
      h('form', { className: 'dn-create-form', onSubmit: submit },
        h('input', {
          className: 'dn-create-input', value: name, maxLength: 140, autoFocus: true,
          'aria-label': 'Notebook name',
          placeholder: mode === 'study' ? 'Example: Calculus midterm — integration by parts' : 'Example: Weekly meal prep',
          onChange: (event) => setName(event.target.value),
        }),
        h('p', { className: 'dn-create-note' }, mode === 'study'
          ? 'This becomes your notebook title. You’ll set a study goal next.'
          : 'You can organize your chats and add sources inside the notebook.'),
        (localError || error) && status(localError || error, 'error'),
        button(busy ? 'Creating…' : 'Create notebook', undefined, {
          type: 'submit', variant: 'primary', className: 'dn-create-submit', disabled: busy || !name.trim(),
        }),
        button('Back to notebooks', onCancel, { variant: 'text', disabled: busy }))));
}

function GettingStarted({ book, openSession, openSessionNative, onAsk, onArchiveChat = () => {} }) {
  const sessions = (book.sessions ?? []).filter((session) => session.kind !== 'linked');
  const chats = (book.chats ?? []).filter((chat) => chat.messages?.length);
  return h('section', { className: 'dn-study-hub dn-scroll dn-getstarted', 'aria-label': 'Get started' },
    h('div', { className: 'dn-getstarted-inner' },
      h('h2', { className: 'dn-getstarted-title' }, 'Get started'),
      h('article', { className: 'dn-getstarted-card' },
        h('h3', null, 'Set a study goal'),
        h('p', null, 'Tell Deep Notebook about an upcoming test or learning objective. The goal opens a setup session and builds your study plan.'),
        button('Set goal', () => openSession({ kind: 'setup', title: 'Notebook setup', prompt: setupPrompt(book) }), { variant: 'pill dn-goal-pill' })),
      sessions.length > 0 && h('section', { className: 'dn-getstarted-chats' },
        h('h3', null, 'Sessions'),
        h('ul', null, sessions.map((session) => h('li', { key: session.id },
          h('button', { type: 'button', className: 'dn-chat-row', onClick: () => openSessionNative(session.id) },
            h('span', null, session.title || 'Session'),
            h('small', null, formatDate(session.created))))))),
      chats.length > 0 && h('section', { className: 'dn-getstarted-chats' },
        h('h3', null, 'Earlier conversations'),
        h('ul', null, chats.map((chat) => h('li', { key: chat.id },
          h('button', { type: 'button', className: 'dn-chat-row', onClick: () => onArchiveChat(chat) },
            h('span', null, chat.title || 'Conversation'),
            h('small', null, formatDate(chat.updated ?? chat.created)))))))),
    h(HomeAskBar, { onAsk }));
}

function HomeAskBar({ onAsk = () => {} }) {
  const [draft, setDraft] = useState('');
  function submit(event) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setDraft('');
    onAsk(value);
  }
  return h('form', { className: 'dn-home-ask', onSubmit: submit },
    h('div', { className: 'dn-home-ask-bar' },
      h('span', { className: 'dn-ask-mark' }, h(StudyIcon, { name: 'spark', size: 18 })),
      h('input', {
        value: draft, maxLength: 3000, 'aria-label': 'Ask about this notebook',
        placeholder: 'Ask about your sources, lessons, or study plan…',
        onChange: (event) => setDraft(event.target.value),
      }),
      button(h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M12 19V5m-6 6 6-6 6 6' })), undefined, {
        type: 'submit', variant: 'primary dn-send', 'aria-label': 'Send', disabled: !draft.trim(),
      })));
}

function StudyPanel({
  book, send, openSession, openReview, openPassage = () => {},
  onAgent = () => {}, openSessionNative = () => {}, onArchiveChat = () => {},
}) {
  const { study, studyProgress: progress } = book;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const task = useRef(null);
  useEffect(() => () => task.current?.abort(), []);
  const units = study?.plan?.units ?? [];
  const next = units.find((unit) => unit.id === progress?.recommendedUnitId) ?? units.find((unit) => !unit.completed);
  const hasMap = Boolean(study?.map?.topics?.length);
  const hasGoal = Boolean(study?.goal);
  const overall = progress ?? { topics: [], mastery: 0, completed: 0, total: 0, cards: { total: 0, due: 0, new: 0 }, streak: 0, today: { minutes: 0, questions: 0, lessons: 0 }, recent: [] };
  const totalCorrect = overall.topics.reduce((sum, item) => sum + item.correct, 0);
  const totalQuestions = overall.topics.reduce((sum, item) => sum + item.total, 0);
  const accuracy = totalQuestions ? Math.round(100 * totalCorrect / totalQuestions) : null;

  async function work(label, job) {
    if (task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setBusy(label);
    setError('');
    try { return await job(controller.signal); }
    catch (reason) { if (!controller.signal.aborted) setError(reason.message); }
    finally { task.current = null; setBusy(''); }
  }

  function generate(kind, fields = {}, after) {
    const labels = {
      'study-map': 'Building your learning map…',
      'study-plan': 'Building your lesson plan…',
      'study-cards': 'Writing flashcards…',
    };
    return work(labels[kind], async (signal) => {
      const result = await send('study-generate', { kind, ...fields }, signal);
      if (signal.aborted) return;
      after?.(result);
    });
  }

  function openUnit(unit) {
    return openSession({ kind: 'lesson', unitId: unit.id, title: unit.title, prompt: lessonPrompt(unit, book) });
  }
  function quizUnit(unit) {
    return openSession({ kind: 'lesson', unitId: unit.id, title: unit.title, prompt: quizPrompt(unit, book), forcePrompt: true });
  }
  function toggleComplete(unit, event) {
    event?.stopPropagation();
    return work(unit.completed ? 'Reopening lesson…' : 'Marking lesson completed…', async () => {
      await send('study-complete', { unitId: unit.id, completed: !unit.completed });
    });
  }
  function openPlan() {
    return openSession({ kind: 'plan', title: 'Study plan', prompt: planPrompt(book) });
  }
  function takeDiagnostic() {
    return openSession({ kind: 'chat', title: 'Diagnostic quiz', prompt: quizFromTopicsPrompt(book, 'diagnostic') });
  }
  function takeTest() {
    return openSession({ kind: 'chat', title: 'Practice quiz', prompt: quizFromTopicsPrompt(book, 'practice') });
  }
  function practiceTopic(topic) {
    if (!topic) return;
    return openSession({ kind: 'chat', title: `Practice · ${topic}`, prompt: `Quiz me on ${topic}. One question at a time, wait for my answer, and report the score with the notebook skill when we finish.` });
  }
  function makeCards(topic = '') {
    generate('study-cards', { topic, count: 12 }, (result) => {
      if (result.studyProgress?.cards?.due) openReview(result.study.cards);
    });
  }
  function review() {
    if (overall.cards.total === 0) makeCards();
    else openReview(book.study.cards);
  }
  function openChat(prompt = '') {
    return openSession({ kind: 'chat', title: prompt ? prompt.slice(0, 60) : 'New Session', prompt });
  }

  if (!hasGoal) {
    return h(GettingStarted, {
      book, openSession, openSessionNative, onAsk: openChat, onArchiveChat,
    });
  }

  if (study.building) {
    const label = study.building === 'plan' ? 'Building your lesson plan…' : 'Building your learning map…';
    return h('section', { className: 'dn-study-hub dn-scroll dn-map-skeleton', 'aria-label': 'Study and learn', 'aria-busy': true },
      h('div', { className: 'dn-study-dash dn-skeleton-dash' },
        h('div', { className: 'dn-skeleton-line' }),
        h('div', { className: 'dn-skeleton-grid' }, [0, 1, 2].map((index) =>
          h('div', { key: index, className: 'dn-skeleton-card' },
            h('span', { className: 'dn-skeleton-bar short' }),
            h('span', { className: 'dn-skeleton-bar' }),
            h('span', { className: 'dn-skeleton-bar short' }),
            h('span', { className: 'dn-skeleton-arrow' }, h(StudyIcon, { name: 'arrow', size: 18 }))))),
        h('div', { className: 'dn-study-busy' }, status(label))),
      study.buildError && status(study.buildError, 'error'),
      error && status(error, 'error'),
      h(HomeAskBar, { onAsk: openChat }));
  }

  const content = [];
  const focusCount = overall.states?.focus ?? 0;
  const incomplete = units.filter((unit) => !unit.completed);
  const priorities = (next ? [next, ...incomplete.filter((unit) => unit.id !== next.id)] : incomplete).slice(0, 3);
  const lessonForTopic = (topic) => units.find((unit) => unitMatchesTopic(unit, topic));

  if (!hasMap) {
    content.push(h('section', { className: 'dn-gem-card dn-map-setup', key: 'map' },
      h('div', null, h('span', { className: 'dn-eyebrow' }, 'Learning map'),
        h('h3', null, 'Break the goal into topics and measurable objectives'),
        h('p', null, 'A map gives every quiz result a place to land. You can update it later without losing completed lessons.')),
      h('div', { className: 'dn-map-setup-actions' },
        button('Build learning map', () => generate('study-map'), { variant: 'primary', disabled: Boolean(busy) }),
        button('Take diagnostic first', takeDiagnostic, { disabled: Boolean(busy) }))));
  }
  if (study.buildError) {
    content.push(h('section', { className: 'dn-gem-card', key: 'build-error' },
      status(study.buildError, 'error'),
      button('Try again', () => work('Retrying…', async () => {
        await send('study-goal', {
          goal: study.goal, level: study.level,
          dailyMinutes: study.dailyMinutes, examDate: study.examDate,
        });
      }), { disabled: Boolean(busy) })));
  }

  const topicRows = overall.topics.map((item) => {
    const unit = lessonForTopic(item.topic);
    return h('button', {
      key: item.topic, type: 'button',
      className: cls('dn-progress-row', `dn-topic-${stateInfo(item.state).tone}`),
      onClick: () => unit ? openUnit(unit) : practiceTopic(item.topic),
      title: unit ? `Open ${unit.title}` : `Practice ${item.topic}`,
    },
    h('span', { className: 'dn-progress-name' }, item.topic),
    h('span', { className: 'dn-progress-arrow' }, h(StudyIcon, { name: 'arrow', size: 15 })),
    h('span', { className: 'dn-progress-bar', role: 'progressbar', 'aria-label': `${item.topic} accuracy`, 'aria-valuenow': Math.round(item.accuracy * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('i', { style: { width: `${Math.round(item.accuracy * 100)}%` } })),
    h('small', null, String(item.objectives?.length ?? item.checks ?? 0)));
  });

  const hasActivity = (study?.attempts?.length ?? 0) > 0 || overall.completed > 0
    || overall.topics.some((item) => item.total > 0);

  const priorityCards = priorities.length
    ? priorities.map((unit) => h('article', {
      key: unit.id, className: cls('dn-priority-card', unit.completed && 'dn-lesson-done'), role: 'button', tabIndex: 0,
      onClick: () => openUnit(unit),
      onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openUnit(unit); } },
    },
    h('small', { className: 'dn-priority-topic' }, unit.topics?.[0] ?? 'Lesson'),
    h('strong', null, unit.title),
    h('div', { className: 'dn-priority-foot' },
      h('span', { className: 'dn-priority-complete' },
        button(unit.completed ? 'Completed' : 'Mark completed', (event) => void toggleComplete(unit, event), {
          variant: 'text', disabled: Boolean(busy),
          title: unit.completed ? 'Click to reopen this lesson' : 'Mark this lesson completed',
        })),
      h('span', { className: 'dn-priority-quiz' },
        button('Quiz', (event) => { event.stopPropagation(); quizUnit(unit); }, { variant: 'text', disabled: Boolean(busy) })),
      h('span', { className: 'dn-priority-arrow' }, h(StudyIcon, { name: 'arrow', size: 18 })))))
    : [h('article', { className: 'dn-priority-card dn-priority-empty', key: 'empty' },
      h('small', { className: 'dn-priority-topic' }, !hasMap ? 'Step 1' : !study.plan ? 'Step 2' : 'Review'),
      h('strong', null, !hasMap ? 'Build your learning map' : !study.plan ? 'Build your lesson plan' : 'Check what you remember'),
      h('div', { className: 'dn-priority-foot' },
        !hasMap
          ? button('Build map', () => generate('study-map'), { variant: 'primary dn-small', disabled: Boolean(busy) })
          : !study.plan
            ? button('Build plan', () => generate('study-plan'), { variant: 'primary dn-small', disabled: Boolean(busy) })
            : button('Take practice quiz', takeTest, { variant: 'primary dn-small', disabled: Boolean(busy) })))];

  content.push(h('section', { className: 'dn-priorities', key: 'priorities' },
    h('div', { className: 'dn-gem-head' }, h('h3', null, 'Top priorities')),
    h('div', { className: 'dn-priority-grid' }, priorityCards)));

  content.push(h('section', { className: 'dn-all-lessons', key: 'all' },
    h('div', { className: 'dn-gem-head' }, h('h3', null, 'All lessons')),
    units.length
      ? h('div', { className: 'dn-lesson-grid' }, units.map((unit, index) => h('article', {
        key: unit.id, className: cls('dn-priority-card dn-lesson-card', unit.completed && 'dn-lesson-done'),
        role: 'button', tabIndex: 0,
        onClick: () => openUnit(unit),
        onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openUnit(unit); } },
      },
      h('small', { className: 'dn-priority-topic' }, unit.topics?.[0] ?? `Lesson ${index + 1}`),
      h('strong', null, unit.title),
      h('div', { className: 'dn-priority-foot' },
        h('span', { className: 'dn-priority-complete' },
          button(unit.completed ? 'Completed' : 'Mark completed', (event) => void toggleComplete(unit, event), {
            variant: 'text', disabled: Boolean(busy),
            title: unit.completed ? 'Click to reopen this lesson' : 'Mark this lesson completed',
          })),
        h('span', { className: 'dn-priority-quiz' },
          button('Quiz', (event) => { event.stopPropagation(); quizUnit(unit); }, { variant: 'text', disabled: Boolean(busy) })),
        h('span', { className: 'dn-priority-arrow' }, h(StudyIcon, { name: 'arrow', size: 18 }))))))
      : h('p', { className: 'dn-muted' }, 'Build a lesson plan from your learning map.')));

  content.push(h('section', { className: 'dn-more-study', key: 'more' },
    h('div', { className: 'dn-gem-head' }, h('h3', null, 'More ways to study'),
      button(overall.cards.total
        ? (overall.cards.due ? `${overall.cards.due} flashcards due` : 'Review flashcards')
        : 'Make flashcards', () => { if (overall.cards.total) review(); else makeCards(); },
      { variant: 'text dn-more-link', disabled: Boolean(busy) })),
    h('div', { className: 'dn-more-grid' },
      button(h(React.Fragment, null,
        h('span', { className: 'dn-more-icon' }, h(StudyIcon, { name: 'book', size: 24 })),
        h('strong', null, 'See your personalized study plan'),
        h('small', null, study.plan ? `${overall.completed} of ${overall.total} lessons complete` : 'Build a sequence from your goal')),
      openPlan, { variant: 'more', disabled: Boolean(busy) }),
      button(h(React.Fragment, null,
        h('span', { className: 'dn-more-icon' }, h(StudyIcon, { name: 'quiz', size: 24 })),
        h('strong', null, 'Check your learning with a quiz'),
        h('small', null, 'One question at a time, in a study session')),
      takeTest, { variant: 'more', disabled: Boolean(busy) }))));

  if (hasActivity) {
    content.push(h('section', { className: 'dn-gem-card dn-progress-card', key: 'progress' },
      h('div', { className: 'dn-gem-head' },
        h('h3', null, 'Your progress'),
        h('small', null, overall.topics.length
          ? `${overall.started} of ${overall.topics.length} topics started · ${overall.streak} day streak`
          : 'Take a quiz to start filling your progress')),
      h('div', { className: 'dn-progress-layout' },
        h(ProgressGauge, { value: overall.strongPercent ?? 0, focus: focusCount }),
        h('div', { className: 'dn-progress-rows' }, topicRows.length ? topicRows
          : h('p', { className: 'dn-muted' }, 'Take a quiz in a study session to see strengths and focus areas here.'))),
      h('div', { className: 'dn-progress-legend' },
        h('span', { className: 'dn-legend-blue' }, `${overall.states?.strength ?? 0} Strengths`),
        h('span', { className: 'dn-legend-pink' }, `${overall.states?.focus ?? 0} Focus areas`),
        h('span', { className: 'dn-legend-gray' }, `${overall.states?.['not-started'] ?? 0} Not started`))));
  }

  const sessions = (book.sessions ?? []).filter((session) => session.kind !== 'linked');
  if (sessions.length) {
    content.push(h('section', { className: 'dn-past dn-study-sessions', key: 'sessions' },
      h('div', { className: 'dn-gem-head' }, h('h3', null, 'Sessions')),
      h('ul', { className: 'dn-past-chat-list' }, sessions.slice().reverse().map((session) => h('li', { key: session.id },
        h('button', { type: 'button', className: 'dn-chat-row', onClick: () => openSessionNative(session.id) },
          h('span', null, session.title || 'Session'),
          h('small', null, `${session.kind === 'lesson' ? 'Lesson' : session.kind === 'plan' ? 'Plan' : session.kind === 'setup' ? 'Setup' : session.kind === 'agent' ? 'Agent' : 'Chat'} · ${formatDate(session.created)}`)))))));
  }

  const chats = [
    ...(book.chats ?? []).filter((chat) => chat.messages?.length),
    ...(study.threads ?? []).filter((thread) => thread.messages?.length).map((thread) => ({
      id: thread.id, title: thread.title || 'Study session',
      created: thread.created, updated: thread.updated ?? thread.created,
      messages: thread.messages,
    })),
  ];
  if (chats.length) {
    content.push(h('section', { className: 'dn-past dn-past-chats', key: 'chats' },
      h('div', { className: 'dn-gem-head' }, h('h3', null, 'Earlier conversations')),
      h('ul', { className: 'dn-past-chat-list' }, chats.map((chat) => h('li', { key: chat.id },
        h('button', { type: 'button', className: 'dn-chat-row', onClick: () => onArchiveChat(chat) },
          h('span', null, chat.title || 'Conversation'),
          h('small', null, formatDate(chat.updated ?? chat.created))))))));
  }

  content.push(h(HomeAskBar, { key: 'ask', onAsk: openChat }));

  return h('section', { className: 'dn-study-hub dn-scroll', 'aria-label': 'Study and learn' },
    h('div', { className: 'dn-study-dash' }, content),
    busy && h('div', { className: 'dn-study-busy' }, status(busy), button('Stop', () => task.current?.abort(), { variant: 'small' })),
    error && status(error, 'error'));
}

function ReviewView({ book, cards, send, close, onCreate, openPassage = () => {}, onDiscuss = () => {} }) {
  const [queue, setQueue] = useState(() => cards.slice());
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = queue[index];
  const done = !current;
  async function rate(rating) {
    if (!current || busy) return;
    setBusy(true);
    setError('');
    try {
      await send('study-review', { cardId: current.id, rating });
      setStats((value) => ({ ...value, [rating]: value[rating] + 1 }));
      if (rating === 'again' && !queue.slice(index + 1).some((item) => item.id === current.id)) {
        setQueue((items) => [...items, current]);
      }
      setIndex(index + 1);
      setFlipped(false);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  if (done) {
    const reviewed = stats.again + stats.hard + stats.good + stats.easy;
    return h('div', { className: 'dn-focus-view dn-scroll' },
      h('header', { className: 'dn-focus-head' },
        button(h(React.Fragment, null, h(StudyIcon, { name: 'back', size: 16 }), 'Notebook'), close, { variant: 'text' }),
        h('div', { className: 'dn-focus-title' }, h('span', { className: 'dn-eyebrow' }, 'Spaced review'), h('h2', null, 'Review complete'))),
      h('div', { className: 'dn-review-done' },
        h(MasteryRing, { value: reviewed ? Math.round(100 * (stats.good + stats.easy + stats.hard) / reviewed) : 0, label: 'Recalled', size: 132 }),
        h('h2', null, reviewed ? 'Cards are scheduled' : 'Nothing due right now'),
        h('p', null, reviewed ? `${reviewed} cards reviewed. The next review dates were spaced from your ratings.` : 'Come back when cards are due, or add a new deck.'),
        h('div', { className: 'dn-review-stats' },
          [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']].map(([key, label]) =>
            h('span', { key }, h('strong', null, stats[key]), label))),
        h('div', { className: 'dn-hero-actions' },
          button('Back to learning map', close, { variant: 'primary' }),
          button('Add more cards', onCreate))));
  }
  const citations = current.citations ?? [];
  return h('div', { className: 'dn-focus-view dn-scroll' },
    h('header', { className: 'dn-focus-head' },
      button(h(React.Fragment, null, h(StudyIcon, { name: 'back', size: 16 }), 'Notebook'), close, { variant: 'text' }),
      h('div', { className: 'dn-focus-title' }, h('span', { className: 'dn-eyebrow' }, 'Spaced review'),
        h('h2', null, `${index + 1} of ${queue.length}`)),
      h('div', { className: 'dn-focus-meta' },
        h('span', null, current.topic),
        h('span', null, `${queue.length - index} left`))),
    h('div', { className: 'dn-card-stage' },
      h('button', { type: 'button', className: cls('dn-flashcard', flipped && 'dn-flipped'), onClick: () => setFlipped(!flipped), 'aria-label': flipped ? 'Show card front' : 'Show answer' },
        h('span', { className: 'dn-card-side' }, h('small', null, flipped ? 'Answer' : 'Prompt'),
          h('div', { className: 'dn-card-text' }, flipped
            ? h(RichText, { value: current.back, citations, open: openPassage })
            : h('p', null, current.front))),
        h('span', { className: 'dn-card-hint' }, flipped ? 'Tap to see the prompt' : 'Tap to reveal the answer')),
      h('div', { className: 'dn-rating-row' }, [
        ['again', 'Again', 'var(--dn-danger)'], ['hard', 'Hard', 'var(--dn-warning)'],
        ['good', 'Good', 'var(--dn-success)'], ['easy', 'Easy', 'var(--dn-primary)'],
      ].map(([value, label, color]) => button(h(React.Fragment, null,
        h('strong', null, label), h('small', null, nextIntervalLabel(current, value))), () => rate(value),
        { key: value, className: 'dn-rate', style: { '--rate-color': color }, disabled: busy }))),
      error && status(error, 'error'),
      button('Discuss this card in a session', () => onDiscuss(current), { variant: 'text' })));
}

function studyMarkdown(study) {
  const plan = study.plan?.units.map((unit) =>
    `- [${unit.completed ? 'x' : ' '}] **${unit.title}** · ${unit.minutes} min. ${unit.objective}`);
  const attempts = study.attempts.map((attempt) => `- ${attempt.title}: ${attempt.correct}/${attempt.total} · ${formatDate(attempt.created)}`);
  const map = study.map?.topics.map((topic) => `### ${topic.title}\n\n${topic.summary}\n\n${topic.objectives.map((objective) => `- **${objective.title}** — ${objective.description}`).join('\n')}`);
  return ['## Study & Learn', study.goal,
    `Level: ${STUDY_LEVELS[study.level] ?? study.level} · ${study.dailyMinutes ?? 20} min/day${study.examDate ? ` · target ${study.examDate}` : ''}`,
    map?.length ? '### Learning map\n\n' + map.join('\n\n') : '',
    plan?.length ? '### Lesson plan\n\n' + plan.join('\n') : '',
    attempts.length ? '### Results\n\n' + attempts.join('\n') : '',
    study.cards?.length ? `### Flashcards\n\n${study.cards.length} cards · ${study.cards.filter((card) => !card.due || Date.parse(card.due) <= Date.now()).length} due` : ''].filter(Boolean).join('\n\n');
}
