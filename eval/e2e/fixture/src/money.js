/**
 * Splits totalCents (an integer) into parts proportional to `ratios`
 * (non-negative numbers, at least one above 0). The parts are integers that
 * add up exactly to totalCents.
 *
 * Each part first gets the whole-cent part (floor) of its exact share. The
 * cents left over then go one each to the parts with the largest fractional
 * remainders; ties go to the earlier part.
 *
 * A negative total is split like its absolute value, and every part negated.
 * allocate(100, [1, 1, 1]) -> [34, 33, 33]
 */
export function allocate(totalCents, ratios) {
  throw new Error('not implemented');
}
