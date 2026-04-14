import type { Rule } from 'eslint';

function isMemberExpression(n: any): n is { type: 'MemberExpression'; object: any; property: any; computed: boolean } {
  return n && n.type === 'MemberExpression';
}

function isIdentifier(n: any, name: string): boolean {
  return n && n.type === 'Identifier' && n.name === name;
}

function isCtxDbChain(n: any): boolean {
  let cur = n;
  while (isMemberExpression(cur) && cur.computed === false) {
    if (isIdentifier(cur.property, 'db') && isIdentifier(cur.object, 'ctx')) return true;
    cur = cur.object;
  }
  return false;
}

const requireWithTenant: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require queries on ctx.db to wrap arguments with withTenant(ctx, ...)',
    },
    schema: [],
    messages: {
      require: 'Wrap this ctx.db call with withTenant(ctx, ... ) to enforce tenant isolation.',
    },
  },
  create(context) {
    return {
      CallExpression(node: any) {
        const callee = node.callee;
        if (!isMemberExpression(callee) || callee.computed) return;
        if (!isCtxDbChain(callee)) return;
        if (!node.arguments || node.arguments.length === 0) return;
        const first = node.arguments[0];
        const ok = first && first.type === 'CallExpression' && isIdentifier(first.callee, 'withTenant');
        if (!ok) {
          context.report({ node, messageId: 'require' });
        }
      },
    };
  },
};

export const rules = {
  'require-with-tenant': requireWithTenant,
} as const;

const plugin = {
  rules,
};

export default plugin;

