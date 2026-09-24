import { LRUCache } from "./lruCache";

export type MermaidTheme = "light" | "dark";

const diagrams = new LRUCache<string>(32, 4 * 1024 * 1024);
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;

function cacheKey(code: string, theme: MermaidTheme) {
  return `${theme}\n${code}`;
}

export function cachedMermaidDiagram(code: string, theme: MermaidTheme) {
  return diagrams.get(cacheKey(code, theme));
}

/** Serialize Mermaid's global configuration and skip work for unmounted previews. */
export function renderMermaidDiagram(code: string, theme: MermaidTheme, signal: AbortSignal) {
  const result = queue.then(async () => {
    signal.throwIfAborted();
    const cached = cachedMermaidDiagram(code, theme);
    if (cached !== null) return cached;
    if (code.length > 20_000) {
      throw new Error("This diagram exceeds the 20,000 character preview limit.");
    }
    const { default: mermaid } = await import("mermaid");
    // Give input and scrolling a turn between diagrams. A promise queue alone
    // would run consecutive layouts in the same browser task.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal.throwIfAborted();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 20_000,
      maxEdges: 200,
      theme: theme === "dark" ? "dark" : "default",
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
        "themeCSS",
        "fontFamily",
        "altFontFamily",
        "dompurifyConfig",
      ],
    });
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
    document.body.appendChild(container);
    try {
      const { svg } = await mermaid.render(`t3-mermaid-${++nextId}`, code, container);
      const key = cacheKey(code, theme);
      diagrams.set(key, svg, (key.length + svg.length) * 2);
      return svg;
    } finally {
      container.remove();
    }
  });
  // A rejected diagram must not prevent the next one from rendering.
  queue = result.catch(() => undefined);
  return result;
}
