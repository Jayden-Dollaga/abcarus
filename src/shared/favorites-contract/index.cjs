"use strict";

const FAVORITES_CONTRACT_VERSION = "abcarus.favorites.v1";
const SET_LIST_SCHEMA = "abcarus.setlist.v2";
const FAVORITES_ID = "favorites";
const FAVORITE_MEMBERSHIPS = "favoriteMemberships";

function parseTime(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function isFavoritesDocument(document) {
  return Boolean(document && (String(document.id || "") === FAVORITES_ID || document.kind === "favorites"));
}

function normalizedFavoriteText(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function favoriteTuneKey(tune) {
  const snapshot = tune && typeof tune === "object" ? tune : {};
  const hash = String(snapshot.contentHash || "").trim().toLowerCase();
  if (/^sha256:[0-9a-f]{64}$/.test(hash)) return hash;
  const source = snapshot.source && typeof snapshot.source === "object" ? snapshot.source : {};
  const locator = normalizedFavoriteText(source.locatorHint || source.tuneIdHint);
  if (locator) return `locator:${locator}`;
  const pathHint = String(source.pathHint || snapshot.sourcePath || "").replace(/\\/g, "/");
  const basename = pathHint.split("/").pop() || "";
  return [
    `tune:${normalizedFavoriteText(basename)}`,
    normalizedFavoriteText(source.xNumberHint || snapshot.xNumber),
    normalizedFavoriteText(snapshot.title),
    normalizedFavoriteText(snapshot.composer),
  ].join("|");
}

function favoriteRecordWins(candidate, current) {
  const candidateTime = parseTime(candidate && candidate.changedAt);
  const currentTime = parseTime(current && current.changedAt);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  if (candidate.present !== current.present) return candidate.present !== true;
  return String(candidate.itemId).localeCompare(String(current.itemId)) > 0;
}

function favoriteMemberships(document) {
  const fallbackChangedAt = String(document && document.updatedAt || "");
  const records = new Map();
  for (const raw of Array.isArray(document && document[FAVORITE_MEMBERSHIPS]) ? document[FAVORITE_MEMBERSHIPS] : []) {
    const itemId = String(raw && raw.itemId || "").trim();
    const tuneKey = String(raw && raw.tuneKey || "").trim();
    const changedAt = String(raw && raw.changedAt || "").trim();
    if (!itemId || !tuneKey || !parseTime(changedAt)) continue;
    const candidate = { itemId, tuneKey, present: raw.present === true, changedAt };
    const current = records.get(itemId);
    if (!current || favoriteRecordWins(candidate, current)) records.set(itemId, candidate);
  }
  for (const item of Array.isArray(document && document.items) ? document.items : []) {
    const itemId = String(item && item.id || "").trim();
    if (!itemId || records.has(itemId)) continue;
    records.set(itemId, {
      itemId,
      tuneKey: favoriteTuneKey(item && item.tune),
      present: true,
      changedAt: fallbackChangedAt,
    });
  }
  return records;
}

function mergeFavoriteDocuments(left, right) {
  if (!isFavoritesDocument(left)) return structuredClone(right);
  if (!isFavoritesDocument(right)) return structuredClone(left);
  const leftTime = parseTime(left.updatedAt);
  const rightTime = parseTime(right.updatedAt);
  const preferred = rightTime > leftTime ? right : left;
  const secondary = preferred === left ? right : left;
  const records = favoriteMemberships(left);
  for (const [itemId, candidate] of favoriteMemberships(right)) {
    const current = records.get(itemId);
    if (!current || favoriteRecordWins(candidate, current)) records.set(itemId, candidate);
  }

  const items = new Map();
  for (const document of [secondary, preferred]) {
    for (const item of Array.isArray(document.items) ? document.items : []) {
      const id = String(item && item.id || "");
      if (id) items.set(id, structuredClone(item));
    }
  }
  const winnerByTune = new Map();
  for (const record of records.values()) {
    const current = winnerByTune.get(record.tuneKey);
    if (!current || favoriteRecordWins(record, current)) winnerByTune.set(record.tuneKey, record);
  }
  const activeItems = [];
  const appended = new Set();
  for (const document of [preferred, secondary]) {
    for (const item of Array.isArray(document.items) ? document.items : []) {
      const id = String(item && item.id || "");
      const record = records.get(id);
      if (!record || !record.present || appended.has(id) || winnerByTune.get(record.tuneKey) !== record) continue;
      const stored = items.get(id);
      if (!stored) continue;
      activeItems.push(stored);
      appended.add(id);
    }
  }
  return {
    ...structuredClone(preferred),
    schema: SET_LIST_SCHEMA,
    id: FAVORITES_ID,
    title: "Favorites",
    kind: "favorites",
    updatedAt: leftTime >= rightTime ? left.updatedAt : right.updatedAt,
    items: activeItems,
    [FAVORITE_MEMBERSHIPS]: Array.from(records.values(), (record) => structuredClone(record)),
  };
}

module.exports = {
  FAVORITES_CONTRACT_VERSION,
  FAVORITES_ID,
  FAVORITE_MEMBERSHIPS,
  favoriteMemberships,
  favoriteRecordWins,
  favoriteTuneKey,
  isFavoritesDocument,
  mergeFavoriteDocuments,
  normalizedFavoriteText,
  parseTime,
};
