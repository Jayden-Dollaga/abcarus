#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "esbuild";

async function loadModule(entryPoint) {
  const bundled = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const encoded = Buffer.from(bundled.outputFiles[0].text, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const {
  createEmptyFavoritesDocument,
  createLibraryFavoritesController,
  filterLibraryFilesByTuneIds,
  nextTimestamp,
} = await loadModule("src/renderer/library/library_favorites_controller.js");

const files = [{
  path: "/music/a.abc",
  tunes: [
    { id: "tune-a", title: "A" },
    { id: "tune-b", title: "B" },
  ],
}, {
  path: "/music/empty.abc",
  tunes: [{ id: "tune-c", title: "C" }],
}];
assert.deepEqual(
  filterLibraryFilesByTuneIds({ files }, new Set(["tune-b"])),
  [{ path: "/music/a.abc", tunes: [{ id: "tune-b", title: "B" }] }],
);

const clock = Date.parse("2026-09-27T12:00:00.000Z");
const empty = createEmptyFavoritesDocument(() => new Date(clock).toISOString());
assert.equal(empty.id, "favorites");
assert.equal(empty.kind, "favorites");
assert.ok(nextTimestamp({ updatedAt: "2026-09-27T12:00:01.000Z" }, clock) > empty.updatedAt);

let stored = {
  ...empty,
  items: [{
    id: "favorite-a",
    tune: {
      title: "A",
      composer: "",
      key: "",
      rhythm: "",
      origin: "",
      groups: [],
      source: { locatorHint: "tune-a", pathHint: "/music/a.abc", xNumberHint: "1" },
      contentHash: "",
    },
    performance: { transposeSemitones: 0, tempoScale: 1 },
    notes: "",
    links: [],
    export: { includeInPdf: true, pageBreakBefore: false },
  }],
  favoriteMemberships: [{
    itemId: "favorite-a",
    tuneKey: "locator:tune-a",
    present: true,
    changedAt: empty.updatedAt,
  }],
};
let currentTime = clock + 1000;
let appliedFilter = null;
let filterLabel = "";
let clearCalls = 0;
const buttonListeners = new Map();
const buttonClasses = new Set();
const button = {
  classList: { toggle: (name, enabled) => enabled ? buttonClasses.add(name) : buttonClasses.delete(name) },
  setAttribute() {},
  addEventListener(type, listener) { buttonListeners.set(type, listener); },
  title: "",
};

const controller = createLibraryFavoritesController({
  button,
  getLibraryIndex: () => ({ files }),
  listSetLists: async () => ({ ok: true, entries: [{ filePath: "/sets/Favorites.json", document: stored }] }),
  publishSetList: async (document, filePath) => {
    stored = structuredClone(document);
    return { ok: true, document: stored, filePath };
  },
  buildDocumentItem: async (tuneId) => ({
    id: `favorite-${tuneId}`,
    tune: {
      title: tuneId === "tune-b" ? "B" : "",
      composer: "",
      key: "",
      rhythm: "",
      origin: "",
      groups: [],
      source: { locatorHint: tuneId, pathHint: "/music/a.abc", xNumberHint: "2" },
      contentHash: "",
    },
    performance: { transposeSemitones: 0, tempoScale: 1 },
    notes: "",
    links: [],
    export: { includeInPdf: true, pageBreakBefore: false },
  }),
  resolveItemSource: async (item) => ({ candidate: { tuneId: item.tune.source.locatorHint } }),
  setLibraryFilter: (value, label) => { appliedFilter = value; filterLabel = label; },
  clearLibraryFilter: () => { clearCalls += 1; },
  makeId: () => "generated-id",
  now: () => ++currentTime,
});

controller.wire();
await controller.refresh({ applyActiveFilter: false });
assert.equal(controller.isTuneFavorite("tune-a"), true);
assert.match(button.title, /Show Favorites \(1\)/);

await controller.toggleFilter();
assert.equal(filterLabel, "Favorites (1)");
assert.equal(appliedFilter[0].tunes[0].id, "tune-a");
assert.equal(buttonClasses.has("toggle-active"), true);

await controller.toggleTune("tune-a");
assert.equal(controller.isTuneFavorite("tune-a"), false);
assert.equal(stored.items.length, 0);
assert.equal(stored.favoriteMemberships[0].present, false);

await controller.toggleTune("tune-b");
assert.equal(controller.isTuneFavorite("tune-b"), true);
assert.equal(stored.items[0].tune.source.locatorHint, "tune-b");

await controller.toggleFilter();
assert.equal(clearCalls, 1);
assert.equal(buttonClasses.has("toggle-active"), false);

console.log("library favorites harness: all tests passed");
