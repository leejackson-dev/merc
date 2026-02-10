import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { openai } from "../lib/openai.js";
import { toFile } from "openai";

export const uploadRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(), // <-- IMPORTANT: keep original filename/mimetype
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB example limit
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertString(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} missing/invalid: ${String(value)}`);
  }
  return value;
}

// Your working runtime signature:
async function retrieveBatch(batchId: string, vectorStoreId: string) {
  return openai.vectorStores.fileBatches.retrieve(batchId, {
    vector_store_id: vectorStoreId,
  } as any);
}

/**
 * POST /upload
 * multipart/form-data field name: file
 */
uploadRouter.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const f = req.file;

    if (!f) {
      return res.status(400).json({
        ok: false,
        error: "No file uploaded (field name must be 'file').",
      });
    }

    try {
      // Ensure filename ends with .pdf if it's a PDF upload
      const originalName = f.originalname || "upload.pdf";
      const safeName = path.basename(originalName);
      const mime = f.mimetype || "application/octet-stream";

      // 1) Create a proper File object with name + type
      const uploadable = await toFile(f.buffer, safeName, { type: mime });

      // 2) Upload file to OpenAI Files
      const uploadedFile = await openai.files.create({
        file: uploadable,
        purpose: "user_data",
      });

      const fileId = assertString("uploadedFile.id", uploadedFile.id);

      // 3) Create vector store
      const vectorStore = await openai.vectorStores.create({
        name: `upload:${safeName}`,
        expires_after: { anchor: "last_active_at", days: 7 },
      });

      const vectorStoreId = assertString("vectorStore.id", vectorStore.id);

      // 4) Create file batch (indexing job)
      const batch = await openai.vectorStores.fileBatches.create(
        vectorStoreId,
        {
          file_ids: [fileId],
        },
      );

      const batchId = assertString("batch.id", batch.id);

      console.log("DEBUG created:", {
        vectorStoreId,
        fileId,
        batchId,
        filename: safeName,
        mime,
      });

      // 5) Poll batch status
      while (true) {
        const b = await retrieveBatch(batchId, vectorStoreId);

        if (b.status === "completed") break;

        if (b.status === "failed") {
          return res.status(500).json({
            ok: false,
            error: "File batch failed during vector store processing",
            fileId,
            vectorStoreId,
            batchId,
            batchStatus: b,
          });
        }

        await sleep(1500);
      }

      // 6) Check vector store file entry for errors
      const filesInStore = await openai.vectorStores.files.list(vectorStoreId);
      const entry: any = filesInStore.data.find((x: any) => x.id === fileId);

      if (!entry) {
        return res.status(500).json({
          ok: false,
          error: "File not found in vector store after batch completed",
          fileId,
          vectorStoreId,
          batchId,
          files: filesInStore.data.map((x: any) => ({
            id: x.id,
            status: x.status,
          })),
        });
      }

      if (entry.status === "failed") {
        return res.status(500).json({
          ok: false,
          error: "Vector store indexing failed for this file",
          fileId,
          vectorStoreId,
          batchId,
          vectorStoreFile: {
            id: entry.id,
            status: entry.status,
            last_error: entry.last_error,
          },
        });
      }

      return res.json({
        ok: true,
        fileId,
        vectorStoreId,
        batchId,
        indexedFiles: filesInStore.data.map((x: any) => ({
          id: x.id,
          status: x.status,
        })),
        note: "File uploaded and indexed successfully",
      });
    } catch (err: any) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, error: err?.message ?? "Upload failed" });
    }
  },
);
