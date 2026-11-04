// Excel + PDF export helpers.
// Libraries are loaded on demand, so they only download when someone clicks Export.
// Install once:  npm install xlsx jspdf jspdf-autotable

const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

const stamp = () => new Date().toISOString().slice(0, 10);

const fileName = (title, ext) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${stamp()}.${ext}`;

// PDF fonts cannot draw the rupee sign, so PDF uses "Rs."
function pdfText(value, kind) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "number") return String(value);
  if (kind === "money") return `Rs. ${inr.format(value)}`;
  if (kind === "qty") return qtyFmt.format(value);
  return String(value);
}

/**
 * spec = {
 *   title, filterText,
 *   headers: string[],
 *   kinds:   ("money" | "qty" | "int" | null)[]   // one per column
 *   rows:    any[][],
 *   totalsRow?: any[],
 *   summary?: [label, number, kind][]
 * }
 */
export async function exportExcel(spec) {
  const XLSX = await import("xlsx");
  const { title, filterText, headers, kinds, rows, totalsRow, summary } = spec;

  const clean = (r) => r.map((v) => (v === null || v === undefined ? "" : v));

  const aoa = [
    [title],
    [`Generated: ${stamp()}`],
    [`Filters: ${filterText || "none"}`],
    [],
    headers,
    ...rows.map(clean),
  ];

  const headerRow = 4;
  const firstData = 5;

  if (totalsRow) aoa.push(clean(totalsRow));

  if (summary?.length) {
    aoa.push([]);
    summary.forEach(([label, value]) => aoa.push([label, value]));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // number formats on data + totals rows
  const lastNumRow = firstData + rows.length + (totalsRow ? 1 : 0) - 1;
  for (let r = firstData; r <= lastNumRow; r++) {
    kinds.forEach((kind, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || typeof cell.v !== "number") return;
      if (kind === "money") cell.z = "#,##0.00";
      else if (kind === "qty") cell.z = "#,##0.###";
    });
  }

  if (summary?.length) {
    const start = lastNumRow + 2;
    summary.forEach(([, , kind], i) => {
      const cell = ws[XLSX.utils.encode_cell({ r: start + i, c: 1 })];
      if (cell && kind === "money") cell.z = "#,##0.00";
    });
  }

  // column widths
  ws["!cols"] = headers.map((h, c) => {
    const longest = Math.max(
      String(h).length,
      ...rows.map((r) => String(r[c] ?? "").length),
      totalsRow ? String(totalsRow[c] ?? "").length : 0
    );
    return { wch: Math.min(Math.max(longest + 2, 10), 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  XLSX.writeFile(wb, fileName(title, "xlsx"));
}

export async function exportPdf(spec) {
  const { jsPDF } = await import("jspdf");
  const autoTableModule = await import("jspdf-autotable");
  const autoTable = autoTableModule.default || autoTableModule.autoTable;

  const { title, filterText, headers, kinds, rows, totalsRow, summary } = spec;

  const doc = new jsPDF({
    orientation: headers.length > 6 ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(23, 32, 51);
  doc.text(title, 40, 42);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 130, 150);
  doc.text(`Generated ${stamp()}   |   Filters: ${filterText || "none"}`, 40, 58, {
    maxWidth: pageW - 80,
  });

  const format = (r) => r.map((v, c) => pdfText(v, kinds[c]));

  const columnStyles = {};
  kinds.forEach((kind, c) => {
    if (kind) columnStyles[c] = { halign: "right" };
  });

  autoTable(doc, {
    startY: 72,
    head: [headers],
    body: rows.map(format),
    foot: totalsRow ? [format(totalsRow)] : undefined,
    showFoot: "lastPage",
    margin: { left: 40, right: 40, bottom: 40 },
    styles: { fontSize: 8, cellPadding: 4, textColor: [60, 72, 95] },
    headStyles: { fillColor: [66, 104, 232], textColor: 255 },
    footStyles: { fillColor: [240, 243, 249], textColor: [23, 32, 51], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 251, 254] },
    columnStyles,
  });

  if (summary?.length) {
    let y = (doc.lastAutoTable?.finalY || 72) + 24;
    if (y > pageH - 90) {
      doc.addPage();
      y = 50;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(23, 32, 51);
    doc.text("Summary", 40, y);
    y += 16;

    summary.forEach(([label, value, kind]) => {
      doc.setFont("helvetica", "normal");
      doc.text(label, 40, y);
      doc.setFont("helvetica", "bold");
      doc.text(pdfText(value, kind), 220, y, { align: "right" });
      y += 15;
    });
  }

  // page numbers
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 150, 165);
    doc.text(`Page ${i} of ${pages}`, pageW - 40, pageH - 20, { align: "right" });
  }

  doc.save(fileName(title, "pdf"));
}
