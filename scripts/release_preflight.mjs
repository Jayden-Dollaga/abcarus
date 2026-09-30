import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Failed (${result.status}): ${command} ${args.join(" ")}`);
}

const profilePath = mkdtempSync(path.join(os.tmpdir(), "abcarus-release-preflight-"));
const smokeEnv = { ...process.env, ABCARUS_DEV_USER_DATA: profilePath };
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  run(npmCommand, ["run", "-s", "test:quick"]);
  run(npmCommand, ["audit", "--omit=dev", "--audit-level=high"]);
  run(npmCommand, ["run", "-s", "thirdparty:review"]);
  run(npmCommand, ["run", "-s", "pbs:check"]);
  for (const script of ["test:ui-smoke", "test:ui-playback-smoke", "test:ui-payload-smoke", "test:ui-transform-keys-smoke", "test:ui-score-selection-smoke"]) {
    run(npmCommand, ["run", "-s", script], { env: smokeEnv });
  }
  console.log("Release preflight passed.");
} finally {
  rmSync(profilePath, { recursive: true, force: true });
}
