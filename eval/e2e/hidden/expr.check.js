import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/expr.js';

test('precedence and associativity', () => {
  assert.equal(evaluate('1 + 2 * 3'), 7);
  assert.equal(evaluate('(1+2)*3'), 9);
  assert.equal(evaluate('1-2-3'), -4);
  assert.equal(evaluate('8/2/2'), 2);
  assert.equal(evaluate('10/4'), 2.5);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('2^3*2'), 16);
});

test('unary minus binds looser than ^', () => {
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('2^-1'), 0.5);
  assert.equal(evaluate('2*-3'), -6);
  assert.equal(evaluate('--2'), 2);
  assert.equal(evaluate('-(2+3)^2'), -25);
});

test('functions and variables', () => {
  assert.equal(evaluate('min(3, 1, 2)'), 1);
  assert.equal(evaluate('max(2)'), 2);
  assert.equal(evaluate('abs(-5) + x', { x: 2 }), 7);
  assert.equal(evaluate('max(1, min(4, y))', { y: 3 }), 3);
  assert.equal(evaluate('  _a1 *2 ', { _a1: 4 }), 8);
  assert.equal(evaluate('2.5 * 2'), 5);
});

test('errors say what went wrong', () => {
  const fails = (text, start, vars) => assert.throws(() => evaluate(text, vars), (err) => err.message.startsWith(start), text);
  fails('1/0', 'Division by zero');
  fails('1/(2-2)', 'Division by zero');
  fails('y+1', 'Unknown variable: y');
  fails('foo(1)', 'Unknown function: foo');
  fails('1 +', 'Syntax error');
  fails('(1+2', 'Syntax error');
  fails('1 2', 'Syntax error');
  fails('.5', 'Syntax error');
  fails('min()', 'Syntax error');
  fails('', 'Syntax error');
  fails('2^', 'Syntax error');
  fails('3 $ 4', 'Syntax error');
});
