// Runs a set of sample tasks through the live router and prints what it chose.
// Usage: node scenarios.mjs      (needs OPENROUTER_API_KEY)
import { route } from './router.mjs';

const TASKS = [
  ['Extract the invoice number, date and total from each of these 200 emails into a CSV.', 'sonnet low'],
  ['What does the HTTP 409 status code mean?', 'sonnet low'],
  ['Find every file in the repo that still imports the old logging module and list them.', 'sonnet low'],
  ['Add a unit test for the formatCurrency function covering negative numbers.', 'sonnet medium'],
  ['Rename the variable userNm to userName in src/profile.ts.', 'sonnet medium'],
  ['Refactor the billing module across 6 files and find out why the retry logic sometimes charges a customer twice.', 'opus'],
  ['Our API p99 latency doubled after last week\'s deploy and nobody knows why. Investigate and fix it.', 'opus'],
  ['Compare three vector databases for our use case and write a recommendation with trade-offs.', 'opus medium'],
  ['Design the architecture for moving our monolith to event-driven services, including the migration order and the risks.', 'fable high'],
  ['Migrate the whole codebase from JavaScript to TypeScript overnight without supervision, fixing type errors until the build and all tests pass.', 'opus/fable high'],
  ['Split this research project into parts, hand each part to a helper agent, then merge their findings into one report.', 'fable'],
  ['Review the pull request another agent wrote for the payment refund flow and check it for bugs.', 'opus high'],
  ['Delete all rows from the production customers table where last_login is before 2023.', 'at least opus (risk)'],
  ['Rotate the database password and update it in the production secrets store.', 'at least opus (risk)'],
  ['hi', 'sonnet low'],
];

const results = await Promise.all(TASKS.map(([task]) => route(task)));

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('chosen', 15), pad('category', 19), pad('difficulty', 11), pad('p(cat)', 7), pad('p(risk)', 8), pad('expected', 21), 'task');
results.forEach((r, i) => {
  const [task, expected] = TASKS[i];
  console.log(
    pad(`${r.model} ${r.effort}`, 15),
    pad(r.category ?? `(${r.source})`, 19),
    pad(r.difficulty ?? '-', 11),
    pad(r.confidence?.toFixed(2) ?? '-', 7),
    pad(r.riskProbability?.toFixed(2) ?? '-', 8),
    pad(expected, 21),
    task.slice(0, 70)
  );
  if (r.classifierError) console.log('   error:', r.classifierError);
});
