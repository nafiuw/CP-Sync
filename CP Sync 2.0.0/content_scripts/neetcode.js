// content_scripts/neetcode.js
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).

(function () {
  console.log("[CP Sync] v" + chrome.runtime.getManifest().version + " watching NeetCode 'solved' checkboxes on this page");

  function getRowInfo(checkbox) {
    const row = checkbox.closest("tr, li, div[class*='row']");
    if (!row) return null;
    const link = row.querySelector('a[href*="leetcode.com"], a[href*="/problems/"]');
    const name = row.textContent.trim().split("\n")[0].slice(0, 120) || "problem";
    return { name, url: link ? link.href : location.href };
  }

  function handleChange(event) {
    const checkbox = event.target;
    if (!checkbox || checkbox.type !== "checkbox" || !checkbox.checked) return;

    const info = getRowInfo(checkbox);
    if (!info) return;

    const dedupeKey = "cpsync_nc_" + encodeURIComponent(info.name);
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, "1");

    console.log("[CP Sync] pushing NeetCode checkbox log entry", info.name);

    chrome.runtime.sendMessage({
      type: "CP_SYNC_SOLVED",
      payload: {
        platform: "neetcode",
        problemName: info.name,
        problemId: info.name,
        rating: "Uncategorized",
        contest: null,
        language: "markdown",
        code: `Marked solved on NeetCode.io.\n\nReference: ${info.url}\n\n(No source captured here - this was logged from the checklist checkbox, not an in-page judge. Use the LeetCode sync for real code if you solved it there.)`,
        url: info.url,
        verdict: "Solved"
      }
    });
  }

  document.addEventListener("change", handleChange, true);
})();
