import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadMedia,
  MAX_IMAGES,
  MODELS,
  EFFORTS,
  DIFFICULTIES,
  CATEGORIES,
  ROUTES,
  FALLBACK,
  DEFAULT_CLASSIFIER,
  decide,
  escalate,
  buildDecisionRequest,
  readDecision,
  route,
  classify,
} from './router.mjs';

const label = (over = {}) => ({
  category: 'coding_routine',
  difficulty: 'normal',
  risk: 'low',
  confidence: 0.9,
  ...over,
});

// A Decisions API response in the documented shape.
const decision = ({ category = 'coding_routine', p = 0.9, difficulty = 'normal', risk = 0.05 } = {}) => ({
  model: 'baseten/bison-1',
  usage: { inputTokens: 100, outputTokens: 0 },
  answers: {
    category: { type: 'choice', choice: category, probabilities: { [category]: p } },
    difficulty: { type: 'choice', choice: difficulty, probabilities: { [difficulty]: 0.8 } },
    high_risk: { type: 'noul', noul: risk },
  },
});

// A stand-in for OpenRouter that answers with the given body.
const fakeFetch = (body, status = 200) => async (url, init) => {
  fakeFetch.last = { url, init };
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
};

const pick = (r) => [r.model, r.effort];

test('every category and difficulty maps to a real model and effort', () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), Object.keys(CATEGORIES).sort());
  for (const category of Object.keys(ROUTES)) {
    for (const difficulty of DIFFICULTIES) {
      const r = decide(label({ category, difficulty }));
      assert.ok(r.model in MODELS, `${category}/${difficulty} model`);
      assert.ok(EFFORTS.includes(r.effort), `${category}/${difficulty} effort`);
      assert.equal(r.modelId, MODELS[r.model].id);
      assert.equal(r.source, 'classifier');
    }
  }
});

test('the rules never pick xhigh or max on their own', () => {
  for (const row of Object.values(ROUTES)) {
    for (const cell of row) assert.ok(!/xhigh|max/.test(cell), cell);
  }
});

test('a harder task never gets a weaker model', () => {
  for (const category of Object.keys(ROUTES)) {
    const ranks = DIFFICULTIES.map((difficulty) => MODELS[decide(label({ category, difficulty })).model].rank);
    assert.ok(ranks[0] <= ranks[1] && ranks[1] <= ranks[2], category);
  }
});

test('documented starting points', () => {
  assert.deepEqual(pick(decide(label({ category: 'chat_simple' }))), ['sonnet', 'low']);
  assert.deepEqual(pick(decide(label({ category: 'coding_routine' }))), ['sonnet', 'medium']);
  assert.deepEqual(pick(decide(label({ category: 'coding_hard' }))), ['fable', 'medium']);
  assert.deepEqual(pick(decide(label({ category: 'deep_reasoning' }))), ['fable', 'high']);
});

test('Haiku is used only when allowed', () => {
  const c = label({ category: 'classify_extract' });
  assert.equal(decide(c).model, 'sonnet');
  assert.equal(decide(c, { allowHaiku: true }).model, 'haiku');
  for (const category of Object.keys(ROUTES)) {
    for (const difficulty of DIFFICULTIES) {
      assert.notEqual(decide(label({ category, difficulty })).model, 'haiku');
    }
  }
});

test('high risk raises the route to at least Opus at medium', () => {
  assert.deepEqual(pick(decide(label({ category: 'chat_simple', risk: 'high' }))), ['opus', 'medium']);
  assert.deepEqual(pick(decide(label({ category: 'chat_simple' }), { risk: 'high' })), ['opus', 'medium']);
  assert.deepEqual(pick(decide(label({ category: 'deep_reasoning', risk: 'high' }))), ['fable', 'high']);
});

test('a caller floor raises the model but never lowers it', () => {
  assert.equal(decide(label({ category: 'search_read' }), { minModel: 'opus' }).model, 'opus');
  assert.equal(decide(label({ category: 'deep_reasoning' }), { minModel: 'sonnet' }).model, 'fable');
});

test('low probability or a missing label falls back to the safe default', () => {
  for (const c of [label({ confidence: 0.3 }), null, {}, label({ category: 'nonsense' })]) {
    const r = decide(c);
    assert.deepEqual(pick(r), [FALLBACK.model, FALLBACK.effort]);
    assert.equal(r.source, 'fallback');
  }
});

test('a label with no probability is still used, and says so', () => {
  const r = decide(label({ confidence: null }));
  assert.deepEqual(pick(r), ['sonnet', 'medium']);
  assert.match(r.reasons.join(' '), /no probability/);
});

test('the request asks Bison three typed questions in the documented shape', () => {
  const req = buildDecisionRequest('Fix the login bug');
  assert.equal(req.model, DEFAULT_CLASSIFIER);
  assert.equal(req.model, 'baseten/bison-1');
  assert.deepEqual(req.state, { task: 'Fix the login bug' });
  assert.equal(req.questions.category.type, 'choice');
  assert.deepEqual(Object.keys(req.questions.category.criteria).sort(), Object.keys(ROUTES).sort());
  assert.equal(req.questions.difficulty.type, 'choice');
  assert.deepEqual(Object.keys(req.questions.difficulty.criteria), DIFFICULTIES);
  assert.equal(req.questions.high_risk.type, 'noul');
  assert.deepEqual(Object.keys(req.questions.high_risk.criteria).sort(), ['false', 'true']);
});

test('readDecision turns answers into a label', () => {
  assert.deepEqual(readDecision(decision({ category: 'coding_hard', p: 0.72, difficulty: 'hard', risk: 0.91 })), {
    category: 'coding_hard',
    difficulty: 'hard',
    risk: 'high',
    riskProbability: 0.91,
    confidence: 0.72,
  });
  assert.equal(readDecision(decision({ risk: 0.39 })).risk, 'low');
  assert.equal(readDecision(decision({ risk: 0.4 })).risk, 'high');
});

test('readDecision uses the confidence field when probabilities are absent', () => {
  const d = decision();
  d.answers.category = { type: 'choice', choice: 'chat_simple', confidence: 0.66 };
  assert.equal(readDecision(d).confidence, 0.66);
  d.answers.category = { type: 'choice', choice: 'chat_simple' };
  assert.equal(readDecision(d).confidence, null);
});

test('readDecision rejects refusals, missing answers and unknown options', () => {
  const refused = decision();
  refused.answers.category = { type: 'refusal' };
  assert.throws(() => readDecision(refused), /refused/);

  const missing = decision();
  delete missing.answers.high_risk;
  assert.throws(() => readDecision(missing), /no answer/);

  assert.throws(() => readDecision(decision({ category: 'made_up' })), /unknown category/);
  assert.throws(() => readDecision(decision({ difficulty: 'huge' })), /unknown difficulty/);
  assert.throws(() => readDecision({}), /no answer/);
});

test('escalation raises effort first, then the model, and ends', () => {
  const seen = [];
  let step = { model: 'sonnet', effort: 'low' };
  while (step) {
    seen.push(`${step.model}:${step.effort}`);
    assert.ok(seen.length < 20, 'ladder must end');
    step = escalate(step);
  }
  assert.deepEqual(seen, [
    'sonnet:low',
    'sonnet:medium',
    'sonnet:high',
    'opus:medium',
    'opus:high',
    'fable:high',
    'fable:xhigh',
  ]);
  assert.throws(() => escalate({ model: 'gpt', effort: 'low' }));
});

test('route calls the Decisions API with Bison and uses its answer', async () => {
  const f = fakeFetch(decision({ category: 'review_verify', p: 0.95 }));
  const r = await route('Review this pull request', { apiKey: 'test-key', classifierModel: undefined, fetchImpl: f });
  assert.deepEqual(pick(r), ['opus', 'high']);
  assert.equal(r.source, 'classifier');
  assert.equal(r.classifierModel, 'baseten/bison-1');
  assert.equal(fakeFetch.last.url, 'https://openrouter.ai/api/alpha/decisions');
  const sent = JSON.parse(fakeFetch.last.init.body);
  assert.equal(sent.model, 'baseten/bison-1');
  assert.equal(sent.state.task, 'Review this pull request');
  assert.equal(fakeFetch.last.init.headers.Authorization, 'Bearer test-key');
});

test('a risky task is raised to Opus even when it looks simple', async () => {
  const f = fakeFetch(decision({ category: 'coding_routine', difficulty: 'easy', risk: 0.88 }));
  const r = await route('Delete old rows from the customers table', { apiKey: 'k', fetchImpl: f });
  assert.deepEqual(pick(r), ['opus', 'medium']);
  assert.equal(r.risk, 'high');
  assert.equal(r.riskProbability, 0.88);
});

test('route falls back and reports why when the classifier fails', async () => {
  const bad = await route('anything', { apiKey: 'k', fetchImpl: fakeFetch({ error: 'nope' }, 400) });
  assert.equal(bad.source, 'fallback');
  assert.match(bad.classifierError, /400/);

  const unsure = await route('anything', { apiKey: 'k', fetchImpl: fakeFetch(decision({ p: 0.2 })) });
  assert.equal(unsure.source, 'fallback');
  assert.deepEqual(pick(unsure), ['sonnet', 'high']);

  const noKey = await route('anything', { apiKey: '', fetchImpl: fakeFetch(decision()) });
  assert.equal(noKey.source, 'fallback');
  assert.match(noKey.classifierError, /OPENROUTER_API_KEY/);
});

test('a very long task is clipped for the classifier and flagged', async () => {
  const f = fakeFetch(decision({ category: 'chat_simple' }));
  const r = await route('x'.repeat(50000), { apiKey: 'k', fetchImpl: f });
  assert.equal(r.truncated, true);
  assert.ok(JSON.parse(fakeFetch.last.init.body).state.task.length < 13000);
});

// --- images and audio ---

const mediaDir = await mkdtemp(join(tmpdir(), 'router-test-'));
const file = async (name, bytes = 'fake-bytes') => {
  const path = join(mediaDir, name);
  await writeFile(path, bytes);
  return path;
};

test('loadMedia turns files into Decisions API parts', async () => {
  const parts = await loadMedia({ images: [await file('a.png', 'PNG!'), await file('b.JPG')], audio: [await file('c.mp3', 'MP3!')] });
  assert.equal(parts[0].type, 'image_url');
  assert.equal(parts[0].image_url.url, `data:image/png;base64,${Buffer.from('PNG!').toString('base64')}`);
  assert.match(parts[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.deepEqual(parts[2], { type: 'input_audio', input_audio: { data: Buffer.from('MP3!').toString('base64'), format: 'mp3' } });
});

test('loadMedia rejects unsupported types, missing files and too many images', async () => {
  await assert.rejects(loadMedia({ images: [await file('x.gif')] }), /\.png, \.jpg/);
  await assert.rejects(loadMedia({ audio: [await file('x.txt')] }), /audio must be/);
  await assert.rejects(loadMedia({ images: [join(mediaDir, 'missing.png')] }), /ENOENT/);
  const many = Array(MAX_IMAGES + 1).fill(await file('a.png'));
  await assert.rejects(loadMedia({ images: many }), /at most 16 images/);
});

test('with media, state is an array: the task text first, then the parts', () => {
  const part = { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } };
  const req = buildDecisionRequest('Fix the error in this screenshot', 'baseten/bison-1', [part]);
  assert.deepEqual(req.state, ['Task: Fix the error in this screenshot', part]);
  assert.match(req.questions.category.instructions, /attached media/);
});

test('route sends an image to Bison and reports the media count', async () => {
  const f = fakeFetch(decision({ category: 'coding_routine' }));
  const r = await route('Fix this', { apiKey: 'k', images: [await file('a.png')], fetchImpl: f });
  const sent = JSON.parse(fakeFetch.last.init.body);
  assert.equal(sent.model, 'baseten/bison-1');
  assert.equal(sent.state[1].type, 'image_url');
  assert.deepEqual(r.media, { images: 1, audio: 0 });
  assert.equal(r.source, 'classifier');
});

test('audio is not sent to Bison: it falls back unless an audio classifier is set', async () => {
  fakeFetch.last = null;
  const f = fakeFetch(decision());
  const none = await route('Transcribe and act on this', { apiKey: 'k', audio: [await file('c.mp3')], audioClassifierModel: null, fetchImpl: f });
  assert.equal(none.source, 'fallback');
  assert.match(none.classifierError, /does not accept audio/);
  assert.equal(fakeFetch.last, null, 'nothing was sent');

  const withModel = await route('Transcribe and act on this', {
    apiKey: 'k',
    audio: [await file('c.mp3')],
    audioClassifierModel: 'cloudflare/clef-omni',
    fetchImpl: f,
  });
  assert.equal(JSON.parse(fakeFetch.last.init.body).model, 'cloudflare/clef-omni');
  assert.equal(withModel.classifierModel, 'cloudflare/clef-omni');
  assert.equal(withModel.source, 'classifier');
});

test('names every object inherits are not mistaken for models or categories', () => {
  assert.throws(() => escalate({ model: 'toString', effort: 'low' }), /Unknown route/);
  assert.throws(() => escalate({ model: 'constructor', effort: 'high' }), /Unknown route/);
  assert.throws(() => decide(label(), { minModel: 'toString' }), /Unknown model/);
  assert.equal(decide(label({ category: 'toString' })).source, 'fallback');
  assert.throws(() => readDecision(decision({ category: 'constructor' })), /unknown category/);
});

test('policy: Opus coordinates, Sonnet does small jobs, Fable does deep work', () => {
  const coordinating = ['orchestration', 'review_verify'];
  const small = ['classify_extract', 'chat_simple', 'search_read', 'coding_routine'];
  const deep = ['coding_hard', 'knowledge_research', 'long_autonomous'];
  for (const category of Object.keys(ROUTES)) {
    for (const difficulty of DIFFICULTIES) {
      const { model, effort } = decide(label({ category, difficulty }));
      const where = `${category}/${difficulty}`;
      assert.ok(!['xhigh', 'max'].includes(effort), where);
      if (coordinating.includes(category)) assert.equal(model, 'opus', where);
      else if (category === 'deep_reasoning') assert.equal(model, 'fable', where);
      else if (small.includes(category)) assert.equal(model, 'sonnet', where);
      else if (deep.includes(category) && difficulty === 'hard') assert.deepEqual([model, effort], ['fable', 'high'], where);
      else assert.notEqual(model, 'opus', where);
    }
  }
});

// --- retry on rate limits and server errors ---

const sequenceFetch = (...replies) => {
  const f = async () => {
    f.calls += 1;
    const next = replies.shift();
    if (next instanceof Error) throw next;
    const [status, body, headers = {}] = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    };
  };
  f.calls = 0;
  return f;
};
const noWait = { sleep: async () => {} };

test('a rate limit or server error is retried once, then the answer is used', async () => {
  for (const first of [[429, { error: 'slow down' }], [503, { error: 'busy' }], new Error('socket hang up')]) {
    const f = sequenceFetch(first, [200, decision({ category: 'chat_simple' })]);
    const r = await classify('hi', { apiKey: 'k', fetchImpl: f, ...noWait });
    assert.equal(r.category, 'chat_simple');
    assert.equal(f.calls, 2);
  }
});

test('a second failure is final, and other errors are not retried', async () => {
  const twice = sequenceFetch([429, {}], [429, {}]);
  await assert.rejects(classify('hi', { apiKey: 'k', fetchImpl: twice, ...noWait }), /429/);
  assert.equal(twice.calls, 2);

  const bad = sequenceFetch([400, { error: 'bad request' }]);
  await assert.rejects(classify('hi', { apiKey: 'k', fetchImpl: bad, ...noWait }), /400/);
  assert.equal(bad.calls, 1);
});

test('a short Retry-After is honoured, a long one is not', async () => {
  const waits = [];
  const sleep = async (ms) => waits.push(ms);
  await classify('hi', { apiKey: 'k', fetchImpl: sequenceFetch([429, {}, { 'retry-after': '2' }], [200, decision()]), sleep });
  await classify('hi', { apiKey: 'k', fetchImpl: sequenceFetch([429, {}, { 'retry-after': '60' }], [200, decision()]), sleep, retryDelayMs: 800 });
  assert.deepEqual(waits, [2000, 800]);
});

test('route falls back after the retry also fails', async () => {
  const r = await route('anything', { apiKey: 'k', fetchImpl: sequenceFetch([429, {}], [429, {}]), retryDelayMs: 1 });
  assert.equal(r.source, 'fallback');
  assert.match(r.classifierError, /429/);
});

// --- backup classifier ---

const modelOf = (init) => JSON.parse(init.body).model;
const recordingFetch = (replyFor) => {
  const f = async (url, init) => {
    f.models.push(modelOf(init));
    const [status, body] = replyFor(modelOf(init), f.models.length);
    return { ok: status === 200, status, text: async () => JSON.stringify(body), headers: { get: () => null } };
  };
  f.models = [];
  return f;
};

test('when Bison fails, Jev is asked at once and its answer is used', async () => {
  const f = recordingFetch((model) => (model === 'baseten/bison-1' ? [429, { error: 'rate limit' }] : [200, decision({ category: 'chat_simple' })]));
  const r = await route('hi', { apiKey: 'k', classifierModel: 'baseten/bison-1', backupClassifierModel: 'typesafe/jev-1.14', fetchImpl: f });
  assert.deepEqual(f.models, ['baseten/bison-1', 'typesafe/jev-1.14'], 'no retry of Bison first');
  assert.equal(r.source, 'classifier');
  assert.equal(r.classifierModel, 'typesafe/jev-1.14');
  assert.equal(r.backupUsed, true);
  assert.match(r.primaryError, /429/);
  assert.equal(r.classifierError, undefined);
});

test('when both fail, the safe default names both errors', async () => {
  const f = recordingFetch(() => [503, { error: 'busy' }]);
  const r = await route('hi', { apiKey: 'k', classifierModel: 'baseten/bison-1', backupClassifierModel: 'typesafe/jev-1.14', fetchImpl: f });
  assert.equal(r.source, 'fallback');
  assert.match(r.classifierError, /503.*backup typesafe\/jev-1\.14.*503/);
  assert.equal(f.models.length, 2);
});

test('a backup key is used for the backup call only', async () => {
  const keys = [];
  const f = async (url, init) => {
    keys.push(init.headers.Authorization);
    const isBison = modelOf(init) === 'baseten/bison-1';
    return { ok: !isBison, status: isBison ? 429 : 200, text: async () => JSON.stringify(decision()), headers: { get: () => null } };
  };
  await route('hi', { apiKey: 'main', backupApiKey: 'backup', classifierModel: 'baseten/bison-1', backupClassifierModel: 'typesafe/jev-1.14', fetchImpl: f });
  assert.deepEqual(keys, ['Bearer main', 'Bearer backup']);
});

test('with the backup off, Bison is retried once as before', async () => {
  const f = recordingFetch((model, n) => (n === 1 ? [429, {}] : [200, decision()]));
  const r = await route('hi', { apiKey: 'k', classifierModel: 'baseten/bison-1', backupClassifierModel: 'off', fetchImpl: f, retryDelayMs: 1 });
  assert.deepEqual(f.models, ['baseten/bison-1', 'baseten/bison-1']);
  assert.equal(r.source, 'classifier');
  assert.equal(r.backupUsed, undefined);
});

test('a low-confidence answer is not an error: no backup call', async () => {
  const f = recordingFetch(() => [200, decision({ p: 0.2 })]);
  const r = await route('hi', { apiKey: 'k', classifierModel: 'baseten/bison-1', backupClassifierModel: 'typesafe/jev-1.14', fetchImpl: f });
  assert.equal(f.models.length, 1);
  assert.equal(r.source, 'fallback');
});
