# Installing a local build into a dev container

A dev container can install Marketplace extensions by id through
`customizations.vscode.extensions` in `devcontainer.json`. A build that is not published —
a branch you are testing, a fork — needs another route, and the obvious one does not
work: `code --install-extension` inside a container is the *remote-cli* binary, which
talks to an attached window over an IPC socket and fails when there is none (during
`postCreateCommand`, or whenever that socket has gone stale).

The VS Code server ships its own CLI, which installs headlessly:

```
~/.vscode-server/bin/<commit>/bin/code-server --install-extension <file>.vsix --force
```

## A script for the lifecycle hooks

Keep the `.vsix` files in `.devcontainer/extensions/` and install them with a script like
this one, wired to both `postCreateCommand` (a no-op while the server is not unpacked yet)
and `postAttachCommand` (which is also how a rebuilt `.vsix` reaches an existing
container). A checksum stamp makes re-attaching cost almost nothing. It needs only bash
and `md5sum`.

```bash
#!/usr/bin/env bash
# .devcontainer/install-local-extensions.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stamp="$HOME/.vscode-server/.local-extensions-stamp"

shopt -s nullglob
vsixes=("$here"/extensions/*.vsix)
shopt -u nullglob
[ ${#vsixes[@]} -eq 0 ] && exit 0

# Newest server build wins: a container can hold several after VS Code updates.
cli=""
for candidate in "$HOME"/.vscode-server/bin/*/bin/code-server; do
  if [ -x "$candidate" ] && { [ -z "$cli" ] || [ "$candidate" -nt "$cli" ]; }; then
    cli="$candidate"
  fi
done
[ -z "$cli" ] && exit 0   # not unpacked yet; postAttachCommand will get it

current="$(md5sum "${vsixes[@]}" | md5sum | cut -d' ' -f1)"
[ -f "$stamp" ] && [ "$(cat "$stamp")" = "$current" ] && exit 0

for vsix in "${vsixes[@]}"; do
  "$cli" --install-extension "$vsix" --force
done
mkdir -p "$(dirname "$stamp")"
printf '%s' "$current" > "$stamp"
```

```jsonc
// .devcontainer/devcontainer.json
"postCreateCommand": "bash .devcontainer/install-local-extensions.sh",
"postAttachCommand": "bash .devcontainer/install-local-extensions.sh"
```

## Shipping a new build

```bash
KW_DEPLOY_DIR=/path/to/.devcontainer/extensions npm run deploy:devcontainer
```

packages the extension and copies the `.vsix` into that folder, replacing older builds of
KnowledgeWalk. Without `KW_DEPLOY_DIR` it uses `../.devcontainer/extensions` next to this
repository, if that folder exists. Re-attach (or run the script) and reload the window.
