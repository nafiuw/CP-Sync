// content_scripts/vjudge.js
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).

(function () {
  console.log("[CP Sync] v" + chrome.runtime.getManifest().version + " watching vJudge submissions on this page");


  try {
    const badge = document.createElement("div");
    badge.textContent = "CP Sync v" + chrome.runtime.getManifest().version + " watching vJudge";
    badge.style.cssText =
      "position:fixed;bottom:8px;right:8px;z-index:2147483647;background:#238636;color:#fff;" +
      "padding:4px 9px;border-radius:6px;font:11px/1.4 sans-serif;opacity:0.9;pointer-events:none;";
    document.documentElement.appendChild(badge);
    setTimeout(() => badge.remove(), 10000);
  } catch (e) {}

  const CHECK_INTERVAL_MS = 3000;

  let seeded = false;
  const historicalIds = new Set();
  let scanCount = 0;

  function getMyUsername() {
    const link = document.querySelector('#navbar a[href*="/user/"], .navbar a[href*="/user/"], [class*="user-name"]');
    if (!link) return null;
    const m = (link.href || "").match(/\/user\/([^/?#]+)/);
    return m ? m[1] : link.textContent.trim();
  }

  function isHeaderRow(row) {
    return !!row.querySelector("th");
  }

  function getStatusTableRows() {
    const statusTable = document.querySelector(
      '#listStatus, table[id*="status" i], table[class*="status" i], table[id*="solution" i]'
    );
    const scope = statusTable ? [statusTable] : Array.from(document.querySelectorAll("table"));
    const rows = [];
    scope.forEach((table) => {
      table.querySelectorAll("tr").forEach((row) => {
        if (!isHeaderRow(row)) rows.push(row);
      });
    });
    return rows;
  }

  async function fetchSolution(runId) {
    try {
      const resp = await fetch(`/solution/data/${runId}`, { credentials: "include" });
      if (!resp.ok) return null;
      const data = await resp.json();
      return {
        code: data.code || data.source || null,
        language: data.language || data.langName || ""
      };
    } catch (e) {
      return null;
    }
  }

  function getRunId(row) {
    const runIdAttr =
      row.getAttribute("data-id") ||
      row.getAttribute("data-runid") ||
      row.getAttribute("data-run-id") ||
      row.getAttribute("data-solution-id") ||
      row.getAttribute("data-oj-id") ||
      row.id;
    if (runIdAttr) return runIdAttr;

    const link = row.querySelector('a[onclick*="showSource"], a[onclick*="solution"], a[href*="solution"], a[href*="Status"]');
    if (link) {
      const m = (link.getAttribute("onclick") || link.href || "").match(/(\d{4,})/);
      if (m) return m[1];
    }

    const anyIdEl = row.querySelector("[data-id], [data-runid], [id]");
    if (anyIdEl) {
      const candidate = anyIdEl.getAttribute("data-id") || anyIdEl.getAttribute("data-runid") || anyIdEl.id;
      if (candidate && /\d/.test(candidate)) return candidate;
    }

    return null;
  }

  function getRowUsername(row) {
    const link = row.querySelector('a[href*="/user/"]');
    if (!link) return null;
    const m = (link.href || "").match(/\/user\/([^/?#]+)/);
    return m ? m[1] : link.textContent.trim();
  }

  function seedHistorical() {
    const rows = getStatusTableRows().filter((row) => getRunId(row));
    if (rows.length > 1) {
      rows.forEach((row) => {
        const runId = getRunId(row);
        const rowText = row.textContent || "";
        if (!/Judging|Running|Pending|Queue/i.test(rowText)) {
          historicalIds.add(runId);
        }
      });
    }
    seeded = true;
  }

  async function scan() {
    if (!seeded) {
      seedHistorical();
      return;
    }

    const myUsername = getMyUsername();
    const rows = getStatusTableRows();

    scanCount++;
    if (scanCount <= 3) {
      const rowsWithRunId = rows.filter((r) => getRunId(r)).length;
      const acceptedRows = rows.filter((r) => /\bAccepted\b/i.test(r.textContent || "")).length;
      console.warn(
        "[CP Sync] vJudge scan #" + scanCount + ": header-filtered rows found:", rows.length,
        "- rows with a detectable run id:", rowsWithRunId,
        "- rows showing Accepted:", acceptedRows,
        "- your username detected as:", myUsername
      );

      const anAcceptedRow = rows.find((r) => /\bAccepted\b/i.test(r.textContent || ""));
      if (anAcceptedRow && !getRunId(anAcceptedRow)) {
        console.warn("[CP Sync] vJudge: an Accepted row exists but has no detectable run id. Row HTML:", anAcceptedRow.outerHTML.slice(0, 1500));
      }
    }

    for (const row of rows) {
      const rowText = row.textContent || "";
      if (!/\bAccepted\b/i.test(rowText)) continue;

      const runId = getRunId(row);
      if (!runId) continue;
      if (historicalIds.has(runId)) continue;

      if (myUsername) {
        const rowUser = getRowUsername(row);
        if (rowUser && rowUser.toLowerCase() !== myUsername.toLowerCase()) {
          historicalIds.add(runId);
          continue;
        }
      }

      const dedupeKey = "cpsync_vj_" + runId;
      if (sessionStorage.getItem(dedupeKey)) continue;
      sessionStorage.setItem(dedupeKey, "1");
      historicalIds.add(runId);

      const problemCell = row.querySelector('[class*="problem"]') || row.cells?.[2];
      const problemName = problemCell ? problemCell.textContent.trim() : "problem";
      const solution = await fetchSolution(runId);

      console.log("[CP Sync] pushing vJudge submission", runId, problemName);

      chrome.runtime.sendMessage({
        type: "CP_SYNC_SOLVED",
        payload: {
          platform: "vjudge",
          problemName,
          problemId: runId,
          rating: null,
          contest: document.title.replace(/\s*-\s*vJudge\s*$/i, "").trim() || null,
          language: solution ? solution.language : "",
          code: solution && solution.code ? solution.code : "// source not captured - open 'View Code' manually and copy it",
          url: location.href,
          verdict: "Accepted"
        }
      });
    }
  }

  setInterval(scan, CHECK_INTERVAL_MS);
  scan();
})();
