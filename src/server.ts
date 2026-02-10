import "dotenv/config";
import express from "express";
import { uploadRouter } from "./routes/upload.js";
import { askRouter } from "./routes/ask.js";
import { exportExcelRouter } from "./routes/exportExcel.js";
import cors from "cors";

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"], // IMPORTANT for file downloads
  }),
);

app.get("/", (_req, res) => res.send("OK"));

app.use("/upload", uploadRouter);
app.use("/ask", askRouter);
app.use("/export/excel", exportExcelRouter);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
