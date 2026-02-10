import "dotenv/config";
import express from "express";
import { uploadRouter } from "./routes/upload.js";
import { askRouter } from "./routes/ask.js";
import { exportExcelRouter } from "./routes/exportExcel.js";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => res.send("OK"));

app.use("/upload", uploadRouter);
app.use("/ask", askRouter);
app.use("/export/excel", exportExcelRouter);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
