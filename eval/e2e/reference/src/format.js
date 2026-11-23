/**
 * Formats a price in cents as dollars with two decimals: 1999 -> "$19.99".
 * Fractional cents are rounded to the nearest cent: 1999.6 -> "$20.00".
 * Negative prices put the minus sign before the dollar sign: -250 -> "-$2.50".
 */
export function formatPrice(cents) {
  const rounded = Math.round(Math.abs(cents));
  const sign = cents < 0 && rounded !== 0 ? '-' : '';
  return `${sign}$${(rounded / 100).toFixed(2)}`;
}
