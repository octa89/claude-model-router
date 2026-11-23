/**
 * Says whether a version "MAJOR.MINOR.PATCH" satisfies a range, npm style.
 * Versions and ranges here never have pre-release or build tags.
 *
 * Range syntax:
 * - Comparators: "1.2.3" or "=1.2.3", ">1.2.3", ">=1.2.3", "<1.2.3", "<=1.2.3".
 *   Spaces may follow the operator (">= 1.2.3"). Several comparators
 *   separated by spaces must all hold.
 * - "||" separates alternatives; the version must satisfy at least one.
 * - Hyphen ranges between full versions: "1.2.3 - 2.3.4" means
 *   ">=1.2.3 <=2.3.4".
 * - X-ranges: "*", "1.x", "1.2.x", "1", "1.2": a missing or x part matches
 *   anything.
 * - Tilde: "~1.2.3" means ">=1.2.3 <1.3.0"; "~1.2" means ">=1.2.0 <1.3.0";
 *   "~1" means ">=1.0.0 <2.0.0".
 * - Caret: "^1.2.3" means ">=1.2.3 <2.0.0"; "^0.2.3" means ">=0.2.3 <0.3.0";
 *   "^0.0.3" means ">=0.0.3 <0.0.4". "^1.2" and "^1" work like "^1.2.0" and
 *   "^1.0.0"; "^0.2" means ">=0.2.0 <0.3.0".
 * - Version parts compare as numbers, not text.
 */
export function satisfies(version, range) {
  throw new Error('not implemented');
}
