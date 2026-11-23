const DAY = 86400000;

const toTime = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const toDate = (time) => new Date(time).toISOString().slice(0, 10);

export function addBusinessDays(date, n, holidays = []) {
  const off = new Set(holidays);
  const isBusiness = (time) => {
    const day = new Date(time).getUTCDay();
    return day !== 0 && day !== 6 && !off.has(toDate(time));
  };
  let time = toTime(date);
  if (n === 0) {
    while (!isBusiness(time)) time += DAY;
    return toDate(time);
  }
  const step = n > 0 ? DAY : -DAY;
  let left = Math.abs(n);
  while (left > 0) {
    time += step;
    if (isBusiness(time)) left -= 1;
  }
  return toDate(time);
}
