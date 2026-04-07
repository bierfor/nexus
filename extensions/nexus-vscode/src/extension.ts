import * as vscode from 'vscode';

/** Escape $, \, } so user selection is literal inside a SnippetString. */
function escapeSnippetBody(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/}/g, '\\}');
}

function wrapIsland(editor: vscode.TextEditor, directive: 'client:visible' | 'client:load' | 'client:idle') {
  const sel = editor.selection;
  const raw = editor.document.getText(sel);
  const inner = raw.length > 0 ? escapeSnippetBody(raw) : '$0';
  const snippet = new vscode.SnippetString(`<div ${directive}>${inner}</div>`);
  void editor.insertSnippet(snippet, sel);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('nexus.nx.wrapClientVisible', (ed) => {
      wrapIsland(ed, 'client:visible');
    }),
    vscode.commands.registerTextEditorCommand('nexus.nx.wrapClientLoad', (ed) => {
      wrapIsland(ed, 'client:load');
    }),
    vscode.commands.registerTextEditorCommand('nexus.nx.wrapClientIdle', (ed) => {
      wrapIsland(ed, 'client:idle');
    }),
  );
}

export function deactivate(): void {}
