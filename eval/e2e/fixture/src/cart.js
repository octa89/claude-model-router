import { applyDiscount } from './discounts.js';

/**
 * items: [{ price (cents), qty }]. promos: the promotions the customer entered.
 * Promotions never stack: only the single best one applies.
 * Returns { subtotal, discount, total } in cents.
 */
export function cartTotal(items, promos = []) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  let discount = 0;
  for (const promo of promos) {
    discount += applyDiscount(subtotal, promo);
  }
  return { subtotal, discount, total: subtotal - discount };
}
