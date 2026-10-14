# Changelog

## 0.4.0

- **Configurable wiki root key.** `mdExplorer.wikiRootKey` names the front matter key
  that declares a document's wiki root (default `root`); the metadata card hides that key.
- **Configurable file extensions.** `mdExplorer.knownFileExtensions` adds extensions whose
  broken references in front matter are flagged. The built-in list is now domain-neutral.
- **Localisation.** The preview's own text (card labels, banners, hover text, errors) is
  localisable, with a Japanese translation.
- Documentation, samples and examples rewritten in English around a neutral example wiki;
  example `.mdexplorer.yaml` files for a minimal OKF wiki, Obsidian-style notes, ADRs and
  a research wiki under `docs/examples/`.

## 0.3.2

- Links inside metadata-card chips stay readable in themes whose badge colour equals the
  link colour (Light 2026).
- Folds (*Details*) stay open per document, and Back opens the fold around the link it
  returns to.

## 0.3.1

- JSON schema for `mdExplorer.frontMatterDisplay`: completion and validation in
  `settings.json`, and for `.mdexplorer.yaml` through the YAML extension.

## 0.3.0

- **OKF v0.2 support.** Front matter is drawn as a metadata card: lifecycle banners,
  badges with the verification tier, the description, sources, and the remaining keys
  under *Details*.
- References in front matter (Concept IDs, relative and root-relative paths) become
  links labelled with the target's title; ambiguous and missing references are marked.
- `[^id]` citations of `sources[].id` become numbered links to the source list.
- Hovering a link to a Markdown page shows its title and description.
- Card layout is configurable through `mdExplorer.frontMatterDisplay` and a per-wiki
  `.mdexplorer.yaml`.
- Dates are shown as written, without time-zone conversion.

## 0.2.x

- Switching between preview and editor keeps the reading position.

## 0.1.0

- Initial release: Markdown opens as a preview, links navigate within the tab, and each
  tab has Back/Forward history. Wiki links, Mermaid, KaTeX, front matter handling.
