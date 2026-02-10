import { openai } from "./openai.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForVectorStoreReady(
  vectorStoreId: string,
  timeoutMs = 120_000,
) {
  const start = Date.now();

  while (true) {
    const vs = await openai.vectorStores.retrieve(vectorStoreId);

    if (vs.status === "completed") return vs;

    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for vector store ${vectorStoreId} to be ready (last status: ${vs.status})`,
      );
    }

    await sleep(1500);
  }
}
