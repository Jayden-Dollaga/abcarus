#!/usr/bin/env node
/* eslint-disable no-console */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

async function importBundledModule(filePath) {
  const result = await build({
    entryPoints: [resolve(filePath)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const source = result.outputFiles[0].text;
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const { createRenderRuntime } = await importBundledModule(
  "src/renderer/render/render_runtime.js",
);
const { createScoreInteractionController } = await importBundledModule(
  "src/renderer/render/score_interaction_controller.js",
);
const { createScoreMeasureSelectionController } = await importBundledModule(
  "src/renderer/render/score_measure_selection_controller.js",
);
const { createHeaderLayersController } = await importBundledModule(
  "src/renderer/render/header_layers_controller.js",
);
{
  const appended = [];
  const windowRef = {};
  const documentRef = {
    body: { appendChild: (element) => appended.push(element) },
    createElement: () => ({ style: {}, setAttribute(name, value) { this[name] = value; } }),
  };
  const bootstrap = await readFile(resolve("src/renderer/abc2svg_bootstrap.js"), "utf8");
  vm.runInNewContext(bootstrap, { window: windowRef, document: documentRef });
  assert.equal(appended.length, 1, "abc2svg must receive its browser text-measurement element");
  assert.equal(windowRef.abc2svg.el, appended[0]);
  assert.equal(windowRef.abc2svg.el.style.visibility, "hidden");
  assert.equal(windowRef.abc2svg.el.style.lineHeight, "1");
  vm.runInNewContext(bootstrap, { window: windowRef, document: documentRef });
  assert.equal(appended.length, 1, "abc2svg text measurer initialization must be idempotent");

  const rendererHtml = await readFile(resolve("src/renderer/index.html"), "utf8");
  assert.ok(
    rendererHtml.indexOf("./abc2svg_bootstrap.js")
      < rendererHtml.indexOf("../../third_party/abc2svg/abc2svg-1.js"),
    "abc2svg text measurement must be initialized before the abc2svg runtime loads",
  );
}

{
  const files = new Map([
    ["/app/global_settings.abc", "%%titlefont Default 20"],
    ["/scores/local_settings.abc", "%%pagewidth 20cm"],
    ["/profile/user_settings.abc", "%%MIDI program 24"],
  ]);
  const controller = createHeaderLayersController({
    api: {
      getSettingsPaths: async () => ({
        globalPath: "/app/global_settings.abc",
        userPath: "/profile/user_settings.abc",
      }),
      pathDirname: () => "/scores",
      pathJoin: (dir, name) => `${dir}/${name}`,
    },
    readFile: async (filePath) => files.has(filePath)
      ? { ok: true, data: files.get(filePath) }
      : { ok: false },
    getActiveFilePath: () => "/scores/tunes.abc",
  });

  controller.setFromSettings({
    globalHeaderEnabled: true,
    globalHeaderText: "%%MIDI program 1",
  });
  await controller.refreshHeaderLayers();
  const enabled = controller.buildHeaderPrefix("%%scale 0.8", false, "X:1\nK:C\n").text;
  assert.match(enabled, /%%titlefont Default 20/);
  assert.match(enabled, /%%pagewidth 20cm/);
  assert.match(enabled, /%%MIDI program 24/);
  assert.doesNotMatch(enabled, /%%MIDI program 1/);
  assert.match(enabled, /%%scale 0\.8/);
  assert.doesNotMatch(enabled, /%%leftmargin 0\.5cm|%%rightmargin 0\.5cm/);

  const interactive = controller.buildInteractiveHeaderPrefix("", false, "X:1\nK:C\n").text;
  assert.match(interactive, /%%leftmargin 0\.5cm/);
  assert.match(interactive, /%%rightmargin 0\.5cm/);
  const explicitMargins = controller.buildInteractiveHeaderPrefix(
    "%%leftmargin 2cm\n%%rightmargin 1cm",
    false,
    "X:1\nK:C\n",
  ).text;
  assert.doesNotMatch(explicitMargins, /0\.5cm/);
  assert.match(explicitMargins, /%%leftmargin 2cm/);
  assert.match(explicitMargins, /%%rightmargin 1cm/);

  controller.setFromSettings({ globalHeaderEnabled: false });
  const disabled = controller.buildHeaderPrefix("%%scale 0.8", false, "X:1\nK:C\n").text;
  assert.doesNotMatch(disabled, /%%titlefont|%%pagewidth|%%MIDI program 24/);
  assert.match(disabled, /%%scale 0\.8/);

  const titleFormat = "%%titleformat P-1 T0 C1, Q-1 T0 O1, R-1 T0 H1";
  const tuneScoped = controller.buildHeaderPrefix(
    titleFormat,
    false,
    "X:7\nT:Tune\nC:Composer\nK:C\nC|\n",
  );
  assert.doesNotMatch(tuneScoped.text, /titleformat/);
  assert.match(tuneScoped.tuneText, new RegExp(`^X:7\\n${titleFormat}\\nT:Tune`));
  assert.equal(tuneScoped.offset, titleFormat.length + 1);

  const tuneOverride = controller.buildHeaderPrefix(
    titleFormat,
    false,
    "X:8\n%%titleformat T1 C0\nT:Override\nK:C\nC|\n",
  );
  assert.doesNotMatch(tuneOverride.text, /titleformat/);
  assert.equal(tuneOverride.tuneText, undefined);
}

{
  const errors = [];
  const runtime = createRenderRuntime({
    consoleRef: {
      error: (message) => errors.push(message),
    },
  });

  assert.equal(runtime.assertCleanAbcText("X:1\nK:C\n", "test"), true);
  assert.equal(runtime.assertCleanAbcText("[object Object]", "test"), false);
  assert.equal(errors.length, 1);
  assert.equal(runtime.normalizeAccThreeQuarterToneForAbc2svg("^3/4C _3/4D"), "^3/2C _3/2D");

  runtime.initializePayload({
    getEditorText: () => "X:1\nK:C\n",
    buildHeaderPrefix: () => ({
      text: "",
      tuneText: "X:1\n%%titleformat T0\nK:C\n",
      offset: 17,
    }),
  });
  assert.deepEqual(runtime.getRenderPayload(), {
    text: "X:1\n%%titleformat T0\nK:C\n",
    offset: 17,
  });

  const payload = {
    offset: 10,
    compatMap: {
      shifts: [{ srcPos: 15, outPos: 17, delta: 2 }],
    },
  };
  assert.equal(runtime.mapEditorOffsetToRenderIdx(5, payload), 17);
  assert.equal(runtime.mapRenderIdxToEditorOffset(17, payload), 5);
}

{
  const attr = (values) => ({
    getAttribute: (name) => values[name] == null ? null : String(values[name]),
  });
  const bars = [
    attr({ x: 0, y: 10, width: 2, height: 20, "data-start": 100, "data-end": 101 }),
    attr({ x: 100, y: 10, width: 2, height: 20, "data-start": 190, "data-end": 191 }),
  ];
  const svg = { querySelectorAll: (selector) => selector === ".bar-hl" ? bars : [] };
  const makeNote = (start, x) => ({
    ...attr({ x, y: 10, width: 10, height: 20, "data-start": start, "data-end": start + 1 }),
    ownerSVGElement: svg,
    classList: { contains: (name) => name === "note-hl" },
  });
  const firstNote = makeNote(120, 20);
  const middleNote = makeNote(150, 60);
  const output = {
    querySelectorAll(selector) {
      if (selector === "svg") return [svg];
      if (selector === ".note-hl[data-start]") return [firstNote, middleNote];
      return [];
    },
  };
  const controller = createScoreMeasureSelectionController({ outputElement: output });
  controller.rebuildIndex();
  assert.deepEqual(
    controller.measureAtPoint(0, 0, middleNote),
    {
      svg,
      playStart: 120,
      playEnd: 191,
      x: 1,
      y: 10,
      width: 100,
      height: 20,
    },
    "double-clicking any note must select the complete containing measure",
  );
}

{
  const listeners = new Map();
  const note = {
    getBoundingClientRect: () => ({ top: 250, left: 350, width: 20, height: 10 }),
  };
  const output = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    querySelectorAll: (selector) => selector === "._120_" ? [note] : [],
  };
  const renderPane = {
    scrollTop: 10,
    scrollLeft: 20,
    clientHeight: 200,
    clientWidth: 300,
    getBoundingClientRect: () => ({ top: 50, left: 100 }),
  };
  const selections = [];
  const playbackRanges = [];
  const origins = [];
  const controller = createScoreInteractionController({
    outputElement: output,
    renderPane,
    getEditorView: () => ({
      state: {
        selection: { main: { anchor: 20 } },
      },
    }),
    mapEditorOffsetToRenderIdx: (value) => value + 100,
    mapRenderIdxToEditorOffset: (value) => value - 100,
    pickClosestNoteElement: (elements) => elements[0] || null,
    setEditorSelectionRange: (start, end) => selections.push([start, end]),
    setPendingPlaybackRangeOrigin: (origin) => origins.push(origin),
    getPlaybackRange: () => ({ loop: true }),
    setPlaybackRange: (range) => playbackRanges.push(range),
    setTimeoutRef: (callback) => callback(),
    clearTimeoutRef: () => {},
  });

  assert.equal(controller.centerCurrentAnchor(), true);
  assert.equal(renderPane.scrollTop, 115);
  assert.equal(renderPane.scrollLeft, 130);

  assert.equal(controller.wireOutputSelection(), true);
  assert.equal(controller.wireOutputSelection(), false);
  const target = {
    classList: { contains: (name) => name === "note-hl" },
    dataset: { start: "120", end: "125" },
  };
  assert.equal(controller.handleOutputClick({ target }), true);
  assert.deepEqual(origins, ["score-note"]);
  assert.deepEqual(selections, [[20, 25]]);
  assert.deepEqual(playbackRanges, [{
    startOffset: 20,
    endOffset: null,
    origin: "score-note",
    loop: false,
  }]);
  assert.equal(typeof listeners.get("click"), "function");
  assert.equal(typeof listeners.get("dblclick"), "function");
  assert.equal(typeof listeners.get("abcarus:score-rendered"), "function");
  assert.equal(typeof listeners.get("abcarus:focus-selection-changed"), "function");
}

{
  const listeners = new Map();
  const svg = { querySelectorAll: () => [] };
  const makeNote = (start, end, x) => ({
    ownerSVGElement: svg,
    classList: { contains: (name) => name === "note-hl" },
    getAttribute(name) {
      return {
        x: String(x),
        y: "10",
        width: "10",
        height: "10",
        "data-start": String(start),
        "data-end": String(end),
      }[name] ?? null;
    },
  });
  const output = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    querySelectorAll: () => [],
  };
  const selections = [];
  let clearedPlaybackPosition = 0;
  let playbackBusy = true;
  let stoppedForRangeEdit = 0;
  const controller = createScoreInteractionController({
    outputElement: output,
    mapEditorOffsetToRenderIdx: (value) => value + 100,
    mapRenderIdxToEditorOffset: (value) => value - 100,
    setEditorSelectionRange: (start, end) => selections.push([start, end]),
    setPendingPlaybackRangeOrigin: () => {},
    clearPlaybackPositionHighlight: () => { clearedPlaybackPosition += 1; },
    isPlaybackBusy: () => playbackBusy,
    stopPlaybackForRangeEdit: () => {
      stoppedForRangeEdit += 1;
      playbackBusy = false;
    },
    getPlaybackRange: () => ({ loop: true }),
    setPlaybackRange: () => {},
  });
  controller.wireOutputSelection();
  controller.handleOutputDoubleClick({ target: makeNote(120, 125, 10), preventDefault() {} });
  assert.equal(stoppedForRangeEdit, 1, "starting a score range must stop active playback before changing it");
  assert.equal(clearedPlaybackPosition, 1, "starting a score range must clear the stale playback position");
  listeners.get("abcarus:editor-playback-scope")({ detail: { startOffset: 20, endOffset: 25 } });
  controller.handleOutputDoubleClick({ target: makeNote(180, 185, 80), preventDefault() {} });
  assert.equal(stoppedForRangeEdit, 1, "completing a range must not stop an already stopped transport again");
  assert.deepEqual(
    selections,
    [[20, 25], [20, 85]],
    "editor feedback must not turn the second score double-click into a new range start",
  );

  controller.handleOutputDoubleClick({ target: makeNote(220, 225, 120), preventDefault() {} });
  listeners.get("abcarus:score-rendered")();
  controller.handleOutputDoubleClick({ target: makeNote(260, 265, 160), preventDefault() {} });
  assert.deepEqual(
    selections.slice(-2),
    [[120, 125], [160, 165]],
    "a score rerender must discard an unfinished double-click anchor",
  );
}

console.log("render domain harness: all tests passed");
