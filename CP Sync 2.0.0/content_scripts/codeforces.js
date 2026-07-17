// content_scripts/codeforces.js
//
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).
//
// IMPORTANT SAFETY LOGIC (read this before touching detection code):
// Status/problem pages on Codeforces can list submissions from OTHER users,
// and always list your own historical solves too - not just the one you
// just made. To avoid pushing a stranger's code or re-pushing old solves
// every time you open a page, we:
//   1. On the very first scan of a page load, record every submission ID
//      that already has a FINAL verdict (accepted or not) WITHOUT pushing
//      anything - these are historical rows, not something you just did.
//   2. Only push a row once it transitions to "Accepted" AFTER that first
//      scan (i.e. it was pending/absent when we started watching).
//   3. Cross-check the row's submitting handle against your own logged-in
//      handle (read from the page header) and skip anything that isn't
//      yours.
//
// NOTE: Codeforces occasionally tweaks its markup. If detection stops
// working, open devtools on a submissions page and check that the
// selectors below (table.status-frame-datatable, #program-source-text,
// #header a[href^="/profile/"]) still match.

(function () {
  console.log("[CP Sync] v" + chrome.runtime.getManifest().version + " watching Codeforces submissions on this page");
  const CHECK_INTERVAL_MS = 3000;

  let seeded = false;
  const historicalIds = new Set(); // ids we should never push (resolved before we started watching)

  function getMyHandle() {
    const link = document.querySelector('#header a[href^="/profile/"]');
    return link ? link.textContent.trim() : null;
  }

  function getRowSubmissionId(row) {
    const subLink = row.querySelector('a[href*="/submission/"]');
    if (!subLink) return null;
    const m = subLink.href.match(/submission\/(\d+)/);
    return m ? m[1] : null;
  }

  function isPendingVerdict(rowText) {
    return /Running|In queue|Judging|Compiling|Testing/i.test(rowText);
  }

  // During a live contest, Codeforces shows "Pretests passed" before the
  // final system test verdict (which only appears once the contest ends).
  // Pushing on pretests-passed means you don't have to come back and
  // manually push once the round is over - the tradeoff is that a
  // pretests-passed submission COULD still fail system tests later (e.g.
  // if it gets hacked). If that happens, the committed file will be a bit
  // stale until you either resubmit a fix (which overwrites it) or push
  // the corrected version manually.
  function verdictKind(rowText) {
    if (/\bAccepted\b/.test(rowText)) return "Accepted";
    if (/Pretests passed/i.test(rowText)) return "Pretests passed";
    return null;
  }

  function extractRowInfo(row) {
    const rowText = row.textContent || "";
    const verdict = verdictKind(rowText);
    if (!verdict) return null;

    const submissionId = getRowSubmissionId(row);
    if (!submissionId) return null;

    const problemLink = row.querySelector('a[href*="/problem/"]');
    if (!problemLink) return null;
    const m = problemLink.href.match(/\/(?:contest|problemset\/problem|gym)\/(\d+)\/(?:problem\/)?([A-Za-z0-9]+)/);
    const problemName = problemLink.textContent.trim();
    const contestId = m ? m[1] : "";
    const problemIndex = m ? m[2] || "" : "";

    const cells = Array.from(row.querySelectorAll("td"));
    const langCell = cells.find((td) =>
      /GNU|G\+\+|C\+\+|Python|PyPy|Java|Kotlin|Rust|C#|Go\b|PHP|Ruby|Scala|Haskell|Node|JavaScript|TypeScript|Pascal|Perl|D lang|Ocaml|Secret_/i.test(
        td.textContent
      )
    );
    const language = langCell ? langCell.textContent.trim() : "";

    const whoLink = row.querySelector('a[href^="/profile/"]');
    const submitterHandle = whoLink ? whoLink.textContent.trim() : null;

    return { submissionId, contestId, problemIndex, problemName, language, submitterHandle, verdict };
  }

  async function fetchSource(contestId, submissionId) {
    const candidateUrls = [
      `/contest/${contestId}/submission/${submissionId}`,
      `/problemset/submission/${contestId}/${submissionId}`,
      `/gym/${contestId}/submission/${submissionId}`
    ];
    for (const url of candidateUrls) {
      try {
        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) continue;
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const pre = doc.querySelector("#program-source-text") || doc.querySelector("pre.prettyprint");
        if (pre && pre.textContent.trim()) return pre.textContent;
      } catch (e) {
        // try the next URL pattern
      }
    }
    return null;
  }

  async function fetchRating(contestId, problemIndex) {
    if (!contestId || !problemIndex) return null;
    try {
      const resp = await fetch(`/contest/${contestId}/problem/${problemIndex}`, { credentials: "include" });
      if (!resp.ok) return null;
      const html = await resp.text();
      const m = html.match(/\*(\d{3,4})(?:\s|<)/);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  function seedHistoricalRows() {
    document.querySelectorAll("table.status-frame-datatable tr").forEach((row) => {
      const submissionId = getRowSubmissionId(row);
      if (!submissionId) return;
      const rowText = row.textContent || "";
      if (!isPendingVerdict(rowText)) {
        historicalIds.add(submissionId);
      }
    });
    seeded = true;
  }

  async function handleRow(row, myHandle) {
    const info = extractRowInfo(row);
    if (!info) return;
    if (historicalIds.has(info.submissionId)) return;

    if (myHandle && info.submitterHandle && info.submitterHandle.toLowerCase() !== myHandle.toLowerCase()) {
      // Not your submission, so we ain't push someone else's accepted code.
      historicalIds.add(info.submissionId);
      return;
    }

    const dedupeKey = "cpsync_cf_" + info.submissionId;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, "1");
    historicalIds.add(info.submissionId);

    const [code, rating] = await Promise.all([
      fetchSource(info.contestId, info.submissionId),
      fetchRating(info.contestId, info.problemIndex)
    ]);

    console.log("[CP Sync] pushing Codeforces submission", info.submissionId, info.problemName, "-", info.verdict);

    chrome.runtime.sendMessage({
      type: "CP_SYNC_SOLVED",
      payload: {
        platform: "codeforces",
        problemName: info.problemName,
        problemId: `${info.contestId}${info.problemIndex}`,
        rating,
        contest: info.contestId ? `Contest-${info.contestId}` : null,
        language: info.language,
        code: code || "// source not captured automatically - open the submission page and copy it manually",
        url: `https://codeforces.com/contest/${info.contestId}/submission/${info.submissionId}`,
        verdict: info.verdict
      }
    });
  }

  function scan() {
    if (!seeded) {
      seedHistoricalRows();
      return;
    }
    const myHandle = getMyHandle();
    document.querySelectorAll("table.status-frame-datatable tr").forEach((row) => handleRow(row, myHandle));
  }
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).
  setInterval(scan, CHECK_INTERVAL_MS);
  scan();
})();
