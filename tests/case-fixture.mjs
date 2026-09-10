import fs from "node:fs/promises";
import path from "node:path";

export async function seedCaseFixture(root) {
  const data = path.join(root, "data");
  await fs.mkdir(path.join(data, "exports"), { recursive: true });
  await fs.mkdir(path.join(data, "incoming"), { recursive: true });
  const sourcePath = path.join(data, "incoming", "synthetic.wav");
  // One second of silent PCM, used only as synthetic review media.
  const wav = Buffer.alloc(32044);
  wav.write("RIFF"); wav.writeUInt32LE(32036, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(32000, 40);
  await fs.writeFile(sourcePath, wav);
  const outputFiles = Object.fromEntries(["txt", "srt", "pdf"].map((format) => [`${format}Path`, path.join(data, "exports", `synthetic.${format}`)]));
  await Promise.all(Object.values(outputFiles).map((file) => fs.writeFile(file, "Synthetic test transcript")));
  const job = { id: "test-recording-01", name: "Witness interview - synthetic.wav", extension: ".wav", state: "completed", stage: "Ready for review", progress: 100, createdAt: "2026-09-10T10:00:00.000Z", completedAt: "2026-09-10T10:01:00.000Z", modelId: "fast", modelLabel: "Synthetic test fixture", language: "auto", projectId: "case-fixture", projectName: "2026-014 · Sample investigation", sourcePath, playbackPath: sourcePath, outputFiles, internalFiles: [], transcript: "This is a synthetic test recording.", segments: [{ id: "segment-1", start: "00:00:00.000", end: "00:00:01.000", startMs: 0, endMs: 1000, text: "This is a synthetic test recording." }] };
  const interrupted = { ...job, id: "test-interrupted", name: "Interrupted intake - synthetic.wav", state: "processing", playbackPath: null, outputFiles: {}, segments: [], transcript: "" };
  await fs.writeFile(path.join(data, "case-catalog.json"), JSON.stringify({ version: 1, cases: [{ id: job.projectId, name: job.projectName }], jobs: [job, interrupted] }));
  return { job, sourcePath };
}
