import { NotebookError } from './store.js';

const STOP = new Set('a an and are as at be by can could did do does for from had has have how i in is it its me of on or our s should so than that the their them then there these they this to us was were what when where which who why will with would you your'.split(' '));

function tokens(value) {
  const words = [];
  const normalized = value.normalize('NFKC').toLowerCase();
  const runs = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}])+/gu) ?? [];
  for (const run of runs) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(run)) {
      const chars = Array.from(run);
      for (let i = 0; i < chars.length; i++) {
        words.push(chars[i]);
        if (i + 1 < chars.length) words.push(chars[i] + chars[i + 1]);
      }
    } else if (!STOP.has(run)) {
      words.push(run.replace(/([a-z]{4,})(?:ies|es|s)$/, '$1'));
    }
  }
  return words;
}

export function passages(source) {
  const body = source.body;
  const result = [];
  let start = 0;
  let line = 1;
  while (start < body.length) {
    let end = Math.min(body.length, start + 2000);
    if (end < body.length) {
      for (const marker of ['\n\n', '\n', '. ', '。', ' ']) {
        const boundary = body.lastIndexOf(marker, end - marker.length);
        if (boundary >= start + 1200) {
          end = boundary + marker.length;
          break;
        }
      }
    }
    const excerpt = body.slice(start, end);
    if (excerpt.trim()) {
      result.push({
        sourceId: source.id, title: source.title, url: source.url ?? '',
        start, line, text: excerpt,
      });
    }
    if (end === body.length) break;
    const next = end - 240;
    line += body.slice(start, next).split('\n').length - 1;
    start = next;
  }
  return result;
}

export function retrieve(sources, query, { limit = 16, overview = false, prior = '' } = {}) {
  const primary = new Set(tokens(query).slice(0, 120));
  const secondary = new Set(tokens(prior).slice(0, 50));
  const terms = new Set([...primary, ...secondary]);
  const groups = sources.map(passages).filter((group) => group.length);
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  if (overview && total <= limit) return groups.flat();
  if (overview && !terms.size) {
    const sampled = [];
    for (let round = 0; sampled.length < limit && sampled.length < total; round++) {
      for (const group of groups) {
        if (sampled.length === limit) break;
        if (round === 0) {
          sampled.push(group[0]);
          continue;
        }
        const order = group.slice(1).sort((a, b) => {
          const distances = (item) => Math.min(...sampled.filter((p) => p.sourceId === item.sourceId).map((p) => Math.abs(item.start - p.start)));
          return distances(b) - distances(a);
        });
        if (order[0] && !sampled.includes(order[0])) sampled.push(order[0]);
      }
    }
    return sampled;
  }
  const counts = new Map();
  let length = 0;
  const indexed = groups.flat().map((passage) => {
    const words = tokens(passage.text);
    const frequencies = new Map();
    for (const word of words) {
      if (terms.has(word)) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    }
    for (const word of frequencies.keys()) counts.set(word, (counts.get(word) ?? 0) + 1);
    length += words.length;
    return { passage, frequencies, length: words.length, title: new Set(tokens(passage.title)) };
  });
  const average = Math.max(1, length / total);
  const ranked = indexed.map((item) => {
    let score = 0;
    for (const word of terms) {
      const frequency = item.frequencies.get(word) ?? 0;
      const weight = primary.has(word) ? 1 : 0.35;
      const matches = counts.get(word) ?? 0;
      const inverse = Math.log(1 + (total - matches + 0.5) / (matches + 0.5));
      score += weight * inverse * (
        (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * item.length / average))
        + Number(item.title.has(word)) * 0.8
      );
    }
    return { ...item.passage, score };
  }).sort((a, b) => b.score - a.score);
  if (!overview) return ranked.filter((item) => item.score > 0).slice(0, limit);

  const spread = retrieve(sources, '', { limit, overview: true });
  const selected = ranked.filter((item) => item.score > 0).slice(0, Math.ceil(limit * 0.6));
  for (const passage of spread) {
    if (selected.length === limit) break;
    if (!selected.some((p) => p.sourceId === passage.sourceId && p.start === passage.start)) selected.push(passage);
  }
  return selected;
}

export const ARTIFACTS = {
  report: 'Write an analytical report in Markdown with executive summary, claims, evidence, and open questions. End with practical next steps if the evidence supports them.',
  guide: 'Write a study guide in Markdown with learning goals, key terms, explanations, review questions, and an answer key.',
  flashcards: 'Return JSON only with shape {"cards":[{"front":"question","back":"answer with [1] citations"}]}. Make 5–12 focused cards when supported.',
  quiz: 'Return JSON only with shape {"questions":[{"question":"question","options":["first","second","third","fourth"],"answer":0,"explanation":"rationale with [1] citations"}]}. Answer is a zero-based integer. Use 4 distinct options and 4–10 questions when supported.',
  map: 'Return JSON only with shape {"root":"main theme","branches":[{"title":"branch","items":["related concept with [1] citations"]}]}. Use 2–8 branches when supported.',
  table: 'Return JSON only with shape {"columns":["heading","Evidence"],"rows":[["cell","[1]"]]}. All cells are strings, all rows match the column width, and the final column contains citations.',
  slides: 'Return JSON only with shape {"slides":[{"title":"heading","points":["concise point with [1] citation"],"notes":"optional speaker notes"}]}. Make 3–10 slides when supported.',
  infographic: 'Return JSON only with shape {"title":"heading","items":[{"label":"label","value":"short number or fact","detail":"context with [1] citations"}]}. Do not invent metrics. Make 3–8 items when supported.',
  audio: 'Write an engaging spoken overview in plain text. Use short paragraphs and smooth transitions. Include [1] citations in the script so the reader can verify them. Do not add speaker tags or stage directions.',
  timeline: 'Return JSON only with shape {"events":[{"date":"date or phase","title":"heading","detail":"context with [1] citations"}]}. Order events chronologically and avoid implying a date the evidence does not contain.',
};

function string(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 9000;
}

function some(value, validate, max = 40) {
  return Array.isArray(value) && value.length > 0 && value.length <= max && value.every(validate);
}

const shape = {
  flashcards: (data) => some(data.cards, (card) => card && string(card.front) && string(card.back)),
  quiz: (data) => some(data.questions, (q) => q && string(q.question) && some(q.options, string)
    && q.options.length === 4 && new Set(q.options.map((answer) => answer.trim().toLowerCase())).size === 4
    && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length && string(q.explanation)),
  map: (data) => string(data.root) && some(data.branches, (branch) => branch && string(branch.title) && some(branch.items, string)),
  table: (data) => some(data.columns, string, 12) && some(data.rows, (row) => some(row, (cell) => typeof cell === 'string')
    && row.length === data.columns.length, 100),
  slides: (data) => some(data.slides, (slide) => slide && string(slide.title) && some(slide.points, string)
    && (slide.notes == null || typeof slide.notes === 'string')),
  infographic: (data) => string(data.title) && some(data.items, (item) => item && string(item.label) && string(item.value) && string(item.detail)),
  timeline: (data) => some(data.events, (event) => event && string(event.date) && string(event.title) && string(event.detail)),
};

export function parseArtifact(kind, output) {
  if (!Object.hasOwn(shape, kind)) return output;
  const text = output.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, '');
  const candidates = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const result = JSON.parse(candidate);
      if (result && shape[kind](result)) return result;
    } catch {
      // The model can return prose instead of the requested JSON.
    }
  }
  throw new NotebookError('The model returned an invalid study format. Try again with a narrower topic.', 502);
}

export function validatedCitations(output, passages) {
  const used = new Set();
  function clean(value) {
    if (typeof value === 'string') {
      return value.replace(/\[(\d{1,4})\](?!\()/g, (label, number) => {
        const index = Number(number);
        if (index < 1 || index > passages.length) return '';
        used.add(index);
        return `[${index}]`;
      });
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clean(child)]));
    return value;
  }
  const data = clean(output);
  return {
    data,
    citations: Array.from(used, (index) => {
      const { score, ...passage } = passages[index - 1];
      return { ...passage, number: index };
    }).sort((a, b) => a.number - b.number),
  };
}
