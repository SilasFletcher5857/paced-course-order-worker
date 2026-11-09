import assert from "node:assert/strict";
import test from "node:test";
import { advanceOrder, checkoutJobSchema } from "../src/order_workflow.js";

test("a paid checkout releases fulfillment and sends the receipt before the update", () => {
  const job = checkoutJobSchema.parse({
    kind: "checkout",
    orderId: "course-order-1042",
    customerId: "learner-88",
    email: "learner@example.com",
    items: [{ sku: "typescript-course", quantity: 1 }],
    paid: true,
  });

  assert.deepEqual(advanceOrder(job), {
    orderId: "course-order-1042",
    status: "customer_notified",
    fulfillment: "released",
    receipt: "sent",
    customerUpdate: "Order course-order-1042 is confirmed for learner@example.com",
  });
});

test("an unpaid checkout holds fulfillment and does not issue a receipt", () => {
  const job = checkoutJobSchema.parse({
    kind: "checkout",
    orderId: "course-order-1043",
    customerId: "learner-91",
    email: "second@example.com",
    items: [{ sku: "algebra-course", quantity: 1 }],
    paid: false,
  });

  assert.equal(advanceOrder(job).status, "awaiting_payment");
  assert.equal(advanceOrder(job).fulfillment, "held");
  assert.equal(advanceOrder(job).receipt, "not_issued");
});
