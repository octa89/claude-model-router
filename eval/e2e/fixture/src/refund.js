/** Refunds part or all of an order. amount is in cents. */
export function refund(order, amount) {
  if (amount <= 0) throw new Error('amount must be positive');
  if (order.status === 'cancelled') throw new Error('order is cancelled');
  const refunded = order.refunded ?? 0;
  order.refunded = refunded + amount;
  order.status = order.refunded >= order.total ? 'refunded' : 'partially_refunded';
  return order;
}
