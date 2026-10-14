# KnowledgeWalk

Read Markdown in VS Code the way you read a website: `.md` files open as a rendered
page, links to other `.md` files load **in the same tab**, and Back/Forward take you
through where you have been.

## What it does

**Preview by default.** Opening a `.md` file — from the Explorer, Quick Open, a link in
another file, anywhere — gives you the rendered page, not the source. Double-click the
body (or use the right-click menu) to switch to the text editor; the preview closes and
the editor takes its place, with the cursor on the line you double-clicked.
`KnowledgeWalk: Open Preview` in the editor's title bar brings you back.

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
hostname as a URL, which turns `build.py` or `setup.cfg` mentioned in prose into a
dead link. Only text that carries a scheme — `https://…` — is linked; set
`knowledgeWalk.linkify` to `all` for the looser behaviour, or `off` for none.

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

**Front matter becomes a card.** A `---` delimited YAML block at the top of a file
parses as a setext heading in plain Markdown, which is why it usually shows up as a wall
of bold text. When the front matter has a `type` — every [OKF](#generated-wikis-and-okf-v02)
page does, and most generated wikis follow suit — it is drawn as a metadata card above the
document; otherwise it is dropped. `knowledgeWalk.frontMatter` switches this: `table` for a
card on every document, `hide` for none, `source` for the raw YAML.

## Installing

Install **KnowledgeWalk** from the Visual Studio Marketplace or Open VSX, or build a `.vsix`
yourself (see [Developing](#developing)) and run *Extensions: Install from VSIX…*. Then
reload the window: tabs that were already open come back as text editors until they are
reopened (see [If a .md file still opens as text](#if-a-md-file-still-opens-as-text)).

## Settings

| Setting | Default | |
| --- | --- | --- |
| `knowledgeWalk.doubleClickToEdit` | `true` | Double-click the body to switch to the editor. Turn this off if it fights with selecting text. |
| `knowledgeWalk.mermaid.enabled` | `true` | Render ` ```mermaid ` blocks as diagrams. |
| `knowledgeWalk.math.enabled` | `true` | Render `$…$` and `$$…$$` with KaTeX. |
| `knowledgeWalk.allowRawHtml` | `true` | Allow raw HTML in Markdown. Output is sanitized either way. |
| `knowledgeWalk.frontMatter` | `auto` | `auto` (a card when the front matter has a `type`), `table` (always a card), `hide` or `source` (raw YAML). |
| `knowledgeWalk.knownFileExtensions` | `[]` | Extra extensions (`.fasta`, `.drawio`, …) that mark a front matter value as a file, so a broken one is flagged. |
| `knowledgeWalk.frontMatterDisplay` | `{}` | Layout of the card; see [The metadata card](#the-metadata-card). A wiki's own `.knowledgewalk.yaml` is layered over it. |
| `knowledgeWalk.wikiLinks` | `true` | Resolve `[[wiki links]]`. |
| `knowledgeWalk.wikiRootMarkers` | `[".obsidian"]` | Files or directories that mark a wiki root. |
| `knowledgeWalk.wikiRootKey` | `root` | The front matter key that names a document's wiki root. Change it if `root` already means something else in your documents. |
| `knowledgeWalk.wikiLinkFallback` | `unique` | `unique` resolves a name outside the wiki when exactly one file matches; `none` keeps wikis hermetic. |
| `knowledgeWalk.linkify` | `urls` | `urls` (text with a scheme), `all` (also bare hostnames) or `off`. |
| `knowledgeWalk.retainHiddenPreviews` | `true` | Keep hidden previews loaded so returning to a tab is instant. Off trades memory for a re-render. |
| `knowledgeWalk.reclaimTextEditors` | `true` | Turn a Markdown file that landed in a plain text editor into a preview. Files opened with **Open in Editor** are left alone. |
| `knowledgeWalk.maxHistoryLength` | `50` | Entries kept per tab. |
| `knowledgeWalk.scrollOffset` | `8` | Breathing room above an element scrolled to the top. |

## Generated wikis and OKF v0.2

KnowledgeWalk is tuned for reading Markdown that a model wrote and maintains — in
particular wikis following the [Open Knowledge Format v0.2][okf], where every page carries
YAML front matter with a `type`, a `description`, the `sources` it was derived from, who
`generated` it and who has `verified` it.

**The card.** Front matter is drawn as a card rather than hidden:

- **Banners** for a `status: deprecated` page (the body is dimmed too: OKF keeps such
  pages "for links and history"), a page past its `stale_after`, and a page whose
  `sources[].last_modified` is newer than its own `generated.at`.
- **A header line** of badges: `type`, `status` (only when it is not the default
  `stable`), the **trust tier** OKF derives from `verified` — *unverified*,
  *machine-checked*, or *human-reviewed* once a `human:` actor has signed — the generation
  stamp (`🤖 my-agent/1.4 · 2026-08-07`), and `tags`.
- **The title** only when it says more than the page's first heading.
- **The `description`** as a lead paragraph.
- **The sources**, each with its id, a link (labelled with the linked page's own title),
  and any keys a wiki adds such as `relation:`.
- **Everything else** under a collapsible *Details*.

**References in front matter become links.** Values such as `related: [runbooks/restart-db]`
or `resource: ../sources/x.md` are links to the page they name, labelled with that page's
title, and clicking one navigates in the tab like any other link. See [how a path is
resolved](#how-a-path-in-front-matter-is-resolved).

**Citations.** OKF attributes a claim with a footnote whose label is a source id,
`…as reported[^smith2024].`, with no `[^smith2024]: …` definition in the body. Those become
numbered citations that jump to the source on the card; a label that names no source is
marked `[smith2024?]`. Footnotes defined in the body work as before.

**Hover a link** to a Markdown page to see its `title` and `description` before following
it.

**Dates are shown as written.** `generated: { at: 2026-08-07T10:00:00+09:00 }` is the 7th
where it was written; converting to UTC, as YAML's timestamp type does, would make it the
6th. Front matter is read with the YAML 1.2 core schema, which leaves timestamps as text.

[okf]: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md

## The metadata card

The card's layout comes from three layers, later ones winning:

1. the built-in defaults, which know the OKF core keys;
2. the `knowledgeWalk.frontMatterDisplay` setting;
3. the `frontMatter:` section of **`.knowledgewalk.yaml` at the wiki root**, which is where a
   wiki describes its own extension keys, versioned alongside its pages.

Mappings merge key by key and lists replace. Then `byType[<type>]` is layered on top for
the page's `type`, by the same rule.

```yaml
# <wiki root>/.knowledgewalk.yaml
frontMatter:
  header: [type, status, trust, generated, tags]   # the first line; `trust` is the tier
  lead: description                                 # the lead paragraph
  hidden: [okf_version, root]                       # never shown
  hideTitleWhenSameAsH1: true
  details: collapsed                                # collapsed | expanded | hidden
  fields:
    owner:     { as: text }
    priority:  { as: badge, colors: { high: red, medium: orange, low: gray } }
    status:    { as: badge, colors: { draft: yellow }, hideValues: [stable] }
    generated: { as: template, template: "🤖 {by} · {at|date}" }
    related:   { as: links, label: title }
  byType:
    decision: { header: [type, status, trust, phase, owner] }
    incident: { header: [type, status, priority, owner] }
```

| `as` | Draws the value as |
| --- | --- |
| `auto` | The default for any key not configured: a URL or a resolvable path is a link, a list is chips (or a table if it holds mappings), a mapping is a nested list, anything else text. |
| `text` | Plain text. |
| `badge` | A badge per value, coloured by `colors` (`red` `orange` `yellow` `green` `blue` `purple` `gray` `none`); values in `hideValues` are skipped. |
| `chips` | A chip per list item. |
| `date` | The `YYYY-MM-DD` part, as written. |
| `link` / `links` | A link per path; `label: path` shows the path instead of the target's title. |
| `table` | A table, one row per mapping in the list. |
| `template` | `{key}`, `{key.sub}` and `{key\|date}` filled from the value. The result is text: markup in a template or a value is escaped, never interpreted. |
| `sources` | The source list (the default for `sources`). |
| `hidden` | Not shown. |

Both places are checked as you type. The setting carries a JSON schema, so in
`settings.json` VS Code completes the setting names, every `as` kind and colour, and
underlines anything it would not accept. The same schema is offered for
`.knowledgewalk.yaml` through the [YAML extension][yaml-ext] (`redhat.vscode-yaml`), when it
is installed.

An invalid entry is reported once in the log (*KnowledgeWalk: Show Log*) and that key falls
back to `auto`. Changes to `.knowledgewalk.yaml` re-render open previews. The file is read in
untrusted workspaces too: it only changes layout, and nothing in it can produce markup.

Fuller examples are in [`docs/examples/`](docs/examples): a minimal OKF wiki, an
Obsidian-style notes vault, architecture decision records, and a research wiki.

[yaml-ext]: https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml

## How it is put together

VS Code pins a custom editor's tab title to the file it was opened with, and offers no
way to change it ([microsoft/vscode#160543][160543]). A preview built directly on a
custom editor would therefore still say `a.md` after you followed a link to `b.md`.

So `knowledgeWalk.redirect` is a custom editor registered as the *default* for `*.md`, and
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
a preview, unless you asked for that file in an editor (`knowledgeWalk.reclaimTextEditors`).

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
  renderer/card.ts          the metadata card
  renderer/okfCite.ts       [^id] citations of front matter sources
  renderer/wikiLink.ts      [[wiki link]] inline rule
  wikiIndex.ts              workspace file index and wiki root detection
  okf/service.ts            per-document preparation: roots, existence, display config
  okf/pathResolver.ts       front matter path values -> files (no vscode dependency)
  okf/model.ts              OKF v0.2 keys, trust tiers, dates (no vscode dependency)
  okf/displayConfig.ts      card layout defaults and layering (no vscode dependency)
  okf/metaCache.ts          title/description of linked pages, for labels and hovers
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
previews open that costs memory; `knowledgeWalk.retainHiddenPreviews: false` trades it for a
re-render on return, and scroll position is preserved either way.

## Where the wiki root comes from

A bare `[[Note]]` only means something relative to a wiki, so the extension has to decide
which subtree that is. In order of precedence:

1. **`root:` in the document's own YAML front matter** (the key name is
   `knowledgeWalk.wikiRootKey`).
2. **The nearest ancestor holding a root marker** — `.obsidian` by default, configurable
   through `knowledgeWalk.wikiRootMarkers`.
3. **The workspace folder** holding the document.
4. **The document's own directory.**

Only files inside the open workspace are indexed, so a root pointing outside it will not
find anything. Where two files share a name, the one nearest the document wins: same
folder first, then the longest shared path, then the shallowest.

### The OKF bundle root

An OKF bundle is the directory holding an `index.md` whose front matter declares
`okf_version`. It is the base of OKF *Concept IDs* — `runbooks/restart-db` means
`<bundle>/runbooks/restart-db.md` — and of links starting with `/`. It need not be the
wiki root: a knowledge base may keep attachments or raw material beside the bundle, with
`root: handbook` pointing at `handbook/` and the bundle at `handbook/wiki/`.

So KnowledgeWalk keeps both. The **wiki root** is found as above, with `root:` first; the
**bundle root** is the nearest directory between the document and the wiki root (both
included) holding such an `index.md`, and is the wiki root itself when there is none. The
wiki root caps the search: `root:` is the author saying where the wiki ends.

A body link starting with `/` is read from the bundle root first, then the workspace
folder, then the filesystem root, and goes to the first that exists. Outside a bundle that
is the workspace folder, as before.

### How a path in front matter is resolved

Front matter written by models mixes several kinds of path, often within one page:

| Written as | Example | Resolved against |
| --- | --- | --- |
| `./` or `../` | `../sources/x.md` | the document's folder |
| `/…` | `/runbooks/restart-db.md` | the bundle root; failing that, the filesystem (shown with ⚠, since it breaks when the wiki moves) |
| anything else with a `/` or an extension | `runbooks/restart-db`, `x.md`, `attachments/diagram.pdf` | the document's folder, the bundle root and the wiki root, in that order |

A value without an extension is also tried with `.md`. For the last row, the value becomes
a link **only when exactly one candidate exists**. If it names a file under two bases —
`notes/dup.md` both in the bundle and beside it — it is shown with a `?` and the
candidates on hover, rather than guessed at. A value with an extension that resolves
nowhere is marked as missing — if the extension is a common file type or listed in
`knowledgeWalk.knownFileExtensions`. Anything else (`my-agent/1.4`, `db.prod`) may well be a
name rather than a file, and is just text.

### Which form should `root:` take?

**Prefer a bare directory name.** It is read as *the nearest ancestor directory with that
name*, so the value is identical in every page of the wiki however deeply it sits:

```yaml
---
title: Restarting the database
root: handbook
---
```

That property is what matters for a generated wiki. The alternatives all make the correct
value depend on where the page happens to live:

| Form | Example | |
| --- | --- | --- |
| **Ancestor name** | `root: handbook` | Same literal everywhere. Survives moving a page between folders and cloning the wiki. **Recommended.** |
| Relative path | `root: ..` | Depends on the page's depth: `handbook/a.md` needs `..` while `handbook/notes/b.md` needs `../..`. A generator has to track its own depth, and a wrong value mis-resolves links silently rather than failing. |
| Absolute path | `root: /home/alice/handbook` | Stops working as soon as the wiki is cloned, moved, or mounted at another path — and in a devcontainer the host and container paths differ, so it is wrong on one side by construction. Machine-specific state does not belong in content. |
| Relative level | `root: 2` | The relative path's problems, plus an off-by-one question ("is 0 this folder or the parent?") and no standard meaning. Not supported. |

All three supported forms are recognised by shape: a leading `/` is absolute, anything
containing `/` or equal to `.`/`..` is a path relative to the document, and anything else
is an ancestor name. A name with no matching ancestor falls back to the next rule and logs
a warning rather than resolving to something arbitrary.

### Several wikis, and links between them

**Two directories with the same name never collide.** An ancestor name is resolved against
the document's own path, so `root: handbook` means a different directory depending on
which file is asking:

```
ws/a/handbook/Index.md   root: handbook  ->  ws/a/handbook
ws/b/handbook/Index.md   root: handbook  ->  ws/b/handbook
```

A name that exists in both — `Home`, say — resolves inside the asking document's own wiki.
Nothing crosses over. This is the one real advantage of the ancestor-name form over a
shared setting: the answer is per-document by construction.

**A project can grow links into a wiki later.** Say `handbook/` was self-contained and
`project-x/notes.md` now wants to link into it. A `[[wiki link]]` whose name is not in the
document's own wiki is looked up across the whole workspace, and resolved **only if
exactly one file has that name**:

| From | Link | Result |
| --- | --- | --- |
| `project-x/notes.md` | `[[On-call guide]]` (one such file, in `handbook/`) | resolves, marked with a ↗ |
| `project-x/notes.md` | `[[Home]]` (exists in two wikis) | unresolved — there is no defensible answer |
| `handbook/Home.md` | `[[notes]]` | resolves back into `project-x/`, same rule |

The local wiki always wins, so this can never change the meaning of a link that already
worked. And because an ambiguous name is refused rather than guessed at, a link never
quietly points into an unrelated project. Set `knowledgeWalk.wikiLinkFallback` to `none` to
keep every wiki hermetic.

When an ambiguous name does need to resolve, spell out the path — `[[../handbook/Home]]`
— which is read from the wiki root first and then relative to the document.

### Or leave it out entirely

The most robust option is not to carry the root in every file at all. Put a marker at the
wiki root and let it be found by walking up — the way `git`, `npm` and Obsidian all locate
theirs:

```jsonc
// .vscode/settings.json
"knowledgeWalk.wikiRootMarkers": [".obsidian", ".mdwiki"]
```

```
handbook/
  .mdwiki          <- empty file; nothing to keep in sync
  Home.md
  notes/On-call guide.md
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

`KnowledgeWalk: Show Log` opens an output channel carrying activation, every navigation,
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
   With `knowledgeWalk.reclaimTextEditors` on they are converted automatically, but only
   once the extension has been activated in that window.
3. **Check `workbench.editorAssociations`** in your user settings. An entry such as
   `"*.md": "default"` overrides the preview. Remove it, or leave the reclaim setting on.

## Developing

```bash
npm install
npm run build            # or: npm run watch
npm test                 # unit tests
npm run test:integration # drives a real VS Code instance
npm run test:all
npm run typecheck
npm run package          # -> knowledgewalk-<version>.vsix, through vsce
```

The integration suite launches VS Code, so on a headless machine run it under a virtual
display: `xvfb-run -a npm run test:integration`. It covers the parts unit tests cannot
reach — that `.md` resolves to the preview at all, that a link keeps you in one tab and
renames it, that Back and Forward walk the history, that switching to the editor and
back replaces the tab rather than piling up new ones, and that the settings schema drives
completion in `settings.json`. Set `KW_ONLY=<text>` to run only the cases whose name
contains it.

`npm run package` packages with `@vscode/vsce`, which needs the `repository` field in
`package.json` to rewrite the README's relative links. `npm run package:local` builds a
`.vsix` without it, for local installs; to put one into a dev container, see
[docs/devcontainer.md](docs/devcontainer.md).

### Releasing

1. Update `CHANGELOG.md` and the `version` in `package.json`.
2. `npm run test:all`.
3. Visual Studio Marketplace: `npx vsce publish` (needs a publisher and a personal access
   token, `vsce login <publisher>`).
4. Open VSX, for VSCodium, Gitpod and other editors that do not read the Marketplace:
   `npx ovsx publish knowledgewalk-<version>.vsix -p <token>`.

Press <kbd>F5</kbd> to launch an Extension Development Host on `samples/`, or:

```bash
code --extensionDevelopmentPath="$PWD" "$PWD/samples"
```

`samples/` is laid out to exercise every case: cross-directory links, fragment links,
relative images, a non-Markdown link, an external link, math, a diagram, and a document
long enough to see the Back scroll rule working.
