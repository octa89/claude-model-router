// Prints the router's latest decisions as a table: when, which project and
// session started the subagent, its title, and what the router chose and why.
// Usage: node recent.mjs [how many, default 15] [--project NAME]
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = join(dirname(fileURLToPath(import.meta.url)), 'router.log');
const args = process.argv.slice(2);
const projectAt = args.indexOf('--project');
const project = projectAt >= 0 ? args[projectAt + 1] : null;
const count = Number(args.find((a, i) => /^\d+$/.test(a) && i !== projectAt + 1)) || 15;

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
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((d) => d && typeof d.model === 'string')
  .filter((d) => !project || String(d.project ?? '').toLowerCase() === project.toLowerCase())
  .slice(-count);

if (project) console.log(`Project: ${project}`);
console.log(pad('time', 20), pad('project', 16), pad('session', 9), pad('subagent', 14), pad('title', 28), pad('chosen', 14), 'why');
for (const d of rows) {
  const when = new Date(d.time).toLocaleString();
  const why = d.retryOf
    ? `RETRY after ${d.retryOf}`
    : d.source === 'classifier'
      ? `${d.category}, ${d.difficulty}, ${Math.round((d.confidence ?? 0) * 100)}%` +
        (d.classifier && !/bison/i.test(d.classifier) ? ` (by ${d.classifier.split('/').pop()})` : '')
      : `safe default${d.error ? ` (${d.error.slice(0, 40)})` : ''}`;
  console.log(
    pad(when, 20),
    pad(d.project, 16),
    pad(d.session ? d.session.slice(0, 8) : null, 9),
    pad(d.subagentType ?? 'general', 14),
    pad(d.description, 28),
    pad(`${d.model} ${d.effort}`, 14),
    why,
  );
}
