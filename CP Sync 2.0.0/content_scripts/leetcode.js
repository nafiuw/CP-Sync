// content_scripts/leetcode.js
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).

(function () {
  console.log("[CP Sync] v" + chrome.runtime.getManifest().version + " watching LeetCode submissions on this page");
  const CHECK_INTERVAL_MS = 2000;

  function getSlug() {
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  function getProblemMeta(slug) {
    const title = (document.title || "").replace(/\s*-\s*LeetCode\s*$/i, "").trim() || slug;
    let difficulty = "Unrated";
    const diffEl = document.querySelector('[class*="difficulty" i]');
    if (diffEl) {
      const t = diffEl.textContent.trim();
      if (/easy/i.test(t)) difficulty = "Easy";
      else if (/medium/i.test(t)) difficulty = "Medium";
      else if (/hard/i.test(t)) difficulty = "Hard";
    }
    return { title, difficulty };
  }

  async function fetchLatestSubmission(slug) {
    try {
      const resp = await fetch(`https://leetcode.com/api/submissions/${slug}/`, { credentials: "include" });
      if (!resp.ok) return null;
      const data = await resp.json();
      const list = data.submissions_dump || data.submissions || [];
      return list[0] || null;
    } catch (e) {
      console.log("[CP Sync] LeetCode submissions API fetch failed", e);
      return null;
    }
  }

  async function checkResultPanel() {
    const slug = getSlug();
    if (!slug) return;

    const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
    if (!resultEl) return;
    const verdict = resultEl.textContent.trim();
    if (!/^Accepted/i.test(verdict)) return;

    const latest = await fetchLatestSubmission(slug);
    if (!latest) {
      console.log("[CP Sync] LeetCode showed Accepted but the submissions API returned nothing usable");
      return;
    }
    if (latest.status_display && !/accepted/i.test(latest.status_display)) return;

    const dedupeKey = "cpsync_lc_" + (latest.id || latest.timestamp || slug);
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, "1");

    const meta = getProblemMeta(slug);
    console.log("[CP Sync] pushing LeetCode submission", slug, latest.id);

    chrome.runtime.sendMessage({
      type: "CP_SYNC_SOLVED",
      payload: {
        platform: "leetcode",
        problemName: meta.title,
        problemId: slug,
        rating: meta.difficulty,
        contest: null,
        language: latest.lang || latest.lang_str || "unknown",
        code: latest.code || "// source not captured - copy it from the editor manually",
        url: `https://leetcode.com/problems/${slug}/`,
        verdict: "Accepted"
      }
    });
  }

  setInterval(checkResultPanel, CHECK_INTERVAL_MS);
  checkResultPanel();
})();
