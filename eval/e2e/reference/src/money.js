export function allocate(totalCents, ratios) {
  if (totalCents < 0) return allocate(-totalCents, ratios).map((part) => (part === 0 ? 0 : -part));
  const sum = ratios.reduce((a, b) => a + b, 0);
  const shares = ratios.map((r) => (totalCents * r) / sum);
  // Rounding noise such as 29.999999999999996 is not a missing cent.
  const parts = shares.map((s) => Math.floor(s + 1e-9));
  let left = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => ({ i, frac: s - Math.floor(s + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}
