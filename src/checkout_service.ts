import { createServer } from "node:http";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai_queue.js";
import { checkoutJobSchema } from "./order_workflow.js";

const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/jobs") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Route not found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const job = checkoutJobSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    await infrai.queue.publish(job, `checkout-${job.orderId}`);
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ orderId: job.orderId, status: "queued" }));
  } catch (error: unknown) {
    const status = error instanceof ZodError || error instanceof SyntaxError
      ? 400
      : error instanceof InfraiError && error.status >= 400 && error.status < 500
        ? error.status
        : 502;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      error: error instanceof InfraiError ? error.code : "INVALID_CHECKOUT_JOB",
    }));
  }
});

server.listen(port, () => {
  console.log(`Checkout intake listening at http://localhost:${port}/jobs`);
});
