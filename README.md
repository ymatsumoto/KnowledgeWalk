# mdExplorer

Read Markdown in VS Code the way you read a website: `.md` files open as a rendered
page, links to other `.md` files load **in the same tab**, and Back/Forward take you
through where you have been.

## What it does

**Preview by default.** Opening a `.md` file — from the Explorer, Quick Open, a link in
another file, anywhere — gives you the rendered page, not the source. Double-click the
body (or use the right-click menu) to switch to the text editor; the preview closes and
the editor takes its place, with the cursor on the line you double-clicked.
`mdExplorer: Open Preview` in the editor's title bar brings you back.

**One tab per document, links stay in the tab.** Each file you open gets its own tab.
Clicking a link to another `.md` file loads it in the tab you are already in, and the
tab is renamed to match. Ctrl/Cmd-click — or a middle-click — opens the link in a new
tab behind the one you are reading, so it is there when you want it. Links to other file
types open in a normal editor; `http` links go to your browser.

**Wiki links.** Obsidian's `[[Note name]]`, `[[Note|shown text]]`, `[[Note#Heading]]`
and `![[picture.png]]` all work. A wiki link names a note rather than a path, so a bare
name is looked up across the whole wiki — not just next to the document — and a link with
a slash is read from the wiki root. Names with no file behind them are marked rather than
turned into a link to nowhere. Embedding another *document* (transclusion) is not
supported; those fall back to a link.

**Filenames are not links.** markdown-it's autolinker treats anything shaped like a
hostname as a URL, which turns `vcf2phylip.py` or `setup.cfg` mentioned in prose into a
dead link. Only text that carries a scheme — `https://…` — is linked; set
`mdExplorer.linkify` to `all` for the looser behaviour, or `off` for none.

**History that remembers where you were.** The ← and → buttons in the preview tab's
title bar walk the tab's history, as do <kbd>Alt</kbd>+<kbd>←</kbd> /
<kbd>Alt</kbd>+<kbd>→</kbd> and the preview's right-click menu. VS Code's *own* arrows in
the window title bar are a different thing — they move between editors and positions, and
an extension cannot repurpose them; hide them with `"window.commandCenter": false` if
they get in the way.

| Action | Where you land |
| --- | --- |
| Following a link | Top of the new page, or the linked `#heading` |
| **Forward (→)** | Top of the page |
| **Back (←)** | The link you clicked, back at the top of the view |
| **Open Preview** from an editor | The paragraph the cursor was in, centred |
| **Open in Editor** from a preview | The paragraph you were reading, centred |

**Switching modes keeps your place.** Both directions carry the position across and
centre what you were on, so reading and editing the same passage does not mean finding it
twice — and you get the paragraph with its surroundings, not pinned to the top edge. Going to the editor
takes your selection if you have one, and otherwise whatever sits at the top of the view;
a double-click still wins over both, since it names a paragraph outright. The mapping is
block-level — `data-line` sits on paragraphs, headings and code blocks, not on individual
lines of prose — so you land on the paragraph containing the line, which is the same
granularity VS Code's own Markdown preview syncs at. Nothing syncs while you read: the
position is only carried at the moment you switch.

**Rendering.** GFM tables, task lists, strikethrough and footnotes; syntax-highlighted
code; Mermaid diagrams; KaTeX math; heading anchors; relative images. Everything follows
your colour theme, and the preview re-renders as you edit the file in a split editor.

**Find in page.** <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>F</kbd> opens VS Code's find
widget over the preview. The editor's own find cannot reach inside a webview, so a panel
has to ask for the webview find widget explicitly — it is off by default.

**Front matter stays out of the way.** A `---` delimited YAML block at the top of a file
parses as a setext heading in plain Markdown, which is why it usually shows up as a wall
of bold text. It is dropped from the preview instead; set `mdExplorer.frontMatter` to
`table` to get a compact metadata card, or `source` for the raw YAML.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `mdExplorer.doubleClickToEdit` | `true` | Double-click the body to switch to the editor. Turn this off if it fights with selecting text. |
| `mdExplorer.mermaid.enabled` | `true` | Render ` ```mermaid ` blocks as diagrams. |
| `mdExplorer.math.enabled` | `true` | Render `$…$` and `$$…$$` with KaTeX. |
| `mdExplorer.allowRawHtml` | `true` | Allow raw HTML in Markdown. Output is sanitized either way. |
| `mdExplorer.frontMatter` | `hide` | `hide`, `table` (metadata card) or `source` (raw YAML). |
| `mdExplorer.doubleClickToEdit` | `true` | See the note below on why this needs a guard. |
| `mdExplorer.wikiLinks` | `true` | Resolve `[[wiki links]]`. |
| `mdExplorer.wikiRootMarkers` | `[".obsidian"]` | Files or directories that mark a wiki root. |
| `mdExplorer.wikiLinkFallback` | `unique` | `unique` resolves a name outside the wiki when exactly one file matches; `none` keeps wikis hermetic. |
| `mdExplorer.linkify` | `urls` | `urls` (text with a scheme), `all` (also bare hostnames) or `off`. |
| `mdExplorer.retainHiddenPreviews` | `true` | Keep hidden previews loaded so returning to a tab is instant. Off trades memory for a re-render. |
| `mdExplorer.reclaimTextEditors` | `true` | Turn a Markdown file that landed in a plain text editor into a preview. Files opened with **Open in Editor** are left alone. |
| `mdExplorer.maxHistoryLength` | `50` | Entries kept per tab. |
| `mdExplorer.scrollOffset` | `8` | Breathing room above an element scrolled to the top. |

## How it is put together

VS Code pins a custom editor's tab title to the file it was opened with, and offers no
way to change it ([microsoft/vscode#160543][160543]). A preview built directly on a
custom editor would therefore still say `a.md` after you followed a link to `b.md`.

So `mdExplorer.redirect` is a custom editor registered as the *default* for `*.md`, and
its only job is to hand the file over: it opens a plain `WebviewPanel` in the same slot
and closes itself. A `WebviewPanel`'s title *is* writable, so from there the tab can
follow you from file to file while the webview — and everything the browser has already
laid out — stays alive. The relay tab is opened and closed within one frame, and never
reaches the session state, so restoring a window is handled by the panel serializer
alone.

The custom editor is not the only way a Markdown text editor can appear, though: tabs
restored from a session that predates the extension come back as text editors, and a
`workbench.editorAssociations` entry for `*.md` overrides a custom editor outright. So a
second, narrower net catches strays — any plain text editor showing a `.md` file becomes
a preview, unless you asked for that file in an editor (`mdExplorer.reclaimTextEditors`).

Markdown is converted to HTML in the extension host, because rewriting relative image
paths needs `Webview.asWebviewUri`, which only exists there. The webview receives HTML,
sanitizes it with DOMPurify, and owns the interactive parts: link interception, the
scroll rules above, double-click-to-edit, and Mermaid (which needs a DOM, so it is the
one thing rendered client-side, from a lazily loaded bundle).

```
src/
  extension.ts              activation: provider, serializer, commands, watchers
  redirectEditorProvider.ts the *.md default editor that hands off and closes
  previewManager.ts         tab registry, open/reveal, context keys
  previewPanel.ts           one tab: navigation, title, host<->webview messages
  history.ts                the back/forward stack (no vscode dependency)
  reclaim.ts                turns stray Markdown text editors into previews
  documentText.ts           reads a document without building a text model
  renderer/frontMatter.ts   YAML front matter: hidden, carded, or raw
  renderer/wikiLink.ts      [[wiki link]] inline rule
  wikiIndex.ts              workspace file index and wiki root detection
  editModeTracker.ts        which files the reader asked to edit (persisted)
  api.ts                    the API returned from activate()
  renderer/                 markdown-it pipeline, link classification, highlighting
webview/
  main.ts                   sanitize, scroll rules, link and double-click handling
  mermaid.ts                lazily loaded diagram bundle
```

[160543]: https://github.com/microsoft/vscode/issues/160543

## Speed

Opening a document costs roughly **150-300 ms** once the extension is running, and
following a link inside a tab about **50 ms**, measured end to end in a real VS Code
window by `npm run test:integration` (it prints its timings). Before this was tuned the
same measurements read 1289 ms and 1.3 s. Three things keep it there:

- Markdown is read with `workspace.fs.readFile` rather than
  `workspace.openTextDocument`, which would build a text model and wake the Markdown
  language server for every file you glance at — that alone measured over a second on a
  cold file. Files already open in an editor still render from their unsaved contents.
- The relay tab is created without any content, our stylesheets are inlined into the
  preview shell, and KaTeX's stylesheet and the Mermaid bundle load only for documents
  that use them.
- After a navigation the page re-applies its scroll target from a `ResizeObserver`
  rather than on a timer, so it stops working as soon as the layout stops moving.

Previews stay loaded while their tab is hidden so switching back is instant. With many
previews open that costs memory; `mdExplorer.retainHiddenPreviews: false` trades it for a
re-render on return, and scroll position is preserved either way.

## Where the wiki root comes from

A bare `[[Note]]` only means something relative to a wiki, so the extension has to decide
which subtree that is. In order of precedence:

1. **`root:` in the document's own YAML front matter.**
2. **The nearest ancestor holding a root marker** — `.obsidian` by default, configurable
   through `mdExplorer.wikiRootMarkers`.
3. **The workspace folder** holding the document.
4. **The document's own directory.**

Only files inside the open workspace are indexed, so a root pointing outside it will not
find anything. Where two files share a name, the one nearest the document wins: same
folder first, then the longest shared path, then the shallowest.

### Which form should `root:` take?

**Prefer a bare directory name.** It is read as *the nearest ancestor directory with that
name*, so the value is identical in every page of the wiki however deeply it sits:

```yaml
---
title: Sequencing pipeline
root: research
---
```

That property is what matters for a generated wiki. The alternatives all make the correct
value depend on where the page happens to live:

| Form | Example | |
| --- | --- | --- |
| **Ancestor name** | `root: research` | Same literal everywhere. Survives moving a page between folders and cloning the wiki. **Recommended.** |
| Relative path | `root: ..` | Depends on the page's depth: `research/a.md` needs `..` while `research/notes/b.md` needs `../..`. A generator has to track its own depth, and a wrong value mis-resolves links silently rather than failing. |
| Absolute path | `root: /root/work/research` | Stops working as soon as the wiki is cloned, moved, or mounted at another path — and in a devcontainer the host and container paths differ, so it is wrong on one side by construction. Machine-specific state does not belong in content. |
| Relative level | `root: 2` | The relative path's problems, plus an off-by-one question ("is 0 this folder or the parent?") and no standard meaning. Not supported. |

All three supported forms are recognised by shape: a leading `/` is absolute, anything
containing `/` or equal to `.`/`..` is a path relative to the document, and anything else
is an ancestor name. A name with no matching ancestor falls back to the next rule and logs
a warning rather than resolving to something arbitrary.

### Several wikis, and links between them

**Two directories with the same name never collide.** An ancestor name is resolved against
the document's own path, so `root: research` means a different directory depending on
which file is asking:

```
ws/a/research/Index.md   root: research  ->  ws/a/research
ws/b/research/Index.md   root: research  ->  ws/b/research
```

A name that exists in both — `Home`, say — resolves inside the asking document's own wiki.
Nothing crosses over. This is the one real advantage of the ancestor-name form over a
shared setting: the answer is per-document by construction.

**A project can grow links into a wiki later.** Say `research/` was self-contained and
`research2/hoge.md` now wants to link into it. A `[[wiki link]]` whose name is not in the
document's own wiki is looked up across the whole workspace, and resolved **only if
exactly one file has that name**:

| From | Link | Result |
| --- | --- | --- |
| `research2/hoge.md` | `[[Shared protocol]]` (one such file, in `research/`) | resolves, marked with a ↗ |
| `research2/hoge.md` | `[[Home]]` (exists in two wikis) | unresolved — there is no defensible answer |
| `research/Home.md` | `[[hoge]]` | resolves back into `research2/`, same rule |

The local wiki always wins, so this can never change the meaning of a link that already
worked. And because an ambiguous name is refused rather than guessed at, a link never
quietly points into an unrelated project. Set `mdExplorer.wikiLinkFallback` to `none` to
keep every wiki hermetic.

When an ambiguous name does need to resolve, spell out the path — `[[../research/Home]]`
— which is read from the wiki root first and then relative to the document.

### Or leave it out entirely

The most robust option is not to carry the root in every file at all. Put a marker at the
wiki root and let it be found by walking up — the way `git`, `npm` and Obsidian all locate
theirs:

```jsonc
// .vscode/settings.json
"mdExplorer.wikiRootMarkers": [".obsidian", ".mdwiki"]
```

```
research/
  .mdwiki          <- empty file; nothing to keep in sync
  Home.md
  notes/Alignment.md
```

Nothing in the documents can then be wrong or go stale. Use `root:` when a single wiki
cannot be identified that way — several wikis nested inside one another, for instance.

## Two gestures that fight each other

Following links means clicking in the same spot twice — wiki navigation sits in the same
place on every page — and two clicks in the same spot are a double-click. By the time the
second click lands, the first has already replaced the document, so it hits body text
rather than the link and "double-click to edit" fires in the middle of a navigation: the
preview closes and you end up in the source. The gesture is therefore ignored for 700 ms
after any navigation. The **Open in Editor** button and command are never guarded, since
they cannot be triggered by accident.

## Diagnostics

`mdExplorer: Show Log` opens an output channel carrying activation, every navigation,
render failures, and any error raised inside the preview page (which would otherwise
only reach a webview devtools console nobody has open).

The integration suite asserts `api.renderErrors === 0` at the end of its run. That check
exists because a document that fails to render still produces a tab with the right title
and a working history: every other assertion can pass while the page shows nothing but an
error, which is exactly how a broken renderer once survived a green test run.

## A note on the find widget

`enableFindWidget` is a `WebviewPanelOption`, which means it can only be set when the
panel is created — unlike `WebviewOptions` (scripts, resource roots), it cannot be changed
afterwards. A preview restored by the serializer therefore depends on VS Code having
persisted it; `PreviewPanel.restore` reads `panel.options.enableFindWidget` back and warns
into the log if it came back missing, since Ctrl+F would then be dead on that tab until it
is closed and reopened.

## A note on title-bar buttons

`WebviewPanel.active` means the webview has keyboard focus, but VS Code goes on treating
a preview as the *active editor* after focus moves away — and clicking a button in that
editor's own title bar is exactly such a move. A command that looks for the focused
preview therefore finds nothing at the moment it is invoked. `PreviewManager` falls back
to the preview that had focus last, for as long as it is still on screen.

## If a .md file still opens as text

1. **Reload the window** (`Developer: Reload Window`). An extension installed into a
   running window is not picked up by tabs that are already open.
2. **Close the old tabs and open the file again.** VS Code restores each tab as whatever
   editor it was last time, so tabs from before the install come back as text editors.
   With `mdExplorer.reclaimTextEditors` on they are converted automatically, but only
   once the extension has been activated in that window.
3. **Check `workbench.editorAssociations`** in your user settings. An entry such as
   `"*.md": "default"` overrides the preview. Remove it, or leave the reclaim setting on.

## Installing it into a devcontainer

`customizations.vscode.extensions` in `devcontainer.json` only accepts Marketplace ids,
and `code --install-extension` is the *remote-cli* binary, which talks to an attached
window over an IPC socket and fails when there is none — during `postCreateCommand`, or
whenever that socket has gone stale. The server ships its own CLI that installs
headlessly, and that is what `.devcontainer/install-local-extensions.sh` uses:

```
~/.vscode-server/bin/<commit>/bin/code-server --install-extension <file>.vsix --force
```

The script installs every `.vsix` in `.devcontainer/extensions/`, keyed on a checksum
stamp so re-attaching costs about 10 ms. It is wired into both lifecycle hooks: to
`postCreateCommand` (a no-op if the server is not unpacked yet) and to
`postAttachCommand`, which is also how a rebuilt `.vsix` reaches an existing container.
It depends on nothing beyond bash and `md5sum` — the base image here has no `node` and no
`unzip`.

To ship a new build: `npm run deploy:devcontainer`, then reload the window.

### Should this be on the Marketplace instead?

Only once you want it somewhere the source is not. The Marketplace's one real advantage
is that VS Code updates the extension for you, and the devcontainer config collapses to
one line in `customizations.vscode.extensions`. Against it:

- **There is no private Marketplace for VS Code extensions.** Publishing makes it public.
  Open VSX is the alternative registry, but VS Code proper does not read it — only
  VSCodium, Gitpod and Theia do.
- Publishing needs a Marketplace publisher (a free Azure DevOps organisation) and a
  personal access token, and `@vscode/vsce` requires Node >= 18 — which the base image
  here does not have, so releases would have to run from CI or the host.
- Every change then costs a version bump and a publish before it reaches the container,
  where today it costs one `npm run deploy:devcontainer`.

If you do publish: set a real `publisher` and `repository` in `package.json` (both are
absent on purpose — a placeholder repository URL would ship a dead link in the listing),
add an `icon`, then `vsce login <publisher>` and `vsce publish`. After that, replace the
`.vsix` and the lifecycle hooks with the id in `customizations.vscode.extensions`.

## Developing

```bash
npm install
npm run build            # or: npm run watch
npm test                 # history, link resolution, rendering
npm run test:integration # drives a real VS Code instance
npm run test:all
npm run typecheck
npm run package          # -> mdexplorer-<version>.vsix
```

The integration suite launches VS Code, so on a headless machine run it under a virtual
display: `xvfb-run -a npm run test:integration`. It covers the parts unit tests cannot
reach — that `.md` resolves to the preview at all, that a link keeps you in one tab and
renames it, that Back and Forward walk the history, and that switching to the editor and
back replaces the tab rather than piling up new ones.

`npm run package` builds the `.vsix` directly rather than through `@vscode/vsce`, which
needs Node >= 18. Install the result with
`code --install-extension mdexplorer-0.1.0.vsix`, and remove it again with
`code --uninstall-extension local.mdexplorer`.

Press <kbd>F5</kbd> to launch an Extension Development Host on `samples/`, or:

```bash
code --extensionDevelopmentPath="$PWD" "$PWD/samples"
```

`samples/` is laid out to exercise every case: cross-directory links, fragment links,
relative images, a non-Markdown link, an external link, math, a diagram, and a document
long enough to see the Back scroll rule working.
