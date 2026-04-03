/**
 * Nexus Pokédex — Dev Server
 *
 * This server IS the Nexus framework demo:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Browser                                            │
 *   │    → GET /                         (list page)      │
 *   │    → GET /pokemon/25               (detail page)    │
 *   │    → GET /api/pokemon?page=2&q=... (JSON API)       │
 *   │    → GET /_cache                   (cache inspector)│
 *   └────────────────────┬────────────────────────────────┘
 *                        │
 *   ┌────────────────────▼────────────────────────────────┐
 *   │  Nexus Server (this file)                           │
 *   │    ① Shield Cache (in-memory, TTL + SWR)            │
 *   │    ② Data Transformation (20KB → 2KB)              │
 *   │    ③ Smart Cache-Control headers                    │
 *   │    ④ SSR HTML generation                            │
 *   └────────────────────┬────────────────────────────────┘
 *                        │ (cache miss only)
 *   ┌────────────────────▼────────────────────────────────┐
 *   │  PokeAPI GraphQL  (beta.pokeapi.co)                 │
 *   │    ONE query = name + types + stats + sprites       │
 *   │              + description + evolution chain        │
 *   └─────────────────────────────────────────────────────┘
 */

import { createServer } from 'node:http';

const PORT = process.env.PORT ?? 3456;
const GQL  = 'https://beta.pokeapi.co/graphql/v1beta';

// ── Shield Cache ──────────────────────────────────────────────────────────────
const cache   = new Map();
const TTL     = 24 * 60 * 60 * 1000;
const SWR_TTL = 48 * 60 * 60 * 1000;
const stats   = { hits: 0, misses: 0, apiCalls: 0 };

async function shieldCache(key, fn) {
  const now   = Date.now();
  const entry = cache.get(key);

  if (entry) {
    if (now < entry.expiresAt) {
      stats.hits++;
      return { ...entry.value, _cached: true, _age: Math.round((now - entry.setAt) / 1000) };
    }
    if (now < entry.swrExpiresAt) {
      stats.hits++;
      fn().then(v => cache.set(key, { value: v, expiresAt: Date.now() + TTL, swrExpiresAt: Date.now() + SWR_TTL, setAt: Date.now() })).catch(() => {});
      return { ...entry.value, _cached: true, _stale: true };
    }
  }

  stats.misses++;
  stats.apiCalls++;
  const value = await fn();
  cache.set(key, { value, expiresAt: now + TTL, swrExpiresAt: now + SWR_TTL, setAt: now });
  return value;
}

// ── GraphQL ───────────────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`GQL ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

// ── Sprite extractor ──────────────────────────────────────────────────────────
function sprite(spritesStr, shiny = false) {
  try {
    const s = JSON.parse(spritesStr);
    const oa = s?.other?.['official-artwork'];
    if (shiny && oa?.front_shiny) return oa.front_shiny;
    if (oa?.front_default)        return oa.front_default;
    return s?.front_default ?? '';
  } catch { return ''; }
}

// ── Type colors ───────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  normal:'#A8A77A',fire:'#EE8130',water:'#6390F0',electric:'#F7D02C',
  grass:'#7AC74C',ice:'#96D9D6',fighting:'#C22E28',poison:'#A33EA1',
  ground:'#E2BF65',flying:'#A98FF3',psychic:'#F95587',bug:'#A6B91A',
  rock:'#B6A136',ghost:'#735797',dragon:'#6F35FC',dark:'#705746',
  steel:'#B7B7CE',fairy:'#D685AD',
};

const STAT_MAX = { hp:255, attack:185, defense:230, 'special-attack':194, 'special-defense':230, speed:200 };

// ── PokeAPI fetch functions ────────────────────────────────────────────────────
async function fetchList({ page = 1, limit = 20, search = '' } = {}) {
  return shieldCache(`list:${page}:${limit}:${search}`, async () => {
    const offset = (page - 1) * limit;
    const sq = search ? `%${search}%` : '%';
    const data = await gql(`
      query($limit:Int!,$offset:Int!,$sq:String!){
        pokemon_v2_pokemon(limit:$limit,offset:$offset,where:{name:{_ilike:$sq}},order_by:{id:asc}){
          id name
          pokemon_v2_pokemontypes(order_by:{slot:asc}){ pokemon_v2_type{name} }
          pokemon_v2_pokemonsprites{ sprites }
        }
        pokemon_v2_pokemon_aggregate(where:{name:{_ilike:$sq}}){ aggregate{count} }
      }
    `, { limit, offset, sq });

    return {
      total: data.pokemon_v2_pokemon_aggregate.aggregate.count,
      pokemon: data.pokemon_v2_pokemon.map(p => {
        const types = p.pokemon_v2_pokemontypes.map(t => t.pokemon_v2_type.name);
        return {
          id: p.id,
          name: p.name,
          types,
          sprite: sprite(p.pokemon_v2_pokemonsprites[0]?.sprites ?? '{}'),
          color: TYPE_COLORS[types[0]] ?? '#A8A77A',
        };
      }),
    };
  });
}

async function fetchDetail(id) {
  return shieldCache(`detail:${id}`, async () => {
    const data = await gql(`
      query($id:Int!){
        pokemon_v2_pokemon_by_pk(id:$id){
          id name height weight base_experience
          pokemon_v2_pokemontypes(order_by:{slot:asc}){ pokemon_v2_type{name} }
          pokemon_v2_pokemonstats{ base_stat pokemon_v2_stat{name} }
          pokemon_v2_pokemonsprites{ sprites }
          pokemon_v2_pokemonspecy{
            capture_rate
            pokemon_v2_pokemoncolor{name}
            pokemon_v2_pokemonspeciesflavortexts(where:{language_id:{_eq:9}},limit:1){ flavor_text }
            pokemon_v2_evolutionchain{
              pokemon_v2_pokemonspecies(order_by:{order:asc}){
                id name evolves_from_species_id
                pokemon_v2_pokemonevolutions(limit:1){
                  min_level pokemon_v2_evolutiontrigger{name}
                }
              }
            }
          }
        }
      }
    `, { id });

    const p = data.pokemon_v2_pokemon_by_pk;
    if (!p) return null;

    const types = p.pokemon_v2_pokemontypes.map(t => t.pokemon_v2_type.name);
    const sp    = p.pokemon_v2_pokemonsprites[0]?.sprites ?? '{}';
    const color = TYPE_COLORS[p.pokemon_v2_pokemonspecy?.pokemon_v2_pokemoncolor?.name] ?? TYPE_COLORS[types[0]] ?? '#A8A77A';
    const desc  = (p.pokemon_v2_pokemonspecy?.pokemon_v2_pokemonspeciesflavortexts[0]?.flavor_text ?? 'No description.')
      .replace(/\f/g,' ').replace(/\n/g,' ');

    const evolution = (p.pokemon_v2_pokemonspecy?.pokemon_v2_evolutionchain?.pokemon_v2_pokemonspecies ?? [])
      .map(e => ({
        id: e.id, name: e.name,
        sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${e.id}.png`,
        minLevel: e.pokemon_v2_pokemonevolutions[0]?.min_level ?? null,
        trigger: e.pokemon_v2_pokemonevolutions[0]?.pokemon_v2_evolutiontrigger?.name ?? null,
      }));

    return {
      id: p.id, name: p.name, height: p.height, weight: p.weight,
      baseExperience: p.base_experience, types, color,
      sprite: sprite(sp), spriteShiny: sprite(sp, true),
      description: desc,
      captureRate: p.pokemon_v2_pokemonspecy?.capture_rate ?? 0,
      stats: p.pokemon_v2_pokemonstats.map(s => ({
        name: s.pokemon_v2_stat.name,
        value: s.base_stat,
        max: STAT_MAX[s.pokemon_v2_stat.name] ?? 255,
      })),
      evolutionChain: evolution,
    };
  });
}

// ── HTML Renderer — this is the SSR engine ────────────────────────────────────

function typeBadge(type) {
  const colors = {
    fire:'#EE8130',water:'#6390F0',grass:'#7AC74C',electric:'#F7D02C',
    psychic:'#F95587',ice:'#96D9D6',dragon:'#6F35FC',dark:'#705746',
    fairy:'#D685AD',fighting:'#C22E28',poison:'#A33EA1',rock:'#B6A136',
    ground:'#E2BF65',ghost:'#735797',bug:'#A6B91A',steel:'#B7B7CE',
    flying:'#A98FF3',normal:'#A8A77A',
  };
  const textDark = ['electric','ice','ground','steel','normal'];
  const bg = colors[type] ?? '#888';
  const fg = textDark.includes(type) ? '#111' : '#fff';
  return `<span style="background:${bg};color:${fg};padding:3px 12px;border-radius:999px;font-size:12px;font-weight:700;text-transform:capitalize">${type}</span>`;
}

function layout(title, body, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  ${extraHead}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#0d0d1a;--surface:#13131f;--border:#1e1e30;--text:#e2e8f0;--muted:#64748b;--accent:#7c3aed;--mono:'JetBrains Mono',monospace}
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;min-height:100vh}
    a{color:inherit;text-decoration:none}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:var(--bg)}
    ::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
  </style>
</head>
<body>
  <header style="display:flex;align-items:center;gap:16px;padding:14px 32px;background:rgba(13,13,26,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100">
    <a href="/" style="display:flex;align-items:center;gap:8px;font-size:20px;font-weight:800;flex-shrink:0">
      <span style="color:var(--accent)">◆</span>
      <span>Nexus<em style="color:var(--accent);font-style:normal">dex</em>
    </span></a>
    <form method="GET" action="/" style="flex:1;max-width:380px">
      <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 14px">
        <span>🔍</span>
        <input name="q" type="search" placeholder="Search Pokémon..." autocomplete="off"
          style="flex:1;background:none;border:none;outline:none;color:var(--text);font-size:14px;font-family:inherit"
          value="${''}" />
      </div>
    </form>
    <div style="margin-left:auto;display:flex;gap:12px;align-items:center">
      <a href="/_cache" style="font-size:12px;color:var(--muted);border:1px solid var(--border);padding:4px 10px;border-radius:6px">📊 Cache</a>
      <a href="https://github.com/bierfor/nexus" target="_blank" style="font-size:13px;color:var(--muted)">GitHub ↗</a>
    </div>
  </header>
  <main style="padding:32px;max-width:1400px;margin:0 auto">
    ${body}
  </main>
  <footer style="padding:16px 32px;border-top:1px solid var(--border);text-align:center;font-size:13px;color:var(--muted)">
    <p>Powered by <strong style="color:var(--text)">Nexus Framework</strong> ·
    Data from <a href="https://pokeapi.co" target="_blank" style="color:var(--accent)">PokéAPI GraphQL</a> ·
    <a href="/_cache" style="color:var(--accent)">Cache Inspector</a></p>
  </footer>
  <script>
    // SPA-like prefetching on hover — Nexus navigation concept
    document.querySelectorAll('a[href^="/pokemon/"]').forEach(a => {
      a.addEventListener('mouseenter', () => {
        const id = a.href.split('/').pop();
        fetch('/api/pokemon/' + id).catch(() => {});
      }, { once: true });
    });
  </script>
</body>
</html>`;
}

function renderListPage({ pokemon, total, page, limit, search, cached, age }) {
  const totalPages = Math.ceil(total / limit);
  const q = search ? `&q=${encodeURIComponent(search)}` : '';

  const cards = pokemon.map(p => `
    <a href="/pokemon/${p.id}" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;text-decoration:none;color:var(--text);transition:all .2s;display:block;cursor:pointer;position:relative" class="card" data-color="${p.color}">
      <div style="background:linear-gradient(135deg,${p.color}22,#0d0d1a);padding:24px;display:flex;justify-content:center;align-items:center;aspect-ratio:1">
        <img src="${p.sprite}" alt="${p.name}" width="140" height="140" loading="lazy"
          style="object-fit:contain;filter:drop-shadow(0 4px 8px #0006);transition:transform .3s"
          onmouseenter="this.style.transform='scale(1.1)'"
          onmouseleave="this.style.transform='scale(1)'" />
      </div>
      <div style="padding:12px 14px 16px">
        <div style="font-size:11px;color:var(--muted);font-family:var(--mono)">#${String(p.id).padStart(3,'0')}</div>
        <div style="font-size:15px;font-weight:700;text-transform:capitalize;margin:3px 0 8px">${p.name}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${p.types.map(typeBadge).join('')}</div>
      </div>
    </a>
  `).join('');

  const pagination = totalPages > 1 ? `
    <div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-top:40px;padding-top:24px;border-top:1px solid var(--border)">
      ${page > 1 ? `<a href="?page=${page-1}${q}" style="padding:8px 20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:14px">← Prev</a>` : ''}
      <span style="color:var(--muted);font-size:13px">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a href="?page=${page+1}${q}" style="padding:8px 20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:14px">Next →</a>` : ''}
    </div>
  ` : '';

  const cacheChip = cached
    ? `<span style="background:rgba(16,185,129,.15);color:#10b981;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;font-family:var(--mono)">⚡ Shield Cache HIT${age ? ` (${age}s old)` : ''}</span>`
    : `<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;font-family:var(--mono)">🌐 Cache MISS — PokeAPI called</span>`;

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;font-size:13px;color:var(--muted)">
      <span>${total.toLocaleString()} Pokémon</span>
      ${search ? `<span style="background:rgba(124,58,237,.15);color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:12px">Search: "${search}"</span>` : ''}
      ${cacheChip}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px">
      ${cards}
    </div>
    ${pagination}
  `;
}

function renderDetailPage(p, cached) {
  const statColors = {hp:'#ef4444',attack:'#f97316','special-attack':'#a855f7',defense:'#3b82f6','special-defense':'#06b6d4',speed:'#10b981'};
  const bars = p.stats.map(s => `
    <div style="display:grid;grid-template-columns:110px 1fr 40px;align-items:center;gap:10px;margin-bottom:10px">
      <div style="font-size:12px;text-transform:capitalize;color:var(--muted);text-align:right">${s.name.replace('-',' ')}</div>
      <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
        <div style="height:100%;border-radius:3px;background:${statColors[s.name]??p.color};width:${Math.round(s.value/s.max*100)}%;transition:width .6s ease"></div>
      </div>
      <div style="font-size:13px;font-weight:700;font-family:var(--mono);text-align:right">${s.value}</div>
    </div>
  `).join('');

  const evolutionHtml = p.evolutionChain.length > 1 ? `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:20px">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:20px">Evolution Chain</h2>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">
        ${p.evolutionChain.map((e, i) => `
          ${i > 0 ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--muted);font-size:11px;min-width:50px">
            <div style="width:24px;height:1px;background:var(--border)"></div>
            ${e.trigger === 'level-up' && e.minLevel ? `<span>Lv.${e.minLevel}</span>` : e.trigger ? `<span>${e.trigger.replace(/-/g,' ')}</span>` : ''}
            <div>→</div>
          </div>` : ''}
          <a href="/pokemon/${e.id}" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px;border-radius:12px;border:2px solid ${e.id === p.id ? 'var(--accent)' : 'transparent'};background:${e.id === p.id ? 'rgba(124,58,237,.08)' : 'transparent'};min-width:90px">
            <div style="width:72px;height:72px;background:rgba(255,255,255,.04);border-radius:50%;display:flex;align-items:center;justify-content:center;padding:8px">
              <img src="${e.sprite}" alt="${e.name}" width="56" height="56" loading="lazy" style="object-fit:contain"/>
            </div>
            <span style="font-size:12px;font-weight:600;text-transform:capitalize;text-align:center">${e.name}</span>
            <span style="font-size:10px;color:var(--muted);font-family:var(--mono)">#${String(e.id).padStart(3,'0')}</span>
          </a>
        `).join('')}
      </div>
    </div>
  ` : '';

  const quickStats = [
    { label:'Height',  value:`${(p.height/10).toFixed(1)}m`  },
    { label:'Weight',  value:`${(p.weight/10).toFixed(1)}kg` },
    { label:'Base XP', value: p.baseExperience },
    { label:'Capture', value:`${Math.round(p.captureRate/255*100)}%` },
  ].map(s => `
    <div style="text-align:center">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">${s.label}</div>
      <div style="font-size:20px;font-weight:700">${s.value}</div>
    </div>
  `).join('');

  const cacheChip = cached
    ? `<span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:var(--mono)">⚡ Cache HIT</span>`
    : `<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:var(--mono)">🌐 API Called</span>`;

  return `
    <div style="max-width:900px;margin:0 auto">
      <!-- Hero -->
      <div style="position:relative;border-radius:20px;overflow:hidden;margin-bottom:24px;border:1px solid var(--border)">
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse 80% 100% at 80% 50%,${p.color}44,transparent 70%),var(--surface)"></div>
        <div style="position:relative;z-index:1;padding:32px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <a href="/" style="color:var(--muted);font-size:14px">← All Pokémon</a>
            <div style="display:flex;gap:8px;align-items:center">
              ${cacheChip}
              <span style="font-family:var(--mono);font-size:13px;color:var(--muted)">#${String(p.id).padStart(3,'0')}</span>
            </div>
          </div>
          <div style="display:flex;gap:40px;align-items:center;flex-wrap:wrap">
            <div id="sprite-wrap" style="text-align:center;flex-shrink:0">
              <img id="poke-sprite" src="${p.sprite}" alt="${p.name}" width="200" height="200"
                style="object-fit:contain;filter:drop-shadow(0 8px 24px #0008);transition:all .4s" />
              <br>
              <button onclick="toggleShiny()" id="shiny-btn"
                style="margin-top:12px;padding:5px 14px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer">
                ✨ Normal
              </button>
            </div>
            <div style="flex:1;min-width:200px">
              <h1 style="font-size:40px;font-weight:800;text-transform:capitalize;margin-bottom:12px">${p.name}</h1>
              <div style="display:flex;gap:8px;margin-bottom:16px">${p.types.map(typeBadge).join('')}</div>
              <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin-bottom:24px;max-width:420px">${p.description}</p>
              <div style="display:flex;gap:24px;flex-wrap:wrap">${quickStats}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700;margin-bottom:20px">Base Stats</h2>
        ${bars}
      </div>

      <!-- Evolution -->
      ${evolutionHtml}

      <!-- Battle Mode -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700;margin-bottom:6px">⚔️ Battle Mode</h2>
        <p style="font-size:13px;color:var(--muted);margin-bottom:20px">
          Data saved to <code style="background:rgba(124,58,237,.15);color:#7c3aed;padding:1px 4px;border-radius:3px">localStorage</code> via <code style="background:rgba(124,58,237,.15);color:#7c3aed;padding:1px 4px;border-radius:3px">$sync</code>.
          Put your browser in Airplane Mode — battles keep working.
        </p>
        <div id="battle-app" data-pokemon='${JSON.stringify({ id:p.id, name:p.name, sprite:p.sprite, atk: p.stats.find(s=>s.name==='attack')?.value ?? 50, hp: p.stats.find(s=>s.name==='hp')?.value ?? 100 })}'></div>
      </div>
    </div>

    <script>
      // ── Shiny Toggle Island ───────────────────────────────────────────────
      let shiny = false;
      const normalSprite = ${JSON.stringify(p.sprite)};
      const shinySprite  = ${JSON.stringify(p.spriteShiny)};

      function toggleShiny() {
        shiny = !shiny;
        document.getElementById('poke-sprite').src = shiny ? shinySprite : normalSprite;
        document.getElementById('poke-sprite').style.filter = shiny
          ? 'drop-shadow(0 8px 24px rgba(247,208,44,.6)) brightness(1.15)'
          : 'drop-shadow(0 8px 24px #0008)';
        document.getElementById('shiny-btn').textContent = shiny ? '✨ Shiny' : '✨ Normal';
        document.getElementById('shiny-btn').style.borderColor = shiny ? '#f7d02c' : '';
        document.getElementById('shiny-btn').style.color = shiny ? '#f7d02c' : '';
      }

      // ── Battle Mode Island (client:idle simulation) ───────────────────────
      // Uses $sync concept: localStorage persists data across sessions
      function initBattle() {
        const data = JSON.parse(document.getElementById('battle-app').dataset.pokemon);
        const storageKey = 'nexus-battle-' + data.id;
        const atkNorm = Math.round(data.atk / 185 * 100);
        let myHp  = data.hp;
        let oppHp = 100;
        let log   = [];

        // Save to "IndexedDB" (localStorage in this demo)
        localStorage.setItem(storageKey, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));

        document.getElementById('battle-app').innerHTML = \`
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
              <span style="font-size:11px;background:rgba(16,185,129,.15);color:#10b981;padding:3px 10px;border-radius:999px;font-weight:700">⚡ Saved offline (localStorage)</span>
            </div>
            <div style="background:linear-gradient(180deg,#0d0d1a,#13131f);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;margin-bottom:20px">
                <div style="text-align:right">
                  <div style="font-weight:700;margin-bottom:4px">Wild Pokémon</div>
                  <div id="opp-bar-wrap" style="width:180px;height:8px;background:#1e1e30;border-radius:4px;overflow:hidden"><div id="opp-bar" style="height:100%;background:#ef4444;width:100%;transition:width .4s"></div></div>
                  <div id="opp-hp-txt" style="font-size:11px;color:var(--muted);font-family:var(--mono)">100/100 HP</div>
                </div>
                <div style="font-size:48px">❓</div>
              </div>
              <div style="display:flex;justify-content:space-between">
                <img src="\${data.sprite}" width="80" height="80" style="object-fit:contain"/>
                <div style="text-align:right">
                  <div style="font-weight:700;text-transform:capitalize;margin-bottom:4px">\${data.name}</div>
                  <div id="my-bar-wrap" style="width:180px;height:8px;background:#1e1e30;border-radius:4px;overflow:hidden"><div id="my-bar" style="height:100%;background:#10b981;width:100%;transition:width .4s"></div></div>
                  <div id="my-hp-txt" style="font-size:11px;color:var(--muted);font-family:var(--mono)">\${myHp}/\${myHp} HP</div>
                </div>
              </div>
            </div>
            <div id="battle-log" style="display:none;background:#0a0a14;border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--muted);font-family:var(--mono);max-height:100px;overflow-y:auto"></div>
            <div id="winner-banner" style="display:none;text-align:center;padding:14px;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);border-radius:10px;font-size:18px;font-weight:700;color:#10b981;margin-bottom:16px"></div>
            <div style="display:flex;gap:12px">
              <button id="atk-btn" onclick="battleAttack()" style="flex:1;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer">⚔️ Attack</button>
              <button onclick="battleReset()" style="padding:10px 16px;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px">Reset</button>
            </div>
          </div>
        \`;

        window.battleAttack = function() {
          if (oppHp <= 0 || myHp <= 0) return;
          const myDmg  = Math.max(1, Math.floor(Math.random() * atkNorm + atkNorm/2));
          const oppDmg = Math.max(1, Math.floor(Math.random() * 30 + 10));
          oppHp = Math.max(0, oppHp - myDmg);
          addLog(\${JSON.stringify(data.name)} + ' dealt ' + myDmg + ' dmg!');
          updateBars(myHp, oppHp, data.hp);
          if (oppHp > 0) {
            setTimeout(() => {
              myHp = Math.max(0, myHp - oppDmg);
              addLog('Wild dealt ' + oppDmg + ' dmg!');
              updateBars(myHp, oppHp, data.hp);
              checkWinner();
            }, 500);
          } else {
            checkWinner();
          }
        };

        window.battleReset = function() {
          myHp = data.hp; oppHp = 100;
          log = [];
          updateBars(myHp, oppHp, data.hp);
          document.getElementById('battle-log').style.display = 'none';
          document.getElementById('winner-banner').style.display = 'none';
          document.getElementById('atk-btn').disabled = false;
          document.getElementById('atk-btn').style.opacity = '1';
        };

        function addLog(msg) {
          log.unshift(msg);
          const el = document.getElementById('battle-log');
          el.style.display = 'block';
          el.innerHTML = log.slice(0,6).map(l => '<p>' + l + '</p>').join('');
        }

        function updateBars(my, opp, maxMy) {
          const myPct  = Math.round(my / maxMy * 100);
          const oppPct = opp;
          document.getElementById('my-bar').style.width  = myPct + '%';
          document.getElementById('opp-bar').style.width = oppPct + '%';
          document.getElementById('my-bar').style.background  = myPct > 50 ? '#10b981' : myPct > 25 ? '#f59e0b' : '#ef4444';
          document.getElementById('my-hp-txt').textContent  = my + '/' + maxMy + ' HP';
          document.getElementById('opp-hp-txt').textContent = opp + '/100 HP';
        }

        function checkWinner() {
          const w = oppHp <= 0 ? \${JSON.stringify(data.name)} : (myHp <= 0 ? 'Wild Pokémon' : null);
          if (w) {
            const wb = document.getElementById('winner-banner');
            wb.style.display = 'flex';
            wb.innerHTML = '🏆 ' + w + ' wins!';
            document.getElementById('atk-btn').disabled = true;
            document.getElementById('atk-btn').style.opacity = '.5';
          }
        }
      }

      // client:idle simulation — run after page paint
      if ('requestIdleCallback' in window) {
        requestIdleCallback(initBattle);
      } else {
        setTimeout(initBattle, 200);
      }
    </script>
  `;
}

function renderCachePage() {
  const entries = [...cache.entries()];
  const ratio = stats.hits + stats.misses > 0
    ? Math.round(stats.hits / (stats.hits + stats.misses) * 100)
    : 0;
  const now = Date.now();

  const rows = entries.map(([k, v]) => {
    const ttlLeft = Math.max(0, Math.round((v.expiresAt - now) / 1000));
    const ageMin  = Math.round((now - v.setAt) / 1000 / 60);
    return `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;color:#06b6d4">${k}</td>
        <td style="padding:8px 12px;font-size:12px;color:var(--muted)">${ageMin}m ago</td>
        <td style="padding:8px 12px;font-size:12px;color:${ttlLeft < 60 ? '#f59e0b' : '#10b981'}">${ttlLeft}s left</td>
        <td style="padding:8px 12px">
          <span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">LIVE</span>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div style="max-width:800px;margin:0 auto">
      <h1 style="font-size:28px;font-weight:800;margin-bottom:8px">📊 Shield Cache Inspector</h1>
      <p style="color:var(--muted);margin-bottom:28px">Real-time view of the Nexus server-side cache. This is the "Nexus Studio" Cache panel running in the browser.</p>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px">
        ${[
          { label:'Cache Entries', value: cache.size, color:'#06b6d4' },
          { label:'Cache Hits',   value: stats.hits,  color:'#10b981' },
          { label:'Cache Misses', value: stats.misses, color:'#f59e0b' },
          { label:'Hit Ratio',    value: ratio + '%',  color:'#7c3aed' },
        ].map(s => `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px">
            <div style="font-size:28px;font-weight:800;color:${s.color}">${s.value}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">${s.label}</div>
          </div>
        `).join('')}
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:600">Cache Entries</div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:2px solid var(--border);background:rgba(255,255,255,.02)">
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Key</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Age</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">TTL remaining</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--muted)">No entries yet — browse some Pokémon!</td></tr>'}
          </tbody>
        </table>
      </div>

      <p style="margin-top:16px;font-size:13px;color:var(--muted)">
        PokeAPI calls made: <strong style="color:var(--text)">${stats.apiCalls}</strong> ·
        Total requests served: <strong style="color:var(--text)">${stats.hits + stats.misses}</strong>
      </p>

      <div style="margin-top:24px;padding:16px;background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.2);border-radius:10px;font-size:13px;color:#94a3b8">
        <strong style="color:var(--text)">💡 How the Shield Cache works:</strong><br><br>
        First visit → <span style="color:#f59e0b">Cache MISS</span> → GraphQL query fires → data cached for 24h → response time ~300ms<br>
        Next 10,000 visits → <span style="color:#10b981">Cache HIT</span> → served from memory → response time ~1ms<br>
        After 24h → Stale-While-Revalidate → serve stale instantly, refresh in background
      </div>
    </div>
  `;
}

// ── HTTP Router ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // ── JSON API (used for prefetch + JS fetch) ─────────────────────────────

    if (path === '/api/pokemon' || path.startsWith('/api/pokemon?')) {
      const page   = Number(url.searchParams.get('page')  ?? '1');
      const limit  = Number(url.searchParams.get('limit') ?? '20');
      const search =        url.searchParams.get('q')     ?? '';
      const result = await fetchList({ page, limit, search });
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': `public, s-maxage=86400, stale-while-revalidate=172800`,
        'x-nexus-cache': result._cached ? 'HIT' : 'MISS',
      });
      return res.end(JSON.stringify(result));
    }

    const apiDetailMatch = path.match(/^\/api\/pokemon\/(\d+)$/);
    if (apiDetailMatch) {
      const p = await fetchDetail(Number(apiDetailMatch[1]));
      if (!p) { res.writeHead(404); return res.end('{"error":"Not found"}'); }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': `public, s-maxage=86400` });
      return res.end(JSON.stringify(p));
    }

    // ── Cache inspector ─────────────────────────────────────────────────────
    if (path === '/_cache') {
      const html = layout('Shield Cache Inspector — Nexus Pokédex', renderCachePage());
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }

    // ── Pokemon detail page ─────────────────────────────────────────────────
    const detailMatch = path.match(/^\/pokemon\/(\d+)$/);
    if (detailMatch) {
      const p = await fetchDetail(Number(detailMatch[1]));
      if (!p) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(layout('Not found', '<h1>Pokémon not found</h1><a href="/">← Back</a>'));
      }
      const ttl = p._cached ? 86400 : 86400;
      const html = layout(
        `${p.name} — Nexus Pokédex`,
        renderDetailPage(p, p._cached),
        `<meta property="og:image" content="${p.sprite}"><meta name="description" content="${p.description}">`
      );
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`,
        'x-nexus-cache': p._cached ? 'HIT' : 'MISS',
        'x-nexus-cache-strategy': 'shield-swr',
      });
      return res.end(html);
    }

    // ── Home page (Pokémon list) ────────────────────────────────────────────
    if (path === '/') {
      const page   = Number(url.searchParams.get('page')  ?? '1');
      const limit  = Number(url.searchParams.get('limit') ?? '20');
      const search =        url.searchParams.get('q')     ?? '';
      const result = await fetchList({ page, limit, search });
      const html = layout(
        search ? `"${search}" — Nexus Pokédex` : `Pokédex — Page ${page} — Nexus Framework`,
        renderListPage({ ...result, page, limit, search, cached: result._cached, age: result._age })
      );
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': `public, s-maxage=86400, stale-while-revalidate=172800`,
        'x-nexus-cache': result._cached ? 'HIT' : 'MISS',
      });
      return res.end(html);
    }

    // ── 404 ─────────────────────────────────────────────────────────────────
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(layout('404 — Nexus Pokédex', '<div style="text-align:center;padding:80px"><h1 style="font-size:64px;color:var(--muted)">404</h1><p style="color:var(--muted)">This page does not exist.</p><br><a href="/" style="color:#7c3aed">← Back to Pokédex</a></div>'));

  } catch (err) {
    console.error('[Nexus] Request error:', err.message);
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(layout('Error', `<div style="max-width:600px;margin:80px auto;text-align:center"><h1>⚠️ Error</h1><pre style="color:#ef4444;margin:16px 0;text-align:left;background:var(--surface);padding:16px;border-radius:8px">${err.message}</pre><a href="/">← Back</a></div>`));
  }
});

server.listen(PORT, () => {
  console.log(`
  ◆ Nexus Pokédex
  
  → App:            http://localhost:${PORT}
  → Cache Inspector: http://localhost:${PORT}/_cache
  → JSON API:        http://localhost:${PORT}/api/pokemon

  Concepts showcased:
    ⚡ Shield Cache      — 200-500ms API → <1ms after first hit
    🔄 Data Transform   — 20KB GraphQL → 2KB per card
    📊 Cache-Control    — Auto s-maxage=86400, swr=172800
    🏝️ Islands          — ShinyToggle (load), Battle (idle)
    ⚔️ Offline-First    — $sync via localStorage
    🌊 One GQL query    — name + types + stats + evolution chain
  `);
});
