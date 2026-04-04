/**
 * Server Action extraction via TypeScript AST (handles nested braces, return objects, etc.).
 */

import ts from 'typescript';
import type { ServerAction } from './types.js';

function hasUseServerDirective(body: ts.Block): boolean {
  if (body.statements.length === 0) return false;
  const first = body.statements[0]!;
  if (!ts.isExpressionStatement(first)) return false;
  const ex = first.expression;
  if (ts.isStringLiteral(ex)) return ex.text === 'use server';
  if (ts.isNoSubstitutionTemplateLiteral(ex)) return ex.text === 'use server';
  return false;
}

/** Body text for registerAction: statements after the leading "use server" directive. */
function extractActionBody(sourceFile: ts.SourceFile, body: ts.Block): string {
  return body.statements.slice(1).map((s) => s.getText(sourceFile)).join('\n');
}

function paramTexts(sourceFile: ts.SourceFile, params: ts.NodeArray<ts.ParameterDeclaration>): string[] {
  return params.map((p) => p.getText(sourceFile));
}

function tryPushAction(
  name: string,
  sourceFile: ts.SourceFile,
  params: ts.NodeArray<ts.ParameterDeclaration>,
  body: ts.Block | undefined,
  seen: Set<string>,
  out: ServerAction[],
): void {
  if (!body || !hasUseServerDirective(body)) return;
  if (seen.has(name)) return;
  seen.add(name);
  const bodyText = extractActionBody(sourceFile, body);
  out.push({
    name,
    params: paramTexts(sourceFile, params),
    body: bodyText,
    returnType: 'Promise<unknown>',
  });
}

function isCreateActionCallee(expr: ts.Expression): boolean {
  return ts.isIdentifier(expr) && expr.text === 'createAction';
}

/** `const save = createAction({ handler: ... })` or `createAction(async (fd, ctx) => {})` */
function tryPushCreateAction(
  name: string,
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  seen: Set<string>,
  out: ServerAction[],
): void {
  if (seen.has(name)) return;
  seen.add(name);
  const createActionSource = call.getText(sourceFile);
  out.push({
    name,
    params: [],
    body: '',
    returnType: 'Promise<unknown>',
    createActionSource,
  });
}

/**
 * Extracts server actions from script + frontmatter (TypeScript / JS).
 */
export function extractServerActionsFromSource(code: string): ServerAction[] {
  const out: ServerAction[] = [];
  const seen = new Set<string>();

  const sourceFile = ts.createSourceFile(
    'actions.ts',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      tryPushAction(node.name.text, sourceFile, node.parameters, node.body, seen, out);
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        const init = decl.initializer;
        if (ts.isCallExpression(init) && isCreateActionCallee(init.expression)) {
          tryPushCreateAction(name, sourceFile, init, seen, out);
          continue;
        }
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          if (init.body && ts.isBlock(init.body)) {
            tryPushAction(name, sourceFile, init.parameters, init.body, seen, out);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return out;
}
