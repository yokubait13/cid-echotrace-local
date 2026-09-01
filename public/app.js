const state = {
  jobs: [],
  selectedJobId: null,
  health: null,
  includedModelId: "fast",
  pollTimer: null,
  toastTimer: null,
  view: "workspace",
  libraryProjectId: null,
  expandedProjectIds: new Set(),
  searchMatchIndex: 0,
  audioJobId: null,
  activeSegmentId: null
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  dropCard: document.querySelector("#dropCard"),
  browseButton: document.querySelector("#browseButton"),
  navJobCount: document.querySelector("#navJobCount"),
  navLinks: [...document.querySelectorAll(".nav-link[data-view]")],
  projectNav: document.querySelector("#projectNav"),
  railQueue: document.querySelector("#railQueue"),
  railQueueCount: document.querySelector("#railQueueCount"),
  railQueueEmpty: document.querySelector("#railQueueEmpty"),
  railJobList: document.querySelector("#railJobList"),
  workspacePanels: [...document.querySelectorAll("[data-workspace-panel]")],
  libraryView: document.querySelector("#libraryView"),
  libraryList: document.querySelector("#libraryList"),
  emptyLibrary: document.querySelector("#emptyLibrary"),
  transcriptPanel: document.querySelector("#transcriptPanel"),
  transcriptTitle: document.querySelector("#transcriptTitle"),
  transcriptBody: document.querySelector("#transcriptBody"),
  transcriptSummary: document.querySelector("#transcriptSummary"),
  audioReview: document.querySelector("#audioReview"),
  audioReviewStatus: document.querySelector("#audioReviewStatus"),
  audioPlayer: document.querySelector("#audioPlayer"),
  globalSearch: document.querySelector("#globalSearch"),
  globalSearchResults: document.querySelector("#globalSearchResults"),
  search: document.querySelector("#searchTranscript"),
  searchCount: document.querySelector("#searchCount"),
  searchNext: document.querySelector("#searchNext"),
  copyButton: document.querySelector("#copyButton"),
  projectName: document.querySelector("#projectName"),
  activeJobName: document.querySelector("#activeJobName"),
  activeJobStage: document.querySelector("#activeJobStage"),
  activeProgress: document.querySelector("#activeProgress"),
  activeProgressFill: document.querySelector("#activeProgressFill"),
  activeProgressPercent: document.querySelector("#activeProgressPercent"),
  activeEngine: document.querySelector("#activeEngine"),
  queueStatus: document.querySelector("#queueStatus"),
  engineCard: document.querySelector("#engineCard"),
  engineMessage: document.querySelector("#engineMessage"),
  refreshEngine: document.querySelector("#refreshEngine"),
  modalBackdrop: document.querySelector("#modalBackdrop"),
  helpButton: document.querySelector("#helpButton"),
  settingsButton: document.querySelector("#settingsButton"),
  modalClose: document.querySelector("#modalClose"),
  toast: document.querySelector("#toast"),
  pageTitle: document.querySelector("#pageTitle")
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function wildcardExpression(query, flags = "i") {
  const normalized = String(query || "");
  if (normalized === "*") return new RegExp("[\\s\\S]+", flags);
  const source = [...normalized].map((character) => {
    if (character === "*") return "[\\s\\S]*?";
    if (character === "?") return "[\\s\\S]";
    return character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return source ? new RegExp(source, flags) : null;
}

function transcriptSearchText(job) {
  if (job.segments?.length) return job.segments.map((segment) => segment.text || "").join("\n");
  return String(job.transcript || "");
}

function countWildcardMatches(text, query) {
  const matcher = wildcardExpression(query, "gi");
  if (!matcher || !text) return 0;
  let count = 0;
  for (const match of text.matchAll(matcher)) {
    // A bare * can also match at the end of text. It is not a useful result.
    if (match[0]) count += 1;
  }
  return count;
}

function wildcardPreview(text, query) {
  const matcher = wildcardExpression(query, "i");
  const match = matcher?.exec(text);
  if (!match || !match[0]) return escapeHtml(text.slice(0, 150));
  const prefixStart = Math.max(0, match.index - 48);
  const matchEnd = Math.min(text.length, match.index + match[0].length);
  const suffixEnd = Math.min(text.length, matchEnd + 82);
  const prefix = `${prefixStart > 0 ? "…" : ""}${escapeHtml(text.slice(prefixStart, match.index))}`;
  const selected = escapeHtml(text.slice(match.index, matchEnd));
  const suffix = `${escapeHtml(text.slice(matchEnd, suffixEnd))}${suffixEnd < text.length ? "…" : ""}`;
  return `${prefix}<mark>${selected}</mark>${suffix}`;
}

function renderGlobalSearch() {
  const query = elements.globalSearch.value.trim();
  if (!query) {
    elements.globalSearchResults.hidden = true;
    elements.globalSearchResults.innerHTML = "";
    return;
  }
  const results = state.jobs.filter((job) => job.state === "completed" && transcriptSearchText(job).trim()).map((job) => {
    const text = transcriptSearchText(job);
    return { job, text, matches: countWildcardMatches(text, query) };
  }).filter((result) => result.matches > 0);
  const visibleResults = results.slice(0, 50);
  const summary = results.length
    ? `${results.length} ${results.length === 1 ? "transcript matches" : "transcripts match"}${results.length > visibleResults.length ? ` · showing the first ${visibleResults.length}` : ""}`
    : "No completed local transcript matches this search.";
  elements.globalSearchResults.innerHTML = `<p class="global-search-summary">${summary}</p>${visibleResults.length ? visibleResults.map(({ job, text, matches }) => `<button class="global-search-result" type="button" data-global-search-job="${escapeHtml(job.id)}"><strong>${escapeHtml(job.name)}</strong><span>${wildcardPreview(text, query)}</span><small>${matches} ${matches === 1 ? "match" : "matches"} · ${escapeHtml(job.projectName || "Ungrouped files")}</small></button>`).join("") : `<p class="global-search-empty">Use <b>*</b> for any number of characters or <b>?</b> for one character. Search stays on this device.</p>`}`;
  elements.globalSearchResults.hidden = false;
}

function titleFromFile(fileName) {
  return String(fileName || "Transcript").replace(/\.[^.]+$/, "");
}

function selectedCompletedJob() {
  return state.jobs.find((job) => job.id === state.selectedJobId && job.state === "completed") || null;
}

function showToast(message, type = "") {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${type}`;
  state.toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 3800);
}

async function request(url, options) {
  const response = await fetch(url, options);
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || `Local request failed (${response.status}).`);
  return payload;
}

async function loadHealth() {
  try {
    const health = await request("/api/health");
    state.health = health;
    const configured = health.models || [];
    const ready = configured.filter((model) => model.ready);
    const engineReady = !health.engine || [health.engine.ffmpeg, health.engine.whisper].every((component) => component.ready !== false);
    const icmvReady = health.engine?.icmv?.ready === true;
    const gpu = health.engine?.gpu;
    const gpuMessage = gpu?.runtimeReady && gpu?.enabled === false
      ? " GPU acceleration was disabled during installation; CPU fallback is active."
      : gpu?.runtimeReady && gpu?.detected
      ? ` NVIDIA GPU acceleration is ready (${gpu.devices?.[0]?.name || "NVIDIA GPU"}).`
      : gpu?.runtimeReady ? " The included CUDA runtime will fall back to CPU when no NVIDIA GPU is available."
        : "";
    if (ready.length && engineReady) {
      state.includedModelId = ready.find((model) => model.id === health.defaultModel)?.id || ready[0].id;
      elements.engineCard.className = "engine-card ready";
      elements.engineMessage.textContent = `The included Whisper model is ready.${gpuMessage}${health.engine?.vad?.ready ? " Local speech detection is included." : ""}${icmvReady ? " ICMV WAV decoding is included." : ""} Nothing is sent online.`;
    } else if (!engineReady) {
      elements.engineCard.className = "engine-card warning";
      elements.engineMessage.textContent = "The included transcription runtime could not be found. Reinstall CID EchoTrace Local.";
    } else {
      elements.engineCard.className = "engine-card warning";
      elements.engineMessage.textContent = "The included Whisper model could not be found. Reinstall CID EchoTrace Local.";
    }
  } catch (error) {
    elements.engineCard.className = "engine-card warning";
    elements.engineMessage.textContent = "The local service is unavailable. Start it with npm start, then refresh this page.";
  }
}

async function loadJobs() {
  try {
    const { jobs } = await request("/api/jobs");
    state.jobs = jobs;
    if (state.selectedJobId && !jobs.some((job) => job.id === state.selectedJobId)) state.selectedJobId = null;
    renderJobs();
    renderProjectNav();
    renderProcessingStatus();
    renderLibrary();
    renderTranscript();
    renderGlobalSearch();
    setPolling(Boolean(jobs.find((job) => ["uploading", "queued", "processing"].includes(job.state))));
  } catch (error) {
    console.warn(error);
  }
}

function stateLabel(job) {
  if (job.state === "completed") return "Ready";
  if (job.state === "failed") return "Issue";
  if (job.state === "uploading") return "Adding";
  if (job.state === "queued") return "Queued";
  return "Processing";
}

function fileIcon() {
  return `<span class="file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7a2 2 0 0 1-2-2v-13a2.5 2.5 0 0 1 2.5-2.5Z"/><path d="M14 3.5v4h4M8.5 14.5c1-2 2-2 3 0s2 2 3 0 2-2 3 0"/></svg></span>`;
}

function jobMeta(job) {
  const device = job.processingDevice ? ` <span>•</span> ${escapeHtml(job.processingDevice)}` : "";
  return `${escapeHtml(job.modelLabel)} <span>•</span> ${job.language === "auto" ? "Auto language" : escapeHtml(job.language.toUpperCase())}${device}`;
}

function renderProcessingStatus() {
  const working = state.jobs.find((job) => job.state === "processing");
  const pending = state.jobs.filter((job) => ["uploading", "queued"].includes(job.state));
  const active = working || pending[0] || null;
  const percent = Math.max(0, Math.min(100, Math.round(Number(active?.progress) || 0)));
  const queueCount = pending.length;
  elements.activeProgressFill.style.width = `${percent}%`;
  elements.activeProgress.setAttribute("aria-valuenow", String(percent));
  elements.activeProgressPercent.textContent = `${percent}%`;
  elements.queueStatus.textContent = queueCount ? `${queueCount} ${queueCount === 1 ? "file" : "files"} waiting` : (working ? "Working now" : "0 files");

  if (!active) {
    elements.activeJobName.textContent = state.jobs.length ? "All caught up" : "No active transcription";
    elements.activeJobStage.textContent = state.jobs.length ? "Every queued file is complete or needs attention." : "Add a file to begin a private local transcription.";
    elements.activeEngine.textContent = "Waiting";
    return;
  }
  elements.activeJobName.textContent = active.name;
  elements.activeJobStage.textContent = active.stage || "Preparing locally";
  if (active.processingDevice) {
    elements.activeEngine.textContent = active.processingDevice;
  } else if (state.health?.engine?.gpu?.runtimeReady && state.health.engine.gpu.detected) {
    elements.activeEngine.textContent = "NVIDIA GPU ready";
  } else {
    elements.activeEngine.textContent = "Local engine";
  }
}

function renderJobs() {
  const jobs = state.jobs;
  elements.navJobCount.textContent = jobs.length;
  elements.railQueueCount.textContent = jobs.length;
  elements.railQueueEmpty.hidden = Boolean(jobs.length);
  elements.railJobList.hidden = !jobs.length;
  if (!jobs.length) {
    elements.railJobList.innerHTML = "";
    return;
  }
  const order = { processing: 0, uploading: 1, queued: 2, failed: 3, completed: 4 };
  const orderedJobs = [...jobs].sort((left, right) => (order[left.state] - order[right.state]) || right.createdAt.localeCompare(left.createdAt));
  elements.railJobList.innerHTML = orderedJobs.map((job) => {
    const selected = job.id === state.selectedJobId;
    const working = ["processing", "uploading", "queued"].includes(job.state);
    return `<button class="rail-job ${selected ? "selected" : ""} ${working ? "working" : ""}" type="button" data-rail-job-id="${job.id}" title="${escapeHtml(job.name)}">
      ${fileIcon()}
      <span class="rail-job-copy"><strong>${escapeHtml(job.name)}</strong><small>${escapeHtml(stateLabel(job))}${working ? ` · ${Math.round(Number(job.progress) || 0)}%` : ""}</small></span>
    </button>`;
  }).join("");
}

function projectGroupsFor(jobs = state.jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const projectId = job.projectId || "legacy-project";
    if (!groups.has(projectId)) groups.set(projectId, { id: projectId, name: job.projectName || "Ungrouped files", jobs: [] });
    groups.get(projectId).jobs.push(job);
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function folderIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2.2 2.3H18A2.5 2.5 0 0 1 20.5 9v8.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z"/></svg>`;
}

function renderProjectNav() {
  const projects = projectGroupsFor();
  elements.projectNav.hidden = !projects.length;
  if (!projects.length) {
    elements.projectNav.innerHTML = "";
    return;
  }
  elements.projectNav.innerHTML = `<p class="project-nav-label">PROJECT FOLDERS</p>${projects.map((project) => {
    const expanded = state.expandedProjectIds.has(project.id);
    return `<section class="project-folder ${state.libraryProjectId === project.id ? "active" : ""}">
      <div class="project-folder-header">
        <button class="project-folder-toggle" type="button" data-project-toggle="${escapeHtml(project.id)}" aria-expanded="${expanded}" title="Show files in ${escapeHtml(project.name)}">${folderIcon()}<span>${escapeHtml(project.name)}</span><em>${project.jobs.length}</em><i aria-hidden="true"></i></button>
        <button class="project-folder-open" type="button" data-project-nav-id="${escapeHtml(project.id)}" title="Open ${escapeHtml(project.name)} in the library">View</button>
      </div>
      <div class="project-file-list" ${expanded ? "" : "hidden"}>${project.jobs.map((job) => `<button class="project-file-item ${job.id === state.selectedJobId ? "selected" : ""}" type="button" data-project-nav-job-id="${job.id}" title="${escapeHtml(job.name)}"><span>${escapeHtml(job.name)}</span><em>${escapeHtml(stateLabel(job))}</em></button>`).join("")}</div>
    </section>`;
  }).join("")}`;
}

function renderLibrary() {
  const allProjects = projectGroupsFor();
  if (state.libraryProjectId && !allProjects.some((project) => project.id === state.libraryProjectId)) state.libraryProjectId = null;
  const jobs = state.libraryProjectId ? state.jobs.filter((job) => (job.projectId || "legacy-project") === state.libraryProjectId) : state.jobs;
  elements.emptyLibrary.hidden = Boolean(jobs.length);
  elements.libraryList.hidden = !jobs.length;
  if (!jobs.length) {
    elements.libraryList.innerHTML = "";
    return;
  }
  elements.libraryList.innerHTML = projectGroupsFor(jobs).map((project) => {
    const completed = project.jobs.filter((job) => job.state === "completed").length;
    const cards = project.jobs.map((job) => {
      const complete = job.state === "completed";
      const failed = job.state === "failed";
      const open = complete ? `<button class="library-action" type="button" data-library-action="open" data-id="${job.id}">Open transcript</button>` : "";
      const play = complete && job.mediaAvailable ? `<button class="library-action primary" type="button" data-library-action="play" data-id="${job.id}">Play audio</button>` : "";
      const clear = !["processing", "uploading"].includes(job.state) ? `<button class="library-action danger" type="button" data-library-action="clear" data-id="${job.id}">Clear</button>` : "";
      const reviewStatus = complete ? (job.mediaAvailable ? "Transcript and synchronized review audio are ready on this device." : "Transcript is ready; review audio is unavailable for this older item.") : (failed ? escapeHtml(job.error || "The engine needs attention.") : `Working: ${escapeHtml(job.stage || "Preparing")}`);
      return `<article class="library-card ${job.id === state.selectedJobId ? "selected" : ""}">
        ${fileIcon()}
        <div class="library-info">
          <div class="job-title-row"><p class="job-title" title="${escapeHtml(job.name)}">${escapeHtml(job.name)}</p><span class="job-state ${failed ? "failed" : ""}">${escapeHtml(stateLabel(job))}</span></div>
          <p class="job-meta"><span>${jobMeta(job)}</span></p>
          <p class="library-description">${reviewStatus}</p>
        </div>
        <div class="library-actions">${open}${play}${clear}</div>
      </article>`;
    }).join("");
    return `<section class="library-project">
      <header class="library-project-header">
        <div><p class="section-kicker">Project folder</p><h3>${escapeHtml(project.name)}</h3><p>${project.jobs.length} ${project.jobs.length === 1 ? "source file" : "source files"} · ${completed} ${completed === 1 ? "completed transcript" : "completed transcripts"}</p></div>
        <div class="project-export-actions"><button class="library-action portfolio-project" type="button" data-library-action="portfolio" data-project-id="${escapeHtml(project.id)}">Export PDF portfolio</button><button class="library-action package-project" type="button" data-library-action="package" data-project-id="${escapeHtml(project.id)}">Package folder</button></div>
      </header>
      <p class="library-project-hint">PDF portfolio compiles every completed PDF transcription in this project folder. Package folder also copies the original media, individual exports, the portfolio, and a manifest.</p>
      <div class="project-job-list">${cards}</div>
    </section>`;
  }).join("");
}

function durationLabel(job) {
  if (!job.segments?.length) return "Timestamped transcript";
  const last = job.segments[job.segments.length - 1];
  const seconds = Math.max(0, Math.round((last.endMs || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${String(seconds % 60).padStart(2, "0")} sec` : `${seconds} sec`;
}

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function highlight(text, query) {
  const source = String(text || "");
  const matcher = wildcardExpression(query, "gi");
  if (!matcher) return escapeHtml(source);
  let output = "";
  let cursor = 0;
  for (const match of source.matchAll(matcher)) {
    // Do not add a misleading highlight for an empty wildcard match.
    if (!match[0]) continue;
    output += `${escapeHtml(source.slice(cursor, match.index))}<mark>${escapeHtml(match[0])}</mark>`;
    cursor = match.index + match[0].length;
  }
  return output ? `${output}${escapeHtml(source.slice(cursor))}` : escapeHtml(source);
}

function updateSearchMatches({ scroll = false } = {}) {
  const query = elements.search.value.trim();
  const matches = [...elements.transcriptBody.querySelectorAll("mark")];
  if (!query || !matches.length) {
    state.searchMatchIndex = 0;
    elements.searchCount.textContent = query ? "No matches" : "";
    elements.searchNext.disabled = true;
    return;
  }
  state.searchMatchIndex = ((state.searchMatchIndex % matches.length) + matches.length) % matches.length;
  matches.forEach((match, index) => match.classList.toggle("active", index === state.searchMatchIndex));
  elements.searchCount.textContent = `${state.searchMatchIndex + 1} / ${matches.length}`;
  elements.searchNext.disabled = false;
  if (scroll) matches[state.searchMatchIndex].scrollIntoView({ behavior: "smooth", block: "center" });
}

function moveToNextSearchMatch() {
  const matches = elements.transcriptBody.querySelectorAll("mark");
  if (!matches.length) return;
  state.searchMatchIndex = (state.searchMatchIndex + 1) % matches.length;
  updateSearchMatches({ scroll: true });
}

function resetPlaybackPlayer() {
  elements.audioPlayer.pause();
  elements.audioPlayer.removeAttribute("src");
  elements.audioPlayer.load();
  state.audioJobId = null;
  state.activeSegmentId = null;
}

function configurePlaybackPlayer(job) {
  if (!job?.mediaAvailable) {
    resetPlaybackPlayer();
    return false;
  }
  const mediaUrl = new URL(`/api/jobs/${encodeURIComponent(job.id)}/media`, window.location.origin).href;
  if (state.audioJobId === job.id && elements.audioPlayer.src === mediaUrl) return true;
  elements.audioPlayer.pause();
  elements.audioPlayer.src = mediaUrl;
  elements.audioPlayer.load();
  state.audioJobId = job.id;
  state.activeSegmentId = null;
  return true;
}

function shortPlaybackTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function updatePlaybackStatus() {
  const job = selectedCompletedJob();
  if (!job?.mediaAvailable || state.audioJobId !== job.id) {
    elements.audioReviewStatus.textContent = "Ready to play";
    return;
  }
  const player = elements.audioPlayer;
  const duration = Number.isFinite(player.duration) ? ` of ${shortPlaybackTime(player.duration)}` : "";
  const current = shortPlaybackTime(player.currentTime);
  elements.audioReviewStatus.textContent = player.paused ? (player.currentTime > 0 ? `Paused at ${current}` : "Ready to play") : `Playing ${current}${duration}`;
}

function activeSegmentForTime(job, timeMs) {
  const segments = job.segments || [];
  return segments.find((segment) => Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && timeMs >= segment.startMs && timeMs <= segment.endMs) || null;
}

function syncPlaybackHighlight({ scroll = true } = {}) {
  const job = selectedCompletedJob();
  if (!job?.mediaAvailable || state.audioJobId !== job.id) return;
  const active = activeSegmentForTime(job, elements.audioPlayer.currentTime * 1000);
  const nextId = active?.id || null;
  if (state.activeSegmentId === nextId) return;
  state.activeSegmentId = nextId;
  elements.transcriptBody.querySelectorAll("[data-segment-row]").forEach((line) => {
    line.classList.toggle("playing", line.dataset.segmentRow === nextId);
  });
  if (scroll && nextId) {
    elements.transcriptBody.querySelector(`[data-segment-row="${CSS.escape(nextId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function waitForAudioMetadata() {
  const player = elements.audioPlayer;
  if (player.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (callback) => {
      player.removeEventListener("loadedmetadata", onMetadata);
      player.removeEventListener("error", onError);
      callback();
    };
    const onMetadata = () => finish(resolve);
    const onError = () => finish(() => reject(new Error("The local review audio could not be loaded.")));
    player.addEventListener("loadedmetadata", onMetadata, { once: true });
    player.addEventListener("error", onError, { once: true });
  });
}

async function playFrom(milliseconds) {
  const job = selectedCompletedJob();
  if (!job?.mediaAvailable) {
    showToast("Review audio is not available for this transcript.", "error");
    return;
  }
  try {
    configurePlaybackPlayer(job);
    await waitForAudioMetadata();
    const targetSeconds = Math.max(0, Number(milliseconds) || 0) / 1000;
    elements.audioPlayer.currentTime = Number.isFinite(elements.audioPlayer.duration) ? Math.min(targetSeconds, Math.max(0, elements.audioPlayer.duration - 0.01)) : targetSeconds;
    await elements.audioPlayer.play();
    syncPlaybackHighlight({ scroll: false });
    updatePlaybackStatus();
  } catch (error) {
    showToast(error.message || "The local review audio could not be played.", "error");
  }
}

function renderTranscript() {
  const job = selectedCompletedJob();
  document.body.classList.toggle("transcript-selected", state.view === "workspace" && Boolean(job));
  elements.transcriptPanel.hidden = state.view !== "workspace" || !job;
  if (!job) {
    resetPlaybackPlayer();
    updateSearchMatches();
    if (state.view === "workspace") elements.pageTitle.textContent = "New transcription";
    return;
  }
  if (state.view !== "workspace") return;
  elements.pageTitle.textContent = titleFromFile(job.name);
  elements.transcriptTitle.textContent = titleFromFile(job.name);
  elements.transcriptSummary.innerHTML = `<span class="summary-chip"><strong>${wordCount(job.transcript)}</strong> words</span><span class="summary-chip">${durationLabel(job)}</span><span class="summary-chip">${escapeHtml(job.modelLabel)}</span>${["txt", "srt", "pdf"].map((format) => `<a class="export-button" href="/api/jobs/${job.id}/export?format=${format}" download>Export ${format.toUpperCase()}</a>`).join("")}`;
  elements.audioReview.hidden = !job.mediaAvailable;
  if (job.mediaAvailable) configurePlaybackPlayer(job);
  else resetPlaybackPlayer();
  updatePlaybackStatus();

  const query = elements.search.value.trim();
  const lines = job.segments?.length ? job.segments : [{ id: "full", start: "Transcript", text: job.transcript }];
  elements.transcriptBody.innerHTML = lines.map((segment) => {
    const hasTimestamp = Number.isFinite(segment.startMs);
    const timestamp = hasTimestamp
      ? `<button class="timestamp" type="button" data-seek-ms="${segment.startMs}" aria-label="Play from ${escapeHtml(segment.start)}">${escapeHtml(segment.start)}</button>`
      : `<time class="timestamp">${escapeHtml(segment.start || "Transcript")}</time>`;
    return `<article class="transcript-line" data-segment-row="${escapeHtml(segment.id)}">${timestamp}<div class="segment-text" contenteditable="true" spellcheck="true" data-segment="${escapeHtml(segment.id)}">${highlight(segment.text, query)}</div></article>`;
  }).join("");
  updateSearchMatches();
  state.activeSegmentId = null;
  syncPlaybackHighlight({ scroll: false });
}

function setView(view, updateHash = true) {
  const nextView = view === "library" ? "library" : "workspace";
  state.view = nextView;
  if (nextView !== "workspace") document.body.classList.remove("transcript-selected");
  elements.workspacePanels.forEach((panel) => { panel.hidden = nextView !== "workspace"; });
  elements.libraryView.hidden = nextView !== "library";
  elements.navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === nextView));
  if (nextView === "library") {
    elements.audioPlayer.pause();
    elements.pageTitle.textContent = "Local library";
    renderLibrary();
  } else {
    renderTranscript();
  }
  if (updateHash && window.location.hash !== `#${nextView}`) window.location.hash = nextView;
}

function openTranscript(id, { play = false } = {}) {
  state.selectedJobId = id;
  setView("workspace");
  renderJobs();
  renderProjectNav();
  renderLibrary();
  renderTranscript();
  document.querySelector("#transcriptPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (play) void playFrom(0);
}

function setPolling(active) {
  if (active && !state.pollTimer) state.pollTimer = setInterval(loadJobs, 500);
  if (!active && state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function uploadFiles(files) {
  const selectedFiles = [...(files || [])];
  if (!selectedFiles.length) return;
  const readyModels = state.health?.models?.filter((model) => model.ready) || [];
  if (!readyModels.length) {
    showToast("The included Whisper model is not ready. Reinstall CID EchoTrace Local.", "error");
    elements.settingsButton.click();
    return;
  }
  const oversized = selectedFiles.find((file) => file.size > state.health.maxUploadBytes);
  if (oversized) return showToast(`${oversized.name} is larger than this workspace's configured limit.`, "error");
  elements.dropCard.classList.remove("dragging");
  elements.browseButton.disabled = true;
  let added = 0;
  const failed = [];
  try {
    for (const [index, file] of selectedFiles.entries()) {
      elements.browseButton.textContent = selectedFiles.length === 1 ? "Adding locally…" : `Adding ${index + 1} of ${selectedFiles.length}…`;
      try {
        const result = await request("/api/jobs", {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
            "X-Model-Id": state.includedModelId,
            "X-Project-Name": encodeURIComponent(elements.projectName.value.trim() || "Untitled project")
          },
          body: file
        });
        state.jobs.unshift(result.job);
        state.selectedJobId = result.job.id;
        added += 1;
        renderJobs();
        renderProjectNav();
        renderProcessingStatus();
        renderLibrary();
      } catch (error) {
        failed.push(`${file.name}: ${error.message}`);
      }
    }
    renderTranscript();
    if (added) {
      setPolling(true);
    showToast(`${added} ${added === 1 ? "file was" : "files were"} added. CID EchoTrace processes one file at a time.`);
    }
    if (failed.length) showToast(failed.join(" "), "error");
  } finally {
    elements.browseButton.disabled = false;
    elements.browseButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0-11-4 4m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg> Choose a file`;
    elements.fileInput.value = "";
    await loadJobs();
  }
}

async function clearJob(id) {
  const job = state.jobs.find((candidate) => candidate.id === id);
  if (!job || !window.confirm(`Clear ${job.name} and its locally generated exports and review audio?`)) return;
  try {
    await request(`/api/jobs/${id}`, { method: "DELETE" });
    if (state.selectedJobId === id) state.selectedJobId = null;
    await loadJobs();
    showToast("The local transcript, exports, and review audio were cleared.");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function packageProject(projectId) {
  const project = state.jobs.find((job) => job.projectId === projectId);
  if (!project) return;
  try {
    const result = await request(`/api/projects/${encodeURIComponent(projectId)}/package`, { method: "POST" });
    const packaged = result.project;
    showToast(`${packaged.projectName} was packaged with ${packaged.files} ${packaged.files === 1 ? "file" : "files"}. Use CID EchoTrace Local > Open data folder to view it.`);
  } catch (error) {
    showToast(error.message || "The project could not be packaged.", "error");
  }
}

async function exportProjectPortfolio(projectId) {
  const project = state.jobs.find((job) => job.projectId === projectId);
  if (!project) return;
  try {
    const result = await request(`/api/projects/${encodeURIComponent(projectId)}/portfolio`, { method: "POST" });
    const portfolio = result.portfolio;
    const download = document.createElement("a");
    download.href = portfolio.downloadUrl;
    download.download = portfolio.fileName;
    document.body.append(download);
    download.click();
    download.remove();
    showToast(`${portfolio.projectName} PDF portfolio downloaded with all ${portfolio.transcriptions} completed ${portfolio.transcriptions === 1 ? "transcription" : "transcriptions"} in this project folder.`);
  } catch (error) {
    showToast(error.message || "The PDF portfolio could not be created.", "error");
  }
}

function showModal() { elements.modalBackdrop.hidden = false; elements.modalClose.focus(); }
function closeModal() { elements.modalBackdrop.hidden = true; }
function isDesktopApp() { return Boolean(window.echoTraceDesktop); }

elements.browseButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => uploadFiles(elements.fileInput.files));
["dragenter", "dragover"].forEach((eventName) => elements.dropCard.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropCard.classList.add("dragging"); }));
["dragleave", "drop"].forEach((eventName) => elements.dropCard.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropCard.classList.remove("dragging"); }));
elements.dropCard.addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files));
elements.refreshEngine.addEventListener("click", loadHealth);
elements.railJobList.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-rail-job-id]");
  if (!target) return;
  openTranscript(target.dataset.railJobId);
});
elements.libraryList.addEventListener("click", (event) => {
  const target = event.target.closest("button[data-library-action]");
  if (!target) return;
  if (target.dataset.libraryAction === "portfolio") void exportProjectPortfolio(target.dataset.projectId);
  if (target.dataset.libraryAction === "package") void packageProject(target.dataset.projectId);
  if (target.dataset.libraryAction === "clear") void clearJob(target.dataset.id);
  if (target.dataset.libraryAction === "open") openTranscript(target.dataset.id);
  if (target.dataset.libraryAction === "play") openTranscript(target.dataset.id, { play: true });
});
elements.transcriptBody.addEventListener("click", (event) => {
  const timestamp = event.target.closest("button[data-seek-ms]");
  if (!timestamp) return;
  void playFrom(Number(timestamp.dataset.seekMs));
});
elements.globalSearch.addEventListener("input", renderGlobalSearch);
elements.globalSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const firstResult = elements.globalSearchResults.querySelector("button[data-global-search-job]");
    if (!firstResult) return;
    event.preventDefault();
    firstResult.click();
  }
  if (event.key === "Escape") {
    elements.globalSearchResults.hidden = true;
    elements.globalSearch.blur();
  }
});
elements.globalSearchResults.addEventListener("click", (event) => {
  const result = event.target.closest("button[data-global-search-job]");
  if (!result) return;
  elements.search.value = elements.globalSearch.value.trim();
  state.searchMatchIndex = 0;
  elements.globalSearchResults.hidden = true;
  openTranscript(result.dataset.globalSearchJob);
});
elements.search.addEventListener("input", () => {
  state.searchMatchIndex = 0;
  renderTranscript();
  updateSearchMatches({ scroll: true });
});
elements.search.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  moveToNextSearchMatch();
});
elements.searchNext.addEventListener("click", moveToNextSearchMatch);
elements.copyButton.addEventListener("click", async () => {
  const job = selectedCompletedJob();
  if (!job) return;
  try {
    await navigator.clipboard.writeText(job.transcript);
    showToast("Transcript copied to your clipboard.");
  } catch {
    showToast("Your browser did not allow copying. Select the text and copy it manually.", "error");
  }
});
elements.navLinks.forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  if (link.dataset.view === "library") state.libraryProjectId = null;
  setView(link.dataset.view);
}));
elements.projectNav.addEventListener("click", (event) => {
  const folder = event.target.closest("button[data-project-toggle]");
  if (folder) {
    const projectId = folder.dataset.projectToggle;
    if (state.expandedProjectIds.has(projectId)) state.expandedProjectIds.delete(projectId);
    else state.expandedProjectIds.add(projectId);
    renderProjectNav();
    return;
  }
  const file = event.target.closest("button[data-project-nav-job-id]");
  if (file) {
    openTranscript(file.dataset.projectNavJobId);
    return;
  }
  const target = event.target.closest("button[data-project-nav-id]");
  if (target) {
    state.libraryProjectId = target.dataset.projectNavId;
    setView("library");
    renderProjectNav();
    renderLibrary();
  }
});
window.addEventListener("hashchange", () => setView(window.location.hash === "#library" ? "library" : "workspace", false));
elements.audioPlayer.addEventListener("loadedmetadata", () => { updatePlaybackStatus(); syncPlaybackHighlight({ scroll: false }); });
elements.audioPlayer.addEventListener("timeupdate", () => { updatePlaybackStatus(); syncPlaybackHighlight(); });
elements.audioPlayer.addEventListener("seeking", () => { updatePlaybackStatus(); syncPlaybackHighlight({ scroll: false }); });
elements.audioPlayer.addEventListener("seeked", () => { updatePlaybackStatus(); syncPlaybackHighlight({ scroll: false }); });
elements.audioPlayer.addEventListener("play", updatePlaybackStatus);
elements.audioPlayer.addEventListener("pause", updatePlaybackStatus);
elements.audioPlayer.addEventListener("ended", () => { updatePlaybackStatus(); syncPlaybackHighlight({ scroll: false }); });
elements.audioPlayer.addEventListener("error", () => {
  if (selectedCompletedJob()?.mediaAvailable) elements.audioReviewStatus.textContent = "Unable to load local review audio";
});
elements.helpButton.addEventListener("click", showModal);
elements.settingsButton.addEventListener("click", showModal);
elements.modalClose.addEventListener("click", closeModal);
elements.modalBackdrop.addEventListener("click", (event) => { if (event.target === elements.modalBackdrop) closeModal(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

if (isDesktopApp()) window.echoTraceDesktop.onShowHelp(showModal);

setView(window.location.hash === "#library" ? "library" : "workspace", false);
await Promise.all([loadHealth(), loadJobs()]);
