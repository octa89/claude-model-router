/**
 * A promotion is { code, percent, minSubtotal }: percent off the subtotal,
 * only when the subtotal is at least minSubtotal (cents).
 * Returns the discount in cents, rounded to the nearest cent.
 */
export function applyDiscount(subtotal, promo) {
  if (subtotal < promo.minSubtotal) return 0;
  return Math.round((subtotal * promo.percent) / 100);
}
