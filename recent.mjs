// Prints the router's latest decisions as a table: when, which project and
// session started the subagent, and what the router chose.
// Usage: node recent.mjs [how many, default 15]
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = join(dirname(fileURLToPath(import.meta.url)), 'router.log');
const count = Number(process.argv[2]) || 15;

let text = '';
try {
  text = await readFile(LOG, 'utf8');
} catch {
  console.log('No decisions logged yet.');
  process.exit(0);
}

const pad = (value, width) => String(value ?? '-').slice(0, width).padEnd(width);
const rows = text
  .trim()
  .split('\n')
  .slice(-count)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((d) => d && typeof d.model === 'string');

console.log(pad('time', 20), pad('project', 22), pad('session', 10), pad('subagent', 16), pad('chosen', 15), 'why');
for (const d of rows) {
  const when = new Date(d.time).toLocaleString();
  const why =
    d.source === 'classifier'
      ? `${d.category}, ${d.difficulty}, ${Math.round((d.confidence ?? 0) * 100)}%` +
        (d.classifier && !/bison/i.test(d.classifier) ? ` (by ${d.classifier.split('/').pop()})` : '')
      : `safe default${d.error ? ` (${d.error.slice(0, 40)})` : ''}`;
  console.log(
    pad(when, 20),
    pad(d.project, 22),
    pad(d.session ? d.session.slice(0, 8) : null, 10),
    pad(d.subagentType ?? 'general', 16),
    pad(`${d.model} ${d.effort}`, 15),
    why,
  );
}
