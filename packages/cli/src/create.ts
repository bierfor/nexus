#!/usr/bin/env node
/**
 * create-nexus — scaffolding CLI for new Nexus projects.
 * Usage: npm create @nexus_js/nexus@latest my-app
 *        npx @nexus_js/create-nexus my-app [--template minimal|full]
 *        npm exec --package=@nexus_js/cli -- create-nexus my-app -t minimal
 *        create-nexus --yes                    (defaults, no prompts)
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** Starter preset: minimal = one landing page, no i18n; full = i18n, islands + blog examples. */
export type CreateTemplate = 'minimal' | 'full';

/** Same version as the published @nexus_js/cli (peer @nexus_js/* packages stay in sync). */
function getPublishedCliVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const BANNER = `
  ${CYAN}◆ create-nexus${RESET}

  The Definitive Full-Stack Framework
  Islands × Runes × Server Actions
`;

const TEMPLATE_HINT: Record<CreateTemplate, string> = {
  minimal: 'Minimal — one landing page, no i18n (build almost from scratch)',
  full: 'Full — i18n (en/es/pt), islands + blog examples',
};

/** Official Nexus mark — keep in sync with docs/assets/nexus-logo.svg */
const NEXUS_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="nxOrbitGrad" x1="40" y1="36" x2="216" y2="220" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#2DD4BF"/>
      <stop offset="50%" stop-color="#7C3AED"/>
      <stop offset="100%" stop-color="#F472B6"/>
    </linearGradient>
    <radialGradient id="nxMarkBg" cx="32%" cy="28%" r="85%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#020617"/>
    </radialGradient>
    <radialGradient id="nxNucleusFill" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="72%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e1b4a"/>
    </radialGradient>
  </defs>
  <rect x="20" y="20" width="216" height="216" rx="60" ry="60" fill="url(#nxMarkBg)"/>
  <rect x="20" y="20" width="216" height="216" rx="60" ry="60" stroke="#475569" stroke-width="1" fill="none" opacity="0.45"/>
  <circle cx="128" cy="86" r="46" fill="url(#nxOrbitGrad)" opacity="0.88"/>
  <circle cx="172" cy="152" r="40" fill="url(#nxOrbitGrad)" opacity="0.78"/>
  <circle cx="84" cy="152" r="34" fill="url(#nxOrbitGrad)" opacity="0.72"/>
  <circle cx="128" cy="128" r="54" fill="url(#nxNucleusFill)"/>
  <circle cx="128" cy="128" r="54" fill="none" stroke="url(#nxOrbitGrad)" stroke-width="2" opacity="0.55"/>
  <circle cx="128" cy="128" r="48" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>
  <path d="M 108 90 L 108 166 M 108 90 L 148 166 M 148 90 L 148 166" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const TEMPLATE_DETAIL: Record<CreateTemplate, string> = {
  minimal: 'Single +page.nx + layout, no i18n, no /islands or /blog examples',
  full: 'i18n (en/es/pt), islands guide, blog — like the my-nexus-app reference',
};

function parseCreateArgs(argv: string[]): {
  projectNamePositional: string | undefined;
  template: CreateTemplate | undefined;
  help: boolean;
  useDefaults: boolean;
} {
  let projectNamePositional: string | undefined;
  let template: CreateTemplate | undefined;
  let help = false;
  let useDefaults = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === '--help' || a === '-h') {
      help = true;
      continue;
    }
    if (a === '--yes' || a === '-y' || a === '--defaults') {
      useDefaults = true;
      continue;
    }
    if (a === '--template' || a === '-t') {
      const v = argv[++i];
      if (v === 'minimal' || v === 'full') template = v;
      continue;
    }
    if (a.startsWith('-')) continue;
    if (!projectNamePositional) projectNamePositional = a;
  }
  return { projectNamePositional, template, help, useDefaults };
}

/** Safe folder name for ./name (no path segments). */
function normalizeProjectName(raw: string, fallback: string): string {
  const t = raw.trim().replace(/[/\\]+/g, '').replace(/^\.+/, '');
  if (!t || t.includes('..')) return fallback;
  const safe = t.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  return safe.length > 0 ? safe.slice(0, 214) : fallback;
}

async function runInteractiveWizard(opts: {
  nameHint: string | undefined;
  templateFromFlag: CreateTemplate | undefined;
}): Promise<{ projectName: string; template: CreateTemplate }> {
  const rl = createInterface({ input, output });
  try {
    const defaultName = normalizeProjectName(opts.nameHint ?? '', 'my-nexus-app');

    console.log(`\n  ${BOLD}◇ Configure your Nexus project${RESET}\n`);

    const nameAns = await rl.question(
      `  ${CYAN}?${RESET} Project directory ${DIM}./${defaultName}${RESET} ${DIM}(press Enter for default)${RESET}\n` +
        `  ${DIM}│${RESET}\n  ${DIM}└${RESET} `,
    );
    const projectName = normalizeProjectName(nameAns.length > 0 ? nameAns : defaultName, defaultName);

    let template: CreateTemplate;
    if (opts.templateFromFlag) {
      template = opts.templateFromFlag;
      console.log(`\n  ${DIM}Starter:${RESET} ${BOLD}${template}${RESET} ${DIM}(--template)${RESET}`);
    } else {
      console.log(`\n  ${BOLD}?${RESET} Which starter do you want?\n`);
      console.log(`  ${DIM}❯${RESET} ${DIM}1${RESET}  ${TEMPLATE_HINT.minimal}`);
      console.log(`       ${DIM}2${RESET}  ${TEMPLATE_HINT.full}\n`);
      console.log(`    ${DIM}${TEMPLATE_DETAIL.minimal}${RESET}`);
      console.log(`    ${DIM}${TEMPLATE_DETAIL.full}${RESET}\n`);
      const tAns = (await rl.question(`  ${CYAN}?${RESET} Pick ${DIM}[1-2, default 2]${RESET} `)).trim().toLowerCase();
      if (tAns === '1' || tAns === 'minimal') template = 'minimal';
      else template = 'full';
    }

    console.log(`\n  ${BOLD}◇ Summary${RESET}\n`);
    console.log(`    ${DIM}·${RESET} ${DIM}Location${RESET}   ${BOLD}./${projectName}${RESET}`);
    console.log(`    ${DIM}·${RESET} ${DIM}Starter${RESET}    ${BOLD}${template}${RESET} — ${TEMPLATE_DETAIL[template]}\n`);

    const confirm = (await rl.question(`  ${CYAN}?${RESET} Create project? ${DIM}[Y/n]${RESET} `)).trim().toLowerCase();
    if (confirm === 'n' || confirm === 'no') {
      console.log(`\n  ${DIM}Aborted.${RESET}\n`);
      process.exit(0);
    }

    return { projectName, template };
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const { projectNamePositional, template: templateFlag, help, useDefaults } = parseCreateArgs(process.argv);
  if (help) {
    console.log(BANNER);
    console.log(`  ${BOLD}Usage:${RESET} create-nexus [directory] [options]\n`);
    console.log(`  ${BOLD}Options:${RESET}`);
    console.log(`    ${DIM}--template, -t${RESET}  ${DIM}minimal${RESET} | ${DIM}full${RESET}   ${DIM}(starter; skips template step in the wizard)${RESET}`);
    console.log(`    ${DIM}--yes, -y${RESET}         ${DIM}Skip prompts${RESET} — use defaults (full starter, name from argv or ${DIM}my-nexus-app${RESET})`);
    console.log(`    ${DIM}--defaults${RESET}        ${DIM}Same as --yes${RESET}`);
    console.log(`    ${DIM}--help, -h${RESET}        ${DIM}Show this help${RESET}\n`);
    console.log(`  ${BOLD}Interactive mode${RESET} ${DIM}(terminal):${RESET} asks for directory name, starter, and confirmation.`);
    console.log(`  ${BOLD}Non-interactive${RESET} ${DIM}(CI, pipe):${RESET} uses ${DIM}--yes${RESET} or defaults ${DIM}(full, my-nexus-app)${RESET}.\n`);
    console.log(`  ${BOLD}Templates:${RESET}`);
    console.log(`    ${DIM}minimal${RESET}  One ${CYAN}+page.nx${RESET} + simple layout, no i18n, no example routes.`);
    console.log(`    ${DIM}full${RESET}     i18n, islands presentation, blog — same as the reference app.\n`);
    process.exit(0);
  }

  console.log(BANNER);

  let projectName: string;
  let template: CreateTemplate;

  if (useDefaults) {
    projectName = normalizeProjectName(projectNamePositional ?? '', 'my-nexus-app');
    template = templateFlag ?? 'full';
  } else if (input.isTTY) {
    const w = await runInteractiveWizard({
      nameHint: projectNamePositional,
      templateFromFlag: templateFlag,
    });
    projectName = w.projectName;
    template = w.template;
  } else {
    projectName = normalizeProjectName(projectNamePositional ?? '', 'my-nexus-app');
    template = templateFlag ?? 'full';
  }

  const targetDir = resolve(process.cwd(), projectName);

  if (existsSync(targetDir)) {
    console.error(
      `\n  ${RED}✖${RESET} Directory already exists: ${BOLD}${projectName}${RESET}\n` +
        `  ${DIM}Choose another name, remove the folder, or run from a different directory.${RESET}\n`,
    );
    process.exit(1);
  }

  console.log(`\n  Creating ${BOLD}${projectName}${RESET}  ${DIM}(${template})${RESET}\n`);

  const dirs =
    template === 'full'
      ? [
          'src/routes',
          'src/routes/islands',
          'src/routes/blog/[slug]',
          'src/components',
          'src/islands',
          'src/lib',
          'public',
          'scripts',
        ]
      : ['src/routes', 'src/components', 'src/islands', 'src/lib', 'public', 'scripts'];

  for (const dir of dirs) {
    await mkdir(join(targetDir, dir), { recursive: true });
  }

  await writeProjectFiles(targetDir, projectName, template);

  console.log(`  ${GREEN}✓${RESET} Project created at ${BOLD}${projectName}/${RESET}\n`);
  console.log(`  Next steps:\n`);
  console.log(`    ${DIM}1.${RESET} ${DIM}cd${RESET} ${projectName}`);
  console.log(
    `    ${DIM}2.${RESET} ${DIM}npm install${RESET}   ${DIM}(required — or pnpm / yarn / bun install)${RESET}`,
  );
  console.log(`    ${DIM}3.${RESET} ${DIM}npm run dev${RESET}     ${DIM}(or pnpm dev, yarn dev, bun run dev)${RESET}\n`);
  console.log(`  ${CYAN}◆${RESET} Docs: ${BOLD}https://nexusjs.dev${RESET}\n`);
}

function buildMinimalScaffoldFiles(
  name: string,
  range: string,
  nexusCli: string,
  ensureDeps: string,
): Record<string, string> {
  return {
    'scripts/check-node-modules.mjs': `import { access } from 'node:fs/promises';
import { join } from 'node:path';

const marker = join(process.cwd(), 'node_modules/@nexus_js/cli/package.json');
try {
  await access(marker);
} catch {
  console.error(
    '\\n  Dependencies are missing. Run npm install (or pnpm / yarn / bun install), then try again.\\n',
  );
  process.exit(1);
}
`,

    'package.json': JSON.stringify(
      {
        name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          predev: ensureDeps,
          dev: `${nexusCli} dev`,
          prebuild: ensureDeps,
          build: `${nexusCli} build`,
          prestart: ensureDeps,
          start: `${nexusCli} start`,
          precheck: ensureDeps,
          check: `${nexusCli} check`,
        },
        dependencies: {
          '@nexus_js/runtime': range,
        },
        devDependencies: {
          '@nexus_js/cli': range,
          '@nexus_js/compiler': range,
          '@nexus_js/server': range,   // needed for advanced server APIs and build output
          typescript: '^5.5.0',
        },
      },
      null,
      2,
    ),

    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          paths: { '$lib/*': ['./src/lib/*'] },
        },
        include: ['nexus.config.ts', 'src/**/*.ts'],
      },
      null,
      2,
    ),

    'nexus.config.ts': `import type { NexusConfig } from '@nexus_js/cli';

export default {
  defaultHydration: 'client:visible',

  images: {
    formats: ['avif', 'webp'],
    sizes: [640, 1280, 1920],
  },

  server: {
    port: 3000,
  },

  build: {
    outDir: '.nexus/output',
    sourcemap: false,
  },
} satisfies NexusConfig;
`,

    'src/routes/+layout.nx': `---
const appName = "My Nexus App";
---

<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Built with Nexus — add your own copy in +layout.nx.">
    <title>{appName}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
  </head>
  <body class="nx-body">
    <div class="nx-bg" aria-hidden="true"></div>
    <header class="nx-header">
      <a class="nx-brand" href="/">
        <span class="nx-brand-mark" aria-hidden="true">◆</span>
        <span>{appName}</span>
      </a>
      <nav class="nx-nav" aria-label="Main">
        <a href="https://nexusjs.dev" target="_blank" rel="noopener noreferrer">Docs</a>
      </nav>
    </header>
    <main class="nx-main">
      <!--nexus:slot-->
    </main>
    <footer class="nx-footer">
      <p>Built with <a href="https://nexusjs.dev" target="_blank" rel="noopener noreferrer">Nexus</a></p>
    </footer>
  </body>
</html>

<style>
  :global(:root) {
    --nx-bg0: #07080c;
    --nx-surface: rgba(255, 255, 255, 0.04);
    --nx-border: rgba(255, 255, 255, 0.08);
    --nx-text: #f1f3f7;
    --nx-muted: #8b93a7;
    --nx-accent: #8b7cf8;
    --nx-radius: 14px;
    --nx-font: "DM Sans", system-ui, -apple-system, sans-serif;
    --nx-display: "Outfit", var(--nx-font);
  }
  :global(.nx-body) {
    margin: 0;
    min-height: 100vh;
    font-family: var(--nx-font);
    color: var(--nx-text);
    background: var(--nx-bg0);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  :global(.nx-bg) {
    position: fixed;
    inset: 0;
    z-index: -1;
    background:
      radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139, 124, 248, 0.22), transparent),
      var(--nx-bg0);
  }
  :global(.nx-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.5rem;
    max-width: 1100px;
    margin: 0 auto;
    border-bottom: 1px solid var(--nx-border);
    backdrop-filter: blur(12px);
    background: rgba(7, 8, 12, 0.75);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  :global(.nx-brand) {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--nx-display);
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--nx-text);
    text-decoration: none;
  }
  :global(.nx-brand-mark) { color: var(--nx-accent); font-size: 1.25rem; line-height: 1; }
  :global(.nx-nav a) {
    color: var(--nx-muted);
    text-decoration: none;
    font-size: 0.925rem;
    font-weight: 500;
  }
  :global(.nx-nav a:hover) { color: var(--nx-text); }
  :global(.nx-main) {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }
  :global(.nx-footer) {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;
    border-top: 1px solid var(--nx-border);
    text-align: center;
  }
  :global(.nx-footer p) {
    margin: 0;
    font-size: 0.875rem;
    color: var(--nx-muted);
  }
  :global(.nx-footer a) { color: var(--nx-accent); text-decoration: none; }
  :global(.nx-footer a:hover) { text-decoration: underline; }
</style>
`,

    'src/routes/+page.nx': `---

<section class="landing">
  <p class="landing-kicker">Nexus</p>
  <h1 class="landing-title">Start here</h1>
  <p class="landing-lead">
    This is the <strong>minimal</strong> template: one presentation page, no i18n, no example blog or islands route.
    Edit <code class="landing-code">src/routes/+page.nx</code> and add routes under <code class="landing-code">src/routes/</code>.
  </p>
  <p class="landing-hint">
    Want i18n, demos, and blog stubs? Create a new project with <code class="landing-code">--template full</code>.
  </p>
  <a class="landing-btn" href="https://nexusjs.dev" target="_blank" rel="noopener noreferrer">Documentation</a>
</section>

<style>
  .landing {
    max-width: 36rem;
    padding: 2rem 0 3rem;
  }
  .landing-kicker {
    margin: 0 0 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--nx-accent);
  }
  .landing-title {
    margin: 0 0 1rem;
    font-family: var(--nx-display);
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .landing-lead {
    margin: 0 0 1rem;
    color: var(--nx-muted);
    line-height: 1.65;
    font-size: 1.05rem;
  }
  .landing-hint {
    margin: 0 0 1.75rem;
    font-size: 0.9rem;
    color: var(--nx-muted);
    line-height: 1.55;
  }
  .landing-code {
    font-family: ui-monospace, monospace;
    font-size: 0.88em;
    padding: 0.1em 0.35em;
    border-radius: 6px;
    background: var(--nx-surface);
    border: 1px solid var(--nx-border);
    color: var(--nx-accent);
  }
  .landing-btn {
    display: inline-flex;
    align-items: center;
    padding: 0.65rem 1.25rem;
    border-radius: 10px;
    font-size: 0.9375rem;
    font-weight: 600;
    text-decoration: none;
    background: linear-gradient(135deg, var(--nx-accent), #6366f1);
    color: #fff;
    box-shadow: 0 4px 24px rgba(139, 124, 248, 0.15);
  }
  .landing-btn:hover { filter: brightness(1.06); }
</style>
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
      return { ...(args.data as object) };
    },
    async create(args: { data: unknown }) {
      return args.data;
    },
  },
};
`,

    'public/favicon.svg': NEXUS_LOGO_SVG,

    '.gitignore': `node_modules/
.nexus/
dist/
*.js.map
`,
  };
}

function buildFullScaffoldFiles(
  name: string,
  range: string,
  nexusCli: string,
  ensureDeps: string,
): Record<string, string> {
  return {
    'scripts/check-node-modules.mjs': `import { access } from 'node:fs/promises';
import { join } from 'node:path';

const marker = join(process.cwd(), 'node_modules/@nexus_js/cli/package.json');
try {
  await access(marker);
} catch {
  console.error(
    '\\n  Dependencies are missing. Run npm install (or pnpm / yarn / bun install), then try again.\\n',
  );
  process.exit(1);
}
`,

    'package.json': JSON.stringify({
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        predev: ensureDeps,
        dev: `${nexusCli} dev`,
        prebuild: ensureDeps,
        build: `${nexusCli} build`,
        prestart: ensureDeps,
        start: `${nexusCli} start`,
        precheck: ensureDeps,
        check: `${nexusCli} check`,
      },
      dependencies: {
        '@nexus_js/runtime': range,
      },
      devDependencies: {
        '@nexus_js/cli': range,
        '@nexus_js/compiler': range,
        '@nexus_js/server': range,   // needed for advanced server APIs and build output
        typescript: '^5.5.0',
      },
    }, null, 2),

    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        paths: { '$lib/*': ['./src/lib/*'] },
      },
      include: ['nexus.config.ts', 'src/**/*.ts'],
    }, null, 2),

    'src/lib/i18n.ts': `/**
 * i18n — aligned with nexus.config.ts \`i18n.locales\`.
 * Resolve locale per request: ?lang= → cookie nx-lang → Accept-Language → default.
 */

export type Locale = 'en' | 'es' | 'pt';

export const LOCALES: Locale[] = ['en', 'es', 'pt'];
export const DEFAULT_LOCALE: Locale = 'en';

type CtxLike = {
  url: URL;
  getCookie: (name: string) => string | undefined;
  request: Request;
};

function isLocale(s: string | undefined | null): s is Locale {
  return s === 'en' || s === 'es' || s === 'pt';
}

/** Active locale for this request (use in templates: getLocale(ctx)). */
export function getLocale(ctx: CtxLike): Locale {
  const q = ctx.url.searchParams.get('lang') ?? ctx.url.searchParams.get('locale');
  if (isLocale(q)) return q;
  const ck = ctx.getCookie('nx-lang');
  if (isLocale(ck)) return ck;
  const al = ctx.request.headers.get('accept-language');
  if (al) {
    const first = al.split(',')[0]?.trim().split('-')[0]?.toLowerCase();
    if (first === 'es' || first === 'pt') return first;
  }
  return DEFAULT_LOCALE;
}

/** Same path + query, with \`lang\` set (preserves other search params). */
export function langHref(ctx: CtxLike, locale: Locale): string {
  const u = new URL(ctx.url.href);
  u.searchParams.set('lang', locale);
  return u.pathname + u.search;
}

/** Internal link with current locale in \`lang\` (e.g. \`/islands?lang=es\`). */
export function pathWithLang(ctx: CtxLike, pathname: string): string {
  const u = new URL(ctx.url.href);
  u.pathname = pathname;
  u.searchParams.set('lang', getLocale(ctx));
  return u.pathname + u.search;
}

export function layoutCopy(locale: Locale) {
  const t = {
    en: {
      appName: 'My Nexus App',
      metaDescription:
        'Built with Nexus — full-stack framework with islands, Svelte 5 runes, and server actions.',
      navHome: 'Home',
      navIslands: 'Islands',
      navBlog: 'Blog',
      navDocs: 'Docs',
      navAria: 'Main',
      langAria: 'Language',
      footerTagline: 'Islands · Runes · Server Actions',
      footerMade: 'Built with',
    },
    es: {
      appName: 'Mi app Nexus',
      metaDescription:
        'Hecho con Nexus — framework full stack con islas, runes de Svelte 5 y server actions.',
      navHome: 'Inicio',
      navIslands: 'Islas',
      navBlog: 'Blog',
      navDocs: 'Docs',
      navAria: 'Principal',
      langAria: 'Idioma',
      footerTagline: 'Islas · Runes · Server Actions',
      footerMade: 'Hecho con',
    },
    pt: {
      appName: 'Meu app Nexus',
      metaDescription:
        'Feito com Nexus — framework full stack com ilhas, runes Svelte 5 e server actions.',
      navHome: 'Início',
      navIslands: 'Ilhas',
      navBlog: 'Blog',
      navDocs: 'Docs',
      navAria: 'Principal',
      langAria: 'Idioma',
      footerTagline: 'Ilhas · Runes · Server Actions',
      footerMade: 'Feito com',
    },
  };
  return t[locale];
}

export function langActiveClass(ctx: CtxLike, locale: Locale): string {
  return getLocale(ctx) === locale ? 'nx-lang-btn--on' : '';
}

export function homeCopy(locale: Locale) {
  const t = {
    en: {
      kicker: "You're running Nexus",
      greeting: 'Ship less JavaScript.',
      sub: 'Nexus combines islands architecture, Svelte 5 runes, and server actions — so your default page weight stays tiny.',
      ctaDocs: 'Documentation',
      ctaIslands: 'Islands guide',
      ctaBlog: 'Example blog',
      featTitle: 'Why Nexus',
      features: [
        { icon: '◇', title: 'Islands', desc: 'HTML-first pages; JS only where you opt in with client:visible and friends.' },
        { icon: '⚡', title: 'Runes', desc: 'Fine-grained reactivity with Svelte 5 — no legacy stores required.' },
        { icon: '↯', title: 'Server actions', desc: 'Mutations colocated with routes; type-safe, SSR-friendly.' },
      ],
      demoTitle: 'Interactive island',
      demoHint:
        'The counter below is a small client island — the rest of this page can stay server-rendered.',
      demoLabel: 'Hydrated in the browser',
      counterAria: 'Increment counter',
    },
    es: {
      kicker: 'Estás ejecutando Nexus',
      greeting: 'Envía menos JavaScript.',
      sub: 'Nexus combina arquitectura de islas, runes de Svelte 5 y server actions — el peso por defecto de la página se mantiene bajo.',
      ctaDocs: 'Documentación',
      ctaIslands: 'Guía de islas',
      ctaBlog: 'Blog de ejemplo',
      featTitle: 'Por qué Nexus',
      features: [
        { icon: '◇', title: 'Islas', desc: 'Páginas HTML primero; JS solo donde eliges con client:visible y similares.' },
        { icon: '⚡', title: 'Runes', desc: 'Reactividad fina con Svelte 5 — sin stores legacy.' },
        { icon: '↯', title: 'Server actions', desc: 'Mutaciones junto a las rutas; tipadas y amigables con SSR.' },
      ],
      demoTitle: 'Isla interactiva',
      demoHint:
        'El contador es una isla pequeña — el resto de la página puede seguir renderizado en el servidor.',
      demoLabel: 'Hidratado en el navegador',
      counterAria: 'Incrementar contador',
    },
    pt: {
      kicker: 'Você está rodando Nexus',
      greeting: 'Envie menos JavaScript.',
      sub: 'Nexus combina ilhas, runes Svelte 5 e server actions — o peso padrão da página permanece baixo.',
      ctaDocs: 'Documentação',
      ctaIslands: 'Guia de ilhas',
      ctaBlog: 'Blog de exemplo',
      featTitle: 'Por que Nexus',
      features: [
        { icon: '◇', title: 'Ilhas', desc: 'HTML primeiro; JS só onde você marca com client:visible e afins.' },
        { icon: '⚡', title: 'Runes', desc: 'Reatividade fina com Svelte 5 — sem stores legados.' },
        { icon: '↯', title: 'Server actions', desc: 'Mutações junto às rotas; tipadas e SSR-friendly.' },
      ],
      demoTitle: 'Ilha interativa',
      demoHint: 'O contador abaixo é uma ilha pequena — o restante pode ficar no servidor.',
      demoLabel: 'Hidratado no navegador',
      counterAria: 'Incrementar contador',
    },
  };
  return t[locale];
}

export function islandsCopy(locale: Locale) {
  const t = {
    en: {
      pageTitle: 'Islands & components',
      lead: 'How Nexus sends HTML first and adds JavaScript only where you mark it with client:*.',
      presKicker: 'Mini brief',
      s1h: '1 · What is an island?',
      s1p:
        'The server paints the full page in HTML. Only the block wrapped with a directive like client:load or client:visible downloads a small bundle that the browser hydrates (runes, clicks, state).',
      diagramAria: 'Flow: server sends HTML; only the island hydrates',
      flowSrv: 'SSR',
      flowHtml: 'HTML + marked island',
      flowJs: 'Island JS',
      flowOk: 'Interactivity',
      s2h: '2 · Hydration directives',
      thDirective: 'Directive',
      thWhen: 'When',
      thUse: 'Typical use',
      r1: ['client:load', 'On page load', 'Critical UI — nav, modal'],
      r2: ['client:idle', 'When the browser is idle', 'Secondary widgets'],
      r3: ['client:visible', 'When entering the viewport', 'Below-the-fold content'],
      r4: ['client:media="…"', 'When the media query matches', 'Mobile-only or desktop-only'],
      r5: ['server:only', 'Never hydrates', 'Heavy tables, admin without JS'],
      s3h: '3 · Structure of a .nx file',
      l1: 'Frontmatter — server only: data, import, await.',
      l2: 'script — runes ($state, $derived, $effect) for the client.',
      l3: 'HTML template — interpolations and client:* on the interactive root.',
      l4: 'style — scoped CSS for this file.',
      s4h: '4 · Componentization',
      s4p:
        'Split reusable pieces into src/components/MyName.nx (same blocks). In a route, import in the frontmatter and use <MyName /> in the template when the compiler resolves it.',
      s4muted: 'Import resolution and preloads follow the compiler conventions.',
      s5h: '5 · Live demo (client:visible)',
      s5p: 'Scroll down to hydrate the island; the button updates reactive state.',
      demoBtnAria: 'Add one',
      refh: 'References',
      refp: 'In the repo: docs/ISLANDS.md · Official site:',
    },
    es: {
      pageTitle: 'Islas y componentes',
      lead: 'Cómo Nexus envía HTML primero y añade JavaScript solo donde lo marcas con client:*.',
      presKicker: 'Mini presentación',
      s1h: '1 · ¿Qué es una isla?',
      s1p:
        'El servidor pinta toda la página en HTML. Solo el bloque con client:load, client:visible, etc. genera un bundle pequeño que el navegador hidrata (runes, clics, estado).',
      diagramAria: 'Flujo: servidor entrega HTML; el navegador hidrata solo la isla',
      flowSrv: 'SSR',
      flowHtml: 'HTML + isla marcada',
      flowJs: 'JS de la isla',
      flowOk: 'Interactividad',
      s2h: '2 · Directivas de hidratación',
      thDirective: 'Directiva',
      thWhen: 'Cuándo',
      thUse: 'Uso típico',
      r1: ['client:load', 'Al cargar la página', 'UI crítica — nav, modal'],
      r2: ['client:idle', 'Cuando el navegador está libre', 'Widgets secundarios'],
      r3: ['client:visible', 'Al entrar en viewport', 'Contenido bajo el fold'],
      r4: ['client:media="…"', 'Si coincide la media query', 'Solo móvil o solo desktop'],
      r5: ['server:only', 'Nunca hidrata', 'Tablas pesadas, admin sin JS'],
      s3h: '3 · Estructura de un archivo .nx',
      l1: 'Frontmatter — solo servidor: datos, import, await.',
      l2: 'script — runes ($state, $derived, $effect) para la parte cliente.',
      l3: 'Plantilla HTML — interpolaciones y client:* en el contenedor interactivo.',
      l4: 'style — CSS con alcance al archivo.',
      s4h: '4 · Componentizar',
      s4p:
        'Separa piezas en src/components/MiNombre.nx (mismo formato). En una ruta, importa en el frontmatter y usa <MiNombre /> en la plantilla cuando el compilador lo resuelva.',
      s4muted: 'La resolución de imports y preloads sigue las convenciones del compilador.',
      s5h: '5 · Demo en vivo (client:visible)',
      s5p: 'Al hacer scroll hasta aquí, la isla se hidrata; el botón incrementa el estado reactivo.',
      demoBtnAria: 'Sumar uno',
      refh: 'Referencias',
      refp: 'En el repo: docs/ISLANDS.md · Sitio oficial:',
    },
    pt: {
      pageTitle: 'Ilhas e componentes',
      lead: 'Como o Nexus envia HTML primeiro e só adiciona JS onde você marca com client:*.',
      presKicker: 'Mini apresentação',
      s1h: '1 · O que é uma ilha?',
      s1p:
        'O servidor renderiza a página inteira em HTML. Só o bloco com client:load, client:visible, etc. baixa um bundle pequeno que o navegador hidrata.',
      diagramAria: 'Fluxo: servidor entrega HTML; só a ilha hidrata',
      flowSrv: 'SSR',
      flowHtml: 'HTML + ilha marcada',
      flowJs: 'JS da ilha',
      flowOk: 'Interatividade',
      s2h: '2 · Diretivas de hidratação',
      thDirective: 'Diretiva',
      thWhen: 'Quando',
      thUse: 'Uso típico',
      r1: ['client:load', 'Ao carregar a página', 'UI crítica — nav, modal'],
      r2: ['client:idle', 'Quando o navegador está ocioso', 'Widgets secundários'],
      r3: ['client:visible', 'Ao entrar na viewport', 'Abaixo da dobra'],
      r4: ['client:media="…"', 'Se a media query casar', 'Só mobile ou só desktop'],
      r5: ['server:only', 'Nunca hidrata', 'Tabelas pesadas, admin sem JS'],
      s3h: '3 · Estrutura de um arquivo .nx',
      l1: 'Frontmatter — só servidor: dados, import, await.',
      l2: 'script — runes ($state, $derived, $effect) para o cliente.',
      l3: 'Template HTML — interpolações e client:* na raiz interativa.',
      l4: 'style — CSS escopado ao arquivo.',
      s4h: '4 · Componentizar',
      s4p:
        'Separe em src/components/Nome.nx. Na rota, importe no frontmatter e use <Nome /> no template quando o compilador resolver.',
      s4muted: 'Imports e preloads seguem as convenções do compilador.',
      s5h: '5 · Demo ao vivo (client:visible)',
      s5p: 'Role até aqui para hidratar a ilha; o botão atualiza o estado.',
      demoBtnAria: 'Mais um',
      refh: 'Referências',
      refp: 'No repositório: docs/ISLANDS.md · Site oficial:',
    },
  };
  return t[locale];
}

export function pageHomeCopy(ctx: CtxLike) {
  return homeCopy(getLocale(ctx));
}

export function pageIslandsCopy(ctx: CtxLike) {
  return islandsCopy(getLocale(ctx));
}
`,
    'nexus.config.ts': `import type { NexusConfig } from '@nexus_js/cli';

export default {
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'pt'],
  },

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
import {
  getLocale,
  langHref,
  langActiveClass,
  layoutCopy,
  pathWithLang,
} from '$lib/i18n';
---

<html lang="{getLocale(ctx)}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="{layoutCopy(getLocale(ctx)).metaDescription}">
    <title>{layoutCopy(getLocale(ctx)).appName}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
  </head>
  <body class="nx-body">
    <div class="nx-bg" aria-hidden="true"></div>
    <header class="nx-header">
      <a class="nx-brand" href="{pathWithLang(ctx, '/')}">
        <span class="nx-brand-mark" aria-hidden="true">◆</span>
        <span>{layoutCopy(getLocale(ctx)).appName}</span>
      </a>
      <div class="nx-header-actions">
        <nav class="nx-nav" aria-label="{layoutCopy(getLocale(ctx)).navAria}">
          <a href="{pathWithLang(ctx, '/')}">{layoutCopy(getLocale(ctx)).navHome}</a>
          <a href="{pathWithLang(ctx, '/islands')}">{layoutCopy(getLocale(ctx)).navIslands}</a>
          <a href="{pathWithLang(ctx, '/blog')}">{layoutCopy(getLocale(ctx)).navBlog}</a>
          <a href="https://nexusjs.dev" target="_blank" rel="noopener noreferrer">{layoutCopy(getLocale(ctx)).navDocs}</a>
        </nav>
        <div class="nx-lang" role="group" aria-label="{layoutCopy(getLocale(ctx)).langAria}">
          <a class="nx-lang-btn {langActiveClass(ctx, 'en')}" href="{langHref(ctx, 'en')}">EN</a>
          <a class="nx-lang-btn {langActiveClass(ctx, 'es')}" href="{langHref(ctx, 'es')}">ES</a>
          <a class="nx-lang-btn {langActiveClass(ctx, 'pt')}" href="{langHref(ctx, 'pt')}">PT</a>
        </div>
      </div>
    </header>
    <main class="nx-main">
      <!--nexus:slot-->
    </main>
    <footer class="nx-footer">
      <p>
        {layoutCopy(getLocale(ctx)).footerMade}
        <a href="https://nexusjs.dev" target="_blank" rel="noopener noreferrer">Nexus</a>
        · {layoutCopy(getLocale(ctx)).footerTagline}
      </p>
    </footer>
  </body>
</html>

<style>
  :global(:root) {
    --nx-bg0: #07080c;
    --nx-bg1: #0e1118;
    --nx-surface: rgba(255, 255, 255, 0.04);
    --nx-border: rgba(255, 255, 255, 0.08);
    --nx-text: #f1f3f7;
    --nx-muted: #8b93a7;
    --nx-accent: #8b7cf8;
    --nx-accent-dim: rgba(139, 124, 248, 0.15);
    --nx-radius: 14px;
    --nx-font: "DM Sans", system-ui, -apple-system, sans-serif;
    --nx-display: "Outfit", var(--nx-font);
  }
  :global(.nx-body) {
    margin: 0;
    min-height: 100vh;
    font-family: var(--nx-font);
    color: var(--nx-text);
    background: var(--nx-bg0);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  :global(.nx-bg) {
    position: fixed;
    inset: 0;
    z-index: -1;
    background:
      radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139, 124, 248, 0.22), transparent),
      radial-gradient(ellipse 60% 40% at 100% 0%, rgba(56, 189, 248, 0.08), transparent),
      var(--nx-bg0);
  }
  :global(.nx-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.5rem;
    max-width: 1100px;
    margin: 0 auto;
    border-bottom: 1px solid var(--nx-border);
    backdrop-filter: blur(12px);
    background: rgba(7, 8, 12, 0.75);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  :global(.nx-header-actions) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.25rem;
    justify-content: flex-end;
  }
  :global(.nx-brand) {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--nx-display);
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--nx-text);
    text-decoration: none;
  }
  :global(.nx-brand-mark) {
    color: var(--nx-accent);
    font-size: 1.25rem;
    line-height: 1;
  }
  :global(.nx-nav) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    align-items: center;
  }
  :global(.nx-nav a) {
    color: var(--nx-muted);
    text-decoration: none;
    font-size: 0.925rem;
    font-weight: 500;
    transition: color 0.15s ease;
  }
  :global(.nx-nav a:hover) {
    color: var(--nx-text);
  }
  :global(.nx-lang) {
    display: inline-flex;
    gap: 0.2rem;
    padding: 0.2rem;
    border-radius: 10px;
    border: 1px solid var(--nx-border);
    background: rgba(0, 0, 0, 0.2);
  }
  :global(.nx-lang-btn) {
    padding: 0.25rem 0.5rem;
    border-radius: 7px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--nx-muted);
    text-decoration: none;
    transition: background 0.12s ease, color 0.12s ease;
  }
  :global(.nx-lang-btn:hover) {
    color: var(--nx-text);
  }
  :global(.nx-lang-btn--on) {
    background: rgba(139, 124, 248, 0.25);
    color: var(--nx-text);
  }
  :global(.nx-main) {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }
  :global(.nx-footer) {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;
    border-top: 1px solid var(--nx-border);
    text-align: center;
  }
  :global(.nx-footer p) {
    margin: 0;
    font-size: 0.875rem;
    color: var(--nx-muted);
  }
  :global(.nx-footer a) {
    color: var(--nx-accent);
    text-decoration: none;
  }
  :global(.nx-footer a:hover) {
    text-decoration: underline;
  }
</style>
`,

    'src/routes/+page.nx': `---
import { pageHomeCopy, pathWithLang } from '$lib/i18n';
---

<script>
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>

<section class="hero">
  <p class="hero-kicker">{pageHomeCopy(ctx).kicker}</p>
  <h1 class="hero-title">{pageHomeCopy(ctx).greeting}</h1>
  <p class="hero-lead">{pageHomeCopy(ctx).sub}</p>
  <div class="hero-actions">
    <a class="btn btn-primary" href="https://nexusjs.dev" target="_blank" rel="noopener noreferrer">{pageHomeCopy(ctx).ctaDocs}</a>
    <a class="btn btn-ghost" href="{pathWithLang(ctx, '/islands')}">{pageHomeCopy(ctx).ctaIslands}</a>
    <a class="btn btn-ghost" href="{pathWithLang(ctx, '/blog')}">{pageHomeCopy(ctx).ctaBlog}</a>
  </div>
</section>

<section class="features" aria-labelledby="feat-heading">
  <h2 id="feat-heading" class="section-title">{pageHomeCopy(ctx).featTitle}</h2>
  <ul class="feature-grid">
    {#each pageHomeCopy(ctx).features as f}
      <li class="card">
        <span class="card-icon" aria-hidden="true">{f.icon}</span>
        <h3 class="card-title">{f.title}</h3>
        <p class="card-desc">{f.desc}</p>
      </li>
    {/each}
  </ul>
</section>

<section class="demo" aria-labelledby="demo-heading">
  <h2 id="demo-heading" class="section-title">{pageHomeCopy(ctx).demoTitle}</h2>
  <p class="demo-hint">{pageHomeCopy(ctx).demoHint}</p>
  <div class="counter-wrap">
    <div class="counter">
      <p class="counter-label">{pageHomeCopy(ctx).demoLabel}</p>
      <div class="counter-row" client:visible>
        <button id="counter-btn" type="button" class="btn-counter" onclick={() => count++} aria-label="Increment counter">
          +1
        </button>
        <output class="counter-out" for="counter-btn">
          <span class="counter-val">{count}</span>
          <span class="counter-meta">×2 = {doubled}</span>
        </output>
      </div>
    </div>
  </div>
</section>

<style>
  .hero {
    text-align: center;
    padding: 2.5rem 0 3rem;
    max-width: 40rem;
    margin: 0 auto;
  }
  .hero-kicker {
    margin: 0 0 0.75rem;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--nx-accent);
  }
  .hero-title {
    margin: 0 0 1rem;
    font-family: var(--nx-display);
    font-size: clamp(2rem, 5vw, 2.75rem);
    font-weight: 700;
    line-height: 1.15;
    letter-spacing: -0.02em;
  }
  .hero-lead {
    margin: 0 0 2rem;
    font-size: 1.0625rem;
    color: var(--nx-muted);
    line-height: 1.65;
  }
  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: center;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.65rem 1.25rem;
    border-radius: 10px;
    font-size: 0.9375rem;
    font-weight: 600;
    text-decoration: none;
    transition: transform 0.12s ease, background 0.15s ease, border-color 0.15s ease;
  }
  .btn:active {
    transform: scale(0.98);
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--nx-accent), #6366f1);
    color: #fff;
    border: none;
    box-shadow: 0 4px 24px var(--nx-accent-dim);
  }
  .btn-primary:hover {
    filter: brightness(1.06);
  }
  .btn-ghost {
    background: var(--nx-surface);
    color: var(--nx-text);
    border: 1px solid var(--nx-border);
  }
  .btn-ghost:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
  }
  .section-title {
    margin: 0 0 1.25rem;
    font-family: var(--nx-display);
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .features {
    padding: 2rem 0 1rem;
  }
  .feature-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1rem;
  }
  .card {
    margin: 0;
    padding: 1.35rem 1.25rem;
    border-radius: var(--nx-radius);
    background: var(--nx-surface);
    border: 1px solid var(--nx-border);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .card:hover {
    border-color: rgba(139, 124, 248, 0.35);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  }
  .card-icon {
    display: block;
    font-size: 1.5rem;
    line-height: 1;
    margin-bottom: 0.75rem;
    color: var(--nx-accent);
  }
  .card-title {
    margin: 0 0 0.5rem;
    font-family: var(--nx-display);
    font-size: 1.05rem;
    font-weight: 600;
  }
  .card-desc {
    margin: 0;
    font-size: 0.9rem;
    color: var(--nx-muted);
    line-height: 1.55;
  }
  .demo {
    padding: 2.5rem 0 1rem;
  }
  .demo-hint {
    margin: 0 0 1.25rem;
    font-size: 0.9rem;
    color: var(--nx-muted);
    max-width: 36rem;
  }
  .counter-wrap {
    display: flex;
    justify-content: center;
  }
  .counter {
    width: 100%;
    max-width: 420px;
    padding: 1.5rem;
    border-radius: var(--nx-radius);
    background: linear-gradient(145deg, rgba(139, 124, 248, 0.08), var(--nx-surface));
    border: 1px solid var(--nx-border);
    text-align: center;
  }
  .counter-label {
    margin: 0 0 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--nx-muted);
  }
  .counter-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    flex-wrap: wrap;
  }
  .btn-counter {
    min-width: 3.5rem;
    min-height: 3rem;
    padding: 0 1.25rem;
    border-radius: 10px;
    border: 1px solid var(--nx-border);
    background: rgba(255, 255, 255, 0.06);
    color: var(--nx-text);
    font-size: 1rem;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  }
  .btn-counter:hover {
    background: rgba(139, 124, 248, 0.2);
    border-color: rgba(139, 124, 248, 0.45);
  }
  .btn-counter:focus-visible {
    outline: 2px solid var(--nx-accent);
    outline-offset: 2px;
  }
  .btn-counter:active {
    transform: scale(0.97);
  }
  .counter-out {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    font-size: 1.5rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-family: var(--nx-display);
  }
  .counter-meta {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--nx-muted);
  }
</style>
`,

    'src/routes/islands/+page.nx': `---
import { pageIslandsCopy } from '$lib/i18n';
---

<script>
  let demo = $state(0);
  let doubled = $derived(demo * 2);
</script>

<section class="pres-hero">
  <p class="pres-kicker">{pageIslandsCopy(ctx).presKicker}</p>
  <h1 class="pres-title">{pageIslandsCopy(ctx).pageTitle}</h1>
  <p class="pres-lead">{pageIslandsCopy(ctx).lead}</p>
</section>

<section class="pres-section" aria-labelledby="s1">
  <h2 id="s1" class="pres-h2">{pageIslandsCopy(ctx).s1h}</h2>
  <p class="pres-p">
    {pageIslandsCopy(ctx).s1p}
  </p>
  <div class="pres-diagram" role="img" aria-label="{pageIslandsCopy(ctx).diagramAria}">
    <div class="pres-flow">
      <span class="pres-box pres-box--srv">{pageIslandsCopy(ctx).flowSrv}</span>
      <span class="pres-arrow" aria-hidden="true">→</span>
      <span class="pres-box">{pageIslandsCopy(ctx).flowHtml}</span>
      <span class="pres-arrow" aria-hidden="true">→</span>
      <span class="pres-box pres-box--js">{pageIslandsCopy(ctx).flowJs}</span>
      <span class="pres-arrow" aria-hidden="true">→</span>
      <span class="pres-box pres-box--ok">{pageIslandsCopy(ctx).flowOk}</span>
    </div>
  </div>
</section>

<section class="pres-section" aria-labelledby="s2">
  <h2 id="s2" class="pres-h2">{pageIslandsCopy(ctx).s2h}</h2>
  <div class="pres-table-wrap">
    <table class="pres-table">
      <thead>
        <tr>
          <th>{pageIslandsCopy(ctx).thDirective}</th>
          <th>{pageIslandsCopy(ctx).thWhen}</th>
          <th>{pageIslandsCopy(ctx).thUse}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>client:load</code></td>
          <td>{pageIslandsCopy(ctx).r1[1]}</td>
          <td>{pageIslandsCopy(ctx).r1[2]}</td>
        </tr>
        <tr>
          <td><code>client:idle</code></td>
          <td>{pageIslandsCopy(ctx).r2[1]}</td>
          <td>{pageIslandsCopy(ctx).r2[2]}</td>
        </tr>
        <tr>
          <td><code>client:visible</code></td>
          <td>{pageIslandsCopy(ctx).r3[1]}</td>
          <td>{pageIslandsCopy(ctx).r3[2]}</td>
        </tr>
        <tr>
          <td><code>client:media="…"</code></td>
          <td>{pageIslandsCopy(ctx).r4[1]}</td>
          <td>{pageIslandsCopy(ctx).r4[2]}</td>
        </tr>
        <tr>
          <td><code>server:only</code></td>
          <td>{pageIslandsCopy(ctx).r5[1]}</td>
          <td>{pageIslandsCopy(ctx).r5[2]}</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<section class="pres-section" aria-labelledby="s3">
  <h2 id="s3" class="pres-h2">{pageIslandsCopy(ctx).s3h}</h2>
  <ol class="pres-list">
    <li>{pageIslandsCopy(ctx).l1}</li>
    <li>{pageIslandsCopy(ctx).l2}</li>
    <li>{pageIslandsCopy(ctx).l3}</li>
    <li>{pageIslandsCopy(ctx).l4}</li>
  </ol>
</section>

<section class="pres-section" aria-labelledby="s4">
  <h2 id="s4" class="pres-h2">{pageIslandsCopy(ctx).s4h}</h2>
  <p class="pres-p">
    {pageIslandsCopy(ctx).s4p}
  </p>
  <p class="pres-p pres-muted">
    {pageIslandsCopy(ctx).s4muted}
  </p>
</section>

<section class="pres-section" aria-labelledby="s5">
  <h2 id="s5" class="pres-h2">{pageIslandsCopy(ctx).s5h}</h2>
  <p class="pres-p">{pageIslandsCopy(ctx).s5p}</p>
  <div class="pres-demo">
    <div class="pres-demo-inner" client:visible>
      <button type="button" class="pres-demo-btn" id="pres-demo-btn" onclick={() => demo++} aria-label="Increment demo counter">
        +1
      </button>
      <div class="pres-demo-out">
        <span class="pres-demo-val">{demo}</span>
        <span class="pres-demo-meta">×2 = {doubled}</span>
      </div>
    </div>
  </div>
</section>

<section class="pres-section pres-outro">
  <h2 class="pres-h2">{pageIslandsCopy(ctx).refh}</h2>
  <p class="pres-p">
    {pageIslandsCopy(ctx).refp}
    <a href="https://nexusjs.dev" target="_blank" rel="noopener noreferrer">nexusjs.dev</a>
  </p>
</section>

<style>
  .pres-hero {
    padding: 1rem 0 2rem;
    border-bottom: 1px solid var(--nx-border);
    margin-bottom: 2rem;
  }
  .pres-kicker {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--nx-accent);
  }
  .pres-title {
    margin: 0 0 0.75rem;
    font-family: var(--nx-display);
    font-size: clamp(1.75rem, 4vw, 2.25rem);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .pres-lead {
    margin: 0;
    max-width: 40rem;
    color: var(--nx-muted);
    line-height: 1.6;
    font-size: 1.05rem;
  }
  .pres-section {
    margin-bottom: 2.5rem;
  }
  .pres-h2 {
    margin: 0 0 1rem;
    font-family: var(--nx-display);
    font-size: 1.2rem;
    font-weight: 600;
  }
  .pres-p {
    margin: 0 0 1rem;
    color: var(--nx-text);
    line-height: 1.65;
    max-width: 46rem;
  }
  .pres-muted {
    color: var(--nx-muted);
    font-size: 0.9rem;
  }
  .pres-code {
    font-family: ui-monospace, monospace;
    font-size: 0.88em;
    background: var(--nx-surface);
    padding: 0.12em 0.35em;
    border-radius: 6px;
    border: 1px solid var(--nx-border);
  }
  .pres-diagram {
    margin-top: 1.25rem;
    padding: 1.25rem;
    border-radius: var(--nx-radius);
    background: var(--nx-surface);
    border: 1px solid var(--nx-border);
    overflow-x: auto;
  }
  .pres-flow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    font-size: 0.9rem;
  }
  .pres-box {
    padding: 0.4rem 0.75rem;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--nx-border);
  }
  .pres-box--srv {
    border-color: rgba(56, 189, 248, 0.35);
  }
  .pres-box--js {
    border-color: rgba(139, 124, 248, 0.45);
  }
  .pres-box--ok {
    border-color: rgba(52, 211, 153, 0.4);
  }
  .pres-arrow {
    color: var(--nx-muted);
  }
  .pres-table-wrap {
    overflow-x: auto;
    border-radius: var(--nx-radius);
    border: 1px solid var(--nx-border);
  }
  .pres-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .pres-table th,
  .pres-table td {
    padding: 0.65rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--nx-border);
  }
  .pres-table th {
    background: rgba(0, 0, 0, 0.2);
    font-weight: 600;
    font-family: var(--nx-display);
  }
  .pres-table tr:last-child td {
    border-bottom: none;
  }
  .pres-table code {
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
    color: var(--nx-accent);
  }
  .pres-list {
    margin: 0;
    padding-left: 1.25rem;
    max-width: 46rem;
    line-height: 1.75;
    color: var(--nx-text);
  }
  .pres-list li {
    margin-bottom: 0.5rem;
  }
  .pres-demo {
    display: flex;
    justify-content: flex-start;
    margin-top: 1rem;
  }
  .pres-demo-inner {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    flex-wrap: wrap;
    padding: 1.25rem 1.5rem;
    border-radius: var(--nx-radius);
    background: linear-gradient(145deg, rgba(139, 124, 248, 0.1), var(--nx-surface));
    border: 1px solid var(--nx-border);
  }
  .pres-demo-btn {
    min-width: 3rem;
    min-height: 2.75rem;
    padding: 0 1rem;
    border-radius: 10px;
    border: 1px solid var(--nx-border);
    background: rgba(255, 255, 255, 0.08);
    color: var(--nx-text);
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
  }
  .pres-demo-btn:hover {
    background: rgba(139, 124, 248, 0.2);
    border-color: rgba(139, 124, 248, 0.45);
  }
  .pres-demo-out {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-family: var(--nx-display);
    font-size: 1.35rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .pres-demo-meta {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--nx-muted);
  }
  .pres-outro {
    padding-top: 1rem;
    border-top: 1px solid var(--nx-border);
  }
  .pres-outro a {
    color: var(--nx-accent);
    text-decoration: none;
  }
  .pres-outro a:hover {
    text-decoration: underline;
  }
</style>
`,

    'src/routes/blog/+page.nx': `---
import { pathWithLang } from '$lib/i18n';

const posts = [
  { slug: "hello-nexus", title: "Hello Nexus", date: "2026-04-03" },
  { slug: "islands-arch", title: "Islands Architecture Deep Dive", date: "2026-04-01" },
];
---

<article class="blog-index">
  <h1 class="blog-title">Blog</h1>
  <ul class="blog-list">
    {#each posts as post}
      <li class="blog-item">
        <a class="blog-link" href="{pathWithLang(ctx, '/blog/' + post.slug)}">{post.title}</a>
        <time class="blog-date" datetime={post.date}>{post.date}</time>
      </li>
    {/each}
  </ul>
</article>

<style>
  .blog-index { max-width: 36rem; }
  .blog-title {
    margin: 0 0 1.5rem;
    font-family: var(--nx-display);
    font-size: 1.75rem;
    font-weight: 700;
  }
  .blog-list { list-style: none; margin: 0; padding: 0; }
  .blog-item {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--nx-border);
  }
  .blog-link {
    color: var(--nx-text);
    font-weight: 600;
    text-decoration: none;
  }
  .blog-link:hover { color: var(--nx-accent); }
  .blog-date { font-size: 0.875rem; color: var(--nx-muted); }
</style>
`,

    'src/routes/blog/[slug]/+page.nx': `---
import { pathWithLang } from '$lib/i18n';
// Use ctx in the template only — frontmatter runs at module load before ctx exists.
---

<article class="blog-post">
  <a class="blog-back" href="{pathWithLang(ctx, '/blog')}">← Blog</a>
  <h1 class="blog-post-title">Post: {ctx.params.slug}</h1>
  <p class="blog-post-body">Placeholder article for <strong>{ctx.params.slug}</strong>. Wire this to your CMS or <code class="inline-code">load()</code> data.</p>
</article>

<style>
  .blog-post { max-width: 40rem; }
  .blog-back {
    display: inline-block;
    margin-bottom: 1.25rem;
    font-size: 0.9rem;
    color: var(--nx-muted);
    text-decoration: none;
  }
  .blog-back:hover { color: var(--nx-accent); }
  .blog-post-title {
    margin: 0 0 1rem;
    font-family: var(--nx-display);
    font-size: 1.75rem;
    font-weight: 700;
  }
  .blog-post-body {
    margin: 0 0 1.5rem;
    color: var(--nx-muted);
    line-height: 1.65;
  }
  .inline-code {
    font-size: 0.9em;
    padding: 0.15em 0.4em;
    border-radius: 6px;
    background: var(--nx-surface);
    border: 1px solid var(--nx-border);
    color: var(--nx-accent);
  }
</style>
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
      return { ...(args.data as object) };
    },
    async create(args: { data: unknown }) {
      return args.data;
    },
  },
};
`,

    'public/favicon.svg': NEXUS_LOGO_SVG,

    '.gitignore': `node_modules/
.nexus/
dist/
*.js.map
`,
  };
}

async function writeProjectFiles(dir: string, name: string, template: CreateTemplate): Promise<void> {
  const v = getPublishedCliVersion();
  const range = `^${v}`;
  const nexusCli = 'node ./node_modules/@nexus_js/cli/dist/bin.js';
  const ensureDeps = 'node ./scripts/check-node-modules.mjs';

  const files =
    template === 'full'
      ? buildFullScaffoldFiles(name, range, nexusCli, ensureDeps)
      : buildMinimalScaffoldFiles(name, range, nexusCli, ensureDeps);

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
