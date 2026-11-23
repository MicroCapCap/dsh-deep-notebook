import { find, NotebookError, record } from './store.js';

const MAP = '{"topics":[{"title":"topic title","summary":"one sentence on why this topic matters","objectives":[{"title":"I can ...","description":"what the learner should be able to do"}]}]}';
const CARDS = '{"cards":[{"front":"prompt or question","back":"answer with [1] citations","topic":"topic title"}]}';
const PLAN = '{"units":[{"title":"lesson title","objective":"what the learner will be able to do","topics":["short concept name"],"minutes":10,"kind":"concept | practice | review"}]}';

export const STUDY_FORMATS = {
  'study-plan': `Return JSON only with shape ${PLAN}. Make 4–8 bite-sized lessons in prerequisite order. Each lesson is one focused sitting of 8–25 minutes. Prioritize low-scoring or unassessed concepts and tie every lesson to the learning goal and available evidence. Use kind "concept" for a new idea, "practice" for guided exercises, and "review" for consolidation.`,
  'study-map': `Return JSON only with shape ${MAP}. Break the learning goal into 3–8 coherent topics and 2–5 measurable objectives per topic (18–32 objectives total). Objectives must be concrete, observable, and ordered from prerequisite to advanced. Use short topic titles that can be reused as assessment labels. Base the map on the supplied evidence when it exists; otherwise use accurate general knowledge of the subject.`,
  'study-cards': `Return JSON only with shape ${CARDS}. Write 10–18 flashcards for active recall. One fact or one reasoning step per card. Fronts are questions, prompts, or cloze deletions; backs are short answers with [1] citations when evidence is supplied. Use the learning-map topic titles. Prioritize weak topics and avoid duplicate cards.`,
};

function label(value, max = 200) {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
}

function array(value, test, limit) {
  return Array.isArray(value) && value.length > 0 && value.length <= limit && value.every(test);
}

export function parseJson(output) {
  const text = String(output ?? '').trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, '');
  const candidates = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* Try the next candidate. */ }
  }
  return undefined;
}

function topic(item) {
  return item && label(item.title, 140)
    && (item.summary == null || label(item.summary, 900))
    && array(item.objectives, (objective) => objective && label(objective.title, 240)
      && (objective.description == null || label(objective.description, 1000)), 8)
    && item.objectives.length >= 2;
}

function card(item) {
  return item && label(item.front, 900) && label(item.back, 4000)
    && (item.topic == null || label(item.topic, 120))
    && (item.objective == null || label(item.objective, 240));
}

function unit(item) {
  return item && label(item.title, 200) && label(item.objective, 1200)
    && array(item.topics, (value) => label(value, 120), 8)
    && Number.isInteger(item.minutes) && item.minutes > 0 && item.minutes <= 90
    && (item.kind == null || ['concept', 'practice', 'review'].includes(item.kind));
}

export function parseStudy(kind, output) {
  const value = parseJson(output);
  try {
    if (!value) throw new TypeError('No JSON object in the response.');
    if (kind === 'study-map' && array(value?.topics, topic, 10) && value.topics.length >= 2) {
      const topics = value.topics.map(({ title, summary, objectives }) => ({
        title: title.trim(),
        summary: (typeof summary === 'string' ? summary : '').trim(),
        objectives: objectives.map(({ title: name, description }) => ({
          title: name.trim(),
          description: (typeof description === 'string' ? description : '').trim(),
        })),
      }));
      const total = topics.reduce((sum, item) => sum + item.objectives.length, 0);
      if (total >= 6 && total <= 48) return { topics };
    }
    if (kind === 'study-cards' && array(value?.cards, card, 30) && value.cards.length >= 4) {
      const seen = new Set();
      const cards = [];
      for (const item of value.cards) {
        const key = topicKey(item.front);
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({
          front: item.front.trim(),
          back: item.back.trim(),
          topic: (item.topic || 'General').trim(),
          ...(item.objective ? { objective: item.objective.trim() } : {}),
        });
      }
      return { cards };
    }
    if (kind === 'study-plan' && array(value?.units, unit, 10) && value.units.length >= 2) {
      return {
        units: value.units.map(({ title, objective, topics, minutes, kind: style }) => ({
          title: title.trim(), objective: objective.trim(), topics, minutes,
          kind: style ?? 'concept',
        })),
      };
    }
  } catch {
    // A provider can emit partial JSON or prose. Keep the existing study state.
  }
  throw new NotebookError('The model returned an invalid study activity. Try again or choose another model.', 502);
}

export function topicKey(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

export function recordQuizAttempt(study, input, now = new Date()) {
  const topics = [];
  for (const item of Array.isArray(input?.topics) ? input.topics : []) {
    const topic = typeof item?.topic === 'string' ? item.topic.trim().slice(0, 140) : '';
    const total = Number(item?.total);
    const correct = Number(item?.correct);
    if (topic && Number.isInteger(total) && total > 0 && Number.isInteger(correct) && correct >= 0 && correct <= total) {
      topics.push({ topic, correct, total });
    }
  }
  let total = Number(input?.total);
  let correct = Number(input?.correct);
  if (!Number.isInteger(total) || total <= 0) total = topics.reduce((sum, item) => sum + item.total, 0);
  if (!Number.isInteger(correct) || correct < 0) correct = topics.reduce((sum, item) => sum + item.correct, 0);
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(correct) || correct < 0 || correct > total) {
    throw new NotebookError('A quiz report needs a question count and a correct count.');
  }
  const title = typeof input?.title === 'string' && input.title.trim()
    ? input.title.trim().slice(0, 200) : 'Quiz';
  if (!topics.length) topics.push({ topic: 'General', correct, total });
  const attempt = record({
    kind: 'quiz', title, total, correct, topics,
    answers: [],
  });
  study.attempts.push(attempt);
  if (study.attempts.length > 400) study.attempts = study.attempts.slice(-400);
  study.sessions.push(record({
    kind: 'quiz', title, minutes: Math.max(2, Math.round(total * 1.5)),
    created: now.toISOString(),
  }));
  if (study.sessions.length > 800) study.sessions = study.sessions.slice(-800);
  study.lastActivity = now.toISOString();
  return attempt;
}

export function topicProgress(study) {
  const topics = new Map();
  for (const attempt of study.attempts.slice(-12)) {
    for (const item of attempt.topics) {
      const key = topicKey(item.topic);
      const summary = topics.get(key) ?? { topic: item.topic, correct: 0, total: 0 };
      summary.correct += item.correct;
      summary.total += item.total;
      topics.set(key, summary);
    }
  }
  return [...topics.values()].sort((a, b) => a.correct / a.total - b.correct / b.total || a.topic.localeCompare(b.topic));
}

function allTopicStats(study) {
  const topics = new Map();
  for (const attempt of study.attempts) {
    for (const item of attempt.topics) {
      const key = topicKey(item.topic);
      const summary = topics.get(key) ?? {
        topic: item.topic, correct: 0, total: 0, checks: 0, last: attempt.created, title: attempt.title,
      };
      summary.correct += item.correct;
      summary.total += item.total;
      summary.checks += 1;
      if (attempt.created > summary.last) {
        summary.last = attempt.created;
        summary.title = attempt.title;
      }
      topics.set(key, summary);
    }
  }
  return topics;
}

function stateFor(correct, total) {
  if (!total) return 'not-started';
  const accuracy = correct / total;
  if ((total >= 3 && accuracy >= 0.75) || (total >= 2 && accuracy >= 0.85)) return 'strength';
  if (accuracy < 0.6) return 'focus';
  return 'developing';
}

function masteryFor(correct, total) {
  if (!total) return 0;
  return Math.round(100 * (correct / total) * Math.min(1, total / 4));
}

function statFor(stats, name) {
  const key = topicKey(name);
  if (stats.has(key)) return stats.get(key);
  for (const [candidate, value] of stats) {
    if (candidate.includes(key) || key.includes(candidate)) return value;
  }
  return null;
}

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function activityDays(study) {
  return new Set([
    ...study.attempts.map((item) => dayKey(item.created)),
    ...study.sessions.map((item) => dayKey(item.created)),
    ...study.reviews.map((item) => dayKey(item.created)),
  ].filter(Boolean));
}

function streakFor(days, now) {
  if (!days.size) return 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function cardSummary(study, now) {
  const due = study.cards.filter((item) => !item.due || Date.parse(item.due) <= now.getTime());
  const fresh = study.cards.filter((item) => !item.reps);
  return { total: study.cards.length, due: due.length, new: fresh.length, dueIds: due.map((item) => item.id) };
}

export function studyProgress(study, now = new Date()) {
  const stats = allTopicStats(study);
  const map = study.map?.topics ?? [];
  const topics = map.map((item) => {
    const stat = statFor(stats, item.title);
    const total = stat?.total ?? 0;
    const correct = stat?.correct ?? 0;
    return {
      topic: item.title,
      summary: item.summary,
      objectives: item.objectives,
      correct,
      total,
      checks: stat?.checks ?? 0,
      accuracy: total ? correct / total : 0,
      mastery: masteryFor(correct, total),
      state: stateFor(correct, total),
      last: stat?.last ?? null,
    };
  });
  if (!topics.length) {
    for (const item of stats.values()) {
      topics.push({
        topic: item.topic, correct: item.correct, total: item.total, checks: item.checks,
        accuracy: item.correct / item.total,
        mastery: masteryFor(item.correct, item.total),
        state: stateFor(item.correct, item.total),
        last: item.last,
      });
    }
    topics.sort((a, b) => a.mastery - b.mastery || a.topic.localeCompare(b.topic));
  }
  const units = study.plan?.units ?? [];
  const incomplete = units.filter((item) => !item.completed);
  const scores = new Map(topics.map((item) => [topicKey(item.topic), item.mastery / 100]));
  const score = (unit) => Math.min(...unit.topics.map((name) => scores.get(topicKey(name)) ?? 0.5));
  const next = incomplete.reduce((best, unit) => !best || score(unit) < score(best) ? unit : best, null);
  const started = topics.filter((item) => item.total > 0).length;
  const mastery = topics.length
    ? Math.round(topics.reduce((sum, item) => sum + item.mastery, 0) / topics.length)
    : 0;
  const states = { strength: 0, focus: 0, developing: 0, 'not-started': 0 };
  for (const item of topics) states[item.state] += 1;
  const strongPercent = topics.length ? Math.round(100 * states.strength / topics.length) : 0;
  const objectives = topics.reduce((sum, item) => sum + (item.objectives?.length ?? 0), 0);
  const today = dayKey(now);
  const todayAttempts = study.attempts.filter((item) => dayKey(item.created) === today);
  const todaySessions = study.sessions.filter((item) => dayKey(item.created) === today);
  return {
    topics,
    recommendedUnitId: next?.id ?? null,
    completed: units.length - incomplete.length,
    total: units.length,
    mastery,
    strongPercent,
    states,
    objectives,
    coverage: topics.length ? started / topics.length : 0,
    started,
    cards: cardSummary(study, now),
    streak: streakFor(activityDays(study), now),
    minutes: study.sessions.reduce((sum, item) => sum + Number(item.minutes ?? 0), 0),
    today: {
      minutes: todaySessions.reduce((sum, item) => sum + (item.minutes ?? 0), 0),
      questions: todayAttempts.reduce((sum, item) => sum + (item.total ?? 0), 0),
      lessons: todaySessions.filter((item) => item.kind === 'lesson').length,
    },
    weak: topics.filter((item) => item.total > 0 && item.accuracy < 0.75)
      .sort((a, b) => a.accuracy - b.accuracy || a.topic.localeCompare(b.topic)).slice(0, 4),
    recent: study.attempts.slice(-6).reverse().map(({ id, title, kind, correct, total, created, unitId }) =>
      ({ id, title, kind, correct, total, created, unitId })),
  };
}

export function studyContext(study, unit) {
  return JSON.stringify({
    goal: study.goal,
    level: study.level,
    examDate: study.examDate,
    dailyMinutes: study.dailyMinutes,
    learningMap: (study.map?.topics ?? []).map((item) => ({
      topic: item.title,
      summary: item.summary,
      objectives: item.objectives.map((objective) => objective.title),
    })),
    recentTopicResults: topicProgress(study).slice(0, 20),
    completedLessons: (study.plan?.units ?? []).filter((item) => item.completed).map((item) => item.title),
    lesson: unit && { title: unit.title, objective: unit.objective, topics: unit.topics, kind: unit.kind },
  });
}

export function saveStudyActivity(study, kind, result, unitId, meta = {}) {
  if (kind === 'study-map') {
    study.map = record({ topics: result.data.topics, citations: result.citations });
  } else if (kind === 'study-cards') {
    const existing = new Set(study.cards.map((item) => topicKey(item.front)));
    const created = new Date().toISOString();
    for (const item of result.data.cards) {
      if (existing.has(topicKey(item.front))) continue;
      existing.add(topicKey(item.front));
      study.cards.push(record({
        ...item, citations: result.citations,
        ease: 2.5, interval: 0, due: created, reps: 0, lapses: 0, lastReviewed: null,
      }));
    }
    if (study.cards.length > 240) study.cards = study.cards.slice(-240);
  } else if (kind === 'study-plan') {
    const completed = (study.plan?.units ?? []).filter((item) => item.completed);
    const titles = new Set(completed.map((item) => topicKey(item.title)));
    const next = [];
    for (const item of result.data.units) {
      const key = topicKey(item.title);
      if (titles.has(key)) continue;
      titles.add(key);
      next.push(record({ ...item, completed: false }));
    }
    study.plan = record({ units: [...completed, ...next], citations: result.citations });
  } else {
    throw new NotebookError('Unknown study activity.');
  }
}

const RATINGS = new Set(['again', 'hard', 'good', 'easy']);

export function completeUnit(study, unitId, now = new Date()) {
  const unit = find(study.plan?.units ?? [], unitId, 'Lesson');
  if (unit.completed) return unit;
  unit.completed = true;
  study.sessions.push(record({
    kind: 'lesson', unitId: unit.id, title: unit.title, minutes: unit.minutes,
    created: now.toISOString(),
  }));
  return unit;
}

export function uncompleteUnit(study, unitId) {
  const unit = find(study.plan?.units ?? [], unitId, 'Lesson');
  unit.completed = false;
  return unit;
}

export function reviewCard(study, cardId, rating, now = new Date()) {  if (!RATINGS.has(rating)) throw new NotebookError('Choose a review rating.');
  const item = find(study.cards, cardId, 'Flashcard');
  const ease = Number(item.ease ?? 2.5);
  const interval = Number(item.interval ?? 0);
  const reps = Number(item.reps ?? 0);
  let nextEase = ease;
  let days;
  if (rating === 'again') {
    nextEase = Math.max(1.3, ease - 0.2);
    item.lapses = Number(item.lapses ?? 0) + 1;
    days = 0;
  } else if (rating === 'hard') {
    nextEase = Math.max(1.3, ease - 0.15);
    days = Math.max(1, Math.round(interval * 1.2));
  } else if (rating === 'easy') {
    nextEase = Math.min(3.2, ease + 0.15);
    days = reps === 0 ? 2 : reps === 1 ? 5 : Math.max(5, Math.round(interval * nextEase * 1.3));
  } else {
    days = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(3, Math.round(interval * nextEase));
  }
  item.ease = Math.round(nextEase * 100) / 100;
  item.interval = days;
  item.reps = reps + 1;
  item.due = new Date(now.getTime() + days * 86_400_000).toISOString();
  item.lastReviewed = now.toISOString();
  study.reviews.push(record({ cardId, rating, topic: item.topic, interval: days }));
  return item;
}

export function cardInterval(item) {
  const days = Number(item?.interval ?? 0);
  if (!days) return 'now';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  return `${Math.round(days / 30)} mo`;
}

export function dueCards(study, now = new Date(), limit = 24) {
  return study.cards
    .filter((item) => !item.due || Date.parse(item.due) <= now.getTime())
    .sort((a, b) => Number(Boolean(a.reps)) - Number(Boolean(b.reps)) || String(a.due).localeCompare(String(b.due)))
    .slice(0, limit);
}
