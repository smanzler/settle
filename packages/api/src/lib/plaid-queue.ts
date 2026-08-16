import { z } from "zod";
import { boss, QUEUE_RETRY } from "./boss";
import { syncItemTransactions } from "./plaid-sync";

/**
 * Lives outside `boss.ts` on purpose: the sync path reaches `notify()`, which
 * needs `boss`, so registering the worker there would close an import cycle.
 */
await boss.createQueue("plaid.sync", QUEUE_RETRY);

boss.work("plaid.sync", async ([job]) => {
  const { itemId } = z.object({ itemId: z.uuid() }).parse(job?.data);

  await syncItemTransactions(itemId);
});

/**
 * `singletonKey` collapses a burst of webhooks for one item into a single
 * queued run — overlapping syncs would race on the same Plaid cursor.
 */
export const enqueuePlaidSync = (itemId: string) =>
  boss.send("plaid.sync", { itemId }, { singletonKey: itemId });
