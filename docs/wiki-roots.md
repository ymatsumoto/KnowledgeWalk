# Wiki roots and path resolution

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
