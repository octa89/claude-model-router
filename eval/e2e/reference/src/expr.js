// Grammar:
//   expr  := term (('+' | '-') term)*
//   term  := unary (('*' | '/') unary)*
//   unary := '-' unary | power
//   power := primary ('^' unary)?
//   primary := number | name | name '(' args ')' | '(' expr ')'
const FUNCTIONS = {
  min: { min: 1, run: (args) => Math.min(...args) },
  max: { min: 1, run: (args) => Math.max(...args) },
  abs: { min: 1, max: 1, run: ([x]) => Math.abs(x) },
};

function tokenize(text) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^(),]))/y;
  let at = 0;
  while (at < text.length) {
    if (/^\s*$/.test(text.slice(at))) break;
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) throw new Error('Syntax error');
    at = re.lastIndex;
    if (m[1] !== undefined) {
      // A number directly followed by "." or a digit run like "1.": not allowed.
      if (text[at] === '.') throw new Error('Syntax error');
      tokens.push({ type: 'num', value: Number(m[1]) });
    } else if (m[2] !== undefined) tokens.push({ type: 'name', value: m[2] });
    else tokens.push({ type: 'op', value: m[3] });
  }
  return tokens;
}

export function evaluate(expr, vars = {}) {
  const tokens = tokenize(expr);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => peek()?.type === 'op' && peek().value === v;
  const expect = (v) => {
    if (!isOp(v)) throw new Error('Syntax error');
    i += 1;
  };

  const parseExpr = () => {
    let value = parseTerm();
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++].value;
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = () => {
    let value = parseUnary();
    while (isOp('*') || isOp('/')) {
      const op = tokens[i++].value;
      const right = parseUnary();
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        value /= right;
      } else value *= right;
    }
    return value;
  };
  const parseUnary = () => {
    if (isOp('-')) {
      i += 1;
      return -parseUnary();
    }
    return parsePower();
  };
  const parsePower = () => {
    const base = parsePrimary();
    if (isOp('^')) {
      i += 1;
      return base ** parseUnary();
    }
    return base;
  };
  const parsePrimary = () => {
    const t = peek();
    if (!t) throw new Error('Syntax error');
    if (t.type === 'num') {
      i += 1;
      return t.value;
    }
    if (t.type === 'name') {
      i += 1;
      if (isOp('(')) {
        i += 1;
        const fn = Object.hasOwn(FUNCTIONS, t.value) ? FUNCTIONS[t.value] : null;
        if (!fn) throw new Error(`Unknown function: ${t.value}`);
        const args = [];
        if (!isOp(')')) {
          args.push(parseExpr());
          while (isOp(',')) {
            i += 1;
            args.push(parseExpr());
          }
        }
        expect(')');
        if (args.length < fn.min || (fn.max !== undefined && args.length > fn.max)) throw new Error('Syntax error');
        return fn.run(args);
      }
      if (!Object.hasOwn(vars, t.value)) throw new Error(`Unknown variable: ${t.value}`);
      return vars[t.value];
    }
    if (isOp('(')) {
      i += 1;
      const value = parseExpr();
      expect(')');
      return value;
    }
    throw new Error('Syntax error');
  };

  const value = parseExpr();
  if (i !== tokens.length) throw new Error('Syntax error');
  return value;
}
