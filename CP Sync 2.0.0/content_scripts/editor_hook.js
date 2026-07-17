// content_scripts/editor_hook.js
// You are free to copy this code, provided you are also willing 
// to take responsibility for all the bugs I left in it. Good luck (Y GAY).

(function () {
  if (window.__cpSyncEditorHookInstalled) return;
  window.__cpSyncEditorHookInstalled = true;

  function isExcluded(el) {
    if (!el || typeof el.closest !== "function") return false;
    return !!el.closest(
      '[class*="tutor" i], [id*="tutor" i], [class*="assistant" i], [id*="assistant" i], ' +
      '[class*="chat" i], [id*="chat" i], [class*="copilot" i], [id*="copilot" i], ' +
      '[class*="reference" i], [id*="reference" i], [class*="cheatsheet" i], [id*="cheatsheet" i], ' +
      '[class*="cheat-sheet" i], [id*="cheat-sheet" i], [class*="keyword" i], [id*="keyword" i], ' +
      '[class*="snippet-list" i], [id*="snippet-list" i], [class*="helper" i], [id*="helper" i], ' +
      '[class*="hint" i], [id*="hint" i], [class*="suggest-widget" i], [class*="hover-widget" i]'
    );
  }

  function looksLikeRealEditor(el) {
    if (!el || typeof el.closest !== "function") return false;
    return !!el.closest(
      '[class*="solution" i], [id*="solution" i], [class*="code-editor" i], [id*="code-editor" i], ' +
      '[class*="ide" i], [id*="ide" i], [data-testid*="editor" i]'
    );
  }


  function looksLikeGarbage(text) {
    if (!text) return true;
    if (/(.)\1{14,}/.test(text)) return true;
    return false;
  }

  function pickBest(candidates) {
    // candidates: [{ el, value }]
    const valid = candidates.filter((c) => c.value && !looksLikeGarbage(c.value));
    if (!valid.length) return null;

    const realEditorCandidates = valid.filter((c) => looksLikeRealEditor(c.el));
    const pool = realEditorCandidates.length ? realEditorCandidates : valid;

    let best = pool[0];
    for (const c of pool) {
      if (c.value.length > best.value.length) best = c;
    }
    return best.value;
  }

  function readMonaco() {
    try {
      if (!window.monaco || !window.monaco.editor) return null;

      if (typeof window.monaco.editor.getEditors === "function") {
        const candidates = window.monaco.editor
          .getEditors()
          .filter((ed) => {
            try {
              return !isExcluded(ed.getDomNode());
            } catch (e) {
              return true;
            }
          })
          .map((ed) => ({ el: ed.getDomNode(), value: ed.getValue() || "" }));
        const result = pickBest(candidates);
        if (result) return result;
      }

      // Fallback: bare models, no DOM filtering possible - only used if
      // getEditors() wasn't available or returned nothing usable.
      const models = window.monaco.editor.getModels();
      if (models && models.length) {
        const candidates = models.map((m) => ({ el: null, value: m.getValue() || "" }));
        const valid = candidates.filter((c) => c.value && !looksLikeGarbage(c.value));
        if (valid.length) {
          let best = valid[0];
          for (const c of valid) if (c.value.length > best.value.length) best = c;
          return best.value;
        }
      }
    } catch (e) {}
    return null;
  }

  function readCodeMirror() {
    try {
      const nodes = Array.from(document.querySelectorAll(".CodeMirror")).filter((node) => !isExcluded(node));
      const candidates = nodes
        .map((node) => {
          const cm = node.CodeMirror;
          return cm && typeof cm.getValue === "function" ? { el: node, value: cm.getValue() || "" } : null;
        })
        .filter(Boolean);
      return pickBest(candidates);
    } catch (e) {
      return null;
    }
  }

  function readAce() {
    try {
      const nodes = Array.from(document.querySelectorAll(".ace_editor")).filter((node) => !isExcluded(node));
      const candidates = [];
      for (const node of nodes) {
        let value = null;
        try {
          if (node.env && node.env.editor && typeof node.env.editor.getValue === "function") {
            value = node.env.editor.getValue();
          } else if (window.ace && typeof window.ace.edit === "function") {
            value = window.ace.edit(node).getValue();
          }
        } catch (e) {}
        if (value) candidates.push({ el: node, value });
      }
      return pickBest(candidates);
    } catch (e) {
      return null;
    }
  }

  function readTextarea() {
    try {
      const areas = Array.from(document.querySelectorAll("textarea")).filter(
        (area) => !isExcluded(area) && !area.closest(".monaco-editor") && !area.closest(".CodeMirror") && !area.closest(".ace_editor")
      );
      const candidates = areas.map((area) => ({ el: area, value: area.value || "" }));
      return pickBest(candidates);
    } catch (e) {
      return null;
    }
  }

  function readCurrentCode() {
    return readMonaco() || readCodeMirror() || readAce() || readTextarea() || null;
  }

  function diagnosticSnapshot() {
    const snap = {
      hasMonacoGlobal: !!(window.monaco && window.monaco.editor),
      monacoEditorsCount: 0,
      monacoModelsCount: 0,
      codeMirrorNodeCount: document.querySelectorAll(".CodeMirror").length,
      aceNodeCount: document.querySelectorAll(".ace_editor").length,
      textareaCount: document.querySelectorAll("textarea").length
    };
    try {
      if (window.monaco && window.monaco.editor) {
        if (typeof window.monaco.editor.getEditors === "function") {
          snap.monacoEditorsCount = window.monaco.editor.getEditors().length;
        }
        if (typeof window.monaco.editor.getModels === "function") {
          snap.monacoModelsCount = window.monaco.editor.getModels().length;
        }
      }
    } catch (e) {}
    return snap;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "cpsync" || msg.type !== "CPSYNC_REQUEST_CODE") return;

    const snap = diagnosticSnapshot();
    const code = readCurrentCode();
    console.log(
      "[CP Sync] v2.0.0 editor_hook diagnostic on", location.href, "-",
      "Monaco global:", snap.hasMonacoGlobal, "editors:", snap.monacoEditorsCount, "models:", snap.monacoModelsCount,
      "- CodeMirror nodes:", snap.codeMirrorNodeCount, "- Ace nodes:", snap.aceNodeCount, "- textareas:", snap.textareaCount,
      "- captured code length:", code ? code.length : 0,
      "- preview:", code ? JSON.stringify(code.slice(0, 80)) : null
    );

    window.postMessage({ source: "cpsync", type: "CPSYNC_CODE_RESPONSE", requestId: msg.requestId, code }, "*");
  });
})();
