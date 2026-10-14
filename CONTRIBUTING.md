# Contributing

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

## Releasing

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
