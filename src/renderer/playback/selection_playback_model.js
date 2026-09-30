function normalizeVoiceIdToken(value) {
  const raw = String(value || "").trim().replace(/^\[+|\]+$/g, "");
  if (!raw) return "";
  const withPrefix = raw.match(/^V\s*:\s*(.+)$/i);
  const token = withPrefix ? withPrefix[1].trim() : raw;
  if (!token) return "";
  const head = token.split(/\s+/)[0];
  return head ? String(head).trim() : "";
}

function parseMutedVoiceSetting(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  raw.split(/[,\s]+/).forEach((part) => {
    const id = normalizeVoiceIdToken(part);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function resolveEffectiveMutedVoiceIds(mutedVoiceIds, firstPlayableVoiceId) {
  const ids = Array.isArray(mutedVoiceIds) ? mutedVoiceIds.map((v) => normalizeVoiceIdToken(v)).filter(Boolean) : [];
  if (!ids.length) return [];
  const firstId = normalizeVoiceIdToken(firstPlayableVoiceId);
  const set = new Set(ids);
  // Project rule: "1" maps to the de-facto first voice when explicit V:1 is missing/malformed.
  if (set.has("1") && firstId) set.add(firstId);
  return Array.from(set);
}

function getFirstPlayableVoiceIdFromTuneRoot(firstSymbol) {
  let s = firstSymbol || null;
  let guard = 0;
  while (s && s.ts_prev && guard < 200000) {
    s = s.ts_prev;
    guard += 1;
  }
  guard = 0;
  while (s && guard < 200000) {
    const pv = s.p_v || null;
    const id = pv && pv.id != null ? String(pv.id) : "";
    const upper = id.toUpperCase();
    if (id && upper !== "_DRUM" && upper !== "_CHORD" && upper !== "_BEATS") return id;
    s = s.ts_next;
    guard += 1;
  }
  return "";
}

function applyMutedVoicesToTuneRoot(firstSymbol, mutedVoiceIds) {
  const mutedSet = new Set(Array.isArray(mutedVoiceIds) ? mutedVoiceIds.map((v) => String(v)) : []);
  if (!firstSymbol || !mutedSet.size) return false;
  let s = firstSymbol;
  let guard = 0;
  while (s && s.ts_prev && guard < 200000) {
    s = s.ts_prev;
    guard += 1;
  }
  let changed = false;
  const touchedVoices = new Set();
  guard = 0;
  while (s && guard < 400000) {
    const pv = s.p_v || null;
    const id = pv && pv.id != null ? String(pv.id) : "";
    if (pv && id && mutedSet.has(id) && !touchedVoices.has(pv)) {
      // Keep symbols intact (for follow/highlight determinism) and mute at MIDI voice level.
      // abc2svg snd engine applies p_v.midictl at voice start via control events.
      if (!Array.isArray(pv.midictl)) pv.midictl = [];
      if (pv.midictl[7] !== 0) {
        pv.midictl[7] = 0; // MIDI CC7 Channel Volume
        changed = true;
      }
      touchedVoices.add(pv);
    }
    s = s.ts_next;
    guard += 1;
  }
  return changed;
}

function hasRepeatTokensInSlice(text, start, end) {
  const src = String(text || "");
  const a = Math.max(0, Math.min(src.length, Number(start) || 0));
  const b = Math.max(0, Math.min(src.length, Number(end) || src.length));
  const slice = src.slice(a, b);
  return /(\|\:|:\||\[\d|\[1|\[2|repeat)/i.test(slice);
}

function focusRangeCrossesRepeats(text, start, end) {
  const src = String(text || "");
  const a = Math.max(0, Math.min(src.length, Number(start) || 0));
  const b = Math.max(0, Math.min(src.length, Number(end) || src.length));
  if (b <= a) return false;
  const slice = src.slice(a, b);
  // Voltas are branch-specific and ambiguous for bounded segment playback without flattening.
  if (/\[\s*\d+/.test(slice)) return true;
  return false;
}

function extendVisibleRangeToRepeatClose(text, start, end) {
  const src = String(text || "");
  const len = src.length;
  const a = Math.max(0, Math.min(len, Number(start) || 0));
  const b = Math.max(a, Math.min(len, Number(end) || len));
  if (b <= a) return b;
  const slice = src.slice(a, b);
  const leftCount = (slice.match(/\|:/g) || []).length;
  const rightCount = (slice.match(/:\|/g) || []).length;
  if (leftCount <= rightCount) return b;
  const closeIdx = src.indexOf(":|", b);
  if (closeIdx < 0) return b;
  // Keep extension local to the nearest close; avoid pulling large unrelated sections.
  if ((closeIdx - b) > 4096) return b;
  return Math.max(b, Math.min(len, closeIdx + 2));
}

function hasIntentionalSelectionPlaybackSpan(text, start, end) {
  const src = String(text || "");
  const a = Math.max(0, Math.min(src.length, Number(start) || 0));
  const b = Math.max(a, Math.min(src.length, Number(end) || 0));
  if (b <= a) return false;
  const slice = src.slice(a, b);
  // Require at least one playable token and at least one barline marker.
  // This avoids accidental tiny selections while still accepting pickups/incomplete bars.
  const hasPlayable = /[A-Ga-gxzZ]/.test(slice);
  const hasBarSpan = /\|/.test(slice);
  return hasPlayable && hasBarSpan;
}

function buildSelectionPlaybackToast(settings) {
  const s = settings || {};
  const voices = Array.isArray(s.mutedVoices) && s.mutedVoices.length
    ? s.mutedVoices.join(",")
    : "none";
  const loop = s.loop ? "on" : "off";
  const repeats = s.suppressRepeats ? "suppressed" : "as-written";
  const chords = s.muteGchords ? "muted" : "on";
  const drums = s.allowMidiDrums ? "on" : "off";
  return `Selection: loop ${loop} | repeats ${repeats} | chords ${chords} | voices ${voices} | drums ${drums}`;
}

// Strip repeat/volta markers inside the given text slice for linear selection playback.
function stripRepeatsForSelection(text) {
  const src = String(text || "");
  const lines = src.split(/\r\n|\n|\r/);
  const out = [];
  let inTextBlock = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^%%\s*begintext\b/i.test(trimmed)) inTextBlock = true;
    if (/^%%\s*endtext\b/i.test(trimmed)) inTextBlock = false;
    if (inTextBlock) {
      out.push(rawLine);
      continue;
    }
    let line = rawLine;
    // Replace repeat starts/ends and voltas while keeping source length stable.
    // Voltas ([1/[2/...) are annotations, not standalone barlines; injecting an extra "|"
    // here can create phantom bar boundaries and shift scoped end behavior.
    line = line.replace(/\|\s*:\s*/g, (m) => `|${" ".repeat(Math.max(0, String(m || "").length - 1))}`);
    line = line.replace(/:\s*\|\s*/g, (m) => `|${" ".repeat(Math.max(0, String(m || "").length - 1))}`);
    line = line.replace(/:\s*\|:\s*/g, (m) => `|${" ".repeat(Math.max(0, String(m || "").length - 1))}`);
    line = line.replace(/\[\s*\d+/g, (m) => " ".repeat(String(m || "").length));
    line = line.replace(/:{2,}/g, (m) => `|${" ".repeat(Math.max(0, String(m || "").length - 1))}`);
    // Only treat D.C./D.S. as playback directives when explicitly marked as decorations (e.g. !D.C.!).
    // Bare "DC" can be a real note sequence and must be preserved.
    line = line.replace(/!D\.?C\.?!/gi, (m) => " ".repeat(String(m || "").length));
    line = line.replace(/!D\.?S\.?!/gi, (m) => " ".repeat(String(m || "").length));
    line = line.replace(/\bCoda\b/gi, (m) => " ".repeat(String(m || "").length));
    line = line.replace(/\bFine\b/gi, (m) => " ".repeat(String(m || "").length));
    out.push(line);
  }
  return out.join("\n");
}

function stripRepeatsLengthSafe(text) {
  return stripRepeatsForSelection(text);
}

function stripQuotedAndCommentText(line) {
  let out = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
      out += " ";
      continue;
    }
    if (!quoted && ch === "%") {
      out += " ".repeat(line.length - i);
      break;
    }
    out += quoted ? " " : ch;
  }
  return out;
}

function isWholeTuneMusicRange(text, start, end) {
  const src = String(text || "");
  const a = Math.max(0, Math.min(src.length, Number(start) || 0));
  const b = Math.max(a, Math.min(src.length, Number(end) || 0));
  let inBody = false;
  let first = null;
  let last = null;
  let offset = 0;
  for (const line of src.split(/\r\n|\n|\r/)) {
    const raw = String(line || "");
    const trimmed = raw.trim();
    if (!inBody && /^\s*K\s*:/i.test(raw)) {
      inBody = true;
      offset += raw.length + 1;
      continue;
    }
    if (!inBody || !trimmed || /^\s*(?:%%|[A-Za-z]:|\[[A-Za-z]+:)/.test(raw)) {
      offset += raw.length + 1;
      continue;
    }
    const code = stripQuotedAndCommentText(raw);
    for (let i = 0; i < code.length; i += 1) {
      if (!/[A-Ga-gxzZ]/.test(code[i])) continue;
      const pos = offset + i;
      if (first == null) first = pos;
      last = pos + 1;
    }
    offset += raw.length + 1;
  }
  return first != null && last != null && a <= first && b >= last;
}

function normalizeSelectionRepeatsLengthSafe(text) {
  const src = String(text || "");
  const chars = src.split("");
  const tokens = [];
  let quoted = false;
  for (let i = 0; i < src.length - 1; i += 1) {
    const ch = src[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (ch === "%") {
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i += 1;
      quoted = false;
      continue;
    }
    const pair = src.slice(i, i + 2);
    if (pair === "|:" || pair === ":|") {
      tokens.push({ index: i, type: pair });
      i += 1;
    }
  }
  const stack = [];
  const paired = new Set();
  const pairedRanges = [];
  const isTrailingSecondEnding = (token) => {
    if (!token || token.type !== ":|") return false;
    const tail = src.slice(token.index + 2);
    const marker = tail.match(/^\s*2/);
    if (!marker) return false;
    return tail.slice(marker[0].length)
      .replace(/%[^\r\n]*/g, "")
      .replace(/\$/g, "")
      .trim() === "";
  };
  for (const token of tokens) {
    if (token.type === "|:") {
      stack.push(token);
    } else if (stack.length) {
      const opening = stack.pop();
      // `:|2` starts a second ending. When it is the final token in the
      // selection, that ending's music lies outside the range, so the repeat
      // structure is incomplete and must be played linearly.
      if (isTrailingSecondEnding(token)) continue;
      paired.add(opening.index);
      paired.add(token.index);
      pairedRanges.push({ start: opening.index, end: token.index + 2 });
    }
  }
  for (const token of tokens) {
    if (paired.has(token.index)) continue;
    if (token.type === "|:") chars[token.index + 1] = " ";
    else chars[token.index] = " ";
  }
  const linear = chars.join("");
  return linear.replace(/(\[\s*\d+|\|\s*\d+)/g, (match, _capture, index) => {
    if (pairedRanges.some((range) => index >= range.start && index < range.end)) return match;
    const bar = match.indexOf("|");
    return bar >= 0
      ? `${" ".repeat(bar)}|${" ".repeat(match.length - bar - 1)}`
      : " ".repeat(match.length);
  });
}

function hasOpeningRepeatBeforeSelection(text, start) {
  const src = String(text || "");
  const end = Math.max(0, Math.min(src.length, Number(start) || 0));
  const windowStart = Math.max(0, end - 1024);
  const before = src.slice(windowStart, end);
  const tokenRe = /\|:|::/g;
  let candidate = null;
  for (let match = tokenRe.exec(before); match; match = tokenRe.exec(before)) candidate = match;
  if (!candidate) return false;
  const tail = before.slice(candidate.index + candidate[0].length)
    .replace(/%[^\r\n]*/g, "")
    .replace(/^\s*\[?\s*P\s*:.*$/gim, "")
    .replace(/\$/g, "")
    .trim();
  return tail === "";
}

function buildIsolatedSelectionPlaybackText(text, start, end) {
  const src = String(text || "");
  const a = Math.max(0, Math.min(src.length, Number(start) || 0));
  const b = Math.max(a, Math.min(src.length, Number(end) || 0));
  const lines = src.split(/\r\n|\n|\r/);
  const header = [];
  const context = [];
  let offset = 0;
  let bodyStarted = false;
  for (const line of lines) {
    const raw = String(line || "");
    const lineEnd = offset + raw.length;
    const isPart = /^\s*P\s*:/i.test(raw) || /^\s*\[\s*P\s*:/i.test(raw);
    const isContext = /^\s*(?:%%|[KMLQVI]:)/i.test(raw) || /^\s*\[\s*(?:K|M|L|Q|V|I)\s*:/i.test(raw);
    if (!bodyStarted) {
      if (!isPart) header.push(raw);
      if (/^\s*K\s*:/i.test(raw)) bodyStarted = true;
    } else if (lineEnd <= a && isContext && !isPart) {
      context.push(raw);
    }
    offset = lineEnd + 1;
  }
  const headerPrefix = `${header.join("\n")}\n${context.length ? `${context.join("\n")}\n` : ""}`;
  const bodyPrefix = hasOpeningRepeatBeforeSelection(src, a) ? "|: " : "| ";
  const selection = normalizeSelectionRepeatsLengthSafe(`${bodyPrefix}${src.slice(a, b)}`);
  return {
    text: `${headerPrefix}${selection}\n`,
    offset: headerPrefix.length + bodyPrefix.length - a,
  };
}

function stripGchordDirectives(text) {
  return String(text || "").replace(/^\s*%%\s*MIDI\s+gchord[^\r\n]*$/gim, "");
}

export {
  applyMutedVoicesToTuneRoot,
  buildSelectionPlaybackToast,
  buildIsolatedSelectionPlaybackText,
  extendVisibleRangeToRepeatClose,
  focusRangeCrossesRepeats,
  getFirstPlayableVoiceIdFromTuneRoot,
  hasIntentionalSelectionPlaybackSpan,
  hasOpeningRepeatBeforeSelection,
  hasRepeatTokensInSlice,
  isWholeTuneMusicRange,
  normalizeSelectionRepeatsLengthSafe,
  normalizeVoiceIdToken,
  parseMutedVoiceSetting,
  resolveEffectiveMutedVoiceIds,
  stripGchordDirectives,
  stripRepeatsForSelection,
  stripRepeatsLengthSafe,
};
