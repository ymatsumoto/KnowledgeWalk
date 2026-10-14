# The metadata card

How KnowledgeWalk draws YAML front matter, what it understands of
[OKF v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md),
and how to lay the card out for your own wiki.

## What the card shows

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
  *machine-confirmed*, or *human-reviewed* once a `human:` actor has signed — the generation
  stamp (`🤖 my-agent/1.4 · 2026-08-07`), and `tags`.
- **The title** only when it says more than the page's first heading.
- **The `description`** as a lead paragraph.
- **The sources**, each with its id, a link (labelled with the linked page's own title),
  and any keys a wiki adds such as `relation:`.
- **Everything else** under a collapsible *Details*.

**References in front matter become links.** Values such as `related: [runbooks/restart-db]`
or `resource: ../sources/x.md` are links to the page they name, labelled with that page's
title, and clicking one navigates in the tab like any other link. See [how a path is
resolved](wiki-roots.md#how-a-path-in-front-matter-is-resolved).

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

## Configuring the card

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

Fuller examples are in [`examples/`](examples): a minimal OKF wiki, an
Obsidian-style notes vault, architecture decision records, and a research wiki.

[yaml-ext]: https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml
