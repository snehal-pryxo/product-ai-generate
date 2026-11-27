import { describe, expect, it } from "vitest";
import {
  classifyError,
  FatalJobError,
  PermanentItemError,
  withRetry,
} from "../../app/lib/bulkJobs/errors.server";
import { geminiRetryDelaySeconds } from "../../app/lib/generateContent.server";
import { aiError } from "../support/fixtures";

describe("classifyError", () => {
  it("retries rate limits, server errors, network failures and malformed AI output", () => {
    expect(classifyError(aiError("Rate limit reached", 429))).toBe("transient");
    expect(classifyError(aiError("Overloaded", 529))).toBe("transient");
    expect(classifyError(aiError("Bad gateway", 502))).toBe("transient");
    expect(classifyError(Object.assign(new Error("fetch failed"), { name: "TypeError" }))).toBe("transient");
    expect(classifyError(Object.assign(new Error("boom"), { code: "ECONNRESET" }))).toBe("transient");
    expect(classifyError(new Error("Unexpected token < in JSON at position 0"))).toBe("transient");
    expect(classifyError(new Error("AI returned non-array for FAQ."))).toBe("transient");
  });

  it("retries Shopify throttling (HTTP 429 and GraphQL THROTTLED)", () => {
    expect(classifyError(Object.assign(new Error("Shopify is throttling"), { name: "HttpThrottlingError" }))).toBe("transient");
    const throttled = new Error("Throttled");
    throttled.graphQLErrors = [{ message: "Throttled", extensions: { code: "THROTTLED" } }];
    expect(classifyError(throttled)).toBe("transient");
  });

  it("retries Gemini per-minute rate limits, whose 429 says 'exceeded your current quota'", () => {
    const gemini429 = aiError("You exceeded your current quota, please check your plan and billing details.", 429);
    expect(classifyError(gemini429)).toBe("transient");
  });

  it("reads Gemini's retry hint from the error body", () => {
    const body = { error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "36s" }] } };
    expect(geminiRetryDelaySeconds(body)).toBe(36);
    expect(geminiRetryDelaySeconds({ error: {} })).toBeNaN();
    expect(geminiRetryDelaySeconds(null)).toBeNaN();
  });

  it("treats bad requests and deleted products as permanent for that item only", () => {
    expect(classifyError(aiError("Invalid request: max_tokens too large", 400))).toBe("permanent");
    expect(classifyError(new PermanentItemError("Product no longer exists"))).toBe("permanent");
    expect(classifyError(new Error("Something odd"))).toBe("permanent");
  });

  it("stops the job when credentials are rejected, the store is gone, or AI quota is exhausted", () => {
    expect(classifyError(aiError("Incorrect API key provided", 401))).toBe("fatal");
    expect(classifyError(Object.assign(new Error("Unauthorized"), { source: "shopify", status: 401 }))).toBe("fatal");
    expect(classifyError(Object.assign(new Error("Could not find a session"), { name: "SessionNotFoundError" }))).toBe("fatal");
    expect(classifyError(Object.assign(aiError("You exceeded your current quota", 429), { quotaExhausted: true }))).toBe("fatal");
    expect(classifyError(new FatalJobError("stop"))).toBe("fatal");
  });
});

describe("withRetry", () => {
  it("retries transient errors with exponential backoff, then succeeds", async () => {
    const delays = [];
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw aiError("Rate limit", 429);
      return "ok";
    }, { maxAttempts: 3, baseDelayMs: 1000, sleep: async (ms) => delays.push(ms), random: () => 0.5 });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it("honours Retry-After when the API provides it", async () => {
    const delays = [];
    let calls = 0;
    await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(aiError("Slow down", 429), { retryAfter: 7 });
      return "ok";
    }, { sleep: async (ms) => delays.push(ms) });
    expect(delays).toEqual([7000]);
  });

  it("gives up after the maximum number of attempts", async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw aiError("Service unavailable", 503);
    }, { maxAttempts: 3, sleep: async () => {} })).rejects.toThrow("Service unavailable");
    expect(calls).toBe(3);
  });

  it("does not retry permanent errors", async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw aiError("Bad request", 400);
    }, { sleep: async () => {} })).rejects.toThrow("Bad request");
    expect(calls).toBe(1);
  });
});
