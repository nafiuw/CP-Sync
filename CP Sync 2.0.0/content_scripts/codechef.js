// content_scripts/codechef.js
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).

(function () {
  console.log(
    "[CP Sync] v" + chrome.runtime.getManifest().version + " watching CodeChef submissions on this frame:", location.href,
    "- is this an iframe (not the main page)?", window !== window.top
  );
  const CHECK_INTERVAL_MS = 1200;

  let seeded = false;
  const historicalIds = new Set();
  let scanCount = 0;
  let alreadyPushedForThisView = false;

  // CodeChef rotates through several congratulatory phrases instead of a
  // single fixed "Accepted" string. Comparing against exact phrases (even
  // with apostrophe normalization) kept missing some, so instead we strip
  // ALL punctuation and casing from the page text and match plain lowercase
  // keyword substrings - this is immune to smart quotes, exclamation marks,
  // commas, or any other punctuation variant CodeChef might use.
  const ACCEPTED_KEYWORDS = [
    "well done its correct",
    "accepted",
    "correct answer",
    "awesome you nailed it",
    "you got it right",
    "hooray you did it",
    "excellent work",
    "great job keep it up",
    "perfect answer"
  ];

  function normalizeForMatch(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[\u2018\u2019\u02BC\u00B4`']/g, "") // drop apostrophes entirely (its vs it's)
      .replace(/[^a-z0-9\s]/g, " ") // drop all other punctuation
      .replace(/\s+/g, " ")
      .trim();
  }

  function isAcceptedVisible(bodyText) {
    const normalized = normalizeForMatch(bodyText);
    return ACCEPTED_KEYWORDS.some((kw) => normalized.includes(kw));
  }

  function getMyUsername() {
    const link = document.querySelector('header a[href*="/users/"], nav a[href*="/users/"], [class*="account"] a[href*="/users/"]');
    if (!link) return null;
    const m = link.href.match(/\/users\/([^/?#]+)/);
    return m ? m[1] : link.textContent.trim();
  }

  // CodeChef now has an "AI Tutor" chat/help widget on problem pages that
  // renders its own <h1>-style heading ("Welcome to the CodeChef AI
  // Tutor") - a naive querySelector can grab that instead of the real
  // problem title. Skip anything inside a tutor/assistant/chat-like
  // container.
  function isInsideAiTutor(el) {
    return !!el.closest(
      '[class*="tutor" i], [id*="tutor" i], [class*="assistant" i], [id*="assistant" i], ' +
      '[class*="chat" i], [id*="chat" i], [class*="copilot" i], [id*="copilot" i]'
    );
  }

  function getProblemMeta() {
    const parts = location.pathname.split("/").filter(Boolean);
    const problemCode = parts[parts.length - 1] || "problem";
    const candidates = Array.from(document.querySelectorAll("h1, .problem-title, ._problem-title, [class*='problemTitle']"));
    const titleEl = candidates.find((el) => !isInsideAiTutor(el));
    const title = titleEl ? titleEl.textContent.trim() : problemCode;
    return { problemCode, title };
  }

  function findSolutionLinks() {
    return Array.from(document.querySelectorAll('a[href*="/viewsolution/"], a[href*="/view/solution/"]'));
  }

  function idFromLink(link) {
    const m = link.href.match(/(\d+)\s*$/);
    return m ? m[1] : link.href;
  }

  async function fetchSolutionCode(viewSolutionUrl) {
    try {
      const resp = await fetch(viewSolutionUrl, { credentials: "include" });
      if (!resp.ok) return null;
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const codeEl = doc.querySelector("pre, textarea, code, [class*='source']");
      return codeEl ? codeEl.textContent : null;
    } catch (e) {
      return null;
    }
  }

  function requestCodeFromLiveEditor(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2);
      function handler(event) {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.source !== "cpsync" || msg.type !== "CPSYNC_CODE_RESPONSE" || msg.requestId !== requestId) return;
        window.removeEventListener("message", handler);
        clearTimeout(timer);
        resolve(msg.code || null);
      }
      window.addEventListener("message", handler);
      const timer = setTimeout(() => {
        window.removeEventListener("message", handler);
        resolve(null);
      }, timeoutMs);
      window.postMessage({ source: "cpsync", type: "CPSYNC_REQUEST_CODE", requestId }, "*");
    });
  }

  function seedHistorical() {
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).
    const links = findSolutionLinks();
    if (links.length > 1) {
      links.forEach((link) => historicalIds.add(idFromLink(link)));
    }
    seeded = true;
  }

  async function pushWithLink(viewLink, myUsername) {
    const subId = idFromLink(viewLink);
    if (historicalIds.has(subId)) return;

    const row = viewLink.closest("tr, li, div[class*='row']");
    if (myUsername && row) {
      const userLink = row.querySelector('a[href*="/users/"]');
      if (userLink) {
        const rowUser = (userLink.href.match(/\/users\/([^/?#]+)/) || [])[1] || userLink.textContent.trim();
        if (rowUser && rowUser.toLowerCase() !== myUsername.toLowerCase()) {
          historicalIds.add(subId);
          return;
        }
      }
    }

    const dedupeKey = "cpsync_cc_" + subId;
    if (sessionStorage.getItem(dedupeKey)) return;
    sessionStorage.setItem(dedupeKey, "1");
    historicalIds.add(subId);

    const meta = getProblemMeta();
    const code = await fetchSolutionCode(viewLink.href);
    const langEl = document.querySelector('[class*="language"]');
    const language = langEl ? langEl.textContent.trim() : "";

    console.log("[CP Sync] pushing CodeChef submission (via solution link)", subId, meta.title);

    chrome.runtime.sendMessage({
      type: "CP_SYNC_SOLVED",
      payload: {
        platform: "codechef",
        problemName: meta.title,
        problemId: meta.problemCode,
        rating: null,
        contest: null,
        language,
        code: code || "// source not captured automatically - open the solution page and copy it manually",
        url: location.href,
        verdict: "Accepted"
      }
    });
  }

  async function pushWithLiveEditor() {
    if (alreadyPushedForThisView) return;
    alreadyPushedForThisView = true;

    const meta = getProblemMeta();
    const code = await requestCodeFromLiveEditor();
    const langEl = document.querySelector('[class*="language"]');
    const language = langEl ? langEl.textContent.trim() : "";

    console.log(
      "[CP Sync] pushing CodeChef submission (via live editor read)", meta.problemCode,
      "- code captured:", !!code, "- preview:", code ? JSON.stringify(code.slice(0, 80)) : null
    );

    chrome.runtime.sendMessage({
      type: "CP_SYNC_SOLVED",
      payload: {
        platform: "codechef",
        problemName: meta.title,
        problemId: meta.problemCode,
        rating: null,
        contest: null,
        language,
        code: code || "// source not captured automatically - copy it from the editor and use Manual Push",
        url: location.href,
        verdict: "Accepted"
      }
    });
  }

  async function scan() {
    if (!seeded) {
      seedHistorical();
      return;
    }

    const bodyText = document.body.innerText || "";
    const accepted = isAcceptedVisible(bodyText);
    const links = findSolutionLinks();

    scanCount++;
    if (scanCount <= 15 && !accepted) {
      console.warn("[CP Sync] CodeChef scan #" + scanCount + ": accepted text present: false - solution link(s):", links.length);

      console.warn("[CP Sync] CodeChef: body text snippet (first 300 chars):", bodyText.slice(0, 300));

      const iframes = Array.from(document.querySelectorAll("iframe")).map((f) => f.src || "(no src)");
      if (iframes.length) {
        console.warn("[CP Sync] CodeChef: iframes present on this page (check their own console context too):", iframes);
      }
    }

    if (accepted) {
      console.warn("[CP Sync] CodeChef: ACCEPTED TEXT DETECTED on scan #" + scanCount + " - solution link(s):", links.length);
    }

    if (!accepted) {
      alreadyPushedForThisView = false; // reset so a future accepted result can push again
      return;
    }

    if (links.length) {
      const myUsername = getMyUsername();
      for (const link of links) await pushWithLink(link, myUsername);
    } else {
      await pushWithLiveEditor();
    }
  }

  setInterval(scan, CHECK_INTERVAL_MS);
  scan();
})();
