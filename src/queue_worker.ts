import { infrai, type QueueMessage } from "./infrai_queue.js";
import { advanceOrder, checkoutJobSchema } from "./order_workflow.js";

const concurrency = positiveInteger(process.env.WORKER_CONCURRENCY, 4);
const startsPerSecond = positiveInteger(process.env.STARTS_PER_SECOND, 2);
const visibilityTimeout = positiveInteger(process.env.VISIBILITY_TIMEOUT, 60);

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error("Worker limits must be positive integers");
  return value;
}

async function processMessage(message: QueueMessage): Promise<void> {
  const job = checkoutJobSchema.parse(message.payload);
  const outcome = advanceOrder(job);
  console.log(JSON.stringify(outcome));
  await infrai.queue.ack(message.message_id);
}

export async function runBatch(): Promise<number> {
  const data = await infrai.queue.consume(concurrency, visibilityTimeout);
  const messages = data.messages ?? [];
  const intervalMs = 1_000 / startsPerSecond;

  for (let offset = 0; offset < messages.length; offset += concurrency) {
    const group = messages.slice(offset, offset + concurrency);
    await Promise.all(group.map(async (message, index) => {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs * index));
      }
      await processMessage(message);
    }));
  }
  return messages.length;
}

async function main(): Promise<void> {
  const count = await runBatch();
  console.log(`Processed ${count} commerce jobs`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
