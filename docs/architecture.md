# How KnowledgeWalk works

Notes on the design: why the preview is built the way it is, what keeps it fast, and the
VS Code behaviours it has to work around.

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

## Two gestures that fight each other

Following links means clicking in the same spot twice — wiki navigation sits in the same
place on every page — and two clicks in the same spot are a double-click. By the time the
second click lands, the first has already replaced the document, so it hits body text
rather than the link and "double-click to edit" fires in the middle of a navigation: the
preview closes and you end up in the source. The gesture is therefore ignored for 700 ms
after any navigation. The **Open in Editor** button and command are never guarded, since
they cannot be triggered by accident.

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
