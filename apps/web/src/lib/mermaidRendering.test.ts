import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("Mermaid rendering", () => {
  beforeEach(() => {
    vi.resetModules();
    mermaid.initialize.mockReset();
    mermaid.render.mockReset();
  });

  function documentFixture() {
    const remove = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => ({ style: {}, remove }),
      body: { appendChild: vi.fn() },
    });
    return remove;
  }

  it("serializes themes, shares queued results, and reuses the cache on remount", async () => {
    documentFixture();
    const { renderMermaidDiagram } = await import("./mermaidRendering");
    const started = deferred<void>();
    const firstRender = deferred<{ svg: string }>();
    mermaid.render
      .mockImplementationOnce(() => {
        started.resolve();
        return firstRender.promise;
      })
      .mockResolvedValueOnce({ svg: "light-svg" });
    const signal = new AbortController().signal;
    try {
      const first = renderMermaidDiagram("flowchart LR; A-->B", "dark", signal);
      const duplicate = renderMermaidDiagram("flowchart LR; A-->B", "dark", signal);
      const light = renderMermaidDiagram("flowchart LR; A-->B", "light", signal);
      await started.promise;
      expect(mermaid.initialize).toHaveBeenCalledTimes(1);
      firstRender.resolve({ svg: "dark-svg" });
      expect(await Promise.all([first, duplicate, light])).toEqual([
        "dark-svg",
        "dark-svg",
        "light-svg",
      ]);
      expect(await renderMermaidDiagram("flowchart LR; A-->B", "dark", signal)).toBe("dark-svg");
      expect(mermaid.render).toHaveBeenCalledTimes(2);
      expect(mermaid.initialize.mock.calls.map(([config]) => config.theme)).toEqual([
        "dark",
        "default",
      ]);
      expect(mermaid.render.mock.calls[0]?.[0]).not.toBe(mermaid.render.mock.calls[1]?.[0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips unmounted queued diagrams and continues after a rendering failure", async () => {
    const remove = documentFixture();
    const { renderMermaidDiagram } = await import("./mermaidRendering");
    const started = deferred<void>();
    const firstRender = deferred<{ svg: string }>();
    mermaid.render
      .mockImplementationOnce(() => {
        started.resolve();
        return firstRender.promise;
      })
      .mockResolvedValueOnce({ svg: "valid-svg" });
    const active = new AbortController();
    const cancelled = new AbortController();
    try {
      const failed = renderMermaidDiagram("invalid", "dark", active.signal);
      const failure = expect(failed).rejects.toThrow("Parse error");
      await started.promise;
      const skipped = renderMermaidDiagram("obsolete", "light", cancelled.signal);
      const abort = expect(skipped).rejects.toMatchObject({ name: "AbortError" });
      cancelled.abort();
      const valid = renderMermaidDiagram("flowchart LR; A-->B", "light", active.signal);
      firstRender.reject(new Error("Parse error"));
      await Promise.all([failure, abort]);
      expect(await valid).toBe("valid-svg");
      expect(mermaid.render).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects oversized source before starting Mermaid", async () => {
    const { renderMermaidDiagram } = await import("./mermaidRendering");
    await expect(
      renderMermaidDiagram("x".repeat(20_001), "dark", new AbortController().signal),
    ).rejects.toThrow("20,000 character");
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
