import { useEffect, useRef, useState, type ReactNode } from "react";
import { Code2Icon, EyeIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";

import {
  cachedMermaidDiagram,
  renderMermaidDiagram,
  type MermaidTheme,
} from "../lib/mermaidRendering";
import { LRUCache } from "../lib/lruCache";
import { serializeMarkdownCodeFence } from "../markdown-clipboard";
import { Button } from "./ui/button";

// View preferences survive virtualized chat row remounts without storing messages on disk.
const sourcePreferences = new LRUCache<boolean>(100, 512 * 1024);

function MermaidSvg({
  svg,
  markdown,
  naturalSize,
}: {
  svg: string;
  markdown: string;
  naturalSize: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // Each SVG has its own ID and CSS scope, including copies of a cached diagram.
    // The SVG comes from Mermaid's strict renderer, which sanitizes its output.
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    root.innerHTML = svg;
    const diagram = root.querySelector("svg");
    if (diagram) {
      diagram.style.display = "block";
      diagram.style.height = "auto";
      diagram.style.margin = "0 auto";
      if (naturalSize && diagram.viewBox.baseVal.width > 0) {
        diagram.style.width = `${diagram.viewBox.baseVal.width}px`;
        diagram.style.maxWidth = "none";
      }
    }
    return () => root.replaceChildren();
  }, [naturalSize, svg]);
  return (
    <div
      ref={host}
      className="max-h-[70vh] overflow-auto p-4"
      role="region"
      aria-label="Mermaid diagram"
      tabIndex={0}
      data-markdown-copy={markdown}
      onCopy={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.clipboardData.setData("text/plain", markdown);
      }}
    />
  );
}

export function MermaidBlock({
  code,
  language,
  theme,
  source,
  children,
}: {
  code: string;
  language: string;
  theme: MermaidTheme;
  source: ReactNode;
  children: (content: ReactNode, actions: ReactNode, showingSource: boolean) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [showSource, setShowSource] = useState(() => sourcePreferences.get(code) ?? false);
  const [naturalSize, setNaturalSize] = useState(false);
  const [result, setResult] = useState<{
    code: string;
    theme: MermaidTheme;
    svg?: string;
    error?: string;
  } | null>(() => {
    const svg = cachedMermaidDiagram(code, theme);
    return svg === null ? null : { code, theme, svg };
  });
  const current = result?.code === code && result.theme === theme ? result : null;
  const svg = showSource ? undefined : current?.svg;
  const showingDiagram = svg !== undefined;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || showSource || (result?.code === code && result.theme === theme)) return;
    const controller = new AbortController();
    void renderMermaidDiagram(code, theme, controller.signal).then(
      (svg) => {
        if (!controller.signal.aborted) setResult({ code, theme, svg });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            code,
            theme,
            error: cause instanceof Error ? cause.message : "The diagram could not be rendered.",
          });
        }
      },
    );
    return () => controller.abort();
  }, [code, result, showSource, theme, visible]);

  const actions = (
    <>
      <Button
        type="button"
        variant="ghost-muted"
        size="xs"
        aria-label={showSource ? "Show diagram" : "Show diagram source"}
        aria-pressed={showSource}
        onClick={() => {
          const next = !showSource;
          sourcePreferences.set(code, next, code.length * 2 + 1);
          setShowSource(next);
        }}
      >
        {showSource ? <EyeIcon /> : <Code2Icon />}
        {showSource ? "Diagram" : "Source"}
      </Button>
      {showingDiagram ? (
        <Button
          type="button"
          variant="ghost-muted"
          size="xs"
          aria-label={naturalSize ? "Fit diagram to width" : "Show diagram at actual size"}
          aria-pressed={naturalSize}
          onClick={() => setNaturalSize((value) => !value)}
        >
          {naturalSize ? <Minimize2Icon /> : <Maximize2Icon />}
          {naturalSize ? "Fit" : "Actual size"}
        </Button>
      ) : null}
    </>
  );
  const content =
    svg !== undefined ? (
      <MermaidSvg
        svg={svg}
        markdown={serializeMarkdownCodeFence(code, language)}
        naturalSize={naturalSize}
      />
    ) : (
      <>
        {!showSource && current?.error ? (
          <div className="px-3 pt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span role="status">Diagram could not render. Source is shown below.</span>
              <Button
                type="button"
                variant="ghost-muted"
                size="xs"
                onClick={() => {
                  setResult(null);
                }}
              >
                Retry
              </Button>
            </div>
            <details>
              <summary>Details</summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{current.error}</pre>
            </details>
          </div>
        ) : null}
        {source}
      </>
    );
  return <div ref={host}>{children(content, actions, !showingDiagram)}</div>;
}
