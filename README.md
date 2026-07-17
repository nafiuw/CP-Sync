
# CP Sync - push Accepted submissions straight to GitHub

> **Updating from a previous version?** Content scripts only get replaced in
> a tab once that tab is fully reloaded - reloading the extension in
> `chrome://extensions` alone does NOT update tabs you already had open.
> After updating: (1) go to `chrome://extensions`, click the refresh icon
> on the CP Sync card, then (2) hard-refresh (Ctrl+Shift+R / Cmd+Shift+R)
> every judge tab you're testing in, or just close and reopen them.
>
> **How to confirm you're actually on the current version:** every content
> script now logs its version number as part of the "watching" line, e.g.
> `[CP Sync] v2.0.0 watching CodeChef submissions on this frame: ...`. Check
> that number against the `version` field in `manifest.json` in this zip -
> if they don't match (or the log is missing the version number entirely),
> you're testing stale code and need to reload as described above.

A browser extension that watches Codeforces, CodeChef, LeetCode, NeetCode,
HackerRank, vJudge and AtCoder for **Accepted** submissions and automatically
commits the code to a GitHub repo, organized like:

```
your-repo/
  codeforces/
    1500-1599/
      1873A.cpp
  leetcode/
    Medium/
      two-sum.py
  codechef/
    Practice/
      FLOW001.cpp
  atcoder/
    abc321/
      A.cpp
  hackerrank/
  vjudge/
  neetcode/
```

## 1. Install the extension (unpacked, for now)

1. Open `chrome://extensions` (or `edge://extensions`, or `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension so you can reach its settings quickly.

## 2. Create a GitHub token

1. Go to [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
   and create a **fine-grained personal access token**.
2. Scope it to the one repository you want submissions pushed to.
3. Under **Repository permissions**, set **Contents: Read and write**.
4. Copy the token - you won't see it again.

## 3. Configure the extension

1. Click the extension icon.
2. Paste your token, your GitHub username/org, and the repo name
   (e.g. `owner = you`, `repo = competitive-programming`).
3. Set the branch (defaults to `main`).
4. Pick which platforms you want to sync, click **Save Settings**, then
   **Test Connection** to confirm everything's wired up correctly.

## 4. Solve problems as normal

Solve on any supported site - the extension polls the page in the
background. When it sees an Accepted verdict, it fetches your source and
pushes a commit named `Solved: <problem> (<platform>)`.

You'll get a small OS notification confirming success or telling you if a
push failed (usually a token/permission issue).

## How detection works per platform (and where it might break)

Every competitive-programming site is a moving target - none of them offer
a stable, documented "give me my Accepted code" API for third parties, so
this extension leans on page-scraping and network-request interception.
**If a site redesigns its UI, the corresponding content script may need a
selector update.** Where you'll find the logic:

| Platform | File | Technique |
|---|---|---|
| Codeforces | `content_scripts/codeforces.js` | Polls the submissions table, fetches the submission page HTML for `#program-source-text` |
| LeetCode | `content_scripts/leetcode.js` | Polls for LeetCode's own `[data-e2e-locator="submission-result"]` result banner, then fetches your code from the same-origin `/api/submissions/{slug}/` endpoint - a plain fetch call made by the content script itself, not intercepted from the page, so it isn't affected by CSP |
| CodeChef | `content_scripts/codechef.js` + `content_scripts/editor_hook.js` | Detects any of CodeChef's several rotating success phrases ("Well done, it's correct!", "Awesome, you nailed it!", "You got it right!", "Hooray, you did it!", "Accepted", "Correct Answer"). Uses a "View Solution" link if one exists, otherwise asks `editor_hook.js` (MAIN world) to read the code straight out of the on-screen Monaco/CodeMirror/textarea editor |
| AtCoder | `content_scripts/atcoder.js` | Only ever looks at the topmost "AC" row that's yours (AtCoder lists newest first) rather than seeding/tracking history - this avoids a bug where a fast-resolving submission got mistaken for an old one and silently skipped. Fetches `#submission-code` from the detail page |
| HackerRank | `content_scripts/hackerrank.js` | Polls the DOM for a pass/success indicator, then fetches your code from a same-origin submissions REST endpoint, trying several known field names for the code and logging the full response shape if none match |
| vJudge | `content_scripts/vjudge.js` | Polls status table, fetches `/solution/data/{id}`. Still working on reliable run-id detection here - see below |
| NeetCode | `content_scripts/neetcode.js` | Watches "solved" checkboxes - **no code capture**, since NeetCode isn't a judge itself (logs a markdown note instead; pair with the LeetCode script for actual code) |

**A note on NeetCode specifically:** if your NeetCode account has its own built-in GitHub sync option (some accounts/plans do, under account or integration settings), use that directly instead of this extension for NeetCode - a first-party integration talking to its own backend will always be more reliable than an extension trying to read a checkbox and guess at your code. This extension's NeetCode support is intentionally limited to a "solved" log entry for that reason.

An earlier version of this extension tried to hook `window.fetch`/`XHR` on LeetCode and HackerRank by injecting a script into the page. That approach turned out to be unreliable in practice, so both now follow the same pattern proven-working LeetCode-sync tools use instead: detect the Accepted state via the DOM, then make an ordinary same-origin fetch call (issued by the content script itself, not intercepted from the page) to the judge's own submissions API to get the code. This sidesteps CSP entirely, since it's a normal outgoing request rather than a page-context script.

`editor_hook.js` is a small MAIN-world helper (declared in the manifest, not injected via a `<script>` tag, so CSP doesn't touch it either) that CodeChef uses when a submission doesn't expose a separate "view solution" page - it reads whatever's currently in the on-screen Monaco editor, CodeMirror instance, or plain `<textarea>`, picking the longest non-empty one as a heuristic for "that's the code, not the input/output pane." This same technique was tried on NeetCode too, but in testing it picked up unrelated page content instead of real code (NeetCode doesn't reliably have a dedicated code editor on every page), so NeetCode was reverted to checkbox-only tracking rather than risk pushing garbage.

A file-extension bug also affected LeetCode and HackerRank specifically: both return the language as a short slug like `"cpp"`, but the extension-guessing logic checked substrings in a fixed order and `"cpp".includes("c")` matched the plain `"c"` key before it ever got to check for `"cpp"` or `"c++"`. Fixed by checking for an exact match first, then falling back to substring matching with longer/more specific keys checked before shorter ones.

**Confidence levels, updated:** two real, confirmed bugs got fixed this round rather than more guessing.

- **HackerRank** was a race condition: `checkResult()` polled every 2.5s without guarding against overlapping calls, and the dedupe check happened *after* the network calls rather than before. Combined with HackerRank rate-limiting the per-submission detail endpoint (429s were showing up in the console), an early attempt with a placeholder "not captured" comment was winning the push race before a later attempt with your real code ever got a chance. Fixed with a proper mutex guard (`isChecking`) plus an internal retry-with-backoff loop for the detail fetch, so it tries several times *within* a single check instead of firing a fresh overlapping request every poll tick.
- **vJudge** was matching its own table HEADER row, not a real submission row - the header contains a filter `<select>` with `<option>Accepted</option>` inside it, and that option's text counts toward the header row's `textContent`. Confirmed directly from a pasted HTML dump. Fixed by skipping any row containing `<th>` cells (real submission rows only ever have `<td>`) and scoping to the actual status table (`#listStatus`) instead of every `<table>` on the page.
- **CodeChef verdict phrases** - apostrophe normalization alone wasn't enough (curly vs straight apostrophes are only one of several ways the exact same wording can vary in whitespace/punctuation). Rewrote the check entirely: strip ALL punctuation and casing from the page text, then match plain lowercase keyword substrings. Verified directly against all seven known phrases including the literal curly-apostrophe text - all seven now match. If CodeChef ever shows an eighth phrase this doesn't catch, the diagnostic log will print the raw text snippet so a ninth keyword can be added quickly.
- **CodeChef pushing garbage instead of code** - found the real cause from an actual pushed file: the committed "code" was a jumble of repeated filler characters and fragments like "friend keyword", "lower_bound snippet" (a keyword/reference cheat-sheet listing, and/or an editor's internal hidden input buffer used for IME/screen-reader support). "Pick whichever editor-like element is longest" was grabbing the wrong element entirely. Fixed with: (1) a much broader exclusion list (reference/cheat-sheet/keyword/snippet-list/hint panels, not just the AI Tutor), (2) excluding Monaco/CodeMirror/Ace's own internal hidden `<textarea>` from the plain-textarea fallback (their real content should only ever come from their dedicated APIs, never a raw textarea read), (3) a sanity check that rejects any candidate containing a long run of the same repeated character (the exact signature of the garbage seen), and (4) preferring a candidate whose container looks like a genuine solution/code editor over blindly picking "whichever is longest" when more than one candidate remains.
- **AtCoder / vJudge showing a completely empty console** - this is a different, more fundamental symptom than a detection bug (not even the "watching" line appeared), so both scripts now also drop a small visible badge in the bottom-right corner of the page for a few seconds, independent of console visibility entirely. If the badge never appears, the script isn't loading on that page at all - check `chrome://extensions` for a red "Errors" button on the CP Sync card, confirm the popup's master toggle reads "Active", and confirm the tab's URL is actually under `atcoder.jp` / `vjudge.net`. If the badge DOES appear but the console still looks empty, that points to a console filter or wrong frame context rather than the extension itself.
- **AtCoder** - added detection for verdicts rendered as icons/badges (not just plain "AC" text), and switched from scanning the live DOM to fetching a fresh copy of the page on every poll, in case AtCoder doesn't auto-refresh a submission's status client-side once judging finishes (which would otherwise leave the DOM stuck showing "WJ" forever even after the real page has updated).
- **Codeforces** now also pushes on "Pretests passed" (not just the final "Accepted"), so you don't have to come back and push manually after a live contest ends. Worth knowing: a pretests-passed submission can still fail system tests later (e.g. if it gets hacked) - if that happens the committed file will be a bit stale until you either resubmit a fix or push a corrected version by hand. The committed file's header comment now also shows which verdict triggered the push.

The LeetCode endpoint (`/api/submissions/{slug}/`) remains solid and unchanged - it's a long-standing endpoint many open-source LeetCode-sync tools rely on.

**On diagnostic logging:** CodeChef, AtCoder, and vJudge all print their diagnostic lines using `console.warn` (shown in yellow, and never hidden by DevTools' "Verbose" log-level filter) on the first few scans of every page load, rather than waiting or gating behind a "log once" flag - this makes them much harder to miss when copying console output. If a platform still isn't working, scroll to the very top of the console output right after the page loads and copy every `[CP Sync]` line you see there, not just the repeating ones further down.

Every content script logs to the DevTools console with a `[CP Sync]` prefix: one line confirming it's watching the page (logged immediately on load, not just on success), and another right before it pushes a submission. If something isn't firing for you:
1. Open DevTools -> Console on the problem/submission page and look for `[CP Sync]` lines. **If an editor is embedded in an iframe**, make sure the console's context selector (the dropdown at the top of the Console panel, usually showing "top") is set to the iframe's frame, not just the top-level page - logs from a different frame won't show up under "top".
2. No "watching" line at all means the script didn't load on that URL - check it's the domain listed in the table above.
3. A "watching" line but no "pushing" line means detection isn't recognizing your submission - check the periodic `[CP Sync] ... scan: ...` diagnostic lines (CodeChef, AtCoder, and vJudge all print one every few seconds) for link/row counts and whether the accepted-text check is matching.
4. For the polling scripts, confirm the CSS selectors still match the current DOM (site redesigns are the most common breakage).

## Extra features

- **Autofill / Clear All** - in Manual Push, click **Autofill** to read the problem name, link, ID, and rating/difficulty straight off whichever judge page is open in your active tab (Competitive-Companion style) - then just paste your code and push. **Clear All** wipes the whole form (and its saved draft) back to defaults in one click. Autofill works out of the box on all seven built-in judges since they're already covered by this extension's host permissions; for a fully custom/unlisted judge it depends on how the popup was opened and may need the fields filled in by hand.
- **Custom language** - the Language dropdown in Manual Push includes C plus an "Other" option with a free-text field, for any language not in the preset list.
- **Pop out to a tab** - clicking the extension icon opens a transient popup, which Chrome closes the instant it loses focus (e.g. clicking another tab to copy a problem name) - this is standard browser behavior for all extension popups, not something an extension can override. Click **Open in tab** in the header to reopen the same UI as a normal persistent browser tab that stays open regardless of focus changes; use this for Manual Push sessions where you need to alt-tab around.
- **Manual Push autosave** - every field in Manual Push is saved to local storage on every keystroke and restored automatically, whether you're in the popup or the tab. Nothing is lost even if the popup does close on you; only a successful push clears the per-problem fields (platform/language selections are kept for the next entry).
- **Remembers your last tab** - reopening the popup returns you to whichever tab (General/Manual Push/History/Advanced) you were last on.
- **Manual Push tab** - when auto-detection misses a submission (or you're
  backfilling old solutions), paste platform/problem/code by hand and it
  goes through the exact same GitHub push pipeline.
- **Streak & stats strip** - the popup header shows your current daily
  streak, total problems synced, and anything still pending retry. The
  extension icon badge also shows your live streak count.
- **History tab** - every push (success, failure, or skipped-as-duplicate)
  is logged locally with a timestamp and the exact repo path it went to.
  Failed pushes can be retried in one click from here.
- **Duplicate detection** - before committing, the code is hashed (SHA-256)
  and compared against what's already at that path. Resubmitting an
  identical accepted solution won't create a no-op commit. Turn this off
  in **Advanced** if you'd rather always overwrite.
- **Automatic retry with backoff** - transient GitHub 5xx errors are
  retried with exponential backoff; if you hit GitHub's rate limit, the
  push is queued and surfaced in the "pending retry" counter instead of
  silently failing.
- **Custom commit messages** - set your own template in **Advanced** using
  `{problem}`, `{platform}`, `{contest}`, `{rating}`, `{language}`.
- **Settings export/import** - back up your configuration (repo, branch,
  enabled platforms, commit template) as JSON. Your GitHub token is
  deliberately excluded from exports so you don't accidentally leak it.

## Known limitations

- This is unpacked/dev-mode only right now - publishing to the Chrome Web
  Store would need icons finalized, privacy policy, and review.
- Rating/difficulty extraction is best-effort (e.g. Codeforces rating is
  scraped from the problem page tag, not a guaranteed field).
- Sites that gate their API behind captchas or aggressive bot detection
  (e.g. some CodeChef contest pages) may block the same-origin `fetch`
  calls this extension makes - if so, the file still gets pushed with a
  placeholder comment telling you to paste the code manually.
- GitHub API rate limits: 5,000 requests/hour on a normal PAT, which is
  far more than any reasonable solving pace.

## Permissions used

- `storage` - save your GitHub token/settings locally (`chrome.storage.sync`)
- `host_permissions` for each judge site - read submission pages
- `host_permissions` for `api.github.com` - push commits
- `notifications` - success/failure toasts
