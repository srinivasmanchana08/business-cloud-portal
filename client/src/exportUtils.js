// Excel + PDF export helpers.
// Libraries are loaded on demand, so they only download when someone clicks Export.
// Install once:  npm install xlsx jspdf jspdf-autotable

const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

// ---- date / time in the user's own time zone (not UTC)
const pad = (n) => String(n).padStart(2, "0");

function parts() {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { date, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

const stamp = () => {
  const { date, time } = parts();
  return `${date} ${time}`;
};

const safe = (text) =>
  String(text || "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Company-Page_2026-11-11_14-35.pdf  (company = the company chosen in the filter)
function fileName(spec, ext) {
  const { date, time } = parts();
  const company = safe(spec.company) || "All-Companies";
  return `${company}_${safe(spec.title)}_${date}_${time.replace(":", "-")}.${ext}`;
}

// PDF fonts cannot draw the rupee sign, so PDF uses "Rs."
function pdfText(value, kind) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "number") return String(value);
  if (kind === "money") {
    return value < 0
      ? `-Rs. ${inr.format(-value)}`
      : `Rs. ${inr.format(value)}`;
  }
  if (kind === "qty") return qtyFmt.format(value);
  return String(value);
}

/**
 * spec = {
 *   title, company?, filterText,
 *   headers: string[],
 *   kinds:   ("money" | "qty" | "int" | null)[]   // one per column
 *   rows:    any[][],
 *   totalsRow?: any[],
 *   summary?: [label, number, kind][]   // printed as a row of columns under the table
 * }
 */
export async function exportExcel(spec) {
  const XLSX = await import("xlsx");
  const { title, filterText, headers, kinds, rows, totalsRow, summary } = spec;

  const clean = (r) => r.map((v) => (v === null || v === undefined ? "" : v));

  const aoa = [
    [title],
    [`Generated: ${stamp()}`],
    [`Company: ${spec.company || "All companies"}`],
    [`Filters: ${filterText || "none"}`],
    [],
    headers,
    ...rows.map(clean),
  ];

  const firstData = 6; // 0-based row index of the first data row

  if (totalsRow) aoa.push(clean(totalsRow));

  const lastNumRow = firstData + rows.length + (totalsRow ? 1 : 0) - 1;

  // summary: one row of labels with one row of values under it (column wise)
  if (summary?.length) {
    aoa.push([]);
    aoa.push(summary.map(([label]) => label));
    aoa.push(summary.map(([, value]) => value));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // number formats on data + totals rows
  for (let r = firstData; r <= lastNumRow; r++) {
    kinds.forEach((kind, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || typeof cell.v !== "number") return;
      if (kind === "money") cell.z = "#,##0.00";
      else if (kind === "qty") cell.z = "#,##0.###";
    });
  }

  if (summary?.length) {
    const valueRow = lastNumRow + 3;
    summary.forEach(([, , kind], c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: valueRow, c })];
      if (!cell || typeof cell.v !== "number") return;
      if (kind === "money") cell.z = "#,##0.00";
      else if (kind === "qty") cell.z = "#,##0.###";
    });
  }

  // column widths (table columns, widened where a summary label needs room)
  const colCount = Math.max(headers.length, summary?.length || 0);
  ws["!cols"] = Array.from({ length: colCount }, (_, c) => {
    const tableLen =
      c < headers.length
        ? Math.max(
            String(headers[c]).length,
            ...rows.map((r) => String(r[c] ?? "").length),
            totalsRow ? String(totalsRow[c] ?? "").length : 0,
          )
        : 0;
    const summaryLen = summary?.[c] ? String(summary[c][0]).length : 0;
    return { wch: Math.min(Math.max(tableLen + 2, summaryLen + 2, 10), 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  XLSX.writeFile(wb, fileName(spec, "xlsx"));
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
  const usableW = pageW - 80;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(23, 32, 51);
  doc.text(title, 40, 42);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 130, 150);
  doc.text(
    `Generated ${stamp()}   |   Company: ${spec.company || "All companies"}   |   Filters: ${filterText || "none"}`,
    40,
    58,
    { maxWidth: usableW },
  );

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
    footStyles: {
      fillColor: [240, 243, 249],
      textColor: [23, 32, 51],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [250, 251, 254] },
    columnStyles,
  });

  // ---- summary: labels across the top, values underneath (column wise)
  if (summary?.length) {
    let y = (doc.lastAutoTable?.finalY || 72) + 22;
    if (y > pageH - 110) {
      doc.addPage();
      y = 50;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(23, 32, 51);
    doc.text("Summary", 40, y);
    y += 8;

    // as many columns per row as fit; split evenly if it needs more than one row
    const perBand = Math.max(3, Math.floor(usableW / 76));
    const bands = Math.ceil(summary.length / perBand);
    const per = Math.ceil(summary.length / bands);

    for (let b = 0; b < bands; b++) {
      const chunk = summary.slice(b * per, (b + 1) * per);
      const colStyles = {};
      chunk.forEach((_, c) => {
        colStyles[c] = { halign: "right" };
      });

      autoTable(doc, {
        startY: y,
        head: [chunk.map(([label]) => label)],
        body: [chunk.map(([, value, kind]) => pdfText(value, kind))],
        theme: "grid",
        tableWidth: Math.min(usableW, per * 120),
        margin: { left: 40, right: 40, bottom: 40 },
        styles: {
          fontSize: 8,
          cellPadding: 4,
          textColor: [23, 32, 51],
          lineColor: [220, 226, 238],
          lineWidth: 0.5,
        },
        headStyles: {
          fillColor: [240, 243, 249],
          textColor: [90, 102, 125],
          fontStyle: "bold",
          halign: "right",
        },
        bodyStyles: { fontStyle: "bold", fontSize: 9 },
        columnStyles: colStyles,
      });

      y = doc.lastAutoTable.finalY + 10;
    }
  }

  // page numbers
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 150, 165);
    doc.text(`Page ${i} of ${pages}`, pageW - 40, pageH - 20, {
      align: "right",
    });
  }

  doc.save(fileName(spec, "pdf"));
}
