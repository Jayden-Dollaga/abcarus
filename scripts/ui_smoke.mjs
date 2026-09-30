#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));

const env = { ...process.env };
env.ABCARUS_DEV_UI_SMOKE = "1";
env.ABCARUS_DEV_NO_MAXIMIZE = "1";
if (args.has("--playback")) env.ABCARUS_DEV_PLAYBACK_SMOKE = "1";
const tempUserData = mkdtempSync(path.join(os.tmpdir(), "abcarus-ui-smoke-"));
env.ABCARUS_DEV_USER_DATA = tempUserData;
if (args.has("--payload")) env.ABCARUS_DEV_PAYLOAD_SMOKE = "1";
if (args.has("--close")) env.ABCARUS_DEV_CLOSE_SMOKE = "1";
if (args.has("--transform")) env.ABCARUS_DEV_TRANSFORM_SMOKE = "1";
if (args.has("--transform-keys")) {
  env.ABCARUS_DEV_TRANSFORM_SMOKE = "1";
  env.ABCARUS_DEV_TRANSFORM_KEYS_SMOKE = "1";
}
const scoreSelectionArg = process.argv.slice(2).find((arg) => arg.startsWith("--score-selection="));
if (scoreSelectionArg) {
  const fixturePath = path.resolve(scoreSelectionArg.slice("--score-selection=".length));
  env.ABCARUS_DEV_SCORE_SELECTION_SMOKE = "1";
  env.ABCARUS_DEV_SCORE_SELECTION_SOURCE = Buffer.from(readFileSync(fixturePath, "utf8"), "utf8").toString("base64");
  const rangeArg = process.argv.slice(2).find((arg) => arg.startsWith("--score-selection-range="));
  if (rangeArg) env.ABCARUS_DEV_SCORE_SELECTION_RANGE = rangeArg.slice("--score-selection-range=".length);
  const inspectMsArg = process.argv.slice(2).find((arg) => arg.startsWith("--score-selection-inspect-ms="));
  if (inspectMsArg) env.ABCARUS_DEV_SCORE_SELECTION_INSPECT_MS = inspectMsArg.slice("--score-selection-inspect-ms=".length);
}
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (tempUserData) rmSync(tempUserData, { recursive: true, force: true });
  if (signal) process.exit(1);
  process.exit(Number.isFinite(code) ? code : 1);
});

child.on("error", () => {
  if (tempUserData) rmSync(tempUserData, { recursive: true, force: true });
  process.exit(1);
});
