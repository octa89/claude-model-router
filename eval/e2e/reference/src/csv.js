export function parseCsv(text) {
  const rows = [];
  if (text === '') return rows;
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;

  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
      i += 1;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (c === '\n' || (c === '\r' && text[i + 1] === '\n')) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' ? 2 : 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (quoted) throw new Error('Unclosed quote');
  // A line break at the very end does not start a new row.
  const endedWithBreak = text.endsWith('\n');
  if (!endedWithBreak) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
