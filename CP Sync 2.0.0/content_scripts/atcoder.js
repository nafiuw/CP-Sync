// content_scripts/atcoder.js
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).

(function () {
  console.log("[CP Sync] v" + chrome.runtime.getManifest().version + " watching AtCoder submissions on this page:", location.pathname);

  try {
    const badge = document.createElement("div");
    badge.textContent = "CP Sync v" + chrome.runtime.getManifest().version + " watching AtCoder";
    badge.style.cssText =
      "position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#238636;color:#fff;" +
      "padding:4px 9px;border-radius:6px;font:11px/1.4 sans-serif;opacity:0.9;pointer-events:none;";
    document.documentElement.appendChild(badge);
    setTimeout(() => badge.remove(), 10000);
  } catch (e) {}

  const CHECK_INTERVAL_MS = 2500;
  let scanCount = 0;

  function contestIdFromPath() {
    const m = location.pathname.match(/\/contests\/([^/]+)/);
    return m ? m[1] : "";
  }

  function getMyHandle() {
    const link = document.querySelector(
      '.header-tail a[href^="/users/"], .navbar a[href^="/users/"], #navbar a[href^="/users/"], header a[href^="/users/"]'
    );
    if (!link) return null;
    const m = link.href.match(/\/users\/([^/?#]+)/);
    return m ? m[1] : link.textContent.trim();
  }

  function resolveHref(el) {
    if (!el) return null;
    const raw = el.getAttribute("href");
    if (!raw) return null;
    try {
      return new URL(raw, location.origin).href;
    } catch (e) {
      return raw;
    }
  }

  function getRowSubmissionId(row) {
    const detailLink = row.querySelector('a[href*="/submissions/"]');
    if (!detailLink) return null;
    const href = resolveHref(detailLink);
    const m = href && href.match(/submissions\/(\d+)/);
    return m ? m[1] : null;
  }

  async function fetchSource(url) {
    try {
      const resp = await fetch(url, { credentials: "include" });
      if (!resp.ok) return null;
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const pre = doc.querySelector("#submission-code");
      return pre ? pre.textContent : null;
    } catch (e) {
      return null;
    }
  }

  function rowShowsAC(row) {
    if (/\bAC\b/.test(row.textContent || "")) return true;
    // The verdict might be rendered as an icon/badge with no visible text
    // node at all - check common places that info would still surface.
    const marked = row.querySelector(
      '[title="AC"], [aria-label="AC"], [title*="Accepted" i], [aria-label*="Accepted" i], .label-success, [class*="badge-success" i]'
    );
    return !!marked;
  }

  function extractRow(row) {
    if (!rowShowsAC(row)) return null;

    const submissionId = getRowSubmissionId(row);
    if (!submissionId) return null;
    const detailLink = row.querySelector('a[href*="/submissions/"]');

    const problemLink = row.querySelector('a[href*="/tasks/"]');
    const problemName = problemLink ? problemLink.textContent.trim() : "problem";
    const problemHref = resolveHref(problemLink);
    const problemId = problemHref ? problemHref.split("/tasks/")[1] : submissionId;

    const cells = Array.from(row.querySelectorAll("td"));
    const langCell = cells.find((td) =>
      /GNU|Python|PyPy|C\+\+|Java|Rust|Kotlin|Go |C#|Ruby|Swift|Haskell/i.test(td.textContent)
    );
    const language = langCell ? langCell.textContent.trim() : "";

    const userLink = row.querySelector('a[href^="/users/"]');
    const userHref = resolveHref(userLink);
    const submitterHandle = userHref ? (userHref.match(/\/users\/([^/?#]+)/) || [])[1] : null;

    return { submissionId, detailUrl: resolveHref(detailLink), problemName, problemId, language, submitterHandle };
  }

  async function pushRow(info) {
    const dedupeKey = "cpsync_ac_" + info.submissionId;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, "1");

    const code = await fetchSource(info.detailUrl);
    const contestId = contestIdFromPath();

    console.log("[CP Sync] pushing AtCoder submission (topmost AC row)", info.submissionId, info.problemName);

    chrome.runtime.sendMessage({
      type: "CP_SYNC_SOLVED",
      payload: {
        platform: "atcoder",
        problemName: info.problemName,
        problemId: info.problemId,
        rating: null,
        contest: contestId,
        language: info.language,
        code: code || "// source not captured automatically - open the submission page and copy it manually",
        url: info.detailUrl,
        verdict: "AC"
      }
    });
  }

  function isSubmissionDetailPage() {
    return /\/submissions\/\d+(?:$|[/?])/.test(location.pathname);
  }

  async function checkDetailPage() {
    if (!isSubmissionDetailPage()) return;

    const statusEl = document.querySelector("#judge-status, [class*='label-success'], td span");
    const bodyText = document.body.innerText || "";
    if (!/\bAC\b/.test(statusEl ? statusEl.textContent : bodyText)) return;

    const idMatch = location.pathname.match(/submissions\/(\d+)/);
    const submissionId = idMatch ? idMatch[1] : location.pathname;
    const dedupeKey = "cpsync_ac_" + submissionId;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, "1");

    const pre = document.querySelector("#submission-code");
    const code = pre ? pre.textContent : null;
    const contestId = contestIdFromPath();
    const problemLink = document.querySelector('a[href*="/tasks/"]');
    const problemName = problemLink ? problemLink.textContent.trim() : "problem";
    const problemId = problemLink ? problemLink.href.split("/tasks/")[1] : submissionId;
    const langEl = Array.from(document.querySelectorAll("td, th")).find((el) =>
      /GNU|Python|PyPy|C\+\+|Java|Rust|Kotlin|Go |C#|Ruby|Swift|Haskell/i.test(el.textContent)
    );

    console.log("[CP Sync] pushing AtCoder submission (detail page)", submissionId, problemName);

    chrome.runtime.sendMessage({
      type: "CP_SYNC_SOLVED",
      payload: {
        platform: "atcoder",
        problemName,
        problemId,
        rating: null,
        contest: contestId,
        language: langEl ? langEl.textContent.trim() : "",
        code: code || "// source not captured automatically - open the submission page and copy it manually",
        url: location.href,
        verdict: "AC"
      }
    });
  }

  // AtCoder's submissions list may not auto-refresh a row's verdict client
  // side once judging finishes - if that's the case, polling the live DOM
  // would show "WJ" forever even after the real page has updated server
  // side. Fetch a fresh copy of the page on every poll instead of trusting
  // the DOM we already have, so a resolved verdict is never missed.
  async function fetchFreshDoc() {
    try {
      const resp = await fetch(location.href, { credentials: "include" });
      if (!resp.ok) return document;
      const html = await resp.text();
      return new DOMParser().parseFromString(html, "text/html");
    } catch (e) {
      return document; // fall back to the live DOM if the fetch itself fails
    }
  }

  async function scan() {
    const doc = await fetchFreshDoc();
    const rows = Array.from(doc.querySelectorAll("table tbody tr"));
    const myHandle = getMyHandle();

    scanCount++;
    if (scanCount <= 3) {
      const acRows = rows.filter((r) => rowShowsAC(r));
      console.warn(
        "[CP Sync] AtCoder scan #" + scanCount + ": rows found:", rows.length,
        "- rows showing AC:", acRows.length,
        "- your handle detected as:", myHandle
      );
      const failing = acRows.find((r) => !extractRow(r));
      if (failing) {
        console.warn("[CP Sync] AtCoder: an AC row exists but couldn't be parsed. Row HTML:", failing.outerHTML.slice(0, 1500));
      }
      if (acRows.length === 0 && rows.length > 0) {
        console.warn("[CP Sync] AtCoder: no row matched AC yet - topmost row HTML:", rows[0].outerHTML.slice(0, 800));
      }
    }

    // Only ever consider the topmost AC row that's yours - AtCoder sorts
    // newest-first, so this is always your latest resolved submission.
    for (const row of rows) {
      const info = extractRow(row);
      if (!info) continue; // not AC yet, or no id - keep looking down the list
      if (myHandle && info.submitterHandle && info.submitterHandle.toLowerCase() !== myHandle.toLowerCase()) {
        continue; // not yours - skip past it, don't stop the search here
      }
      await pushRow(info);
      break;
    }

    checkDetailPage();
  }

  setInterval(scan, CHECK_INTERVAL_MS);
  scan();
})();
