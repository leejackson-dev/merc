import { Router, type Request, type Response } from "express";
import ExcelJS from "exceljs";

export const exportExcelRouter = Router();

type ExcelReadyRow = Record<string, unknown>;

type AskJson = {
  ok?: boolean;
  data?: {
    tables?: Array<{
      tableName: string;
      columns: string[];
      rows: ExcelReadyRow[];
    }>;
    // other fields ignored by this export endpoint:
    documentText?: any[];
    idAnalysis?: any;
    meta?: any;
  };
};

function safeSheetName(name: string, fallback: string) {
  // Excel sheet rules:
  // - max 31 chars
  // - cannot contain: : \ / ? * [ ]
  const cleaned = String(name || fallback)
    .replace(/[:\\/?*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);

  return cleaned.length ? cleaned : fallback;
}

function uniqueSheetName(base: string, used: Set<string>) {
  let name = base;
  let i = 2;

  while (used.has(name)) {
    const suffix = ` ${i++}`;
    name = (base.slice(0, 31 - suffix.length) + suffix).trim();
  }

  used.add(name);
  return name;
}

function normalizeRows(columns: string[], rows: ExcelReadyRow[]) {
  return (rows || []).map((r) => {
    const out: Record<string, string> = {};
    for (const c of columns) {
      const v = (r as any)?.[c];
      out[c] = v === null || v === undefined ? "" : String(v);
    }
    return out;
  });
}

function setColumnWidths(
  ws: ExcelJS.Worksheet,
  columns: string[],
  rows: Record<string, string>[],
  maxWidth = 70,
) {
  // Size based on headers + first N rows
  const sampleN = Math.min(rows.length, 50);
  const widths = columns.map((c) => Math.max(10, c.length + 2));

  for (let i = 0; i < sampleN; i++) {
    const row = rows[i] || {};
    columns.forEach((c, idx) => {
      const s = row[c] ?? "";
      // @ts-ignore
      widths[idx] = Math.min(maxWidth, Math.max(widths[idx], s.length + 2));
    });
  }

  // @ts-ignore
  ws.columns = columns.map((c, idx) => ({
    header: c,
    key: c,
    width: widths[idx],
  }));
}

function applySheetStyling(
  ws: ExcelJS.Worksheet,
  columnsCount: number,
  rowsCount: number,
) {
  // Freeze header row
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // Bold header
  const header = ws.getRow(1);
  header.font = { bold: true };

  // Autofilter header row
  if (columnsCount > 0 && rowsCount >= 1) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnsCount },
    };
  }

  // Wrap text for readability
  // Apply to all cells that exist (header + data)
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { wrapText: true, vertical: "top" };
    });
  });

  // Reasonable row height for wrapped text
  // (not perfect, but helps)
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) row.height = 18;
    else row.height = 30;
  });
}

/**
 * POST /export/excel
 * Body: either the full /ask response ({ ok, data }) or just the data object ({ tables, ... }).
 * Returns: an .xlsx file with one sheet per table.
 */
exportExcelRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as AskJson | any;

    // Accept:
    // 1) { ok: true, data: {...} }
    // 2) { data: {...} }
    // 3) { tables: [...] } (inner data object)
    const data = body?.data ?? body;

    const tables = Array.isArray(data?.tables) ? data.tables : [];

    if (!tables.length) {
      return res.status(400).json({
        ok: false,
        error:
          "No tables found. Expected JSON with data.tables[] (paste the full /ask response or the inner data object).",
      });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "merc-f1";
    wb.created = new Date();

    const used = new Set<string>();

    tables.forEach((t: any, idx: number) => {
      const tableName =
        typeof t?.tableName === "string" ? t.tableName : `Table ${idx + 1}`;
      const baseName = safeSheetName(tableName, `Table ${idx + 1}`);
      const sheetName = uniqueSheetName(baseName, used);

      const columns = Array.isArray(t?.columns) ? t.columns.map(String) : [];
      const rows = Array.isArray(t?.rows) ? t.rows : [];

      // If columns missing, derive them from the union of row keys
      const finalColumns =
        columns.length > 0
          ? columns
          : Array.from(new Set(rows.flatMap((r: any) => Object.keys(r ?? {}))));

      const ws = wb.addWorksheet(sheetName);

      // If still empty, create a placeholder
      if (!finalColumns.length) {
        ws.columns = [{ header: "message", key: "message", width: 50 }];
        ws.addRow({ message: "Table had no columns/rows." });
        applySheetStyling(ws, 1, 1);
        return;
      }

      const normalized = normalizeRows(finalColumns, rows);

      setColumnWidths(ws, finalColumns, normalized);

      // Add rows
      normalized.forEach((r) => ws.addRow(r));

      // Force "text" style-ish behavior: store everything as string already.
      // Also helps Excel not auto-convert IDs/scientific notation.
      ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell({ includeEmpty: true }, (cell) => {
          if (cell.value === null || cell.value === undefined) cell.value = "";
          cell.numFmt = "@"; // text format
        });
      });

      applySheetStyling(ws, finalColumns.length, normalized.length + 1);
    });

    const buffer = await wb.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="extracted.xlsx"`,
    );

    return res.send(Buffer.from(buffer));
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err?.message ?? "Excel export failed",
    });
  }
});
