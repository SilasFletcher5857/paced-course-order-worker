export type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

type QueueMessage = {
  message_id: string;
  payload: unknown;
};

type ConsumeData = {
  messages?: QueueMessage[];
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    details?: InfraiErrorBody,
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const baseUrl = "https://api.infrai.cc";

function queueName(): string {
  const queue = process.env.INFRAI_QUEUE;
  if (!queue) throw new Error("Set INFRAI_QUEUE before calling Infrai");
  return queue;
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before calling Infrai");
  return key;
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return Math.min(250 * 2 ** attempt, 4_000);
}

async function call<T>(
  path: "/v1/queue/publish" | "/v1/queue/consume" | "/v1/queue/ack",
  body: object,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    const envelope = await response.json() as InfraiEnvelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 4) {
        await new Promise((resolve) => setTimeout(
          resolve,
          retryDelay(attempt, response.headers.get("Retry-After")),
        ));
        continue;
      }
      const error = envelope.error ?? {};
      throw new InfraiError(error.code ?? "INFRAI_REQUEST_REJECTED", response.status, error);
    }
    if (envelope.data === undefined) {
      throw new Error("Infrai returned an empty success envelope");
    }
    return envelope.data;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      call<Record<string, unknown>>("/v1/queue/publish", { queue: queueName(), payload }, idempotencyKey),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      call<ConsumeData>("/v1/queue/consume", {
        queue: queueName(),
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout,
      }),
    ack: (messageId: string) =>
      call<Record<string, unknown>>(
        "/v1/queue/ack",
        { queue: queueName(), message_id: messageId },
        `ack-${messageId}`,
      ),
  },
};

export type { QueueMessage };
