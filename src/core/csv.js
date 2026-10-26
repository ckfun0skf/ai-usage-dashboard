/** Generic CSV parsing utilities shared by all future source adapters. */
export function parseCsv(text) {
  const input = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(value => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (cell.length || row.length) { row.push(cell); if (row.some(value => value.trim() !== "")) rows.push(row); }
  if (rows.length < 2) throw new Error("The CSV needs a header and at least one data row.");
  const headers = rows.shift().map(value => value.trim());
  if (headers.some(value => !value)) throw new Error("CSV contains an empty column name.");
  return rows.map((values, index) => {
    if (values.length > headers.length) throw new Error(`CSV row ${index + 2} has more fields than the header.`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
  });
}

export function parseNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}