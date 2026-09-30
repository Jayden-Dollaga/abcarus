function normalizeMeasureNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : null;
}

function advanceFocusScoreSelection({ fromMeasure, toMeasure, awaitingEnd }, measureNumber) {
  const measure = normalizeMeasureNumber(measureNumber);
  if (measure == null) return null;
  const from = normalizeMeasureNumber(fromMeasure);
  const to = normalizeMeasureNumber(toMeasure);
  if (!awaitingEnd || from == null || to == null) {
    return { fromMeasure: measure, toMeasure: measure, awaitingEnd: true };
  }
  return {
    fromMeasure: Math.min(from, measure),
    toMeasure: Math.max(from, measure),
    awaitingEnd: false,
  };
}

function normalizeRenderMeasure(measure) {
  const start = Number(measure && measure.playStart);
  const end = Number(measure && measure.playEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { playStart: start, playEnd: end };
}

function advanceScoreRenderSelection(current, measure) {
  const next = normalizeRenderMeasure(measure);
  if (!next) return null;
  const previous = current && current.awaitingEnd ? normalizeRenderMeasure(current) : null;
  if (!previous) return { ...next, awaitingEnd: true };
  return {
    playStart: Math.min(previous.playStart, next.playStart),
    playEnd: Math.max(previous.playEnd, next.playEnd),
    awaitingEnd: false,
  };
}

function applyScoreRenderSelectionToFocusPlan(result, selection, mapRenderOffset, tuneLength) {
  if (!result || !result.ok || !result.plan) return result;
  const normalized = normalizeRenderMeasure(selection);
  if (!normalized || typeof mapRenderOffset !== "function") return result;
  const startOffset = Number(mapRenderOffset(normalized.playStart));
  const endOffset = Number(mapRenderOffset(normalized.playEnd));
  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) return result;
  const max = Math.max(0, Number.isFinite(Number(tuneLength)) ? Number(tuneLength) : endOffset);
  return {
    ...result,
    plan: {
      ...result.plan,
      startOffset: Math.max(0, Math.min(max, Math.floor(startOffset))),
      endOffset: Math.max(0, Math.min(max, Math.ceil(endOffset))),
    },
  };
}

function resolveFocusMeasureNumberAtRenderOffset(measureIndex, renderOffset) {
  const target = Number(renderOffset);
  if (!measureIndex || !Number.isFinite(target)) return null;
  const byNumber = measureIndex.byNumber;
  let best = null;
  let first = null;
  if (byNumber && typeof byNumber.entries === "function") {
    for (const [rawNumber, rawStarts] of byNumber.entries()) {
      const number = normalizeMeasureNumber(rawNumber);
      if (number == null || !Array.isArray(rawStarts)) continue;
      for (const rawStart of rawStarts) {
        const start = Number(rawStart);
        if (!Number.isFinite(start)) continue;
        if (!first || start < first.start) first = { number, start };
        if (start <= target && (!best || start > best.start)) best = { number, start };
      }
    }
  }
  if (best) return best.number;
  if (first) return first.number;

  const starts = Array.isArray(measureIndex.istarts)
    ? Array.from(new Set(measureIndex.istarts.map(Number).filter(Number.isFinite))).sort((a, b) => a - b)
    : [];
  if (starts.length) {
    const firstAfter = starts.findIndex((start) => start > target);
    let index = firstAfter < 0 ? starts.length - 1 : firstAfter - 1;
    if (index < 0) index = 0;
    const anchor = Number.isInteger(measureIndex.anchor) ? measureIndex.anchor : 0;
    return Math.max(1, index - anchor + 1);
  }

  return null;
}

export {
  advanceFocusScoreSelection,
  advanceScoreRenderSelection,
  applyScoreRenderSelectionToFocusPlan,
  resolveFocusMeasureNumberAtRenderOffset,
};
