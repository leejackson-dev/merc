import { Router, type Request, type Response } from "express";
import { openai } from "../lib/openai.js";

export const askRouter = Router();

/**
 * GET /ask/:fileId
 * Example: GET /ask/file-abc123
 *
 * Uses PDF file input (vision-style PDF understanding) and returns JSON-only extraction.
 */
askRouter.get("/:fileId", async (req: Request, res: Response) => {
  const fileId = req.params.fileId;

  if (typeof fileId !== "string" || !fileId.startsWith("file-")) {
    return res.status(400).json({
      ok: false,
      error: `Invalid fileId. Expected a path param like /ask/file-...`,
    });
  }

  // Your “perfect” extraction prompt
  const EXTRACTION_PROMPT = `
You are given a single-page engineering drawing PDF. Extract structured data and return JSON ONLY.

Output schema (must match exactly):
{
  "tables": [
    { "tableName": "string", "columns": ["string"], "rows": [ { "col": "value" } ] }
  ],
  "keyFields": [
    { "field": "string", "value": "string" }
  ],
  "processSteps": [
    { "step": "number", "text": "string" }
  ],
  "notes": [
    { "note": "string" }
  ],
  "idIndex": [
    { "id": "string", "type": "part_number|email|phone|other", "foundIn": "table:<name>|keyFields|processSteps|notes|other" }
  ]
}

Rules:
- JSON only. No markdown. No commentary.
- Tables: extract ALL BOM-style tables you see. Keep each table separate. Preserve column order.
- For each table row: include keys EXACTLY matching the table's columns. Use "" if a cell is blank.
- keyFields: capture title-block style fields (e.g., Part Number, Description, Classification, Mass, Material, Drawn By, Email, Phone, Issue/Revision, Date) when present.
- processSteps: capture numbered process steps in order.
- notes: capture the NOTES section as an array (one note per item).
- idIndex: list all identifier-like strings (part numbers/codes, emails, phone numbers). Keep IDs as strings; do not dedupe unless identical.

TABLE NAMING
- Name tables sequentially in reading order as:
  "Table 1", "Table 2", "Table 3", etc.
- ONLY override this default name if there is a clear, explicit label
  printed immediately above the table (e.g. "Stage 1: Laminate", "BOND BOM").
- If a label is used, it MUST be the exact text printed above the table.
- If there is any ambiguity, missing label, or uncertainty, use the default
  sequential name ("Table N").
- Never infer or invent table names.
`.trim();

  try {
    // PDF file inputs are supported for models that accept text+image inputs. :contentReference[oaicite:1]{index=1}
    const response = await openai.responses.create({
      model: "gpt-4o", // PDF vision-capable model per docs :contentReference[oaicite:2]{index=2}
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", file_id: fileId },
            { type: "input_text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
      // optional: keep responses smaller/cheaper; adjust as needed
      max_output_tokens: 100000,
    });

    const rawText = response.output_text ?? "";

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return res.status(500).json({
        ok: false,
        error: "Model did not return valid JSON.",
        preview: rawText.slice(0, 1200),
      });
    }

    // Minimal normalization to keep it Excel-export-friendly
    const documentText = Array.isArray(parsed.documentText)
      ? parsed.documentText.map((x: any, i: number) => ({
          order: typeof x?.order === "number" ? x.order : i + 1,
          content: String(x?.content ?? ""),
        }))
      : [];

    const tables = Array.isArray(parsed.tables)
      ? parsed.tables.map((t: any) => {
          const columns = Array.isArray(t?.columns)
            ? t.columns.map(String)
            : [];
          const rows = Array.isArray(t?.rows)
            ? t.rows.map((r: any) => {
                const out: Record<string, string> = {};
                for (const c of columns) out[c] = String(r?.[c] ?? "");
                return out;
              })
            : [];
          return {
            tableName: String(t?.tableName ?? "Unnamed Table"),
            columns,
            rows,
          };
        })
      : [];

    const idAnalysis = {
      ids_found_in_multiple_tables: Array.isArray(
        parsed?.idAnalysis?.ids_found_in_multiple_tables,
      )
        ? parsed.idAnalysis.ids_found_in_multiple_tables
        : [],
      ids_found_in_single_location: Array.isArray(
        parsed?.idAnalysis?.ids_found_in_single_location,
      )
        ? parsed.idAnalysis.ids_found_in_single_location
        : [],
    };

    return res.json({
      ok: true,
      fileId,
      data: {
        documentText,
        tables,
        idAnalysis,
        meta: {
          sourceFileId: fileId,
          generatedAtISO: new Date().toISOString(),
        },
      },
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err?.message ?? "Ask failed",
    });
  }
});
