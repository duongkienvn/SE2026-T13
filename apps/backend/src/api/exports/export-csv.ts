/** RFC 4180. Prefix before quoting, including Unicode whitespace/format bypasses. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  const significant = text
    .replace(/^[\p{White_Space}\p{Cc}\p{Cf}\p{M}]*/u, '')
    .normalize('NFKC');
  if (/^[=+@-]/u.test(significant)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export const csvRow = (values: readonly unknown[]): string =>
  values.map(csvCell).join(',') + '\r\n';
