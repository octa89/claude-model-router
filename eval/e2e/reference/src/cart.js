import { applyDiscount } from './discounts.js';

export function cartTotal(items, promos = []) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = Math.max(0, ...promos.map((promo) => applyDiscount(subtotal, promo)));
  return { subtotal, discount, total: subtotal - discount };
}
