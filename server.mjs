/**
 * CID EchoTrace Local
 *
 * A zero-dependency HTTP shell around local ffmpeg + whisper.cpp binaries.
 * The browser only talks to 127.0.0.1; no files or transcript content leave
 * this machine. See README.md for initial setup.
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = process.env.ECHOSCRIBE_DATA_DIR ? path.resolve(process.env.ECHOSCRIBE_DATA_DIR) : rootDir;
const bundledEngineDir = process.env.ECHOSCRIBE_ENGINE_DIR ? path.resolve(process.env.ECHOSCRIBE_ENGINE_DIR) : null;
const bundledModelDir = process.env.ECHOSCRIBE_MODEL_DIR ? path.resolve(process.env.ECHOSCRIBE_MODEL_DIR) : null;
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(runtimeDir, "data");
const incomingDir = path.join(dataDir, "incoming");
const workspaceDir = path.join(dataDir, "workspace");
const exportsDir = path.join(dataDir, "exports");
// Project packages are user-requested copies of a batch's original media and
// finished exports. They are deliberately separate from the working files so
// clearing a session never silently removes a package the user created.
const projectsDir = path.join(dataDir, "projects");
const projectPortfoliosDir = path.join(projectsDir, "portfolios");
// Keep a browser-playable copy of the exact PCM WAV Whisper receives. This is
// deliberately separate from the temporary job workspace so review playback
// stays available after transcription, including for legacy codec inputs.
const playbackDir = path.join(dataDir, "playback");
// The bundled static FFmpeg build carries a broad decoder suite. Keep this
// list focused on file containers/extensions FFmpeg can identify reliably,
// including common recorder, dispatch/call-capture, and legacy audio files.
// Codec support itself is determined by FFmpeg during local normalization.
const allowedExtensions = new Set([
  // Common audio and uncompressed/PCM containers
  ".aac", ".ac3", ".adx", ".aif", ".aiff", ".alac", ".amr", ".ape", ".au", ".awb", ".caf", ".dff", ".dsf", ".dts", ".eac3", ".flac", ".g722", ".g726", ".g726le", ".g729", ".gsm", ".m4a", ".m4b", ".m4p", ".m4r", ".mka", ".mlp", ".mp1", ".mp2", ".mp3", ".mpc", ".oga", ".ogg", ".opus", ".ra", ".rm", ".spx", ".tak", ".thd", ".truehd", ".tta", ".voc", ".wav", ".w64", ".wma", ".wv",
  // Audio/video containers that routinely carry audio evidence
  ".3g2", ".3ga", ".3gp", ".asf", ".avi", ".divx", ".f4v", ".flv", ".m2t", ".m2ts", ".mkv", ".mov", ".mp4", ".mpe", ".mpeg", ".mpg", ".mts", ".mxf", ".ogv", ".ts", ".vob", ".webm", ".wmv"
]);
const GIBIBYTE = 1024 ** 3;
// Large recorder/video files are normal in case work. The app keeps a finite
// ceiling to protect the local data drive, but it must not reject them at the
// old, arbitrary 5 GiB boundary.
const MAX_LOCAL_INPUT_BYTES = 64 * GIBIBYTE;
const UPLOAD_STORAGE_HEADROOM_BYTES = GIBIBYTE;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const defaultConfig = {
  port: Number(process.env.ECHOSCRIBE_PORT) || 4310,
  ffmpegPath: process.env.FFMPEG_PATH || (bundledEngineDir ? path.join(bundledEngineDir, "ffmpeg", "ffmpeg.exe") : "ffmpeg"),
  // The installed package contains both official whisper.cpp CUDA/cuBLAS and
  // CPU binaries. GPU is preferred automatically when NVIDIA hardware is
  // present; CPU remains a self-contained fallback for other Windows PCs.
  whisperPath: process.env.WHISPER_CLI_PATH || (bundledEngineDir ? path.join(bundledEngineDir, "whisper-cpu", "whisper-cli.exe") : "whisper-cli"),
  whisperGpuPath: process.env.WHISPER_CUDA_CLI_PATH || (bundledEngineDir ? path.join(bundledEngineDir, "whisper-cuda", "whisper-cli.exe") : ""),
  vadModelPath: process.env.WHISPER_VAD_MODEL_PATH || (bundledModelDir ? path.join(bundledModelDir, "ggml-silero-v6.2.0.bin") : "./models/ggml-silero-v6.2.0.bin"),
  // ICMV is a legacy x86 ACM audio codec. The bridge only loads it privately
  // when an uploaded WAV actually needs it; it never installs the codec.
  icmvDecoderPath: process.env.ICMV_DECODER_PATH || (bundledEngineDir ? path.join(bundledEngineDir, "icmv", "icmv-decode-x86.exe") : ""),
  icmvCodecPath: process.env.ICMV_CODEC_PATH || (bundledEngineDir ? path.join(bundledEngineDir, "icmv", "icmv.acm") : ""),
  maxUploadBytes: MAX_LOCAL_INPUT_BYTES,
  models: {
    fast: { label: bundledModelDir ? "Included · Whisper Large v3 Turbo multilingual" : "Whisper Large v3 Turbo multilingual", path: bundledModelDir ? path.join(bundledModelDir, "ggml-large-v3-turbo.bin") : "./models/ggml-large-v3-turbo.bin" }
  },
  defaultModel: "fast"
};

const jobs = new Map();
const pendingJobIds = [];
let activeJobId = null;
let config = defaultConfig;
let nvidiaGpuProbe = null;
let installerGpuPreference = null;

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolvePath(configPath) {
  return path.isAbsolute(configPath) ? configPath : path.resolve(runtimeDir, configPath);
}

async function loadConfig() {
  // The installer and portable executable contain a complete, pinned runtime.
  // Do not let a previous user's config file turn that into a setup workflow.
  if (bundledEngineDir && bundledModelDir) {
    config = { ...defaultConfig, models: { ...defaultConfig.models }, defaultModel: "fast" };
    return;
  }
  const configPath = path.join(runtimeDir, "config.json");
  try {
    const persisted = JSON.parse(await fsp.readFile(configPath, "utf8"));
    config = {
      ...defaultConfig,
      ...persisted,
      models: { ...defaultConfig.models, ...(persisted.models || {}) }
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("config.json could not be read; using defaults:", error.message);
    }
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function safeFileName(input) {
  let source = String(input || "recording");
  try { source = decodeURIComponent(source); } catch { /* Keep a non-encoded supplied name. */ }
  const sanitized = path.basename(source).replace(/[^a-zA-Z0-9._()\- ]/g, "_");
  return sanitized || "recording";
}

function safeProjectName(input) {
  const name = safeFileName(String(input || "Untitled project")).replace(/^\.+$/, "").trim();
  return (name || "Untitled project").slice(0, 80);
}

function projectFromHeader(input) {
  const name = safeProjectName(input);
  const key = createHash("sha256").update(name.toLocaleLowerCase()).digest("hex").slice(0, 16);
  return { id: `project-${key}`, name };
}

function safeFileStem(input) {
  const stem = path.parse(safeFileName(input)).name.replace(/^\.+$/, "").trim();
  return (stem || "recording").slice(0, 90);
}

function timestampToMs(value) {
  if (typeof value === "number") return value > 10000 ? value / 10 : value * 1000;
  if (typeof value !== "string") return 0;
  const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  return ((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000) + Number(match[4].padEnd(3, "0").slice(0, 3));
}

function formatTimestamp(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":") + "." + String(ms).padStart(3, "0");
}

function formatProjectTimestamp(milliseconds) {
  const total = Math.max(0, Math.floor(Number(milliseconds) || 0));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatSrtTimestamp(milliseconds) {
  return formatTimestamp(milliseconds).replace(".", ",");
}

function speakerLabelForChannel(value) {
  const channel = String(value ?? "").trim();
  if (channel === "0") return { speakerKey: "channel-0", speaker: "Speaker A" };
  if (channel === "1") return { speakerKey: "channel-1", speaker: "Speaker B" };
  if (channel === "?") return { speakerKey: "channel-mixed", speaker: "Overlapping / unclear" };
  return null;
}

function safeSpeakerLabel(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function speakerText(segment) {
  const speaker = safeSpeakerLabel(segment?.speaker);
  const text = String(segment?.text || "").trim();
  return speaker ? `${speaker}: ${text}` : text;
}

function transcriptFromSegments(segments) {
  return (segments || []).map(speakerText).filter(Boolean).join("\n");
}

function speakerCount(segments) {
  return new Set((segments || []).map((segment) => segment.speakerKey).filter((key) => key && key !== "channel-mixed")).size;
}

function pdfSafeText(value) {
  const replacements = new Map([
    ["–", "-"], ["—", "-"], ["‘", "'"], ["’", "'"], ["“", '"'], ["”", '"'], ["…", "..."], ["•", "-"], [" ", " "]
  ]);
  const normalized = String(value ?? "").replace(/[–—‘’“”…• ]/g, (character) => replacements.get(character) || "?").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return Array.from(normalized).map((character) => {
    const code = character.charCodeAt(0);
    if (code >= 32 && code <= 126) return character;
    if (code >= 160 && code <= 255) return String.fromCharCode(code);
    return "?";
  }).join("").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfText(value, maximum = 89) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maximum) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function pdfTextCommand(text, x, y, size, font = "F1", color = "0.11 0.13 0.23") {
  return `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${pdfSafeText(text)}) Tj ET`;
}

function pdfBrandCommands(fileName, pageNumber, documentLabel = "PRIVATE LOCAL TRANSCRIPT") {
  return [
    "q 0.46 0.35 0.91 rg 46 736 26 26 re f 0.78 0.72 1 rg 52 742 4 8 re f 59 739 4 14 re f 66 743 4 7 re f Q",
    pdfTextCommand("CID EchoTrace Local", 82, 747, 14, "F2"),
    pdfTextCommand(documentLabel, 82, 733, 7, "F2", "0.42 0.45 0.58"),
    "0.90 0.91 0.95 RG 46 716 m 566 716 l S",
    pdfTextCommand(fileName, 46, 700, 8, "F1", "0.40 0.43 0.54"),
    pdfTextCommand(`Page ${pageNumber}`, 522, 700, 8, "F1", "0.40 0.43 0.54")
  ];
}

async function createTranscriptPdf(destinationPath, job) {
  const transcriptRows = job.segments?.length
    ? job.segments.flatMap((segment) => wrapPdfText(`${formatProjectTimestamp(segment.startMs)}  ${speakerText(segment)}`, 83))
    : String(job.transcript || "").split(/\r?\n/).flatMap((line) => wrapPdfText(line, 89));
  const pages = [];
  const linesPerPage = 43;
  for (let index = 0; index < transcriptRows.length || (index === 0 && !transcriptRows.length); index += linesPerPage) {
    pages.push(transcriptRows.slice(index, index + linesPerPage));
  }

  // Object ids 1-4 are the catalog, pages node, and the two built-in fonts.
  // Page content/page objects are allocated after those fixed ids.
  const objects = [null, null, null, null, null];
  const pageObjectIds = [];
  for (const [pageIndex, lines] of pages.entries()) {
    const contentObjectId = objects.length;
    const pageObjectId = contentObjectId + 1;
    const commands = [
      ...pdfBrandCommands(job.name, pageIndex + 1),
      ...(pageIndex === 0 ? [
        pdfTextCommand("Transcript", 46, 675, 19, "F2"),
        pdfTextCommand(`Project: ${job.projectName}`, 46, 658, 9, "F1", "0.36 0.39 0.50"),
        pdfTextCommand(`Created locally ${new Date().toLocaleString("en-US")}`, 46, 644, 9, "F1", "0.36 0.39 0.50"),
        "0.92 0.92 0.96 RG 46 632 m 566 632 l S"
      ] : []),
      ...lines.map((line, lineIndex) => pdfTextCommand(line, 46, (pageIndex === 0 ? 612 : 676) - (lineIndex * 13), 9.5, "F1", "0.17 0.19 0.29"))
    ];
    const stream = commands.join("\n");
    objects[contentObjectId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    pageObjectIds.push(pageObjectId);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let document = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(document, "latin1");
    document += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, "latin1");
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) document += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info << /Title (${pdfSafeText(`CID EchoTrace Local - ${job.name}`)}) /Author (CID EchoTrace Local) >> >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  await fsp.writeFile(destinationPath, Buffer.from(document, "latin1"));
}

async function createProjectPortfolioPdf(destinationPath, projectName, projectJobs) {
  const completedJobs = projectJobs.filter((job) => job.state === "completed" && String(job.transcript || "").trim());
  if (!completedJobs.length) throw new Error("Complete at least one transcription before creating a project PDF portfolio.");

  const pages = [];
  const coverRows = [
    `Includes ${completedJobs.length} completed ${completedJobs.length === 1 ? "PDF transcription" : "PDF transcriptions"} from this project folder.`,
    "Each section retains the timestamps produced by the local transcription engine.",
    "",
    "Included PDF transcriptions:"
  ];
  for (const [index, job] of completedJobs.entries()) {
    coverRows.push(...wrapPdfText(`${index + 1}. ${job.name}`, 84));
  }
  for (let index = 0; index < coverRows.length; index += 39) {
    pages.push({
      kind: "cover",
      rows: coverRows.slice(index, index + 39),
      continuation: index > 0
    });
  }

  for (const [jobIndex, job] of completedJobs.entries()) {
    const transcriptRows = job.segments?.length
      ? job.segments.flatMap((segment) => wrapPdfText(`${formatProjectTimestamp(segment.startMs)}  ${speakerText(segment)}`, 83))
      : String(job.transcript || "").split(/\r?\n/).flatMap((line) => wrapPdfText(line, 89));
    const rows = transcriptRows.length ? transcriptRows : ["No transcript text was captured for this file."];
    let offset = 0;
    let continuation = false;
    while (offset < rows.length) {
      const capacity = continuation ? 45 : 40;
      pages.push({
        kind: "transcript",
        job,
        jobIndex: jobIndex + 1,
        totalJobs: completedJobs.length,
        rows: rows.slice(offset, offset + capacity),
        continuation
      });
      offset += capacity;
      continuation = true;
    }
  }

  // The portfolio uses the same embedded logo, built-in fonts, and local-only
  // PDF construction as an individual transcript. It contains no web assets.
  const objects = [null, null, null, null, null];
  const pageObjectIds = [];
  for (const [pageIndex, page] of pages.entries()) {
    const isCover = page.kind === "cover";
    const headerName = isCover ? `Portfolio - ${projectName}` : page.job.name;
    const commands = [
      ...pdfBrandCommands(headerName, pageIndex + 1, "PRIVATE LOCAL PORTFOLIO")
    ];
    let rowStart = 675;
    if (isCover) {
      commands.push(
        pdfTextCommand(page.continuation ? "Project transcription portfolio - continued" : "Project transcription portfolio", 46, 675, 19, "F2"),
        pdfTextCommand(`Project: ${projectName}`, 46, 658, 9, "F1", "0.36 0.39 0.50"),
        pdfTextCommand(`Created locally ${new Date().toLocaleString("en-US")}`, 46, 644, 9, "F1", "0.36 0.39 0.50"),
        "0.92 0.92 0.96 RG 46 632 m 566 632 l S"
      );
      rowStart = 612;
    } else if (!page.continuation) {
      commands.push(
        pdfTextCommand(`Transcript ${page.jobIndex} of ${page.totalJobs}`, 46, 675, 18, "F2"),
        ...wrapPdfText(page.job.name, 76).slice(0, 2).map((line, index) => pdfTextCommand(line, 46, 657 - (index * 12), 9, "F1", "0.36 0.39 0.50")),
        pdfTextCommand(`Project: ${projectName}`, 46, 632, 9, "F1", "0.36 0.39 0.50"),
        "0.92 0.92 0.96 RG 46 620 m 566 620 l S"
      );
      rowStart = 600;
    } else {
      commands.push(pdfTextCommand(`Transcript ${page.jobIndex} of ${page.totalJobs} - continued`, 46, 675, 10, "F2", "0.36 0.39 0.50"));
      rowStart = 657;
    }
    commands.push(...page.rows.map((line, lineIndex) => pdfTextCommand(line, 46, rowStart - (lineIndex * 12), 9.5, "F1", "0.17 0.19 0.29")));
    const stream = commands.join("\n");
    const contentObjectId = objects.length;
    const pageObjectId = contentObjectId + 1;
    objects[contentObjectId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    pageObjectIds.push(pageObjectId);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let document = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(document, "latin1");
    document += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, "latin1");
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) document += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info << /Title (${pdfSafeText(`CID EchoTrace Local Portfolio - ${projectName}`)}) /Author (CID EchoTrace Local) >> >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  await fsp.writeFile(destinationPath, Buffer.from(document, "latin1"));
}

function publicJob(job) {
  return {
    id: job.id,
    name: job.name,
    extension: job.extension,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    createdAt: job.createdAt,
    completedAt: job.completedAt || null,
    modelId: job.modelId,
    modelLabel: job.modelLabel,
    language: job.language,
    projectId: job.projectId,
    projectName: job.projectName,
    transcript: job.transcript || "",
    segments: job.segments || [],
    inputChannelCount: job.inputChannelCount || null,
    diarization: job.diarization ? { ...job.diarization, speakerCount: speakerCount(job.segments) } : null,
    error: job.error || null,
    processingDevice: job.processingDevice || null,
    mediaAvailable: job.state === "completed" && Boolean(job.playbackPath),
    exports: job.state === "completed" ? ["txt", "srt", "pdf"] : []
  };
}

async function removeIfPresent(target) {
  await fsp.rm(target, { force: true }).catch(() => undefined);
}

function formatStorageBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < GIBIBYTE) return `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
  return `${(bytes / GIBIBYTE).toFixed(1)} GiB`;
}

function localStorageError(message) {
  const error = new Error(message);
  error.code = "ENOSPC";
  return error;
}

async function availableStorageBytes(targetPath) {
  // fs.statfs is available in the Electron runtime used by the packaged app.
  // Keep a fallback so development on an older Node runtime remains usable.
  if (typeof fsp.statfs !== "function") return null;
  try {
    const stats = await fsp.statfs(path.dirname(targetPath));
    const available = Number(stats.bavail) * Number(stats.bsize);
    return Number.isSafeInteger(available) && available >= 0 ? available : null;
  } catch {
    return null;
  }
}

async function ensureUploadStorage(destination, statedLength) {
  if (!Number.isSafeInteger(statedLength) || statedLength <= 0) return;
  const required = statedLength + UPLOAD_STORAGE_HEADROOM_BYTES;
  const available = await availableStorageBytes(destination);
  if (available !== null && available < required) {
    throw localStorageError(`Not enough free local storage to receive this file. CID EchoTrace needs at least ${formatStorageBytes(required)} in its data location, but only ${formatStorageBytes(available)} is available.`);
  }
}

function run(command, args, onLine = () => {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { shell: false, windowsHide: true });
    let output = "";
    const append = (chunk) => {
      const text = String(chunk);
      output = (output + text).slice(-12000);
      // FFmpeg and whisper.cpp update status on carriage returns while they
      // work. Splitting both line-ending forms makes live progress visible
      // instead of waiting for a full command line to finish.
      for (const line of text.split(/\r?\n|\r/)) if (line.trim()) onLine(line.trim());
    };
    process.stdout.on("data", append);
    process.stderr.on("data", append);
    process.once("error", (error) => reject(error));
    process.once("close", (code) => {
      if (code === 0) resolve(output);
      else {
        const error = new Error(`Command exited with ${code}. ${output.trim()}`);
        error.exitCode = code;
        reject(error);
      }
    });
  });
}

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {
      // Try the next format/extension.
    }
  }
  return null;
}

function segmentsFromWhisperJson(payload) {
  const transcription = payload.transcription || payload.segments || [];
  if (!Array.isArray(transcription)) return [];
  return transcription.map((segment, index) => {
    const timestamps = segment.timestamps || {};
    const offsets = segment.offsets || {};
    const start = timestampToMs(timestamps.from ?? segment.start ?? offsets.from ?? 0);
    const end = timestampToMs(timestamps.to ?? segment.end ?? offsets.to ?? start);
    const speaker = speakerLabelForChannel(segment.speaker);
    return {
      id: String(index + 1),
      startMs: start,
      endMs: Math.max(start, end),
      start: formatTimestamp(start),
      end: formatTimestamp(Math.max(start, end)),
      text: String(segment.text || "").trim(),
      ...(speaker || {})
    };
  }).filter((segment) => segment.text);
}

async function tryDecodeIcmv(sourcePath, destinationPath) {
  if (path.extname(sourcePath).toLowerCase() !== ".wav") return false;
  if (!config.icmvDecoderPath || !config.icmvCodecPath) return false;
  try {
    await run(resolvePath(config.icmvDecoderPath), [resolvePath(config.icmvCodecPath), sourcePath, destinationPath]);
    return true;
  } catch (error) {
    // The helper returns these codes for non-RIFF / non-ICMV WAV files. Let
    // FFmpeg process its normal collection of formats in those cases.
    if (error.exitCode === 3 || error.exitCode === 4) {
      await removeIfPresent(destinationPath);
      return false;
    }
    const detail = String(error.message || error).replace(/^Command exited with \d+\.\s*/i, "").trim();
    throw new Error(`The included ICMV Audio Codec could not decode this WAV file. ${detail}`);
  }
}

function ffmpegProgressReporter(job, startPercent, endPercent) {
  let durationMs = 0;
  return (line) => {
    const duration = line.match(/Duration:\s*(\d+:\d+:\d+(?:[.,]\d+)?)/i);
    if (duration) durationMs = timestampToMs(duration[1]);
    const currentTime = line.match(/time=\s*(\d+:\d+:\d+(?:[.,]\d+)?)/i);
    if (!currentTime || !durationMs) return;
    const elapsedMs = timestampToMs(currentTime[1]);
    const next = startPercent + ((Math.min(elapsedMs, durationMs) / durationMs) * (endPercent - startPercent));
    job.progress = Math.max(job.progress || 0, Math.min(endPercent, Math.round(next)));
  };
}

async function inspectAudioChannelCount(sourcePath) {
  // ffprobe is not part of the compact static payload, so ask bundled FFmpeg
  // to decode one frame locally and read its reported channel count. This
  // accepts the same formats and private ICMV fallback as the main pipeline.
  const output = await run(config.ffmpegPath, ["-hide_banner", "-i", sourcePath, "-map", "0:a:0", "-frames:a", "1", "-af", "ashowinfo", "-f", "null", "-"]);
  const match = output.match(/\bchannels:(\d+)\b/i);
  const channels = Number(match?.[1]);
  return Number.isInteger(channels) && channels > 0 ? channels : 1;
}

async function normalizeToWhisperWav(job, sourcePath, wavPath, startPercent, endPercent, outputChannels = 1) {
  // Preserve exactly two original channels when a recording contains them.
  // whisper.cpp's built-in diarization then identifies the dominant channel
  // per segment. Everything else is downmixed to mono as before so the app
  // never invents speaker identities for single-channel evidence.
  const channels = outputChannels === 2 ? "2" : "1";
  await run(config.ffmpegPath, ["-y", "-i", sourcePath, "-vn", "-ar", "16000", "-ac", channels, "-af", "highpass=f=80,loudnorm=I=-18:LRA=11:TP=-2", "-c:a", "pcm_s16le", wavPath], ffmpegProgressReporter(job, startPercent, endPercent));
  job.progress = Math.max(job.progress || 0, endPercent);
}

async function extractAudioForTranscription(job, wavPath, icmvWavPath) {
  job.stage = "Preparing and cleaning the audio track";
  job.progress = 12;
  try {
    // FFmpeg handles standard and legacy formats such as the supplied G.729
    // WAV directly. Do not send every non-PCM WAV through an old ACM driver.
    const sourceChannels = await inspectAudioChannelCount(job.sourcePath).catch(() => 1);
    const diarizationChannels = sourceChannels === 2 ? 2 : 1;
    job.inputChannelCount = sourceChannels;
    job.diarization = diarizationChannels === 2
      ? { mode: "stereo-channel", sourceChannels, speakerLabels: ["Speaker A", "Speaker B"] }
      : { mode: "manual", sourceChannels, speakerLabels: [] };
    if (diarizationChannels === 2) job.stage = "Preparing stereo channels for speaker labels";
    await normalizeToWhisperWav(job, job.sourcePath, wavPath, 12, 36, diarizationChannels);
    return diarizationChannels;
  } catch (ffmpegError) {
    // ICMV remains a narrow fallback for legacy RIFF/WAV inputs that FFmpeg
    // does not recognise. For all other formats, preserve FFmpeg's diagnosis.
    if (path.extname(job.sourcePath).toLowerCase() !== ".wav") throw ffmpegError;
    job.stage = "Decoding with the included ICMV Audio Codec";
    job.progress = 17;
    const decodedIcmv = await tryDecodeIcmv(job.sourcePath, icmvWavPath);
    if (!decodedIcmv) throw ffmpegError;
    job.stage = "Preparing decoded ICMV audio";
    job.progress = 23;
    const sourceChannels = await inspectAudioChannelCount(icmvWavPath).catch(() => 1);
    const diarizationChannels = sourceChannels === 2 ? 2 : 1;
    job.inputChannelCount = sourceChannels;
    job.diarization = diarizationChannels === 2
      ? { mode: "stereo-channel", sourceChannels, speakerLabels: ["Speaker A", "Speaker B"] }
      : { mode: "manual", sourceChannels, speakerLabels: [] };
    if (diarizationChannels === 2) job.stage = "Preparing decoded ICMV stereo channels for speaker labels";
    await normalizeToWhisperWav(job, icmvWavPath, wavPath, 23, 36, diarizationChannels);
    return diarizationChannels;
  }
}

async function probeNvidiaGpu() {
  if (nvidiaGpuProbe) return nvidiaGpuProbe;
  nvidiaGpuProbe = (async () => {
    try {
      const output = await run("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"]);
      const devices = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const [name, driverVersion] = line.split(",").map((part) => part.trim());
        return { name: name || "NVIDIA GPU", driverVersion: driverVersion || null };
      });
      return { detected: devices.length > 0, devices };
    } catch {
      return { detected: false, devices: [] };
    }
  })();
  return nvidiaGpuProbe;
}

async function gpuAccelerationEnabled() {
  if (installerGpuPreference !== null) return installerGpuPreference;
  // The installer writes this per-user setting. Absence means the safe,
  // recommended default: use the bundled CUDA runtime when supported.
  try {
    const output = await run("reg.exe", ["query", "HKCU\\Software\\CID EchoTrace Local", "/v", "UseCuda"]);
    installerGpuPreference = !/\b0x0\b/i.test(output);
  } catch {
    installerGpuPreference = true;
  }
  return installerGpuPreference;
}

function isGpuRuntimeError(error) {
  const detail = String(error && error.message ? error.message : error).toLowerCase();
  return /cuda|cublas|nvidia|gpu|device|driver|backend|dll/.test(detail);
}

async function transcribeWithPreferredEngine(job, args, onLine) {
  const cpuPath = config.whisperPath;
  const gpuPath = config.whisperGpuPath && resolvePath(config.whisperGpuPath);
  const cudaEnabled = await gpuAccelerationEnabled();
  const gpu = gpuPath && cudaEnabled ? await probeNvidiaGpu() : { detected: false, devices: [] };

  if (gpu.detected) {
    job.processingDevice = "NVIDIA GPU";
    job.stage = `Transcribing on ${gpu.devices[0]?.name || "the NVIDIA GPU"}`;
    try {
      await run(gpuPath, args, onLine);
      return;
    } catch (gpuError) {
      if (!cpuPath || !isGpuRuntimeError(gpuError)) throw gpuError;
      job.processingDevice = "CPU fallback";
      job.stage = "GPU runtime was unavailable; continuing on CPU";
      job.progress = Math.max(40, Math.min(92, job.progress || 40));
    }
  } else {
    job.processingDevice = "CPU fallback";
    job.stage = cudaEnabled ? "No NVIDIA GPU detected; transcribing on CPU" : "GPU acceleration was disabled at installation; transcribing on CPU";
  }

  await run(cpuPath, args, onLine);
}

function srtFromSegments(segments) {
  return (segments || []).map((segment, index) => [
    String(index + 1),
    `${formatSrtTimestamp(segment.startMs)} --> ${formatSrtTimestamp(segment.endMs)}`,
    speakerText(segment)
  ].join("\r\n")).join("\r\n\r\n") + (segments?.length ? "\r\n" : "");
}

async function refreshTranscriptExports(job) {
  const outputFiles = job.outputFiles || {};
  const pdfPath = outputFiles.pdfPath;
  if (!pdfPath) throw new Error("The local export location is unavailable.");
  if (job.segments?.length) {
    job.transcript = transcriptFromSegments(job.segments);
    await Promise.all([
      outputFiles.txtPath ? fsp.writeFile(outputFiles.txtPath, `${job.transcript}\r\n`, "utf8") : Promise.resolve(),
      outputFiles.srtPath ? fsp.writeFile(outputFiles.srtPath, srtFromSegments(job.segments), "utf8") : Promise.resolve()
    ]);
  }
  await createTranscriptPdf(pdfPath, job);
}

async function transcribe(job) {
  const jobDir = path.join(workspaceDir, job.id);
  const wavPath = path.join(jobDir, "audio.wav");
  const icmvWavPath = path.join(jobDir, "icmv-decoded.wav");
  const playbackPath = path.join(playbackDir, `${job.id}.wav`);
  const outputBase = path.join(exportsDir, `${job.id}-${path.parse(job.name).name}`);
  await fsp.mkdir(jobDir, { recursive: true });

  try {
    job.state = "processing";
    const diarizationChannels = await extractAudioForTranscription(job, wavPath, icmvWavPath);

    // The original upload may use a codec Chromium cannot play (for example
    // legacy G.729 or ICMV WAV). Preserve the normalized local WAV instead so
    // the player and transcript share an identical timeline.
    await fsp.copyFile(wavPath, playbackPath);
    job.playbackPath = playbackPath;

    job.stage = "Loading the included local model";
    job.progress = 38;
    const modelPath = resolvePath(config.models[job.modelId].path);
    // Keep transcript rows short enough for practical timestamp-based review.
    const args = ["-m", modelPath, "-f", wavPath, "-of", outputBase, "-oj", "-otxt", "-osrt", "--max-len", "96", "--print-progress"];
    if (diarizationChannels === 2) args.push("--diarize");
    // whisper.cpp otherwise defaults to English. Always pass `auto` so a
    // multilingual model performs language detection for every upload.
    args.push("-l", job.language || "auto");
    // VAD avoids treating extended silence as speech and keeps the model's
    // effort focused on voiced portions. The conservative padding/overlap
    // values were verified against the retained, original-timeline playback.
    const vadPath = resolvePath(config.vadModelPath);
    try {
      await fsp.access(vadPath);
      args.push("--vad", "--vad-model", vadPath, "--vad-min-silence-duration-ms", "400", "--vad-speech-pad-ms", "200", "--vad-samples-overlap", "0.15");
      job.voiceActivityDetection = true;
    } catch {
      job.voiceActivityDetection = false;
    }
    await transcribeWithPreferredEngine(job, args, (line) => {
      const progress = line.match(/progress\s*=\s*(\d+(?:\.\d+)?)%/i);
      if (progress) {
        const engineProgress = Math.max(0, Math.min(100, Number(progress[1])));
        const overallProgress = 38 + ((engineProgress / 100) * 56);
        job.progress = Math.max(job.progress || 38, Math.min(94, Math.round(overallProgress)));
      }
    });

    job.stage = "Preparing your transcript";
    job.progress = 95;
    const [jsonPath, txtPath, srtPath] = await Promise.all([
      firstExisting([`${outputBase}.json`]),
      firstExisting([`${outputBase}.txt`]),
      firstExisting([`${outputBase}.srt`])
    ]);
    let segments = [];
    if (jsonPath) {
      segments = segmentsFromWhisperJson(JSON.parse(await fsp.readFile(jsonPath, "utf8")));
    }
    const transcript = segments.length ? transcriptFromSegments(segments) : (txtPath ? (await fsp.readFile(txtPath, "utf8")).trim() : "");
    if (!transcript) throw new Error("Whisper completed but did not create a readable transcript.");

    job.transcript = transcript;
    job.segments = segments;
    job.stage = "Creating your branded PDF";
    job.progress = 97;
    const pdfPath = `${outputBase}.pdf`;
    job.outputFiles = { txtPath: txtPath || `${outputBase}.txt`, srtPath: srtPath || `${outputBase}.srt`, pdfPath };
    await refreshTranscriptExports(job);
    job.internalFiles = [jsonPath].filter(Boolean);
    job.progress = 100;
    job.stage = "Ready";
    job.state = "completed";
    job.completedAt = new Date().toISOString();
  } catch (error) {
    await removeIfPresent(job.playbackPath);
    job.playbackPath = null;
    job.state = "failed";
    job.stage = "Needs attention";
    job.error = friendlyEngineError(error);
  } finally {
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function processNextJob() {
  if (activeJobId) return;
  const nextId = pendingJobIds.shift();
  if (!nextId) return;
  const job = jobs.get(nextId);
  if (!job) return processNextJob();
  activeJobId = job.id;
  await transcribe(job);
  activeJobId = null;
  void processNextJob();
}

function friendlyEngineError(error) {
  const raw = String(error && error.message ? error.message : error);
  if (raw.includes("ENOENT")) {
    return "The included local transcription runtime is not ready. Reinstall CID EchoTrace Local and try again.";
  }
  return raw.slice(0, 1400);
}

async function streamPlaybackWav(request, response, playbackPath) {
  const stat = await fsp.stat(playbackPath);
  if (!stat.isFile() || stat.size < 1) return sendError(response, 404, "The local review audio is not available.");

  const totalBytes = stat.size;
  const range = String(request.headers.range || "").trim();
  let start = 0;
  let end = totalBytes - 1;
  let statusCode = 200;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${totalBytes}`, "Cache-Control": "no-store" });
      return response.end();
    }
    const [, startText, endText] = match;
    if (!startText && !endText) {
      response.writeHead(416, { "Content-Range": `bytes */${totalBytes}`, "Cache-Control": "no-store" });
      return response.end();
    }
    if (startText) {
      start = Number(startText);
      end = endText ? Number(endText) : end;
    } else {
      const suffixLength = Number(endText);
      start = Math.max(0, totalBytes - suffixLength);
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= totalBytes || end < start) {
      response.writeHead(416, { "Content-Range": `bytes */${totalBytes}`, "Cache-Control": "no-store" });
      return response.end();
    }
    end = Math.min(end, totalBytes - 1);
    statusCode = 206;
  }

  response.writeHead(statusCode, {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    ...(statusCode === 206 ? { "Content-Range": `bytes ${start}-${end}/${totalBytes}` } : {}),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (request.method === "HEAD") return response.end();
  const stream = fs.createReadStream(playbackPath, { start, end });
  stream.once("error", () => response.destroy());
  return stream.pipe(response);
}

async function saveUpload(request, job, destination) {
  const headerValue = request.headers["content-length"];
  const statedLength = headerValue === undefined ? null : Number(headerValue);
  if (statedLength !== null && (!Number.isSafeInteger(statedLength) || statedLength < 0)) {
    throw new Error("The local browser sent an invalid file size.");
  }
  if (statedLength !== null && statedLength > config.maxUploadBytes) {
    throw new Error(`This file is ${formatStorageBytes(statedLength)}. CID EchoTrace accepts local files up to ${formatStorageBytes(config.maxUploadBytes)}.`);
  }
  await ensureUploadStorage(destination, statedLength);
  await new Promise((resolve, reject) => {
    let received = 0;
    const output = fs.createWriteStream(destination, { flags: "wx" });
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > config.maxUploadBytes) {
        const error = new Error(`This file exceeds CID EchoTrace's ${formatStorageBytes(config.maxUploadBytes)} local file limit.`);
        output.destroy(error);
        request.destroy(error);
      }
    });
    request.once("error", reject);
    output.once("error", (error) => {
      if (error.code === "ENOSPC" || error.code === "EFBIG") {
        return reject(localStorageError("CID EchoTrace ran out of usable local storage while receiving this file. Free space in the app data drive, and use NTFS or exFAT rather than FAT32 for files above 4 GiB."));
      }
      reject(error);
    });
    output.once("finish", resolve);
    request.pipe(output);
  });
}

async function readJsonBody(request, maximumBytes = 4096) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBytes) throw new Error("That local update is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The local update could not be read.");
  }
}

function manualSpeakerKey(label) {
  return `manual-${createHash("sha256").update(label.toLocaleLowerCase()).digest("hex").slice(0, 12)}`;
}

async function renameJobSpeaker(job, speakerKey, nextName) {
  const label = safeSpeakerLabel(nextName);
  if (!label) throw new Error("Enter a speaker label before saving.");
  const matchingSegments = (job.segments || []).filter((segment) => segment.speakerKey === speakerKey);
  if (!matchingSegments.length) throw new Error("That speaker label is not available in this local transcript.");
  matchingSegments.forEach((segment) => { segment.speaker = label; });
  await refreshTranscriptExports(job);
}

async function assignSegmentSpeaker(job, segmentId, nextName) {
  const label = safeSpeakerLabel(nextName);
  if (!label) throw new Error("Enter a speaker label before saving.");
  const segment = (job.segments || []).find((candidate) => candidate.id === segmentId);
  if (!segment) throw new Error("That transcript segment is no longer available.");
  segment.speaker = label;
  segment.speakerKey = manualSpeakerKey(label);
  await refreshTranscriptExports(job);
}

async function copyPackageFile(sourcePath, destinationPath) {
  if (!sourcePath) return false;
  try {
    await fsp.copyFile(sourcePath, destinationPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function completedProjectTranscriptions(projectJobs) {
  return projectJobs.filter((job) => job.state === "completed" && String(job.transcript || "").trim());
}

function expectedTranscriptPdfPath(job) {
  return job.outputFiles?.pdfPath || path.join(exportsDir, `${job.id}-${path.parse(job.name).name}.pdf`);
}

async function ensureProjectPdfTranscriptions(projectJobs) {
  const completedJobs = completedProjectTranscriptions(projectJobs);
  if (!completedJobs.length) throw new Error("Complete at least one transcription before creating a project PDF portfolio.");
  await Promise.all(completedJobs.map(async (job) => {
    const pdfPath = expectedTranscriptPdfPath(job);
    try {
      await fsp.access(pdfPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // A transcript can still be valid if its individual PDF was removed
      // outside the app. Rebuild it before the portfolio so every completed
      // transcription in this project has a corresponding PDF section.
      await fsp.mkdir(path.dirname(pdfPath), { recursive: true });
      await createTranscriptPdf(pdfPath, job);
    }
    job.outputFiles = { ...(job.outputFiles || {}), pdfPath };
  }));
  return completedJobs;
}

async function createProjectPortfolio(projectId) {
  const projectJobs = [...jobs.values()].filter((job) => job.projectId === projectId);
  if (!projectJobs.length) throw new Error("This project has no local files.");
  const completedJobs = await ensureProjectPdfTranscriptions(projectJobs);
  const projectName = projectJobs[0].projectName;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${safeFileStem(projectName)}-portfolio-${stamp}.pdf`;
  const filePath = path.join(projectPortfoliosDir, fileName);
  await fsp.mkdir(projectPortfoliosDir, { recursive: true });
  await createProjectPortfolioPdf(filePath, projectName, completedJobs);
  return { projectName, fileName, transcriptions: completedJobs.length, filePath };
}

async function packageProject(projectId) {
  const projectJobs = [...jobs.values()].filter((job) => job.projectId === projectId);
  if (!projectJobs.length) throw new Error("This project has no local files to package.");
  const projectName = projectJobs[0].projectName;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bundleName = `${safeFileStem(projectName)}-${stamp}`;
  const bundleDir = path.join(projectsDir, bundleName);
  const audioDir = path.join(bundleDir, "audio");
  const transcriptsDir = path.join(bundleDir, "transcripts");
  await Promise.all([fsp.mkdir(audioDir, { recursive: true }), fsp.mkdir(transcriptsDir, { recursive: true })]);
  const completedJobs = await ensureProjectPdfTranscriptions(projectJobs).catch((error) => {
    if (/Complete at least one transcription/.test(String(error.message || error))) return [];
    throw error;
  });
  let portfolioFileName = null;
  if (completedJobs.length) {
    portfolioFileName = `${safeFileStem(projectName)}-portfolio.pdf`;
    await createProjectPortfolioPdf(path.join(bundleDir, portfolioFileName), projectName, completedJobs);
  }

  const manifestJobs = [];
  for (const job of projectJobs) {
    const identifier = job.id.slice(0, 8);
    const stem = safeFileStem(job.name);
    const audioName = `${stem}-${identifier}${job.extension}`;
    const audioCopied = await copyPackageFile(job.sourcePath, path.join(audioDir, audioName));
    const exported = [];
    for (const format of ["txt", "srt", "pdf"]) {
      const source = job.outputFiles?.[`${format}Path`];
      const fileName = `${stem}-${identifier}.${format}`;
      if (await copyPackageFile(source, path.join(transcriptsDir, fileName))) exported.push(fileName);
    }
    manifestJobs.push({
      id: job.id,
      file: job.name,
      state: job.state,
      audio: audioCopied ? `audio/${audioName}` : null,
      exports: exported.map((fileName) => `transcripts/${fileName}`),
      completedAt: job.completedAt || null
    });
  }
  await fsp.writeFile(path.join(bundleDir, "project-manifest.json"), JSON.stringify({
    application: "CID EchoTrace Local",
    projectName,
    packagedAt: new Date().toISOString(),
    note: "This package was created locally. Audio files are original uploads; every completed transcript's PDF export and one combined PDF portfolio are included when available.",
    portfolio: portfolioFileName,
    jobs: manifestJobs
  }, null, 2), "utf8");
  return {
    projectName,
    bundleName,
    files: manifestJobs.length,
    completed: manifestJobs.filter((job) => job.exports.length).length,
    portfolio: Boolean(portfolioFileName)
  };
}

async function engineHealth() {
  const models = await Promise.all(Object.entries(config.models).map(async ([id, model]) => {
    const modelPath = resolvePath(model.path);
    try {
      await fsp.access(modelPath);
      return { id, label: model.label, ready: true };
    } catch {
      return { id, label: model.label, ready: false };
    }
  }));
  const checkExecutable = async (executable) => {
    if (!path.isAbsolute(executable)) return { configured: false, ready: null };
    try {
      await fsp.access(executable);
      return { configured: true, ready: true };
    } catch {
      return { configured: true, ready: false };
    }
  };
  const [ffmpeg, whisper, whisperGpu, icmvDecoder, icmvCodec] = await Promise.all([
    checkExecutable(config.ffmpegPath),
    checkExecutable(config.whisperPath),
    checkExecutable(config.whisperGpuPath),
    checkExecutable(config.icmvDecoderPath),
    checkExecutable(config.icmvCodecPath)
  ]);
  const nvidia = whisperGpu.ready === true ? await probeNvidiaGpu() : { detected: false, devices: [] };
  const [cudaEnabled, vadReady] = await Promise.all([
    gpuAccelerationEnabled(),
    fsp.access(resolvePath(config.vadModelPath)).then(() => true).catch(() => false)
  ]);
  return {
    models,
    engine: {
      ffmpeg,
      whisper,
      gpu: {
        runtimeReady: whisperGpu.ready === true,
        enabled: cudaEnabled,
        detected: nvidia.detected,
        devices: nvidia.devices
      },
      vad: { ready: vadReady },
      icmv: { configured: Boolean(config.icmvDecoderPath && config.icmvCodecPath), ready: icmvDecoder.ready === true && icmvCodec.ready === true }
    },
    defaultModel: config.defaultModel,
    maxUploadBytes: config.maxUploadBytes
  };
}

async function handleApi(request, response, url) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, await engineHealth());
  }
  if (request.method === "GET" && url.pathname === "/api/jobs") {
    return sendJson(response, 200, { jobs: [...jobs.values()].map(publicJob).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }
  if (request.method === "POST" && url.pathname === "/api/jobs") {
    const suppliedName = safeFileName(request.headers["x-file-name"]);
    const extension = path.extname(suppliedName).toLowerCase();
    const modelId = config.defaultModel;
    const language = "auto";
    const project = projectFromHeader(request.headers["x-project-name"]);
    if (!allowedExtensions.has(extension)) return sendError(response, 415, "Choose a supported audio/video container. CID EchoTrace supports common audio evidence formats such as MP3, WAV, M4A, AMR, Opus, WMA, FLAC, OGG, MKV, and MP4.");
    if (!config.models[modelId]) return sendError(response, 500, "The included Whisper model is unavailable. Reinstall CID EchoTrace Local.");

    const id = randomUUID();
    const job = {
      id,
      name: suppliedName,
      extension,
      state: "uploading",
      stage: "Receiving the local file",
      progress: 5,
      createdAt: new Date().toISOString(),
      modelId,
      modelLabel: config.models[modelId].label,
      language,
      projectId: project.id,
      projectName: project.name,
      sourcePath: path.join(incomingDir, `${id}${extension}`),
      playbackPath: null,
      outputFiles: {},
      internalFiles: []
    };
    jobs.set(id, job);
    try {
      await saveUpload(request, job, job.sourcePath);
      job.state = "queued";
      job.stage = "Waiting for the local engine";
      job.progress = 10;
      pendingJobIds.push(id);
      void processNextJob();
      return sendJson(response, 202, { job: publicJob(job) });
    } catch (error) {
      jobs.delete(id);
      await removeIfPresent(job.sourcePath);
      return sendError(response, 413, String(error.message || error));
    }
  }
  if (request.method === "POST" && segments.length === 4 && segments[0] === "api" && segments[1] === "projects" && segments[3] === "portfolio") {
    try {
      const portfolio = await createProjectPortfolio(segments[2]);
      return sendJson(response, 201, {
        portfolio: {
          projectName: portfolio.projectName,
          fileName: portfolio.fileName,
          transcriptions: portfolio.transcriptions,
          downloadUrl: `/api/projects/${encodeURIComponent(segments[2])}/portfolio?file=${encodeURIComponent(portfolio.fileName)}`
        }
      });
    } catch (error) {
      return sendError(response, 400, String(error.message || error));
    }
  }
  if (["GET", "HEAD"].includes(request.method) && segments.length === 4 && segments[0] === "api" && segments[1] === "projects" && segments[3] === "portfolio") {
    const fileName = safeFileName(url.searchParams.get("file"));
    const portfolioPath = path.resolve(projectPortfoliosDir, fileName);
    if (!isPathInside(projectPortfoliosDir, portfolioPath)) return sendError(response, 403, "Invalid project portfolio path.");
    try {
      await fsp.access(portfolioPath);
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName.replace(/[\r\n"]/g, "_")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      if (request.method === "HEAD") return response.end();
      return fs.createReadStream(portfolioPath).pipe(response);
    } catch {
      return sendError(response, 404, "That local project portfolio is no longer available.");
    }
  }
  if (request.method === "POST" && segments.length === 4 && segments[0] === "api" && segments[1] === "projects" && segments[3] === "package") {
    try {
      return sendJson(response, 201, { project: await packageProject(segments[2]) });
    } catch (error) {
      return sendError(response, 400, String(error.message || error));
    }
  }
  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "jobs") {
    const job = jobs.get(segments[2]);
    if (!job) return sendError(response, 404, "This local transcription session no longer exists.");
    if (request.method === "GET" && segments.length === 3) return sendJson(response, 200, { job: publicJob(job) });
    if (request.method === "PATCH" && segments.length === 5 && segments[3] === "speakers") {
      if (job.state !== "completed") return sendError(response, 409, "Wait for the local transcription to finish before labeling speakers.");
      try {
        const payload = await readJsonBody(request);
        await renameJobSpeaker(job, segments[4], payload?.name);
        return sendJson(response, 200, { job: publicJob(job) });
      } catch (error) {
        return sendError(response, 400, String(error.message || error));
      }
    }
    if (request.method === "PATCH" && segments.length === 6 && segments[3] === "segments" && segments[5] === "speaker") {
      if (job.state !== "completed") return sendError(response, 409, "Wait for the local transcription to finish before labeling speakers.");
      try {
        const payload = await readJsonBody(request);
        await assignSegmentSpeaker(job, segments[4], payload?.name);
        return sendJson(response, 200, { job: publicJob(job) });
      } catch (error) {
        return sendError(response, 400, String(error.message || error));
      }
    }
    if (request.method === "DELETE" && segments.length === 3) {
      if (job.state === "processing" || job.state === "uploading") return sendError(response, 409, "Wait for the active job to finish before clearing it.");
      jobs.delete(job.id);
      const queuedIndex = pendingJobIds.indexOf(job.id);
      if (queuedIndex >= 0) pendingJobIds.splice(queuedIndex, 1);
      await Promise.all([removeIfPresent(job.sourcePath), removeIfPresent(job.playbackPath), ...Object.values(job.outputFiles || {}).filter(Boolean).map(removeIfPresent), ...(job.internalFiles || []).filter(Boolean).map(removeIfPresent)]);
      return sendJson(response, 200, { ok: true });
    }
    if (["GET", "HEAD"].includes(request.method) && segments.length === 4 && segments[3] === "media") {
      if (job.state !== "completed" || !job.playbackPath) return sendError(response, 404, "The local review audio is not available yet.");
      return streamPlaybackWav(request, response, job.playbackPath);
    }
    if (request.method === "GET" && segments[3] === "export") {
      const format = url.searchParams.get("format");
      const output = job.outputFiles && job.outputFiles[`${format}Path`];
      if (!output || !["txt", "srt", "pdf"].includes(format)) return sendError(response, 404, "That export is not available yet.");
      const downloadName = `${path.parse(job.name).name}.${format}`.replace(/[\r\n"]/g, "_");
      response.writeHead(200, {
        "Content-Type": format === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return fs.createReadStream(output).pipe(response);
    }
  }
  return sendError(response, 404, "Unknown local API route.");
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const target = path.resolve(publicDir, `.${requested}`);
  if (!isPathInside(publicDir, target)) return sendError(response, 403, "Invalid path.");
  try {
    const file = await fsp.readFile(target);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'"
    });
    response.end(file);
  } catch (error) {
    sendError(response, error.code === "ENOENT" ? 404 : 500, "Unable to load this local page.");
  }
}

export async function startServer({ port } = {}) {
  await Promise.all([loadConfig(), fsp.mkdir(incomingDir, { recursive: true }), fsp.mkdir(workspaceDir, { recursive: true }), fsp.mkdir(exportsDir, { recursive: true }), fsp.mkdir(playbackDir, { recursive: true }), fsp.mkdir(projectsDir, { recursive: true }), fsp.mkdir(projectPortfoliosDir, { recursive: true })]);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      void handleApi(request, response, url).catch((error) => {
        console.error(error);
        if (!response.headersSent) sendError(response, 500, "The local service ran into an unexpected error.");
        else response.end();
      });
    } else {
      void serveStatic(response, url.pathname);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port ?? config.port, "127.0.0.1", () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : (port ?? config.port);
      console.log(`CID EchoTrace Local is ready at http://127.0.0.1:${activePort}`);
      console.log("All processing routes are bound to localhost only.");
      resolve({ server, port: activePort, runtimeDir });
    });
  });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
