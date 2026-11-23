/**
 * Evaluates an arithmetic expression and returns a number.
 *
 * - Numbers: digits with an optional decimal part ("3", "2.5"). ".5" is not a number.
 * - Operators: + - * / and ^ (power).
 *   Precedence, highest first: ^, then unary minus, then * and /, then + and -.
 *   ^ is right-associative (2^3^2 is 512); the others are left-associative.
 *   Unary minus binds looser than ^ on its left: -2^2 is -4. The right side of
 *   ^ may itself start with a minus: 2^-1 is 0.5.
 * - Parentheses, and the functions min(a, b, ...) and max(a, b, ...) with one
 *   or more arguments, and abs(x) with exactly one.
 * - Variable names start with a letter or underscore, then letters, digits or
 *   underscores; their values come from `vars`.
 * - Spaces may appear anywhere between tokens.
 *
 * Throws an Error whose message starts with:
 *   "Unknown variable: <name>", "Unknown function: <name>",
 *   "Division by zero", or "Syntax error" for anything else that is malformed.
 */
export function evaluate(expr, vars = {}) {
  throw new Error('not implemented');
}
