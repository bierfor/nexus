# Nexus `.nx` (VS Code)

Language support for [Nexus](https://nexusjs.dev) `.nx` files: grammar (server `---` block as TypeScript, markup as HTML), bracket/comment behavior, snippets, and keyboard shortcuts to wrap selections in client islands.

## Install from this repo

1. In a terminal: `cd extensions/nexus-vscode && npm install` (builds `out/` via `postinstall`).
2. **Command Palette** → **Extensions: Install from Location…**
3. Choose the folder `extensions/nexus-vscode` (this directory).

The Nexus workspace recommends **`bierhffor.nexus-nx`** once it exists on the Marketplace. Until then, use **Install from Location** (above) or install the generated `.vsix` manually.

**CLI (global):** install the packaging tool once so `vsce` is on your PATH:

```bash
npm install -g @vscode/vsce
```

The extension folder still ships a local `@vscode/vsce` so `npm run package` works without a global install.

## Emmet

If Emmet does not expand in `.nx`, add to your user or workspace `settings.json`:

```json
"emmet.includeLanguages": {
  "nx": "html"
}
```

The Nexus repo workspace already includes this under `.vscode/settings.json`.

## Snippets

With a `.nx` file focused, use **Insert Snippet** or trigger prefixes such as `nx-page`, `nx-server`, `nx-use-server`, `nx-client-visible`, `nx-call-action`, etc.

## Keyboard shortcuts (default)

| Action | Windows / Linux | macOS |
|--------|-----------------|-------|
| Wrap with `client:visible` | `Ctrl+Alt+V` | `Cmd+Alt+V` |
| Wrap with `client:load` | `Ctrl+Alt+L` | `Cmd+Alt+L` |
| Wrap with `client:idle` | `Ctrl+Alt+I` | `Cmd+Alt+I` |

Change them under **Keyboard Shortcuts** by searching for **Nexus: Wrap**.

## Development

```bash
cd extensions/nexus-vscode
npm install
npm run compile
```

Press **F5** in VS Code with this folder open to launch an **Extension Development Host**.

### Package a `.vsix`

From `extensions/nexus-vscode`:

```bash
npm run package
```

Creates `nexus-nx-<version>.vsix` in this folder (ignored by git). Install via **Extensions: Install from VSIX…**.

### Publish to the Visual Studio Marketplace

1. Create a [Microsoft Azure DevOps](https://dev.azure.com) organization if needed, then a **Personal Access Token** with **Marketplace (Manage)** scope ([publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)).
2. Create or use the Marketplace publisher id **`bierhffor`** (must match `package.json` → `publisher`).
3. Log in once: `vsce login bierhffor` (after `npm install -g @vscode/vsce`), or `npx @vscode/vsce login bierhffor`.
4. Bump `version` in `package.json`, then:

```bash
npm run publish:marketplace
```

Or set `VSCE_PAT` in the environment and run the same command in CI.

**Note on publisher IDs:** The extension declares `"publisher": "bierhffor"` (the Visual Studio Marketplace account). The GitHub repository and all framework packages use the org `bierfor`. This split is intentional. When running `vsce login` or `vsce publish`, always use the Marketplace name `bierhffor`. The two names will never be the same string.

### Open VSX (optional)

For VSCodium / Eclipse Theia registries, after installing the Open VSX CLI, publish from this directory following [Open VSX publishing](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).

## License

See [LICENSE](./LICENSE) (MIT, same as the Nexus monorepo).
