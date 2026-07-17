// content_scripts/hackerrank.js
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).

(function () {
  console.log("[CP Sync] v" + chrome.runtime.getManifest().version + " watching HackerRank submissions on this page");
  const CHECK_INTERVAL_MS = 2500;

  function getSlug() {
    const m = location.pathname.match(/challenges\/([^/]+)/);
    return m ? m[1] : null;
  }

  function getProblemMeta(slug) {
    const titleEl = document.querySelector("h1, .challenge-page-title, [class*='challenge-title']");
    const title = titleEl ? titleEl.textContent.trim() : slug;
    return { title };
  }

  function isAcceptedVisible() {
    const text = document.body.innerText || "";
    return /All test cases passed|Accepted|Congratulations/i.test(text) && document.querySelector('[class*="success" i], [class*="passed" i]');
  }

  function candidateEndpoints(slug) {
    return [
      `https://www.hackerrank.com/rest/contests/master/challenges/${slug}/submissions/?offset=0&limit=1`,
      `https://www.hackerrank.com/rest/contests/master/challenges/${slug}/submissions?offset=0&limit=1`
    ];
  }

  async function fetchLatestSubmission(slug) {
    for (const url of candidateEndpoints(slug)) {
      try {
        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) {
          console.log("[CP Sync] HackerRank endpoint returned", resp.status, url);
          continue;
        }
        const data = await resp.json();
        const list = data.models || data.submissions || [];
        if (list.length) {
          console.warn("[CP Sync] HackerRank submission object keys:", Object.keys(list[0]));
          return list[0];
        }
        console.log("[CP Sync] HackerRank endpoint returned no submissions in the list:", url, Object.keys(data));
      } catch (e) {
        console.log("[CP Sync] HackerRank endpoint fetch failed", url, e);
      }
    }
    return null;
  }

  function extractCode(obj) {
    if (!obj) return null;
    return (
      obj.code ||
      obj.source ||
      obj.solution ||
      obj.answer ||
      obj.raw_code ||
      obj.code_bytes ||
      (obj.model && obj.model.code) ||
      (obj.testcase_context && obj.testcase_context.code) ||
      null
    );
  }


  async function fetchSubmissionDetail(slug, submissionId) {
    const urls = [
      `https://www.hackerrank.com/rest/contests/master/challenges/${slug}/submissions/${submissionId}`,
      `https://www.hackerrank.com/rest/contests/master/submissions/${submissionId}`
    ];
    for (const url of urls) {
      try {
        const resp = await fetch(url, { credentials: "include" });
        if (!resp.ok) {
          console.log("[CP Sync] HackerRank detail endpoint returned", resp.status, url);
          continue;
        }
        const data = await resp.json();
        const record = data.model || data;
        console.warn("[CP Sync] HackerRank detail object keys:", Object.keys(record));
        if (extractCode(record)) return record;
      } catch (e) {
        console.log("[CP Sync] HackerRank detail endpoint fetch failed", url, e);
      }
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  let isChecking = false;
  let pushedForThisAccept = false;

  async function checkResult() {
    const slug = getSlug();
    if (!slug) return;

    if (!isAcceptedVisible()) {
      pushedForThisAccept = false; // reset so a future Accepted result can push again
      return;
    }
    if (pushedForThisAccept) return; // already handled this one
    if (isChecking) return; // a previous attempt is still in flight - don't overlap requests

    isChecking = true;
    try {
      const latest = await fetchLatestSubmission(slug);
      if (!latest) {
        console.log("[CP Sync] HackerRank showed a pass but no submission endpoint returned code - see README troubleshooting");
        return;
      }

      let record = latest;
      if (!extractCode(latest) && latest.id) {
        for (let attempt = 0; attempt < 5 && !extractCode(record); attempt++) {
          if (attempt > 0) await sleep(1500 * attempt);
          const detail = await fetchSubmissionDetail(slug, latest.id);
          if (detail) record = detail;
        }
      }

      if (!extractCode(record)) {
        console.warn(
          "[CP Sync] HackerRank submission found but no known code field matched after retries. Raw list object:",
          JSON.stringify(latest).slice(0, 800)
        );
      }

      pushedForThisAccept = true;

      const dedupeKey = "cpsync_hr_" + (latest.id || latest.submission_id || slug);
      if (sessionStorage.getItem(dedupeKey)) return;
      sessionStorage.setItem(dedupeKey, "1");

      const meta = getProblemMeta(slug);
      console.log("[CP Sync] pushing HackerRank submission", slug, latest.id, "- code captured:", !!extractCode(record));

      chrome.runtime.sendMessage({
        type: "CP_SYNC_SOLVED",
        payload: {
          platform: "hackerrank",
          problemName: meta.title,
          problemId: slug,
          rating: null,
          contest: null,
          language: latest.language || latest.lang || "unknown",
          code: extractCode(record) || "// source not captured - copy it from the editor manually",
          url: location.href,
          verdict: "Accepted"
        }
      });
    } finally {
      isChecking = false;
    }
  }

  setInterval(checkResult, CHECK_INTERVAL_MS);
  checkResult();
})();
