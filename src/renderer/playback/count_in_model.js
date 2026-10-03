const MAX_COUNT_IN_MEASURES = 8;

function clampCountInMeasures(value, fallback = 0) {
  const parsed = Number(value);
  const base = Number.isFinite(parsed) ? parsed : Number(fallback);
  return Math.max(0, Math.min(MAX_COUNT_IN_MEASURES, Math.round(Number.isFinite(base) ? base : 0)));
}

function parseFraction(value, fallback) {
  const match = String(value || "").trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match || Number(match[2]) === 0) return fallback;
  return Number(match[1]) / Number(match[2]);
}

function estimateMeasureSeconds(abcText = "", playbackState = null) {
  const measures = playbackState && Array.isArray(playbackState.measures) ? playbackState.measures : [];
  if (measures.length > 1) {
    const first = Number(measures[0] && measures[0].symbol && measures[0].symbol.time);
    const second = Number(measures[1] && measures[1].symbol && measures[1].symbol.time);
    if (Number.isFinite(first) && Number.isFinite(second) && second > first && second - first < 120) return second - first;
  }
  const text = String(abcText || "");
  const meter = (text.match(/^M:\s*([^\s%]+)/m) || [])[1];
  const tempo = (text.match(/^Q:\s*(.*)$/m) || [])[1] || "";
  const meterBeats = parseFraction(meter, 1);
  const tempoMatch = tempo.match(/(?:(\d+)\s*\/\s*(\d+)\s*=\s*)?(\d+(?:\.\d+)?)/);
  const tempoUnit = tempoMatch && tempoMatch[1] ? Number(tempoMatch[1]) / Number(tempoMatch[2]) : 0.25;
  const bpm = tempoMatch ? Number(tempoMatch[3]) : 120;
  if (!Number.isFinite(tempoUnit) || !Number.isFinite(bpm) || bpm <= 0) return 2;
  return Math.max(0.05, (meterBeats / tempoUnit) * 60 / bpm);
}

function getCountInDelayMs({ measures = 0, abcText = "", playbackState = null, speed = 1 } = {}) {
  const count = clampCountInMeasures(measures);
  if (!count) return 0;
  const rate = Number(speed);
  return Math.round(count * estimateMeasureSeconds(abcText, playbackState) * 1000 / (Number.isFinite(rate) && rate > 0 ? rate : 1));
}

function getCountInPlan({ measures = 0, abcText = "", playbackState = null, speed = 1 } = {}) {
  const requestedCount = clampCountInMeasures(measures);
  const measureSeconds = estimateMeasureSeconds(abcText, playbackState);
  const meterMatch = String(abcText || "").match(/^M:\s*(\d+)\s*\/\s*(\d+)/m);
  const beatsPerMeasure = meterMatch ? Math.max(1, Number(meterMatch[1])) : 4;
  const rate = Number(speed);
  const playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const beatSeconds = measureSeconds / beatsPerMeasure / playbackRate;
  const hasMidiDrum = /(?:^|\n)\s*%%\s*MIDI\s+drum(?:on|off|bars|map)?\b/im.test(String(abcText || ""));
  const drumBarsMatch = String(abcText || "").match(/(?:^|\n)\s*%%\s*MIDI\s+drumbars\s+(\d+)/im);
  const drumBars = drumBarsMatch ? Math.max(1, Math.min(MAX_COUNT_IN_MEASURES, Number(drumBarsMatch[1]))) : 0;
  const count = requestedCount && hasMidiDrum ? Math.max(requestedCount, drumBars) : requestedCount;
  return {
    count,
    beatsPerMeasure,
    beatSeconds,
    delayMs: Math.round(count * measureSeconds * 1000 / playbackRate),
    hasMidiDrum,
    drumBars,
  };
}

export { MAX_COUNT_IN_MEASURES, clampCountInMeasures, estimateMeasureSeconds, getCountInDelayMs, getCountInPlan };
