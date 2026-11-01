// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Drawer } from "@/components/ui/Drawer";

/**
 * Issue #447 — the Drawer's document scroll lock must release completely
 * whatever order overlapping Drawers close in. Each Drawer used to snapshot
 * the body styles it found at mount, so a Drawer that opened while another's
 * lock was active "restored" the first Drawer's locked styles on close and
 * left the page permanently unscrollable until a full reload.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOCK_PROPS = ["overflow", "position", "top", "width", "paddingRight"] as const;
const bodyLock = () => Object.fromEntries(LOCK_PROPS.map((p) => [p, document.body.style[p]]));
const UNLOCKED = { overflow: "", position: "", top: "", width: "", paddingRight: "" };

let host: HTMLDivElement;
let root: Root;

function drawer(id: string) {
  return React.createElement(Drawer, {
    key: id,
    label: id,
    title: id,
    eyebrow: "t",
    children: React.createElement("button", { type: "button" }, id),
  });
}

async function render(ids: string[]) {
  await act(async () => {
    root.render(React.createElement(React.Fragment, null, ids.map(drawer)));
  });
}

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.removeAttribute("style");
});

describe("Drawer document scroll lock (#447)", () => {
  it("locks while one Drawer is open and releases when it closes", async () => {
    await render(["a"]);
    expect(bodyLock()).toMatchObject({ overflow: "hidden", position: "fixed" });
    await render([]);
    expect(bodyLock()).toEqual(UNLOCKED);
  });

  it("releases fully when overlapping Drawers close in LIFO order", async () => {
    await render(["a", "b"]);
    await render(["a"]);
    expect(bodyLock()).toMatchObject({ overflow: "hidden", position: "fixed" });
    await render([]);
    expect(bodyLock()).toEqual(UNLOCKED);
  });

  it("keeps the page locked while a later Drawer outlives the first", async () => {
    await render(["a"]);
    await render(["a", "b"]);
    await render(["b"]);
    expect(bodyLock()).toMatchObject({ overflow: "hidden", position: "fixed" });
  });

  it("leaves no stale lock when the FIRST Drawer closes before a later one", async () => {
    await render(["a"]);
    await render(["a", "b"]);
    await render(["b"]);
    await render([]);
    expect(bodyLock()).toEqual(UNLOCKED);
  });

  it("restores the scroll position the page had before the first lock", async () => {
    const scrolls: Array<[number, number]> = [];
    window.scrollTo = ((x: number, y: number) => {
      scrolls.push([x, y]);
    }) as typeof window.scrollTo;
    Object.defineProperty(window, "scrollY", { value: 240, configurable: true });
    await render(["a"]);
    // While locked the page reports scrollY 0, as a fixed body does in a browser.
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    await render(["a", "b"]);
    await render([]);
    expect(scrolls.at(-1)).toEqual([0, 240]);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });
});
