export function freeSlots(busy, dayStart, dayEnd, minLength) {
  const clipped = busy
    .map(([s, e]) => [Math.max(s, dayStart), Math.min(e, dayEnd)])
    .filter(([s, e]) => s < e)
    .sort((a, b) => a[0] - b[0]);
  const free = [];
  let cursor = dayStart;
  for (const [s, e] of clipped) {
    if (s > cursor && s - cursor >= minLength) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (dayEnd > cursor && dayEnd - cursor >= minLength) free.push([cursor, dayEnd]);
  return free;
}
