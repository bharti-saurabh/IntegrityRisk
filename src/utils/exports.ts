// Client-side export helpers. Every export produces a real file from live state
// (no hardcoded payloads) and triggers a browser download.

export function downloadBlob(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportJson(filename: string, data: unknown) {
  downloadBlob(filename, "application/json", JSON.stringify(data, null, 2));
}

export function exportMarkdown(filename: string, markdown: string) {
  downloadBlob(filename, "text/markdown", markdown);
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    downloadBlob(filename, "text/csv", "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")),
  ];
  downloadBlob(filename, "text/csv", lines.join("\n"));
}
