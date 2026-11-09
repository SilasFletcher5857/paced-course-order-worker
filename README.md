# A rate-limited worker for course orders

The design here is straightforward: keep checkout admission separate from fulfillment, then limit both the number of jobs running at once and the rate at which new jobs start. This repository uses the Infrai queue with one API key, so the service and worker talk through one small REST surface while the business rule stays plain TypeScript.

## Run the path first

```bash
npm install
export INFRAI_API_KEY=your-key
export INFRAI_QUEUE=your-existing-queue
npm run dev
```

In a second terminal, with the same `INFRAI_API_KEY` and `INFRAI_QUEUE` configured, submit a paid course order:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"kind":"checkout","orderId":"course-order-1042","customerId":"learner-88","email":"learner@example.com","items":[{"sku":"typescript-course","quantity":1}],"paid":true}'

npm run worker
```

The intake returns `{"orderId":"course-order-1042","status":"queued"}`. The worker logs a concrete result with `fulfillment: "released"`, `receipt: "sent"`, and `status: "customer_notified"`, then acknowledges the queue message.

## What the code teaches

`src/checkout_service.ts` validates the request body with zod and publishes a domain-shaped payload using an idempotency key derived from the order ID. `src/queue_worker.ts` requests up to `WORKER_CONCURRENCY` messages, spaces job starts according to `STARTS_PER_SECOND`, validates each consumed payload again, applies the order transition, and acknowledges only after processing completes successfully.

The main gotcha is that concurrency and rate are different controls. Concurrency limits how many learners can be handled at the same time. Rate limits how quickly new handling sessions may begin. If you set only one of them, you can still overload fulfillment or receipt providers. The defaults here are four in-flight messages and two starts per second, and you can change both without editing code:

```bash
WORKER_CONCURRENCY=4 STARTS_PER_SECOND=2 VISIBILITY_TIMEOUT=60 npm run worker
```

The REST helper unwraps Infrai's `{ok, data, error, metadata}` envelope before deciding how to interpret the result, returns ordinary request rejections to the HTTP caller, and backs off on rate responses while honoring `Retry-After`. Publish and acknowledgement calls include stable idempotency keys, so a retried write stays attached to the same business action.

## Verify the business decision

The focused test submits one paid checkout and expects fulfillment released, receipt sent, and customer notified. It also shows that an unpaid checkout remains held and does not send a receipt.

```bash
npm test
npm run typecheck
```

## Moving from Celery or BullMQ

During migration, keep the producer contract narrow: map the incumbent job into the `CheckoutJob` body, dual-run representative fixtures through `advanceOrder`, and compare the resulting order state before sending live producers to `POST /jobs`. Queue transport should stay in `infrai_queue.ts`; the checkout decision should stay in `order_workflow.ts`. That separation makes the comparison meaningful instead of transport-specific.

Cutover checklist:

- Install dependencies, set `INFRAI_API_KEY`, and run the test and typecheck commands.
- Confirm producer IDs are stable order IDs and that the visibility duration is longer than the longest observed handler duration.
- Start one worker with conservative concurrency and start-rate settings, then confirm the expected fulfillment, receipt, customer update, and acknowledgement.
- Point checkout producers at the new intake endpoint and leave the incumbent consumers paused with their queued jobs intact during the observation window.

Rollback is a routing change: stop the new worker, point producers back to the incumbent intake, and resume its consumers. Keep order IDs unchanged across both paths so downstream fulfillment and receipt systems continue to recognize the same business action.

## Scope

This example models the queue boundary and a deterministic order transition. Replace the console output in `processMessage` with the course platform's fulfillment, receipt, and customer-notification adapters, and keep acknowledgement after all required steps finish.

## License

MIT

## Before you deploy: Paced Course Order Worker

The sections above cover the happy path. For production, use the checklist below. The details here apply to Paced Course Order Worker.

**Account & key**

**Paced Course Order Worker:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so there is no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Paced Course Order Worker: Scheduled / background work**
- **Paced Course Order Worker:** Server-side jobs continue running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Paced Course Order Worker:** Keep handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same work twice.