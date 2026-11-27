// Error classification and retry policy for the bulk job worker.
//
//   transient — worth retrying with backoff (rate limits, 5xx, network blips,
//               malformed AI output).
//   permanent — this item cannot succeed (bad request, deleted product). Fail
//               the item, keep going with the rest of the job.
//   fatal     — nothing else in the job can succeed either (store uninstalled,
//               Shopify token rejected, AI key invalid or quota exhausted).
//               Stop the job and refund what was not used.

export class PermanentItemError extends Error {
  constructor(message) {
    super(message);
    this.name = "PermanentItemError";
  }
}

export class FatalJobError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "FatalJobError";
    if (cause) this.cause = cause;
  }
}

// Thrown when this worker no longer holds the job's lease (it expired and
// another worker claimed the job). The worker must stop touching the job.
export class LeaseLostError extends Error {
  constructor(jobId) {
    super(`Lease lost for bulk job ${jobId}`);
    this.name = "LeaseLostError";
  }
}

const TRANSIENT_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
const TRANSIENT_ERROR_NAMES = new Set([
  "AbortError",
  "FetchError",
  "TimeoutError",
  "HttpRequestError",
  "HttpThrottlingError",
  "HttpInternalError",
  "HttpMaxRetriesError",
]);
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const TRANSIENT_MESSAGE_PATTERN =
  /fetch failed|network|socket hang up|timed? ?out|overloaded|temporarily|try again|rate limit|too many requests|throttl|service unavailable|bad gateway/i;
// The AI occasionally returns malformed JSON; a second attempt usually succeeds.
const MALFORMED_AI_OUTPUT_PATTERN = /JSON|Unexpected token|non-array|parse/i;
// Not "exceeded your current quota": Gemini returns that on every 429, including
// per-minute limits that clear in seconds. OpenAI quota errors set quotaExhausted.
const QUOTA_PATTERN = /insufficient_quota|quota is exhausted/i;

export function getErrorStatus(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.code,
    error?.response?.status,
    typeof error?.code === "number" ? error.code : undefined,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 100 && n <= 599) return n;
  }
  return undefined;
}

function graphqlErrorCodes(error) {
  const list = error?.body?.errors?.graphQLErrors || error?.response?.errors?.graphQLErrors || error?.graphQLErrors || [];
  return (Array.isArray(list) ? list : []).map((e) => e?.extensions?.code).filter(Boolean);
}

export function classifyError(error) {
  if (!error) return "permanent";
  if (error instanceof FatalJobError || error instanceof LeaseLostError) return "fatal";
  if (error instanceof PermanentItemError) return "permanent";
  if (error.name === "SessionNotFoundError") return "fatal";

  const status = getErrorStatus(error);
  const message = String(error.message || "");

  // A rejected Shopify token or AI key will fail every remaining item the same way.
  if ((status === 401 || status === 403) && (error.source === "shopify" || error.source === "ai")) return "fatal";
  if (error.quotaExhausted || QUOTA_PATTERN.test(message)) return "fatal";

  if (graphqlErrorCodes(error).includes("THROTTLED")) return "transient";
  if (status && TRANSIENT_STATUSES.has(status)) return "transient";
  if (TRANSIENT_ERROR_NAMES.has(error.name)) return "transient";
  const code = error.code || error.cause?.code;
  if (code && TRANSIENT_ERROR_CODES.has(code)) return "transient";
  if (TRANSIENT_MESSAGE_PATTERN.test(message) || TRANSIENT_MESSAGE_PATTERN.test(String(error.cause?.message || ""))) {
    return "transient";
  }
  if (!status && MALFORMED_AI_OUTPUT_PATTERN.test(message)) return "transient";
  return "permanent";
}

function retryAfterMs(error) {
  const seconds = Number(error?.retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return undefined;
}

export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff and jitter.
 * Permanent and fatal errors are rethrown immediately.
 */
export async function withRetry(fn, {
  maxAttempts = 3,
  baseDelayMs = 2000,
  maxDelayMs = 30000,
  sleep = defaultSleep,
  random = Math.random,
  onRetry,
} = {}) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || classifyError(error) !== "transient") throw error;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.min(maxDelayMs, retryAfterMs(error) ?? Math.round(backoff * (0.75 + random() * 0.5)));
      onRetry?.({ error, attempt, delay });
      await sleep(delay);
    }
  }
}

export function errorMessage(error, maxLength = 500) {
  const message = String(error?.message || error || "Unknown error").trim() || "Unknown error";
  return message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
}
