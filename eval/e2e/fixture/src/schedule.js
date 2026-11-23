/**
 * busy: [start, end] pairs in minutes since midnight. They may be unsorted,
 * overlap, nest, touch, or reach outside the day.
 * Returns the free gaps inside [dayStart, dayEnd] that are at least
 * minLength minutes long, as sorted [start, end] pairs. Busy blocks that
 * touch (one ends when the next starts) leave no gap between them.
 */
export function freeSlots(busy, dayStart, dayEnd, minLength) {
  throw new Error('not implemented');
}
