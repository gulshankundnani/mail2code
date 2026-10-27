import { afterEach, describe, expect, it } from "vitest";
import { onDeviceStatus, prepareOnDevice, summarizeOnDevice, summarizerOptions, summaryLanguage, testOnDevice } from "../src/on-device-ai.ts";

type G = { Summarizer?: unknown };

function fakeSummarizer(opts: { availability?: string; createFails?: boolean } = {}) {
  const calls: Record<string, unknown>[] = [];
  (globalThis as G).Summarizer = {
    availability: async (o: Record<string, unknown>) => {
      calls.push(o);
      return opts.availability ?? "available";
    },
    create: async (o: Record<string, unknown>) => {
      calls.push(o);
      if (opts.createFails) throw new Error("NotSupportedError");
      return { summarize: async () => " key points ", destroy() {} };
    },
  };
  return calls;
}

afterEach(() => delete (globalThis as G).Summarizer);

describe("on-device summarizer", () => {
  it("picks a supported output language from the browser language, else English", () => {
    expect(summaryLanguage("fr-CA")).toBe("fr");
    expect(summaryLanguage("ja")).toBe("ja");
    expect(summaryLanguage("hi-IN")).toBe("en");
    expect(summaryLanguage(undefined)).toBe("en");
    expect(summarizerOptions("de-DE")).toMatchObject({ outputLanguage: "de", expectedInputLanguages: ["de", "en"], expectedContextLanguages: ["en"] });
    expect(summarizerOptions("en-IN")).toMatchObject({ outputLanguage: "en", expectedInputLanguages: ["en"] });
  });

  it("names the output language on every availability and create call", async () => {
    const calls = fakeSummarizer();
    expect(await summarizeOnDevice("Please fix the login bug.")).toBe("key points");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c.outputLanguage).toMatch(/^(en|de|es|fr|ja)$/);
  });

  it("reports not-ready when the model is available but a summarizer won't start", async () => {
    fakeSummarizer({ createFails: true });
    expect(await onDeviceStatus()).toBe("available");
    expect(await summarizeOnDevice("text")).toBeNull();
    expect(await testOnDevice()).toBe(false);
    expect(await prepareOnDevice()).toBe("not-ready");
  });

  it("is unsupported without the API", async () => {
    expect(await onDeviceStatus()).toBe("unsupported");
    expect(await testOnDevice()).toBe(false);
  });
});
