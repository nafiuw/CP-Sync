// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).

const SETTINGS_DEFAULTS = {
  githubToken: "",
  githubOwner: "",
  githubRepo: "",
  githubBranch: "main",
  commitMessageTemplate: "Solved: {problem} ({platform})",
  skipDuplicateCode: true,
  extensionEnabled: true,
  otherJudgesEnabled: true,
  platformsEnabled: {
    codeforces: true,
    codechef: true,
    leetcode: true,
    neetcode: true,
    hackerrank: true,
    vjudge: true,
    atcoder: true
  }
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    activateTab(btn.dataset.tab);
    chrome.storage.local.set({ cpsync_active_tab: btn.dataset.tab });
  });
});

function activateTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (!btn) return;
  btn.classList.add("active");
  $("tab-" + tabName).classList.add("active");
  if (tabName === "history") loadHistory();
}

chrome.storage.local.get({ cpsync_active_tab: "general" }, (res) => {
  activateTab(res.cpsync_active_tab);
});

function setStatus(el, msg, cls) {
  el.textContent = msg;
  el.className = "status " + (cls || "");
}

// ---------------------------------------------------------------------
// Pop out to a persistent tab (a toolbar popup closes the instant it
// loses focus - e.g. clicking another tab to copy a problem name - which
// wipes an in-progress Manual Push. A real tab doesn't have that problem.)
// ---------------------------------------------------------------------
$("popOutBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

if (chrome.tabs && chrome.tabs.getCurrent) {
  chrome.tabs.getCurrent((tab) => {
    if (tab) $("popOutBtn").style.display = "none"; // already a full tab, no need to offer it again
  });
}

// ---------------------------------------------------------------------
// Master on/off toggle
// ---------------------------------------------------------------------
function renderMasterState(enabled) {
  const el = $("masterState");
  el.textContent = enabled ? "Active" : "Paused";
  el.className = "master-state" + (enabled ? "" : " off");
}

$("masterToggle").addEventListener("change", async (e) => {
  const enabled = e.target.checked;
  await chrome.storage.sync.set({ extensionEnabled: enabled });
  renderMasterState(enabled);
});

// ---------------------------------------------------------------------
// General tab
// ---------------------------------------------------------------------
async function loadGeneral() {
  const settings = await chrome.storage.sync.get(SETTINGS_DEFAULTS);
  $("token").value = settings.githubToken;
  $("owner").value = settings.githubOwner;
  $("repo").value = settings.githubRepo;
  $("branch").value = settings.githubBranch || "main";
  $("otherJudgesEnabled").checked = settings.otherJudgesEnabled !== false;

  $("masterToggle").checked = settings.extensionEnabled !== false;
  renderMasterState(settings.extensionEnabled !== false);

  document.querySelectorAll("[data-platform]").forEach((el) => {
    const p = el.getAttribute("data-platform");
    el.checked = settings.platformsEnabled ? settings.platformsEnabled[p] !== false : true;
  });
}

async function saveGeneral() {
  const platformsEnabled = {};
  document.querySelectorAll("[data-platform]").forEach((el) => {
    platformsEnabled[el.getAttribute("data-platform")] = el.checked;
  });

  await chrome.storage.sync.set({
    githubToken: $("token").value.trim(),
    githubOwner: $("owner").value.trim(),
    githubRepo: $("repo").value.trim(),
    githubBranch: $("branch").value.trim() || "main",
    otherJudgesEnabled: $("otherJudgesEnabled").checked,
    platformsEnabled
  });

  setStatus($("generalStatus"), "Saved", "ok");
  setTimeout(() => setStatus($("generalStatus"), ""), 2000);
}

function testConnection() {
  setStatus($("generalStatus"), "Testing connection...");
  chrome.runtime.sendMessage({ type: "CP_SYNC_TEST_CONNECTION" }, (res) => {
    if (res && res.ok) {
      setStatus($("generalStatus"), `Connected to ${res.fullName} (branch: ${res.defaultBranch})`, "ok");
    } else {
      setStatus($("generalStatus"), "Failed: " + (res ? res.error : "unknown error"), "err");
    }
  });
}

$("save").addEventListener("click", saveGeneral);
$("test").addEventListener("click", testConnection);

// ---------------------------------------------------------------------
// Manual push tab
// ---------------------------------------------------------------------
$("mPlatform").addEventListener("change", () => {
  $("mOtherWrap").style.display = $("mPlatform").value === "other" ? "block" : "none";
});
$("mLanguage").addEventListener("change", () => {
  $("mOtherLanguageWrap").style.display = $("mLanguage").value === "other" ? "block" : "none";
});

const MANUAL_DRAFT_KEY = "cpsync_manual_draft";
const MANUAL_FIELD_IDS = [
  "mPlatform", "mLanguage", "mOtherLanguage", "mOtherName",
  "mProblemId", "mGroup", "mProblemName", "mUrl", "mCode"
];

function saveManualDraft() {
  const draft = {};
  MANUAL_FIELD_IDS.forEach((id) => (draft[id] = $(id).value));
  chrome.storage.local.set({ [MANUAL_DRAFT_KEY]: draft });
}

function loadManualDraft() {
  chrome.storage.local.get({ [MANUAL_DRAFT_KEY]: null }, (res) => {
    const draft = res[MANUAL_DRAFT_KEY];
    if (!draft) return;
    MANUAL_FIELD_IDS.forEach((id) => {
      if (draft[id] !== undefined) $(id).value = draft[id];
    });
    $("mOtherWrap").style.display = $("mPlatform").value === "other" ? "block" : "none";
    $("mOtherLanguageWrap").style.display = $("mLanguage").value === "other" ? "block" : "none";
  });
}

function clearManualDraft(fieldsToClear) {
  fieldsToClear.forEach((id) => ($(id).value = ""));
  saveManualDraft();
}

// Save on every keystroke/change - nothing typed here is ever lost, even
// if the popup closes because you clicked away to go copy something.
MANUAL_FIELD_IDS.forEach((id) => {
  $(id).addEventListener("input", saveManualDraft);
  $(id).addEventListener("change", saveManualDraft);
});

function manualPush() {
  const platformSelect = $("mPlatform").value;
  const platform = platformSelect === "other" ? ($("mOtherName").value.trim() || "other") : platformSelect;
  const problemId = $("mProblemId").value.trim();
  const problemName = $("mProblemName").value.trim() || problemId;
  const group = $("mGroup").value.trim();
  const languageSelect = $("mLanguage").value;
  const language = languageSelect === "other" ? ($("mOtherLanguage").value.trim() || "unknown") : languageSelect;
  const code = $("mCode").value;
  const url = $("mUrl").value.trim();

  if (!problemId || !code) {
    setStatus($("manualStatus"), "Problem ID and code are required.", "err");
    return;
  }
  if (platformSelect === "other" && !$("mOtherName").value.trim()) {
    setStatus($("manualStatus"), "Please name the judge for the folder.", "err");
    return;
  }

  // "group" doubles as rating (Codeforces/LeetCode/HackerRank) or contest
  // name (AtCoder/vJudge/CodeChef/Other) depending on platform - buildPath()
  // in background.js falls back sensibly either way.
  const payload = {
    platform,
    problemName,
    problemId,
    rating: group || null,
    contest: group || null,
    language,
    code,
    url: url || null,
    verdict: "Accepted"
  };

  setStatus($("manualStatus"), "Pushing...");
  $("manualPush").disabled = true;
  chrome.runtime.sendMessage({ type: "CP_SYNC_MANUAL_PUSH", payload }, (res) => {
    $("manualPush").disabled = false;
    if (res && res.ok) {
      setStatus($("manualStatus"), res.skipped ? "Skipped: identical code already pushed." : `Pushed to ${res.path}`, "ok");
      // Clear only the per-problem fields - keep platform/language selected
      // since the next problem you push is usually on the same judge.
      clearManualDraft(["mProblemId", "mGroup", "mProblemName", "mUrl", "mCode"]);
    } else {
      setStatus($("manualStatus"), "Failed: " + (res ? res.error : "unknown error") + " (your text hasn't been lost, fix and retry)", "err");
    }
    refreshStats();
  });
}

$("manualPush").addEventListener("click", manualPush);
loadManualDraft();

// ---------------------------------------------------------------------
// Autofill from current tab (Competitive-Companion style)
// ---------------------------------------------------------------------

// This runs INSIDE the target page via chrome.scripting.executeScript, not
// in the popup - it must be fully self-contained (no references to
// anything outside its own body) since its source gets serialized and
// re-executed in that page's context.
function cpSyncExtractProblemMetadata() {
  function text(el) {
    return el ? el.textContent.trim() : null;
  }
  const host = location.hostname;
  const result = { platform: null, problemId: null, problemName: null, url: location.href, rating: null };

  try {
    if (host.includes("codeforces.com")) {
      result.platform = "codeforces";
      const m = location.pathname.match(/\/(?:contest|problemset\/problem|gym)\/(\d+)\/(?:problem\/)?([A-Za-z0-9]+)/);
      if (m) result.problemId = m[1] + m[2];
      result.problemName = text(document.querySelector(".problem-statement .title")) || document.title;
      const ratingMatch = (document.body.innerText || "").match(/\*(\d{3,4})(?:\s|<|$)/);
      if (ratingMatch) result.rating = ratingMatch[1];
    } else if (host.includes("codechef.com")) {
      result.platform = "codechef";
      const parts = location.pathname.split("/").filter(Boolean);
      result.problemId = parts[parts.length - 1] || null;
      result.problemName =
        text(document.querySelector("h1, .problem-title, ._problem-title, [class*='problemTitle']")) || document.title;
    } else if (host.includes("leetcode.com")) {
      result.platform = "leetcode";
      const m = location.pathname.match(/\/problems\/([^/]+)/);
      result.problemId = m ? m[1] : null;
      result.problemName = (document.title || "").replace(/\s*-\s*LeetCode\s*$/i, "").trim();
      const diffEl = document.querySelector('[class*="difficulty" i]');
      if (diffEl) result.rating = diffEl.textContent.trim();
    } else if (host.includes("atcoder.jp")) {
      result.platform = "atcoder";
      const m = location.pathname.match(/\/contests\/([^/]+)/);
      if (m) result.rating = m[1]; // used as the "contest" grouping field
      const taskLink = document.querySelector('a[href*="/tasks/"]');
      result.problemId = taskLink ? taskLink.href.split("/tasks/")[1] : null;
      result.problemName = text(document.querySelector("h2, .h2")) || document.title;
    } else if (host.includes("hackerrank.com")) {
      result.platform = "hackerrank";
      const m = location.pathname.match(/challenges\/([^/]+)/);
      result.problemId = m ? m[1] : null;
      result.problemName =
        text(document.querySelector("h1, .challenge-page-title, [class*='challenge-title']")) || document.title;
    } else if (host.includes("vjudge.net")) {
      result.platform = "vjudge";
      result.problemName = (document.title || "").replace(/\s*-\s*vJudge\s*$/i, "").trim();
      result.problemId = result.problemName;
    } else if (host.includes("neetcode.io")) {
      result.platform = "neetcode";
      result.problemName = document.title;
      result.problemId = location.pathname.split("/").filter(Boolean).pop() || null;
    } else {
      result.platform = "other";
      result.otherName = host;
      result.problemId = location.pathname.split("/").filter(Boolean).pop() || host;
      result.problemName = document.title;
    }
  } catch (e) {
    result.error = String(e);
  }

  return result;
}

$("autofillBtn").addEventListener("click", async () => {
  setStatus($("manualStatus"), "Reading the current tab...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      setStatus($("manualStatus"), "Could not find an active tab to read.", "err");
      return;
    }

    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: cpSyncExtractProblemMetadata
    });

    const result = injection && injection[0] && injection[0].result;
    if (!result || !result.problemName) {
      setStatus($("manualStatus"), "Couldn't read a problem off that tab - fill it in manually.", "err");
      return;
    }

    if (result.platform && result.platform !== "other") {
      $("mPlatform").value = result.platform;
      $("mOtherWrap").style.display = "none";
    } else {
      $("mPlatform").value = "other";
      $("mOtherWrap").style.display = "block";
      $("mOtherName").value = result.otherName || "";
    }

    if (result.problemId) $("mProblemId").value = result.problemId;
    if (result.problemName) $("mProblemName").value = result.problemName;
    if (result.url) $("mUrl").value = result.url;
    if (result.rating) $("mGroup").value = result.rating;

    saveManualDraft();
    setStatus($("manualStatus"), "Autofilled from the current tab - paste your code and push.", "ok");
  } catch (e) {
    setStatus($("manualStatus"), "Autofill failed: " + (e.message || e) + " (the tab may be a chrome:// page or otherwise unreadable)", "err");
  }
});

$("clearAllBtn").addEventListener("click", () => {
  clearManualDraft(MANUAL_FIELD_IDS);
  $("mLanguage").value = "C++17";
  $("mPlatform").value = "codeforces";
  $("mOtherWrap").style.display = "none";
  $("mOtherLanguageWrap").style.display = "none";
  setStatus($("manualStatus"), "Cleared.", "ok");
});

// ---------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function loadHistory() {
  chrome.runtime.sendMessage({ type: "CP_SYNC_GET_HISTORY" }, (res) => {
    const list = $("historyList");
    const history = (res && res.history) || [];
    if (!history.length) {
      list.innerHTML = '<p class="hint">No pushes yet.</p>';
      return;
    }
    list.innerHTML = history
      .map(
        (h) => `
      <div class="history-item">
        <div class="history-item-top">
          <span class="history-item-name">${escapeHtml(h.problemName || h.path || "problem")}</span>
          <span class="badge ${h.status}">${h.status}</span>
        </div>
        <div class="history-item-path">${escapeHtml(h.path || "")}</div>
        <div class="history-item-time">${timeAgo(h.timestamp)} - ${escapeHtml(h.platform || "")}</div>
        ${h.status === "failed" ? `<div class="history-item-detail">${escapeHtml(h.detail || "")}</div>` : ""}
      </div>`
      )
      .join("");
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

$("retryFailed").addEventListener("click", () => {
  $("retryFailed").textContent = "Retrying...";
  chrome.runtime.sendMessage({ type: "CP_SYNC_RETRY_FAILED" }, () => {
    $("retryFailed").textContent = "Retry failed";
    loadHistory();
    refreshStats();
  });
});

$("clearHistory").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CP_SYNC_CLEAR_HISTORY" }, () => loadHistory());
});

// ---------------------------------------------------------------------
// Advanced tab
// ---------------------------------------------------------------------
async function loadAdvanced() {
  const settings = await chrome.storage.sync.get(SETTINGS_DEFAULTS);
  $("commitTemplate").value = settings.commitMessageTemplate || SETTINGS_DEFAULTS.commitMessageTemplate;
  $("skipDuplicates").checked = settings.skipDuplicateCode !== false;
}

$("saveAdvanced").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    commitMessageTemplate: $("commitTemplate").value.trim() || SETTINGS_DEFAULTS.commitMessageTemplate,
    skipDuplicateCode: $("skipDuplicates").checked
  });
  setStatus($("advancedStatus"), "Saved", "ok");
  setTimeout(() => setStatus($("advancedStatus"), ""), 2000);
});

$("exportSettings").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CP_SYNC_EXPORT_SETTINGS" }, (res) => {
    if (!res || !res.ok) {
      setStatus($("importExportStatus"), "Export failed.", "err");
      return;
    }
    const blob = new Blob([JSON.stringify(res.settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cp-sync-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus($("importExportStatus"), "Exported (token excluded for safety).", "ok");
  });
});

$("importSettingsBtn").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const settings = JSON.parse(text);
    chrome.runtime.sendMessage({ type: "CP_SYNC_IMPORT_SETTINGS", settings }, (res) => {
      if (res && res.ok) {
        setStatus($("importExportStatus"), "Imported. Re-enter your token in the General tab.", "ok");
        loadGeneral();
        loadAdvanced();
      } else {
        setStatus($("importExportStatus"), "Import failed.", "err");
      }
    });
  } catch (err) {
    setStatus($("importExportStatus"), "Invalid settings file.", "err");
  }
  e.target.value = "";
});

// ---------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------
function refreshStats() {
  chrome.runtime.sendMessage({ type: "CP_SYNC_GET_STATS" }, (res) => {
    if (!res || !res.ok) return;
    $("streakValue").textContent = res.streak || 0;
    const total = Object.values(res.stats.totalByPlatform || {}).reduce((a, b) => a + b, 0);
    $("totalValue").textContent = total;
  });
  chrome.runtime.sendMessage({ type: "CP_SYNC_GET_FAILED_QUEUE" }, (res) => {
    if (!res || !res.ok) return;
    $("failedValue").textContent = res.queue.length;
  });
}

// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).
loadGeneral();
loadAdvanced();
refreshStats();
