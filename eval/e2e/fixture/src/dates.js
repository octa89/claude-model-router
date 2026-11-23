/**
 * Adds n business days to a date given as "YYYY-MM-DD" and returns the result
 * in the same format.
 *
 * Business days are Monday to Friday, except the dates listed in `holidays`
 * (strings "YYYY-MM-DD"). n may be positive, negative (count backwards) or 0.
 * Counting starts from the day after (or, for a negative n, before) the given
 * date, so starting on a weekend or holiday works: adding 1 to a Saturday
 * gives the Monday. With n = 0 the date is returned unchanged when it is a
 * business day, and otherwise the next business day after it.
 *
 * The result must not depend on the computer's time zone.
 */
export function addBusinessDays(date, n, holidays = []) {
  throw new Error('not implemented');
}
