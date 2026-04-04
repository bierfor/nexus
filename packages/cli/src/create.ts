#!/usr/bin/env node
/**
 * create-nexus — scaffolding CLI for new Nexus projects.
 * Usage: npx create-nexus my-app
 */

import { mkdir, writeFile, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const BANNER = `
  ${CYAN}◆ create-nexus${RESET}

  The Definitive Full-Stack Framework
  Islands × Runes × Server Actions
`;

async function main(): Promise<void> {
  console.log(BANNER);

  const projectName = process.argv[2] ?? 'my-nexus-app';
  const targetDir = resolve(process.cwd(), projectName);

  console.log(`  Creating ${BOLD}${projectName}${RESET}...\n`);

  // Create directory structure
  const dirs = [
    'src/routes',
    'src/routes/blog/[slug]',
    'src/routes/api/users',
    'src/components',
    'src/islands',
    'src/lib',
    'public',
  ];

  for (const dir of dirs) {
    await mkdir(join(targetDir, dir), { recursive: true });
  }

  // Write project files
  await writeProjectFiles(targetDir, projectName);

  console.log(`  ${GREEN}✓${RESET} Project created at ${BOLD}${projectName}/${RESET}\n`);
  console.log(`  Next steps:\n`);
  console.log(`    ${DIM}cd${RESET} ${projectName}`);
  console.log(`    ${DIM}pnpm install${RESET}`);
  console.log(`    ${DIM}pnpm dev${RESET}\n`);
  console.log(`  ${CYAN}◆${RESET} Docs: ${BOLD}https://nexusjs.dev${RESET}\n`);
}

async function writeProjectFiles(dir: string, name: string): Promise<void> {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'nexus dev',
        build: 'nexus build',
        start: 'nexus start',
        check: 'nexus check',
      },
      dependencies: {
        '@nexus_js/runtime': 'workspace:*',
      },
      devDependencies: {
        '@nexus_js/cli': 'workspace:*',
        '@nexus_js/compiler': 'workspace:*',
        typescript: '^5.5.0',
      },
    }, null, 2),

    'tsconfig.json': JSON.stringify({
      extends: '../../tsconfig.base.json',
      compilerOptions: { paths: { '$lib/*': ['./src/lib/*'] } },
      include: ['src/**/*'],
    }, null, 2),

    'nexus.config.ts': `import type { NexusConfig } from '@nexus_js/cli';

export default {
  // Islands hydration strategy defaults
  defaultHydration: 'client:visible',

  // Image optimization
  images: {
    formats: ['avif', 'webp'],
    sizes: [640, 1280, 1920],
  },

  // Server options
  server: {
    port: 3000,
  },

  // Build output
  build: {
    outDir: '.nexus/output',
    sourcemap: false,
  },
} satisfies NexusConfig;
`,

    'src/routes/+layout.nx': `---
// Root layout — server-only
const appName = "My Nexus App";
---

<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{appName}</title>
  </head>
  <body>
    <nav>
      <a href="/">Home</a>
      <a href="/blog">Blog</a>
    </nav>
    <main>
      <!--nexus:slot-->
    </main>
  </body>
</html>
`,

    'src/routes/+page.nx': `---
// Index page — runs on server only
const greeting = "Welcome to Nexus";
const features = [
  { icon: "🏝️", title: "Islands Architecture", desc: "Zero JS by default" },
  { icon: "⚡", title: "Svelte 5 Runes", desc: "Fine-grained reactivity" },
  { icon: "🔧", title: "Server Actions", desc: "Type-safe mutations" },
];
---

<script>
  // Client island — only this code reaches the browser
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>

<section class="hero">
  <h1>{greeting}</h1>
  <p>Islands × Runes × Server Actions</p>
</section>

<section class="features">
  {#each features as f}
    <div class="card">
      <span>{f.icon}</span>
      <h3>{f.title}</h3>
      <p>{f.desc}</p>
    </div>
  {/each}
</section>

<div class="counter" client:visible>
  <button onclick={() => count++}>
    Clicked {count} times (×2 = {doubled})
  </button>
</div>

<style>
  .hero { text-align: center; padding: 4rem 2rem; }
  .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
  .card { padding: 1.5rem; border: 1px solid #eee; border-radius: 8px; }
  .counter { text-align: center; margin-top: 2rem; }
  button { padding: 0.75rem 2rem; font-size: 1rem; cursor: pointer; }
</style>
`,

    'src/routes/blog/+page.nx': `---
// Blog listing page
const posts = [
  { slug: "hello-nexus", title: "Hello Nexus", date: "2026-04-03" },
  { slug: "islands-arch", title: "Islands Architecture Deep Dive", date: "2026-04-01" },
];
---

<h1>Blog</h1>
<ul>
  {#each posts as post}
    <li>
      <a href="/blog/{post.slug}">{post.title}</a>
      <time>{post.date}</time>
    </li>
  {/each}
</ul>
`,

    'src/routes/blog/[slug]/+page.nx': `---
// Dynamic blog post page
// params.slug is injected by the router
const { slug } = ctx.params;
const post = { title: \`Post: \${slug}\`, content: "Post content here..." };
---

<article>
  <h1>{post.title}</h1>
  <p>{post.content}</p>
  <a href="/blog">← Back to Blog</a>
</article>
`,

    'src/routes/api/users/+server.nx': `---
// API route — returns JSON
// GET /api/users
const users = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];
---

// Export GET handler
export async function GET(ctx) {
  return Response.json({ users });
}

// POST /api/users
export async function POST(ctx) {
  const body = await ctx.request.json();
  // Create user logic...
  return Response.json({ created: true }, { status: 201 });
}
`,

    'src/lib/db.ts': `// Database client placeholder
// Replace with your preferred ORM (Prisma, Drizzle, etc.)

export const db = {
  user: {
    async findFirst() {
      return { id: 1, name: 'Demo User', email: 'demo@nexusjs.dev' };
    },
    async findMany() {
      return [{ id: 1, name: 'Demo User', email: 'demo@nexusjs.dev' }];
    },
    async update(args: { where?: unknown; data: unknown }) {
      return { ...args.data };
    },
    async create(args: { data: unknown }) {
      return args.data;
    },
  },
};
`,

    'public/favicon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <text y="28" font-size="28">◆</text>
</svg>`,

    '.gitignore': `node_modules/
.nexus/
dist/
*.js.map
`,
  };

  for (const [filepath, content] of Object.entries(files)) {
    const fullPath = join(dir, filepath);
    await writeFile(fullPath, content, 'utf-8');
    console.log(`  ${GREEN}+${RESET} ${filepath}`);
  }
}

main().catch((err) => {
  console.error('\x1b[31m[create-nexus Error]\x1b[0m', err);
  process.exit(1);
});
