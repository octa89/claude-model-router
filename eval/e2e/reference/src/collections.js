export function groupBy(items, keyFn) {
  const groups = {};
  for (const item of items) {
    const key = String(keyFn(item));
    (groups[key] ??= []).push(item);
  }
  return groups;
}
