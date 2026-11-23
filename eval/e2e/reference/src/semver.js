const parse = (v) => v.split('.').map(Number);
const cmp = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

// A partial version: [major, minor, patch] with null for a missing or x part.
const partial = (text) => {
  const parts = text.split('.').map((p) => (p === 'x' || p === 'X' || p === '*' ? null : Number(p)));
  while (parts.length < 3) parts.push(null);
  return parts;
};

// Each returns a list of [operator, version] comparators.
function expand(token) {
  if (token === '*' || token === '') return [];
  const m = /^(~|\^|>=|<=|>|<|=)?(.*)$/.exec(token);
  const op = m[1] ?? '';
  const [ma, mi, pa] = partial(m[2]);
  if (op === '~') {
    if (mi === null) return [['>=', [ma, 0, 0]], ['<', [ma + 1, 0, 0]]];
    return [['>=', [ma, mi, pa ?? 0]], ['<', [ma, mi + 1, 0]]];
  }
  if (op === '^') {
    if (mi === null) return [['>=', [ma, 0, 0]], ['<', [ma + 1, 0, 0]]];
    if (ma > 0) return [['>=', [ma, mi, pa ?? 0]], ['<', [ma + 1, 0, 0]]];
    if (mi > 0 || pa === null) return [['>=', [0, mi, pa ?? 0]], ['<', [0, mi + 1, 0]]];
    return [['>=', [0, 0, pa]], ['<', [0, 0, pa + 1]]];
  }
  if (op === '' || op === '=') {
    if (ma === null) return [];
    if (mi === null) return [['>=', [ma, 0, 0]], ['<', [ma + 1, 0, 0]]];
    if (pa === null) return [['>=', [ma, mi, 0]], ['<', [ma, mi + 1, 0]]];
    return [['=', [ma, mi, pa]]];
  }
  return [[op, [ma, mi ?? 0, pa ?? 0]]];
}

const test = (v, [op, w]) => {
  const c = cmp(v, w);
  return { '=': c === 0, '>': c > 0, '>=': c >= 0, '<': c < 0, '<=': c <= 0 }[op];
};

export function satisfies(version, range) {
  const v = parse(version);
  return range.split('||').some((alt) => {
    const text = alt.trim().replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1');
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
    const comparators = hyphen
      ? [['>=', parse(hyphen[1])], ['<=', parse(hyphen[2])]]
      : text.split(/\s+/).flatMap(expand);
    return comparators.every((c) => test(v, c));
  });
}
