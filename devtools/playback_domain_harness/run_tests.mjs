#!/usr/bin/env node
/* eslint-disable no-console */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

const { createPlaybackDomain } = await importBundledModule(
  "src/renderer/playback/playback_domain.js",
);
const { createPlaybackTransportState } = await importBundledModule(
  "src/renderer/playback/playback_transport_state.js",
);
const { createPlaybackTransportController } = await importBundledModule(
  "src/renderer/playback/playback_transport_controller.js",
);
const { createPlaybackStartController } = await importBundledModule(
  "src/renderer/playback/playback_start_controller.js",
);
const { createPlaybackFollowController } = await importBundledModule(
  "src/renderer/playback/playback_follow_controller.js",
);
const { createPlaybackPlayerController } = await importBundledModule(
  "src/renderer/playback/playback_player_controller.js",
);
const { createFocusModeController } = await importBundledModule(
  "src/renderer/playback/focus_mode_controller.js",
);
const { injectGchordOn } = await importBundledModule(
  "src/renderer/playback/playback_payload_model.js",
);
const { createAbSelectionPlaybackController } = await importBundledModule(
  "src/renderer/playback/ab_selection_playback_controller.js",
);
const {
  buildIsolatedSelectionPlaybackText,
  hasOpeningRepeatBeforeSelection,
  hasIntentionalSelectionPlaybackSpan,
  isWholeTuneMusicRange,
  normalizeSelectionRepeatsLengthSafe,
} = await importBundledModule(
  "src/renderer/playback/selection_playback_model.js",
);

{
  assert.equal(normalizeSelectionRepeatsLengthSafe("A B :|2 C|"), "A B  |  C|");
  assert.equal(normalizeSelectionRepeatsLengthSafe("|: A B |1 C :|2 D|"), "|: A B |1 C :|2 D|");
  assert.equal(
    normalizeSelectionRepeatsLengthSafe("|: A |1 B :|2 C |3 D :|4 E"),
    "|: A |1 B :|2 C |  D  |  E",
    "matched repeats survive while a separate unmatched volta is linearized",
  );
  const source = "X:1\nP:ABBA\nL:1/8\nM:4/4\nK:C\n[P:A]\n|: C D|E F:|\n[P:B]\nG A|B c|\n";
  const start = source.indexOf("G A");
  const end = source.indexOf("|B c") + 1;
  const isolated = buildIsolatedSelectionPlaybackText(source, start, end);
  assert.equal(isolated.text.includes("P:ABBA"), false);
  assert.equal(isolated.text.includes("C D"), false);
  assert.equal(isolated.text.includes("G A|"), true);
  assert.equal(start + isolated.offset, isolated.text.indexOf("G A"));
  assert.equal(isWholeTuneMusicRange(source, source.indexOf("C D"), source.length), true);
  assert.equal(isWholeTuneMusicRange(source, start, end), false);
}

{
  const source = "X:1\nP:AB\nK:C\n[P:A]\n|: C D :: $\n%\n[P:B]\nE F :| G A |\n";
  const start = source.indexOf("E F");
  const end = source.indexOf(" G A");
  assert.equal(hasOpeningRepeatBeforeSelection(source, start), true);
  const isolated = buildIsolatedSelectionPlaybackText(source, start, end);
  assert.match(isolated.text, /\|: E F :\|/);
  assert.equal(start + isolated.offset, isolated.text.indexOf("E F"));
}

{
  const source = await readFile(
    resolve("devtools/playback_domain_harness/fixtures/sectional_end_selection.abc"),
    "utf8",
  );
  const partD = source.indexOf("[P:D]");
  const partE = source.indexOf("[P:E]");
  const dStart = source.indexOf("S A4 _B4", partD);
  const dSelection = buildIsolatedSelectionPlaybackText(source, dStart, partE);
  assert.equal(dSelection.text.includes("P:ABBCDEFDE"), false);
  assert.equal(dSelection.text.includes("=c/d/c/B/"), false, "earlier part C must not leak into part D playback");
  assert.equal(dSelection.text.includes("S A4 _B4"), true);
  assert.equal(dSelection.text.includes("[P:E]"), false);

  const eStart = source.indexOf("FGFE D2 E2", partE);
  const eEnd = source.indexOf("\nAFGE D2 ^G2", eStart);
  const eSelection = buildIsolatedSelectionPlaybackText(source, eStart, eEnd);
  assert.equal(eSelection.text.includes("FGFE D2 E2"), true);
  assert.equal(eSelection.text.includes("AFGE F>E\"_Fine\" D2"), true);
  assert.doesNotMatch(eSelection.text, /\|:|:\||\[\s*\d+|\|\s*\d+/);
  assert.equal(eSelection.text.includes("AFGE D2 ^G2"), false, "measure after the selection must not leak into playback");
}
const {
  advanceFocusScoreSelection,
  advanceScoreRenderSelection,
  applyScoreRenderSelectionToFocusPlan,
  resolveFocusMeasureNumberAtRenderOffset,
} = await importBundledModule(
  "src/renderer/playback/focus_score_selection_model.js",
);

{
  const volumes = [];
  const speeds = [];
  const warmupEvents = [];
  let plays = 0;
  let stops = 0;
  let warmupPlayArgs = null;
  let playerVolume = 0.7;
  let playerConfig = null;
  const fakePlayer = {
    play: (...args) => {
      plays += 1;
      warmupPlayArgs = args;
      warmupEvents.push("play");
      queueMicrotask(() => playerConfig.onend());
    },
    stop: () => {
      stops += 1;
      warmupEvents.push("stop");
    },
    set_sfu: () => {},
    set_vol: (value) => {
      if (value == null) return playerVolume;
      playerVolume = value;
      volumes.push(value);
      warmupEvents.push(`volume:${value}`);
      return playerVolume;
    },
    set_speed: (value) => { speeds.push(value); },
  };
  const sourceSymbol = {
    istart: 25,
    dur: 192,
    ptim: 10,
    time: 10,
    v: 0,
    p_v: { id: "1" },
    notes: [{ midi: 60 }],
    parts: "ABC",
    part1: { p_s: [] },
    ts_prev: { parts: "ABC" },
    ts_next: {},
  };
  const playbackState = { symbols: [{ symbol: sourceSymbol }] };
  const playerTransport = {
    player: null,
    playbackState,
    desiredPlayerSpeed: 0.8,
  };
  const playerController = createPlaybackPlayerController({
    windowRef: {
      AbcPlay: (config) => {
        playerConfig = config;
        return fakePlayer;
      },
      sessionStorage: { setItem() {} },
      setTimeout,
      clearTimeout,
    },
    transport: playerTransport,
    getSoundfontSource: () => "test.sf2",
  });
  const startSymbol = sourceSymbol;
  assert.equal(await playerController.warmupPlayback(startSymbol), true);
  assert.deepEqual(volumes, [0, 0.7], "audio warmup must remain silent and restore playback volume");
  assert.deepEqual(
    warmupEvents,
    ["volume:0", "play", "stop", "volume:0.7"],
    "the muted warmup channel must be stopped before normal volume is restored",
  );
  assert.deepEqual(speeds, [0.8], "audio warmup must not alter the requested tempo");
  assert.equal(plays, 1);
  assert.equal(stops, 1);
  assert.notEqual(warmupPlayArgs[0], sourceSymbol, "warmup must use an isolated symbol clone");
  assert.equal(warmupPlayArgs[0].ts_prev, null);
  assert.equal(warmupPlayArgs[0].parts, undefined);
  assert.equal(warmupPlayArgs[0].part1, undefined);
  assert.equal(warmupPlayArgs[0].ts_next, warmupPlayArgs[1]);
  assert.equal(await playerController.warmupPlayback(startSymbol), true);
  assert.equal(plays, 1, "the same prepared playback state must only be warmed once");
}

{
  const renderPane = {
    scrollTop: 400,
    scrollLeft: 100,
    scrollHeight: 1200,
    scrollWidth: 1200,
    clientHeight: 200,
    clientWidth: 400,
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
  };
  const follow = createPlaybackFollowController({
    transport: { isPlaying: false, isPaused: false, waitingForFirstNote: false },
    getRenderPane: () => renderPane,
  });
  follow.maybeScrollRenderToNote({
    getBoundingClientRect: () => ({ top: 260, bottom: 280, left: 100, right: 200, width: 100, height: 20 }),
  }, { placement: "comfortable-center" });
  assert.equal(renderPane.scrollTop, 570, "editor-selected score row should be vertically centered");
  assert.equal(renderPane.scrollLeft, 100, "a horizontally comfortable measure should not move");

  follow.maybeScrollRenderToNote({
    getBoundingClientRect: () => ({ top: 80, bottom: 120, left: 500, right: 1100, width: 600, height: 40 }),
  }, { placement: "comfortable-center" });
  assert.equal(renderPane.scrollLeft, 700, "a wide off-screen measure should be centered within scroll bounds");

  let guardedScrolls = 0;
  const busyFollow = createPlaybackFollowController({
    transport: { isPlaying: false, isPaused: false, waitingForFirstNote: true },
    getRenderPane: () => renderPane,
    maybeAutoScrollRenderToCursor: () => { guardedScrolls += 1; },
  });
  renderPane.scrollTop = 700;
  busyFollow.maybeScrollRenderToNote({
    getBoundingClientRect: () => ({ top: -600, bottom: -580, left: 100, right: 200, width: 100, height: 20 }),
  }, { placement: "comfortable-center", force: true });
  assert.equal(guardedScrolls, 0, "count-in positioning must bypass guarded playback auto-scroll");
  assert.equal(renderPane.scrollTop, 10, "count-in positioning must reveal the requested score row immediately");
}

{
  const previousDocument = globalThis.document;
  globalThis.document = {
    activeElement: null,
    body: { classList: { toggle() {} } },
  };
  const makeElement = () => ({ hidden: true, checked: false, value: "" });
  const optionsGroup = makeElement();
  const voicesGroup = makeElement();
  const selectionGroup = makeElement();
  let selected = false;
  const focusUi = createFocusModeController({
    elements: {
      practiceFocusOptionsGroup: optionsGroup,
      practiceFocusVoicesGroup: voicesGroup,
      practiceSelectionGroup: selectionGroup,
      selectionSuppressWrap: makeElement(),
      selectionGchordsWrap: makeElement(),
      selectionDrumsWrap: makeElement(),
      selectionMutedWrap: makeElement(),
    },
    transport: { practiceTempoMultiplier: 1 },
    getEditorView: () => ({
      state: { selection: { ranges: selected ? [{ from: 4, to: 12 }] : [{ from: 4, to: 4 }] } },
    }),
  });

  focusUi.updatePracticeUi();
  assert.equal(optionsGroup.hidden, true, "legacy score-toolbar options stay hidden");
  selected = true;
  focusUi.updatePracticeUi();
  assert.equal(optionsGroup.hidden, true, "normal selection keeps Focus playback options hidden");
  assert.equal(voicesGroup.hidden, true, "normal selection keeps Focus voice controls hidden");
  assert.equal(selectionGroup.hidden, true, "legacy score-toolbar loop control stays hidden");
  focusUi.setEnabled(true);
  selected = false;
  focusUi.updatePracticeUi();
  assert.equal(optionsGroup.hidden, true, "legacy score-toolbar options remain hidden in Focus");
  assert.equal(selectionGroup.hidden, true, "legacy score-toolbar loop control remains hidden in Focus");
  globalThis.document = previousDocument;
}

{
  const bobFixture = `X:110
T:Lady Walpole's Reel
M:C|
L:1/8
K:Bb
"^A"[|] F2 |
"Bb"B2d2 "F7"decd | "Eb"EDEG "Bb"D2B,2 ||
`;
  const enabled = injectGchordOn(bobFixture, bobFixture.indexOf("X:110"));
  assert.equal(enabled.changed, true, "ordinary chord symbols must enable default abc2svg accompaniment");
  assert.match(enabled.text, /^%%MIDI gchordon\nX:110/);

  const annotationOnly = injectGchordOn('X:1\nK:C\n"^A" CDEF |\n', 0);
  assert.equal(annotationOnly.changed, false, "quoted annotations must not enable accompaniment");

  const explicitlyMuted = injectGchordOn('%%MIDI gchordoff\nX:1\nK:C\n"C" CDEF |\n', 0);
  assert.equal(explicitlyMuted.changed, false, "an explicit gchord toggle must remain authoritative");
}

assert.deepEqual(
  advanceFocusScoreSelection({ fromMeasure: 0, toMeasure: 0, awaitingEnd: false }, 6),
  { fromMeasure: 6, toMeasure: 6, awaitingEnd: true },
);
assert.deepEqual(
  advanceScoreRenderSelection(null, { playStart: 900, playEnd: 940 }),
  { playStart: 900, playEnd: 940, awaitingEnd: true },
);
assert.deepEqual(
  advanceScoreRenderSelection(
    { playStart: 900, playEnd: 940, awaitingEnd: true },
    { playStart: 700, playEnd: 760 },
  ),
  { playStart: 700, playEnd: 940, awaitingEnd: false },
);
assert.deepEqual(
  advanceScoreRenderSelection(
    { playStart: 700, playEnd: 940, awaitingEnd: false },
    { playStart: 1100, playEnd: 1160 },
  ),
  { playStart: 1100, playEnd: 1160, awaitingEnd: true },
  "a double-click after a completed range must start a fresh selection",
);
assert.deepEqual(
  applyScoreRenderSelectionToFocusPlan(
    { ok: true, plan: { startOffset: 400, endOffset: 440, mode: "segment" } },
    { playStart: 380, playEnd: 420 },
    (offset) => offset - 100,
    1000,
  ),
  { ok: true, plan: { startOffset: 280, endOffset: 320, mode: "segment" } },
  "physical score boundaries must override a later number-derived Focus range",
);
assert.deepEqual(
  advanceFocusScoreSelection({ fromMeasure: 6, toMeasure: 6, awaitingEnd: true }, 3),
  { fromMeasure: 3, toMeasure: 6, awaitingEnd: false },
);
assert.deepEqual(
  advanceFocusScoreSelection({ fromMeasure: 3, toMeasure: 6, awaitingEnd: false }, 9),
  { fromMeasure: 9, toMeasure: 9, awaitingEnd: true },
);
const scoreMeasureIndex = {
  anchor: 0,
  istarts: [100, 140, 180],
  byNumber: new Map([[1, [100]], [2, [140]], [3, [180]]]),
};
assert.equal(resolveFocusMeasureNumberAtRenderOffset(scoreMeasureIndex, 100), 1);
assert.equal(resolveFocusMeasureNumberAtRenderOffset(scoreMeasureIndex, 179), 2);
assert.equal(resolveFocusMeasureNumberAtRenderOffset(scoreMeasureIndex, 220), 3);

const repeatedBoundaryMeasureIndex = {
  anchor: 0,
  istarts: [100, 140, 140, 180, 220, 220, 260],
  byNumber: new Map([[1, [100]], [2, [140]], [3, [180]], [4, [220]], [5, [260]]]),
};
assert.equal(
  resolveFocusMeasureNumberAtRenderOffset(repeatedBoundaryMeasureIndex, 225),
  4,
  "explicit abc2svg bar numbers must win over duplicate repeat-boundary starts",
);

{
  const playbackStarts = [];
  const playbackRanges = [];
  let pendingRange = {
    startOffset: 10,
    endOffset: 14,
    origin: "selection",
    loop: true,
  };
  const editorView = {
    state: {
      doc: { length: 30 },
      selection: { main: { anchor: 10, head: 14 } },
    },
  };
  const selectionRuntime = {
    captureSelection: () => {},
    clearAbMutedVoices: () => {},
    setAbMutedVoiceIds: () => {},
  };
  const scoreSelectionController = createAbSelectionPlaybackController({
    selectionPlaybackRuntime: selectionRuntime,
    getSettings: () => ({ playbackSelectionLoopEnabled: true }),
    getEditorView: () => editorView,
    getEditorText: () => "X:1\nK:C\nCDEF GABc\n",
    isRawMode: () => false,
    isPayloadMode: () => false,
    getPlaybackRange: () => pendingRange,
    setPlaybackRange: (range) => playbackRanges.push(range),
    startPlaybackFromRange: async (range) => playbackStarts.push(range),
    parseMutedVoiceSetting: () => [],
    hasIntentionalSelectionPlaybackSpan,
  });

  assert.equal(
    await scoreSelectionController.playSelectionOnce(),
    true,
    "an explicit score selection must not require a barline inside its editor span",
  );
  assert.equal(playbackStarts.length, 1);
  assert.deepEqual(playbackRanges[0], {
    startOffset: 10,
    endOffset: 14,
    origin: "selection",
    loop: true,
    loopGapMs: 0,
  });

  playbackStarts.length = 0;
  playbackRanges.length = 0;
  pendingRange = {
    startOffset: 10,
    endOffset: 14,
    origin: "cursor",
    loop: false,
  };
  assert.equal(
    await scoreSelectionController.playSelectionOnce(),
    false,
    "an accidental short editor selection must keep the existing intent gate",
  );
  assert.equal(playbackStarts.length, 0);

  pendingRange = {
    startOffset: 10,
    endOffset: null,
    origin: "score-note",
    loop: false,
  };
  assert.equal(
    await scoreSelectionController.playSelectionOnce(),
    false,
    "a clicked score note is a start anchor, not a bounded selection playback request",
  );
}

const endState = createPlaybackTransportState();
endState.activePlaybackRange = { startOffset: 0, endOffset: null, origin: "transport", loop: false };
endState.isPlaying = true;
const completed = endState.consumePlaybackEnd();
assert.equal(completed.shouldLoop, false);
assert.equal(endState.restartOnNextPlay, true);
assert.equal(endState.consumeRestartOnNextPlay(), true);
assert.equal(endState.restartOnNextPlay, false);
endState.isPlaying = true;
endState.activePlaybackRange = { startOffset: 0, endOffset: null, origin: "transport", loop: true };
endState.consumePlaybackEnd();
assert.equal(endState.restartOnNextPlay, false);

const startCalls = [];
const rangeStartSpeeds = [];
const controllerTransport = createPlaybackTransportState();
controllerTransport.restartOnNextPlay = true;
const controller = createPlaybackTransportController({
  transport: controllerTransport,
  getEditorView: () => ({ state: { doc: { length: 10 }, selection: { main: { anchor: 9, head: 9 } } } }),
  getFocusModeEnabled: () => false,
  startPlaybackAtIndex: async (index) => startCalls.push(index),
  startPlaybackFromRange: async () => rangeStartSpeeds.push(controllerTransport.desiredPlayerSpeed),
  pausePlayback: () => {},
  playSelectionOnce: async () => false,
  updatePlayButton: () => {},
  clearNoteSelection: () => {},
  resetPlaybackUiState: () => {},
  setSoundfontCaption: () => {},
  showToast: () => {},
});
controllerTransport.practiceTempoMultiplier = 0.75;
assert.equal(
  controller.buildTransportPlaybackPlan().tempoMultiplier,
  0.75,
  "runtime tempo multiplier must apply outside Focus mode",
);
controllerTransport.playbackLoopEnabled = true;
assert.deepEqual(
  {
    rangeStart: controller.buildTransportPlaybackPlan().rangeStart,
    loopEnabled: controller.buildTransportPlaybackPlan().loopEnabled,
  },
  { rangeStart: 0, loopEnabled: true },
  "a global Loop repeats the whole tune from its beginning when no scope is selected",
);
controllerTransport.playbackLoopEnabled = false;
await controller.transportPlay();
assert.deepEqual(startCalls, [0]);
assert.equal(controllerTransport.desiredPlayerSpeed, 0.75);
assert.equal(controllerTransport.restartOnNextPlay, false);

// Regression: a pending Focus/navigation plan must not override the current
// editor cursor when normal-mode playback is started with F5.
const cursorStartCalls = [];
const cursorStartTransport = createPlaybackTransportState();
cursorStartTransport.restartOnNextPlay = true;
cursorStartTransport.pendingPlaybackPlan = {
  rangeStart: 0,
  rangeEnd: null,
  loopEnabled: false,
  tempoMultiplier: 1,
};
const cursorStartController = createPlaybackTransportController({
  transport: cursorStartTransport,
  getEditorView: () => ({
    state: {
      doc: { length: 15 },
      selection: { main: { anchor: 12, head: 12 } },
    },
  }),
  getEditorText: () => "X:1\nK:C\nC|D|E|F|",
  findMeasureStartOffsetByNumber: () => null,
  getFocusModeEnabled: () => false,
  startPlaybackFromRange: async (range) => cursorStartCalls.push(range),
  playSelectionOnce: async () => false,
  updatePlayButton: () => {},
  clearNoteSelection: () => {},
  resetPlaybackUiState: () => {},
  setSoundfontCaption: () => {},
  showToast: () => {},
});
cursorStartController.setPlaybackRange({ startOffset: 12, endOffset: null, origin: "cursor", loop: false });
assert.equal(cursorStartTransport.restartOnNextPlay, false, "moving the cursor after playback ends must cancel restart-from-zero");
await cursorStartController.togglePlayPauseEffective();
assert.equal(cursorStartCalls.length, 1);
assert.ok(cursorStartCalls[0].startOffset > 0, "normal playback must use the current editor measure, not a stale pending plan");

controllerTransport.practiceTempoMultiplier = 0.6;
await controller.transportPlay();
assert.deepEqual(rangeStartSpeeds, [0.6]);
assert.equal(
  controllerTransport.desiredPlayerSpeed,
  0.6,
  "the runtime tempo selected before Play must reach the first playback start",
);

controllerTransport.isPaused = true;
controllerTransport.restartOnNextPlay = true;
controllerTransport.resumeStartIdx = 3;
controller.setPlaybackRange({
  startOffset: 9,
  endOffset: null,
  origin: "score-note",
  loop: false,
});
assert.equal(controllerTransport.isPaused, false);
assert.equal(controllerTransport.restartOnNextPlay, false);
assert.equal(controllerTransport.resumeStartIdx, null);
assert.equal(
  controller.buildTransportPlaybackPlan().rangeStart,
  9,
  "a clicked score note must override measure snapping and stale resume/restart state",
);

{
  const finalBar = { istart: 146, bar_type: "|]", ts_next: null };
  const finalDrum = { istart: undefined, dur: 192, ts_next: finalBar };
  const firstDrum = { istart: undefined, dur: 192, ts_next: finalDrum };
  const finalRest = { istart: 143, dur: 1728, ts_next: firstDrum };
  const startRest = { istart: 128, dur: 1728 };
  const rangeController = createPlaybackStartController({
    transport: { playbackIndexOffset: 0 },
    findSymbolAtOrBefore: () => finalRest,
  });
  assert.equal(
    rangeController.resolvePlaybackEndSymbol(
      { startOffset: 128, endOffset: 145, origin: "selection", loop: true },
      startRest,
    ),
    finalBar,
    "selection playback must include generated drum events attached to its final source measure",
  );
}

{
  const calls = [];
  const startSymbol = {
    istart: 128,
    dur: 1728,
    ptim: 0,
    time: 0,
    v: 0,
    p_v: { id: "1" },
    ts_prev: null,
  };
  const endSymbol = { istart: 146, bar_type: "|]" };
  const nativeTransport = {
    playbackStartArmed: true,
    playbackState: { symbols: [{ symbol: startSymbol }], startSymbol, rootSymbol: startSymbol },
    activePlaybackRange: {
      startOffset: 128,
      endOffset: 145,
      origin: "selection",
      loop: true,
      loopGapMs: 0,
    },
    activePlaybackEndSymbol: endSymbol,
    waitingForFirstNote: false,
    player: { play: (...args) => calls.push(args) },
    markPreparedStart: () => {},
    markPlayingStarted: () => {},
    allowPlaybackEnd: () => {},
  };
  const nativeController = createPlaybackStartController({
    transport: nativeTransport,
    findSymbolAtOrAfter: () => startSymbol,
    getPlaybackRange: () => nativeTransport.activePlaybackRange,
    getDebugParts: () => false,
    setStatus: () => {},
    updatePlayButton: () => {},
  });
  nativeController.startPlaybackFromPrepared(128);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], endSymbol);
  assert.equal(calls[0][3], true, "zero-gap selection loops must use abc2svg native looping");
  assert.equal(calls[0][0].ts_next, startSymbol, "native loop proxy must restart at the selected first symbol");
  assert.equal(calls[0][0].ts_prev, null, "scoped playback proxy must not inherit the tune's global P: routing");
  assert.equal(calls[0][0].dur, 0, "native loop proxy must not add an audible event before the selection");

  calls.length = 0;
  nativeTransport.playbackStartArmed = true;
  nativeTransport.playbackLoopGapMs = 0;
  nativeTransport.activePlaybackRange = {
    startOffset: 128,
    endOffset: 145,
    origin: "focus",
    loop: true,
  };
  nativeController.startPlaybackFromPrepared(128);
  assert.equal(calls[0][3], true, "zero-gap Focus loops must use abc2svg native looping");

  calls.length = 0;
  nativeTransport.playbackStartArmed = true;
  nativeTransport.playbackLoopGapMs = 500;
  nativeController.startPlaybackFromPrepared(128);
  assert.equal(calls[0][3], true, "legacy loop-gap settings must not disable seamless native looping");

  calls.length = 0;
  nativeTransport.playbackStartArmed = true;
  nativeTransport.activePlaybackRange = {
    startOffset: 0,
    endOffset: null,
    origin: "transport",
    loop: true,
  };
  nativeController.startPlaybackFromPrepared(128);
  assert.equal(calls[0][3], true, "whole-tune transport loops must use abc2svg native looping");

  calls.length = 0;
  nativeTransport.playbackStartArmed = true;
  nativeTransport.lastPlaybackHasPartOrder = true;
  nativeController.startPlaybackFromPrepared(128);
  assert.equal(
    calls[0][3],
    false,
    "tunes with P: part order must restart through ABCarus because abc2svg native loops retain stale part state",
  );
}

const trace = [];
const transport = {
  isPlaying: false,
  isPaused: false,
  waitingForFirstNote: false,
  playbackIndexOffset: 12,
  playbackLoopFromMeasure: 4,
  playbackLoopToMeasure: 8,
  playbackState: {
    byTime: [],
    byIstart: [],
    measureStarts: [],
  },
  appendTrace: (event) => trace.push(event),
};
let focusEnabled = true;
const focusCalls = [];
const focusController = {
  computePlaybackPlan: () => ({ ok: true, start: 4 }),
  normalizeLoopBounds: (from, to) => ({ from, to }),
  normalizeLoopBoundsForPlayback: () => true,
  maybeResetLoopForTune: (...args) => focusCalls.push(args),
  clearScoreSelection: () => "cleared",
  getFocusScoreSelectionBounds: () => ({ fromMeasure: 2, toMeasure: 5 }),
  getFocusScoreRenderSelection: () => ({ playStart: 20, playEnd: 80 }),
  resolveScoreMeasureNumber: (offset) => offset + 1,
  selectScoreMeasureAtRenderOffset: (offset) => ({ selected: offset }),
  setEnabled: (...args) => focusCalls.push(["setEnabled", ...args]),
  toggle: () => focusCalls.push(["toggle"]),
};
const uiCalls = [];
const domain = createPlaybackDomain({
  transport,
  selectionRuntime: {},
  getEditorLength: () => 100,
  getFocusModeEnabled: () => focusEnabled,
  getFocusModeController: () => focusController,
  getPlaybackUiController: () => ({
    handlePlaybackGuardStop: (message) => uiCalls.push(message),
    isPlaybackBusy: () => Boolean(
      transport.isPlaying || transport.isPaused || transport.waitingForFirstNote
    ),
  }),
});

assert.equal(domain.isBusy(), false);
assert.equal(domain.isFollowEnabled(), true);
domain.setFollowEnabled(false);
assert.equal(domain.isFollowEnabled(), false);
assert.deepEqual(domain.computeFocusPlan(), { ok: true, start: 4 });
assert.equal(domain.clearFocusScoreSelection(), "cleared");
assert.deepEqual(domain.getFocusScoreSelectionBounds(), { fromMeasure: 2, toMeasure: 5 });
assert.deepEqual(domain.getFocusScoreRenderSelection(), { playStart: 20, playEnd: 80 });
assert.equal(domain.resolveFocusScoreMeasureNumber(8), 9);
assert.deepEqual(domain.selectFocusScoreMeasure(8), { selected: 8 });
assert.deepEqual(domain.normalizeFocusLoopBounds(2, 7), { from: 2, to: 7 });
assert.equal(domain.normalizeFocusLoopBoundsForPlayback(), true);
domain.resetFocusLoopForTune("tune-1", { updateUi: false });
assert.deepEqual(focusCalls, [["tune-1", { updateUi: false }]]);
domain.setFocusEnabled(true);
domain.toggleFocus();
domain.stopFromGuard("guard");
assert.deepEqual(focusCalls.slice(1), [["setEnabled", true], ["toggle"]]);
assert.deepEqual(uiCalls, ["guard"]);
assert.match(domain.getFollowPipelineVersion(), /^follow-/);
transport.waitingForFirstNote = true;
assert.equal(domain.isBusy(), true);
transport.waitingForFirstNote = false;

assert.throws(
  () => domain.getPayload(),
  /Playback controller is not attached: payload/,
);

const calls = [];
domain.attach({
  abSelection: {
    getSelectionSettings: () => ({ suppressRepeats: false, allowMidiDrums: true }),
    getSelectionRange: () => ({ startOffset: 2, endOffset: 7 }),
    withTempPlaybackFlags: (flags, action) => {
      calls.push(["flags", flags]);
      return action();
    },
  },
  payload: {
    getPlaybackPayload: () => ({ text: "X:1\nK:C\n", offset: 12 }),
    getPlaybackSourceKey: () => "source-key",
  },
  transport: {
    setPlaybackRange: (range) => calls.push(["range", range]),
    stopPlaybackTransport: () => calls.push("stop"),
  },
});

assert.deepEqual(domain.getScopedSettingsForOrigin("focus"), {
  suppressRepeats: true,
  allowMidiDrums: true,
});
focusEnabled = false;
assert.deepEqual(domain.getScopedSettingsForOrigin("focus"), {
  suppressRepeats: false,
  allowMidiDrums: true,
});
assert.deepEqual(domain.withScopedOrigin({ loop: true }, "selection"), {
  loop: true,
  origin: "selection",
});
assert.equal(domain.toDerivedOffset(8), 20);
assert.equal(domain.toEditorOffset(20), 8);
assert.equal(domain.toDerivedOffset("bad"), null);
assert.equal(domain.getSourceKey(), "source-key");
assert.equal(domain.getPayload().offset, 12);
assert.deepEqual(domain.getSelectionRange(), { startOffset: 2, endOffset: 7 });
domain.setRange({ startOffset: 1, endOffset: 3 });
domain.stopTransport();
domain.appendTrace({ index: 5 });
assert.deepEqual(trace, [{ index: 5 }]);
assert.deepEqual(calls, [
  ["range", { startOffset: 1, endOffset: 3 }],
  "stop",
]);

const rendererSource = await readFile("src/renderer/renderer.js", "utf8");
assert.doesNotMatch(rendererSource, /function\s+getPlaybackPayload\s*\(/);
assert.doesNotMatch(rendererSource, /function\s+startPlaybackFromRange\s*\(/);
assert.doesNotMatch(rendererSource, /function\s+setPlaybackRange\s*\(/);
assert.doesNotMatch(rendererSource, /function\s+getScopedPlaybackSettingsForOrigin\s*\(/);
assert.doesNotMatch(rendererSource, /buildPlaybackStateModel|snapIstartToPlayableModel/);
assert.doesNotMatch(
  rendererSource,
  /playbackTransport\.[A-Za-z_$][A-Za-z0-9_$]*\s*=/,
);
assert.doesNotMatch(
  rendererSource,
  /from\s+["']\.\/playback\/(?:ab_loop_runtime|ab_marker_extension|ab_selection_playback_controller|drum_preview_controller|focus_mode_controller|follow_highlight_settings|playback_autoscroll_controller|playback_follow_controller|playback_payload_controller|playback_player_controller|playback_prepare_controller|playback_start_controller|playback_transport_controller|playback_transport_state|selection_playback_runtime|soundfont_controller)\.js["']/,
);
assert.doesNotMatch(
  rendererSource,
  /\b(?:playbackTransport|selectionPlaybackRuntime|abLoopRuntime|soundfontController|focusModeController|playbackUiController)\b/,
);
assert.match(rendererSource, /createPlaybackDomain\s*\(/);
assert.match(rendererSource, /playbackDomain\.initialize\s*\(/);

console.log("playback domain harness: all tests passed");
