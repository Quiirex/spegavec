// preprost CSV: vejica, narekovaji po potrebi, BOM za Excel
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null): string => {
    if (value === null) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header, ...rows].map((row) => row.map(cell).join(","));
  return `\ufeff${lines.join("\n")}\n`;
}
