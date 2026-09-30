function createScoreMeasureSelectionController({
  documentRef = typeof document !== "undefined" ? document : null,
  outputElement = null,
  resolveMeasureNumber = () => null,
  getSelectedBounds = () => null,
  getSelectedRenderBounds = () => null,
} = {}) {
  let measures = [];
  let highlightElements = [];

  function numberAttr(element, name) {
    const value = Number(element && element.getAttribute ? element.getAttribute(name) : NaN);
    return Number.isFinite(value) ? value : null;
  }

  function sameStaff(aY, aHeight, bY, bHeight) {
    const overlap = Math.min(aY + aHeight, bY + bHeight) - Math.max(aY, bY);
    return overlap > Math.min(aHeight, bHeight) * 0.35;
  }

  function buildMeasureForNote(noteElement) {
    const svg = noteElement && noteElement.ownerSVGElement;
    if (!svg) return null;
    const noteX = numberAttr(noteElement, "x");
    const noteY = numberAttr(noteElement, "y");
    const noteHeight = numberAttr(noteElement, "height");
    const noteWidth = numberAttr(noteElement, "width") || 0;
    const noteStart = numberAttr(noteElement, "data-start");
    const noteEnd = numberAttr(noteElement, "data-end");
    if (noteX == null || noteY == null || noteHeight == null || noteStart == null) return null;

    const centerX = noteX + (noteWidth * 0.5);
    let leftX = null;
    let rightX = null;
    let rightPlayEnd = null;
    let staffY = noteY;
    let staffHeight = noteHeight;
    for (const bar of svg.querySelectorAll(".bar-hl")) {
      const barXRaw = numberAttr(bar, "x");
      const barY = numberAttr(bar, "y");
      const barHeight = numberAttr(bar, "height");
      const barWidth = numberAttr(bar, "width") || 0;
      if (barXRaw == null || barY == null || barHeight == null) continue;
      if (!sameStaff(noteY, noteHeight, barY, barHeight)) continue;
      const barX = barXRaw + (barWidth * 0.5);
      if (barX <= centerX && (leftX == null || barX > leftX)) {
        leftX = barX;
        staffY = barY;
        staffHeight = barHeight;
      } else if (barX > centerX && (rightX == null || barX < rightX)) {
        rightX = barX;
        rightPlayEnd = numberAttr(bar, "data-end");
        staffY = barY;
        staffHeight = barHeight;
      }
    }
    if (leftX == null) leftX = Math.max(0, noteX - 34);
    if (rightX == null) rightX = noteX + noteWidth + 72;
    return {
      svg,
      playStart: noteStart,
      playEnd: Math.max(noteStart, rightPlayEnd == null ? (noteEnd == null ? noteStart : noteEnd) : rightPlayEnd),
      x: Math.max(0, leftX),
      y: Math.max(0, staffY),
      width: Math.max(2, rightX - leftX),
      height: Math.max(1, staffHeight),
    };
  }

  function rebuildIndex() {
    if (!outputElement) {
      measures = [];
      return;
    }
    const svgElements = Array.from(outputElement.querySelectorAll("svg"));
    const byKey = new Map();
    for (const note of outputElement.querySelectorAll(".note-hl[data-start]")) {
      const measure = buildMeasureForNote(note);
      if (!measure) continue;
      const svgIndex = svgElements.indexOf(measure.svg);
      const key = `${svgIndex}:${Math.round(measure.y)}:${Math.round(measure.x)}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.playStart = Math.min(existing.playStart, measure.playStart);
        existing.playEnd = Math.max(existing.playEnd, measure.playEnd);
        const right = Math.max(existing.x + existing.width, measure.x + measure.width);
        existing.x = Math.min(existing.x, measure.x);
        existing.width = right - existing.x;
      } else {
        byKey.set(key, measure);
      }
    }
    measures = Array.from(byKey.values()).sort((a, b) => a.playStart - b.playStart);
  }

  function measureAtPoint(clientX, clientY, target = null) {
    if (target && target.classList && target.classList.contains("note-hl")) {
      const direct = buildMeasureForNote(target);
      if (direct) {
        if (!measures.length) rebuildIndex();
        const indexed = measures.find((measure) => (
          measure.svg === direct.svg
          && sameStaff(measure.y, measure.height, direct.y, direct.height)
          && Math.abs(measure.x - direct.x) < 1
        ));
        return indexed || direct;
      }
    }
    for (const measure of measures) {
      const rect = measure.svg.getBoundingClientRect();
      const viewBox = measure.svg.viewBox && measure.svg.viewBox.baseVal;
      if (!viewBox || !viewBox.width || !viewBox.height) continue;
      const scaleX = rect.width / viewBox.width;
      const scaleY = rect.height / viewBox.height;
      const left = rect.left + (measure.x * scaleX);
      const right = left + (measure.width * scaleX);
      const top = rect.top + (measure.y * scaleY);
      const bottom = top + (measure.height * scaleY);
      if (clientX >= left && clientX <= right && clientY >= top && clientY <= bottom) return measure;
    }
    return null;
  }

  function clearHighlight() {
    for (const element of highlightElements) {
      try { element.remove(); } catch {}
    }
    highlightElements = [];
  }

  function renderHighlight() {
    clearHighlight();
    if (!documentRef) return false;
    const bounds = getSelectedBounds();
    const renderBounds = getSelectedRenderBounds();
    const renderStart = Number(renderBounds && renderBounds.playStart);
    const renderEnd = Number(renderBounds && renderBounds.playEnd);
    const hasRenderBounds = Number.isFinite(renderStart) && Number.isFinite(renderEnd) && renderEnd >= renderStart;
    const from = Number(bounds && bounds.fromMeasure);
    const to = Number(bounds && bounds.toMeasure);
    if (!hasRenderBounds && (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from)) return false;
    if (!measures.length) rebuildIndex();
    const rows = [];
    for (const measure of measures) {
      if (hasRenderBounds) {
        if (measure.playEnd <= renderStart || measure.playStart >= renderEnd) continue;
      } else {
        const number = resolveMeasureNumber(measure.playStart);
        if (!Number.isInteger(number) || number < from || number > to) continue;
      }
      let row = rows.find((candidate) => (
        candidate.svg === measure.svg
        && sameStaff(candidate.y, candidate.height, measure.y, measure.height)
      ));
      if (!row) {
        row = {
          svg: measure.svg,
          x: measure.x,
          right: measure.x + measure.width,
          y: measure.y,
          height: measure.height,
        };
        rows.push(row);
      } else {
        row.x = Math.min(row.x, measure.x);
        row.right = Math.max(row.right, measure.x + measure.width);
        const top = Math.min(row.y, measure.y);
        const bottom = Math.max(row.y + row.height, measure.y + measure.height);
        row.y = top;
        row.height = bottom - top;
      }
    }
    for (const row of rows) {
      const rect = documentRef.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("class", "svg-focus-selection");
      rect.setAttribute("x", String(row.x));
      rect.setAttribute("y", String(row.y));
      rect.setAttribute("width", String(Math.max(1, row.right - row.x)));
      rect.setAttribute("height", String(row.height));
      rect.setAttribute("pointer-events", "none");
      try { row.svg.insertBefore(rect, row.svg.firstChild || null); } catch { row.svg.appendChild(rect); }
      highlightElements.push(rect);
    }
    return highlightElements.length > 0;
  }

  function handleScoreRendered() {
    clearHighlight();
    rebuildIndex();
    renderHighlight();
  }

  return {
    clearHighlight,
    handleScoreRendered,
    measureAtPoint,
    rebuildIndex,
    renderHighlight,
  };
}

export { createScoreMeasureSelectionController };
