import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { MAX_SOURCE, NotebookError, record, text } from './store.js';

const exec = promisify(execFile);
const OFFICE = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.epub']);
export const MAX_UPLOAD = 12 * 1024 * 1024;

export function webUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new NotebookError('Enter a complete website URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) {
    throw new NotebookError('Enter a valid HTTP or HTTPS URL without credentials.');
  }
  return url.href;
}

const HTML_ENTITIES = { amp: '&', apos: "'", quot: '"', gt: '>', lt: '<', nbsp: ' ', ndash: '–', mdash: '—' };

function htmlText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|noscript|template|head|nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:p|li|h[1-6]|section|article|main|pre|blockquote|ul|ol|table|tr|br|hr|div)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
      if (code[0] !== '#') return Object.hasOwn(HTML_ENTITIES, code) ? HTML_ENTITIES[code] : entity;
      const point = /^#x/i.test(code) ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function makeSource(title, value, kind, extra = {}) {
  const body = text(value, 'Source text', MAX_SOURCE).replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
  if (!body) throw new NotebookError('This source contains no readable text.');
  return record({ title: text(title, 'Source title', 180), kind, body, enabled: true, ...extra });
}

export async function importWeb(web, input, signal) {
  const url = webUrl(input.url);
  if (!web) throw new NotebookError('Enable the Harness web tools to import websites.', 503);
  try {
    const fetched = await web.fetch({ url }, signal);
    if (fetched.statusCode < 200 || fetched.statusCode >= 300) {
      throw new NotebookError(`The website returned HTTP ${fetched.statusCode}.`);
    }
    const content = fetched.body.content;
    const pageTitle = fetched.body.kind === 'html' && content.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
    const body = fetched.body.kind === 'html' ? htmlText(content) : content;
    return makeSource(input.title || (pageTitle && htmlText(pageTitle).trim().slice(0, 180)) || new URL(url).hostname,
      body.slice(0, MAX_SOURCE), 'web', { url: webUrl(fetched.url), truncated: fetched.truncated || body.length > MAX_SOURCE });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof NotebookError) throw error;
    const summary = text(input.excerpt, 'Search excerpt', 7000, true);
    if (summary) return makeSource(input.title || new URL(url).hostname, summary, 'excerpt', { url });
    throw new NotebookError('Harness could not read the website. Check that it is public, or paste the relevant text.', 422);
  }
}

export async function importDocument(filename, buffer, converter, signal) {
  const cleanName = text(filename, 'File name', 180);
  const extension = extname(cleanName).toLowerCase();
  if (!OFFICE.has(extension)) throw new NotebookError('This document format is unsupported.');
  if (!buffer.length || buffer.length > MAX_UPLOAD) throw new NotebookError('Document must be between 1 byte and 12 MB.', 413);
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notebook-'));
  try {
    const file = join(dir, `source${extension}`);
    await writeFile(file, buffer);
    const { stdout } = await exec(converter || 'markitdown', [file], {
      windowsHide: true,
      timeout: 45_000,
      maxBuffer: 2_400_000,
      signal,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    if (!stdout.trim()) throw new NotebookError('This document has no text layer. Paste its text after transcription or OCR.', 422);
    return makeSource(cleanName, stdout.slice(0, MAX_SOURCE), 'file', { truncated: stdout.length > MAX_SOURCE });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof NotebookError) throw error;
    if (error.code === 'ENOENT') throw new NotebookError('Install MarkItDown or add it to PATH, then restart Harness. You can also paste the document text.', 503);
    throw new NotebookError('Could not extract this document. Check that it opens locally and has a readable text layer.', 422);
  } finally {
    await rm(dir, { force: true, recursive: true, maxRetries: 3 });
  }
}

export async function listSessions(sessionQuery, signal) {
  if (!sessionQuery) throw new NotebookError('Harness session history is unavailable.', 503);
  const sessions = (await sessionQuery.listSessions(signal))
    .filter(({ formatStatus }) => formatStatus !== 'migration-required')
    .map(({ header }) => header)
    .slice(0, 80);
  const titles = await sessionQuery.readTitleSnapshots(sessions.map((session) => session.id), signal);
  return sessions.map((session, index) => ({
    id: session.id,
    date: session.createdAt,
    title: sessionTitle(session.id, titles[index]?.value?.title),
  }));
}

export function sessionId(value) {
  const id = text(value, 'Session', 180);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new NotebookError('Choose a valid Harness session.');
  return id;
}

function sessionTitle(id, name) {
  return (name?.title || name?.text || `Session ${id.slice(0, 8)}`).slice(0, 180);
}

export async function sessionLink(sessionQuery, value, signal) {
  if (!sessionQuery) throw new NotebookError('Harness session history is unavailable.', 503);
  const id = sessionId(value);
  let snapshot;
  try {
    snapshot = await sessionQuery.readTitleSnapshot(id, signal);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new NotebookError('Harness could not open that session. Pick an existing session to link.', 404);
  }
  return { id, title: sessionTitle(id, snapshot.title) };
}

export async function importSession(sessionQuery, input) {
  if (!sessionQuery) throw new NotebookError('Harness session history is unavailable.', 503);
  const id = sessionId(input.sessionId);
  const { events } = await sessionQuery.readSurface(id);
  const entries = [];
  for (const event of events) {
    const user = event.type === 'user/message';
    if (!user && event.type !== 'assistant/message') continue;
    const blocks = user ? event.data.content : event.data.message.content;
    const content = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
    if (content) entries.push(`## ${user ? 'User' : 'Assistant'}\n\n${content}`);
  }
  const body = entries.join('\n\n');
  return makeSource(input.title || `Session ${id.slice(0, 8)}`, body.slice(0, MAX_SOURCE), 'session', {
    truncated: body.length > MAX_SOURCE,
  });
}
