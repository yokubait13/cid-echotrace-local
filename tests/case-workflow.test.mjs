import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { seedCaseFixture } from "./case-fixture.mjs";

const serverUrl = new URL("../server.mjs", import.meta.url).href;
async function launch(root) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `const {startServer}=await import(${JSON.stringify(serverUrl)}); await startServer({port:0});`], { env: { ...process.env, ECHOSCRIBE_DATA_DIR: root, ECHOSCRIBE_ENGINE_DIR: path.join(root, "missing-test-engine"), ECHOSCRIBE_MODEL_DIR: path.join(root, "missing-test-model") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(output || "Server startup timed out")); }, 10000);
    child.stdout.on("data", (chunk) => { output += chunk; const match = output.match(/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}
async function stop(child) { if (child.exitCode !== null) return; await new Promise((resolve) => { child.once("exit", resolve); child.kill(); }); }

test("case management, saved corrections, exports, source preservation, and restart recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "echotrace-case-test-"));
  const { sourcePath } = await seedCaseFixture(root);
  const hash = async () => createHash("sha256").update(await fs.readFile(sourcePath)).digest("hex");
  const originalHash = await hash();
  let service = await launch(root);
  const api = async (route, method = "GET", payload) => {
    const response = await fetch(`${service.url}${route}`, { method, ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    let list = await api("/api/jobs");
    assert.equal(list.body.jobs.find((job) => job.id === "test-interrupted").state, "failed");
    assert.match(list.body.jobs.find((job) => job.id === "test-interrupted").error, /interrupted/);
    assert.equal((await api("/api/cases", "POST", { name: "   " })).status, 400);
    const created = await api("/api/cases", "POST", { name: "2026-015 · Counsel review" });
    assert.equal(created.status, 200);
    const caseId = created.body.case.id;
    assert.equal((await api("/api/cases", "POST", { name: "2026-015 · counsel review" })).status, 409);
    assert.equal((await api("/api/jobs/test-recording-01/case", "PATCH", { caseId: "missing" })).status, 404);
    assert.equal((await api("/api/jobs/test-recording-01/retry", "POST")).status, 409);
    assert.equal((await api("/api/jobs/test-recording-01/case", "PATCH", { caseId })).status, 200);
    assert.equal((await api(`/api/cases/${caseId}`, "PATCH", { name: "2026-015 · Legal review" })).status, 200);
    const corrected = await api("/api/jobs/test-recording-01/transcript", "PATCH", { edits: { "segment-1": "Corrected synthetic statement for review." } });
    assert.equal(corrected.status, 200);
    assert.match(corrected.body.job.transcript, /Corrected synthetic/);
    assert.equal((await api("/api/jobs/test-recording-01/transcript", "PATCH", { edits: { bad: "invalid" } })).status, 400);
    for (const format of ["txt", "srt", "pdf"]) {
      const result = await fetch(`${service.url}/api/jobs/test-recording-01/export?format=${format}`);
      assert.equal(result.status, 200);
      assert.match(await result.text(), /Corrected synthetic/);
    }
    const portfolio = await api(`/api/projects/${caseId}/portfolio`, "POST");
    assert.equal(portfolio.status, 201);
    assert.equal((await fetch(service.url + portfolio.body.portfolio.downloadUrl)).status, 200);
    assert.equal((await api(`/api/projects/${caseId}/package`, "POST")).status, 201);
    const catalog = JSON.parse(await fs.readFile(path.join(root, "data", "case-catalog.json"), "utf8"));
    assert.equal(catalog.jobs.find((job) => job.id === "test-recording-01").originalSegments[0].text, "This is a synthetic test recording.");
    assert.equal(await hash(), originalHash);
    await stop(service.child);
    service = await launch(root);
    list = await api("/api/jobs");
    const restored = list.body.jobs.find((job) => job.id === "test-recording-01");
    assert.equal(restored.projectName, "2026-015 · Legal review");
    assert.equal(restored.projectId, caseId);
    assert.match(restored.transcript, /Corrected synthetic/);
    assert.equal(list.body.cases.length, 2);
    assert.equal(await hash(), originalHash);
    const retry = await api("/api/jobs/test-interrupted/retry", "POST");
    assert.equal(retry.status, 202);
    assert.equal(retry.body.job.projectId, "case-fixture");
    assert.equal(retry.body.job.id, "test-interrupted");
  } finally { await stop(service.child); await fs.rm(root, { recursive: true, force: true }); }
});
