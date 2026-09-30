import {
  favoriteTuneKey,
  normalizeSetListDocument,
} from "../tools/set_list/set_list_document.js";

const FAVORITES_ID = "favorites";

function createEmptyFavoritesDocument(nowIso) {
  const timestamp = nowIso();
  return {
    schema: "abcarus.setlist.v2",
    id: FAVORITES_ID,
    title: "Favorites",
    kind: "favorites",
    createdAt: timestamp,
    updatedAt: timestamp,
    print: {
      headerText: "",
      pageBreaks: "perTune",
      compact: false,
      titlePage: false,
      tuneIndex: "none",
      numberTunes: false,
      indexQrCodes: false,
    },
    items: [],
    favoriteMemberships: [],
  };
}

function nextTimestamp(document, now = Date.now()) {
  let latest = Date.parse(String(document && document.updatedAt || "")) || 0;
  for (const record of Array.isArray(document && document.favoriteMemberships)
    ? document.favoriteMemberships
    : []) {
    latest = Math.max(latest, Date.parse(String(record && record.changedAt || "")) || 0);
  }
  return new Date(Math.max(Number(now) || 0, latest + 1)).toISOString();
}

function filterLibraryFilesByTuneIds(libraryIndex, tuneIds) {
  const ids = tuneIds instanceof Set ? tuneIds : new Set(tuneIds || []);
  const files = libraryIndex && Array.isArray(libraryIndex.files) ? libraryIndex.files : [];
  return files.map((file) => ({
    ...file,
    tunes: (Array.isArray(file && file.tunes) ? file.tunes : []).filter((tune) => (
      ids.has(String(tune && tune.id || "")) || ids.has(String(tune && tune.tuneUid || ""))
    )),
  })).filter((file) => file.tunes.length > 0);
}

function createLibraryFavoritesController({
  button = null,
  getLibraryIndex = () => null,
  listSetLists = async () => ({ ok: false, entries: [] }),
  publishSetList = async () => ({ ok: false }),
  buildDocumentItem = async () => null,
  resolveItemSource = async () => ({ candidate: null }),
  setLibraryFilter = () => {},
  clearLibraryFilter = () => {},
  onFavoritesChanged = () => {},
  showToast = () => {},
  logError = () => {},
  makeId = () => globalThis.crypto.randomUUID(),
  now = () => Date.now(),
} = {}) {
  let document = null;
  let filePath = "";
  let filterActive = false;
  let resolvedTuneIds = new Set();
  let itemIdsByTuneId = new Map();
  let operation = Promise.resolve();
  let refreshScheduled = false;

  function nowIso() {
    return new Date(now()).toISOString();
  }

  function updateButton() {
    if (!button) return;
    button.classList.toggle("toggle-active", filterActive);
    button.setAttribute("aria-pressed", filterActive ? "true" : "false");
    const count = resolvedTuneIds.size;
    button.title = filterActive
      ? `Showing ${count} favorite ${count === 1 ? "tune" : "tunes"}. Click to show the full Library.`
      : `Show Favorites (${count})`;
    button.setAttribute("aria-label", filterActive ? "Show full Library" : "Show Favorites");
  }

  async function resolveDocumentItems() {
    const ids = new Set();
    const itemIds = new Map();
    for (const item of Array.isArray(document && document.items) ? document.items : []) {
      try {
        const resolution = await resolveItemSource(item);
        const tuneId = String(resolution && resolution.candidate && resolution.candidate.tuneId || "");
        if (!tuneId) continue;
        ids.add(tuneId);
        const matches = itemIds.get(tuneId) || [];
        matches.push(String(item.id || ""));
        itemIds.set(tuneId, matches);
      } catch (error) {
        logError(error);
      }
    }
    resolvedTuneIds = ids;
    itemIdsByTuneId = itemIds;
  }

  function applyFilter() {
    if (!filterActive) return;
    const files = filterLibraryFilesByTuneIds(getLibraryIndex(), resolvedTuneIds);
    setLibraryFilter(files, `Favorites (${resolvedTuneIds.size})`);
  }

  async function refresh({ applyActiveFilter = true } = {}) {
    const result = await listSetLists();
    if (!result || !result.ok) {
      throw new Error(result && result.error ? result.error : "Unable to load Favorites.");
    }
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const entry = entries.find((candidate) => (
      candidate && candidate.document && String(candidate.document.id || "") === FAVORITES_ID
    ));
    document = entry
      ? normalizeSetListDocument(entry.document, { makeId, nowIso })
      : createEmptyFavoritesDocument(nowIso);
    filePath = entry ? String(entry.filePath || "") : "";
    await resolveDocumentItems();
    if (applyActiveFilter && filterActive) applyFilter();
    else onFavoritesChanged();
    updateButton();
    return document;
  }

  async function publish(nextDocument) {
    const normalized = normalizeSetListDocument(nextDocument, { makeId, nowIso });
    const result = await publishSetList(normalized, filePath);
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "Unable to update Favorites.");
    document = normalizeSetListDocument(result.document || normalized, { makeId, nowIso });
    filePath = String(result.filePath || filePath || "");
    await resolveDocumentItems();
    if (filterActive) applyFilter();
    else onFavoritesChanged();
    updateButton();
  }

  function isTuneFavorite(tuneId) {
    return resolvedTuneIds.has(String(tuneId || ""));
  }

  async function toggleTune(tuneId) {
    const id = String(tuneId || "");
    if (!id) return false;
    operation = operation.then(async () => {
      await refresh({ applyActiveFilter: false });
      const timestamp = nextTimestamp(document, now());
      const next = structuredClone(document);
      const existingItemIds = itemIdsByTuneId.get(id) || [];
      if (existingItemIds.length) {
        const removedIds = new Set(existingItemIds);
        next.items = next.items.filter((item) => !removedIds.has(String(item && item.id || "")));
        for (const record of next.favoriteMemberships) {
          if (!removedIds.has(String(record && record.itemId || ""))) continue;
          record.present = false;
          record.changedAt = timestamp;
        }
        next.updatedAt = timestamp;
        await publish(next);
        showToast("Removed from Favorites.", 2200);
        return false;
      }

      const item = await buildDocumentItem(id);
      if (!item) return false;
      next.items.push(item);
      next.favoriteMemberships.push({
        itemId: item.id,
        tuneKey: favoriteTuneKey(item.tune),
        present: true,
        changedAt: timestamp,
      });
      next.updatedAt = timestamp;
      await publish(next);
      showToast("Added to Favorites.", 2200);
      return true;
    }).catch((error) => {
      logError(error);
      showToast(error && error.message ? error.message : String(error), 5000);
      return false;
    });
    return operation;
  }

  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      refresh().catch(logError);
    });
  }

  async function toggleFilter() {
    if (filterActive) {
      filterActive = false;
      clearLibraryFilter();
      updateButton();
      return false;
    }
    filterActive = true;
    try {
      await refresh();
      return true;
    } catch (error) {
      filterActive = false;
      updateButton();
      throw error;
    }
  }

  function handleExternalFilterClear() {
    if (!filterActive) return;
    filterActive = false;
    updateButton();
  }

  function wire() {
    if (button) button.addEventListener("click", () => { toggleFilter().catch(logError); });
  }

  return {
    handleExternalFilterClear,
    isFilterActive: () => filterActive,
    isTuneFavorite,
    refresh,
    scheduleRefresh,
    toggleFilter,
    toggleTune,
    wire,
  };
}

export {
  createEmptyFavoritesDocument,
  createLibraryFavoritesController,
  filterLibraryFilesByTuneIds,
  nextTimestamp,
};
