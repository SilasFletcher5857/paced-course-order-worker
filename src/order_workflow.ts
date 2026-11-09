import { z } from "zod";

export const checkoutJobSchema = z.object({
  kind: z.literal("checkout"),
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  email: z.string().email(),
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.number().int().positive(),
  })).min(1),
  paid: z.boolean(),
});

export type CheckoutJob = z.infer<typeof checkoutJobSchema>;

export type OrderOutcome = {
  orderId: string;
  status: "awaiting_payment" | "customer_notified";
  fulfillment: "held" | "released";
  receipt: "not_issued" | "sent";
  customerUpdate: string;
};

export function advanceOrder(job: CheckoutJob): OrderOutcome {
  if (!job.paid) {
    return {
      orderId: job.orderId,
      status: "awaiting_payment",
      fulfillment: "held",
      receipt: "not_issued",
      customerUpdate: `Order ${job.orderId} is awaiting payment`,
    };
  }

  return {
    orderId: job.orderId,
    status: "customer_notified",
    fulfillment: "released",
    receipt: "sent",
    customerUpdate: `Order ${job.orderId} is confirmed for ${job.email}`,
  };
}
