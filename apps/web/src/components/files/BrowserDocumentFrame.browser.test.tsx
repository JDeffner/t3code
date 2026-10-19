import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { BrowserDocumentFrame } from "./BrowserDocumentFrame";

it("keeps the loaded HTML page while its signed URL renews, and reloads on a new revision", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (src: string, documentKey: string) =>
    act(async () =>
      root.render(
        <BrowserDocumentFrame src={src} title="Review" pdf={false} documentKey={documentKey} />,
      ),
    );

  await render("about:blank#token-a", "review.html:1");
  const frame = container.querySelector("iframe");
  await render("about:blank#token-b", "review.html:1");
  expect(container.querySelector("iframe")).toBe(frame);
  expect(frame?.getAttribute("src")).toBe("about:blank#token-a");

  await render("about:blank#token-c", "review.html:2");
  expect(container.querySelector("iframe")).not.toBe(frame);
  expect(container.querySelector("iframe")?.getAttribute("src")).toBe("about:blank#token-c");

  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
