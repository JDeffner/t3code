import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as rendering from "../lib/mermaidRendering";
import { MermaidBlock } from "./MermaidBlock";
import { Button } from "./ui/button";

describe("Mermaid preview lifecycle", () => {
  let renderer: ReactTestRenderer | undefined;
  let intersect: () => void;
  const roots: Array<{
    innerHTML: string;
    querySelector: ReturnType<typeof vi.fn>;
    replaceChildren: ReturnType<typeof vi.fn>;
  }> = [];
  const code = "flowchart LR; LifecycleA-->LifecycleB";
  const frame = (content: ReactNode, actions: ReactNode) => (
    <section>
      {actions}
      {content}
    </section>
  );
  const block = (theme: "light" | "dark" = "dark") => (
    <MermaidBlock code={code} language="mermaid" theme={theme} source={<pre>{code}</pre>}>
      {frame}
    </MermaidBlock>
  );
  const mount = async (theme: "light" | "dark" = "dark") => {
    await act(async () => {
      renderer = create(block(theme), {
        createNodeMock: () => ({
          attachShadow() {
            const root = {
              innerHTML: "",
              querySelector: vi.fn(() => ({ style: {}, viewBox: { baseVal: { width: 1200 } } })),
              replaceChildren: vi.fn(),
            };
            roots.push(root);
            return root;
          },
        }),
      });
    });
  };
  const click = async (label: string) => {
    const button = renderer!.root
      .findAllByType(Button)
      .find((node) => node.props["aria-label"] === label || node.props.children === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => button.props.onClick());
  };

  beforeEach(() => {
    roots.length = 0;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          intersect = () => callback([{ isIntersecting: true }]);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(rendering, "cachedMermaidDiagram").mockReturnValue(null);
    vi.spyOn(rendering, "renderMermaidDiagram").mockResolvedValue("<svg>diagram</svg>");
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("waits for visibility, rerenders for the theme, and remembers source mode on remount", async () => {
    await mount();
    expect(rendering.renderMermaidDiagram).not.toHaveBeenCalled();
    await act(async () => intersect());
    expect(roots.at(-1)?.innerHTML).toBe("<svg>diagram</svg>");
    await act(async () => renderer!.update(block("light")));
    expect(rendering.renderMermaidDiagram).toHaveBeenLastCalledWith(
      code,
      "light",
      expect.any(AbortSignal),
    );
    await click("Show diagram source");
    expect(renderer!.root.findByType("pre").children.join("")).toBe(code);
    await act(async () => renderer!.unmount());
    vi.mocked(rendering.renderMermaidDiagram).mockClear();
    await mount();
    await act(async () => intersect());
    expect(rendering.renderMermaidDiagram).not.toHaveBeenCalled();
    await click("Show diagram");
    expect(roots.at(-1)?.innerHTML).toBe("<svg>diagram</svg>");
  });

  it("reports failures, retains the source, and allows a successful retry", async () => {
    vi.mocked(rendering.renderMermaidDiagram).mockRejectedValueOnce(
      new Error("Parse error on line 2"),
    );
    await mount();
    await act(async () => intersect());
    expect(renderer!.root.findByProps({ role: "status" }).children.join("")).toContain(
      "could not render",
    );
    expect(renderer!.root.findAllByType("pre").map((node) => node.children.join(""))).toEqual([
      "Parse error on line 2",
      code,
    ]);
    await click("Retry");
    expect(renderer!.root.findAllByProps({ role: "status" })).toHaveLength(0);
    expect(roots.at(-1)?.innerHTML).toBe("<svg>diagram</svg>");
  });

  it("aborts an in-flight preview on unmount", async () => {
    let finish!: (svg: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    vi.mocked(rendering.renderMermaidDiagram).mockReturnValueOnce(pending);
    await mount();
    await act(async () => intersect());
    const signal = vi.mocked(rendering.renderMermaidDiagram).mock.calls[0]![2];
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(signal.aborted).toBe(true);
    await act(async () => finish("<svg>obsolete</svg>"));
    expect(roots).toHaveLength(0);
  });
});
