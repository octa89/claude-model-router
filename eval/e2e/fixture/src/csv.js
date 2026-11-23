/**
 * Parses CSV text (RFC 4180) into an array of rows, each an array of strings.
 *
 * - Fields are separated by commas, rows by "\n" or "\r\n".
 * - A field may be wrapped in double quotes. Inside quotes, commas and line
 *   breaks belong to the field, and "" stands for one double quote.
 * - Empty fields are empty strings.
 * - A line break at the very end does not start a new row; empty input gives [].
 * - Throws an Error with the message "Unclosed quote" when a quoted field
 *   never ends.
 */
export function parseCsv(text) {
  throw new Error('not implemented');
}
