/**
 * Nexus Pokédex — PokeAPI GraphQL Client + Shield Cache
 *
 * THE SHIELD CACHE:
 *   PokeAPI responds in 200-500ms. After the first hit, every subsequent
 *   request for the same Pokémon is served in ~0ms from this in-memory cache.
 *
 *   In production, swap the Map with a Redis adapter:
 *     import { setCacheAdapter } from '@nexus/runtime';
 *     setCacheAdapter(redisAdapter(process.env.REDIS_URL));
 *
 * GRAPHQL ENDPOINT:
 *   https://beta.pokeapi.co/graphql/v1beta (rate limit: 200 req/hour)
 *   We batch multiple API needs into a single GraphQL query — one network
 *   round trip for an entire Pokémon detail page (name, types, stats,
 *   sprites, description, evolution chain). In REST this would be 3-4 calls.
 */

import type {
  PokemonListItem,
  PokemonDetail,
  PokemonStat,
  EvolutionNode,
  GqlPokemonListResponse,
  GqlPokemonDetailResponse,
} from './types.js';

const GQL_ENDPOINT = 'https://beta.pokeapi.co/graphql/v1beta';

// ── Shield Cache ─────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  swrExpiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 24 * 60 * 60 * 1000;   // 24 hours for Pokemon data (rarely changes)
const CACHE_SWR = 48 * 60 * 60 * 1000;   // 48 hours for stale-while-revalidate

export function getCacheStats() {
  const now = Date.now();
  return {
    entries: cache.size,
    hits: _stats.hits,
    misses: _stats.misses,
    ratio: _stats.hits + _stats.misses > 0
      ? Math.round((_stats.hits / (_stats.hits + _stats.misses)) * 100)
      : 0,
    entries_detail: [...cache.entries()].map(([k, v]) => ({
      key: k,
      expiresIn: Math.max(0, Math.round((v.expiresAt - now) / 1000 / 60)) + 'm',
      stale: now > v.expiresAt,
    })),
  };
}

const _stats = { hits: 0, misses: 0 };

async function shieldCache<T>(key: string, fn: () => Promise<T>): Promise<T & { _cached?: boolean }> {
  const now = Date.now();
  const entry = cache.get(key) as CacheEntry<T> | undefined;

  if (entry) {
    if (now < entry.expiresAt) {
      _stats.hits++;
      return { ...(entry.value as object), _cached: true } as T & { _cached: boolean };
    }
    if (now < entry.swrExpiresAt) {
      // Stale-while-revalidate: serve stale, refresh in background
      _stats.hits++;
      refreshInBackground(key, fn);
      return { ...(entry.value as object), _cached: true } as T & { _cached: boolean };
    }
  }

  _stats.misses++;
  const value = await fn();
  cache.set(key, {
    value,
    expiresAt: now + CACHE_TTL,
    swrExpiresAt: now + CACHE_SWR,
  });
  return value;
}

function refreshInBackground<T>(key: string, fn: () => Promise<T>): void {
  fn()
    .then(value => {
      const now = Date.now();
      cache.set(key, { value, expiresAt: now + CACHE_TTL, swrExpiresAt: now + CACHE_SWR });
    })
    .catch(err => console.error(`[Shield Cache] Background refresh failed for "${key}":`, err));
}

// ── GraphQL executor ──────────────────────────────────────────────────────────

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`PokeAPI GraphQL error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${json.errors.map(e => e.message).join(', ')}`);
  }

  return json.data as T;
}

// ── GraphQL Queries ────────────────────────────────────────────────────────────

const POKEMON_LIST_QUERY = `
  query PokemonList($limit: Int!, $offset: Int!, $search: String!) {
    pokemon_v2_pokemon(
      limit: $limit
      offset: $offset
      where: { name: { _ilike: $search } }
      order_by: { id: asc }
    ) {
      id
      name
      pokemon_v2_pokemontypes(order_by: { slot: asc }) {
        pokemon_v2_type { name }
      }
      pokemon_v2_pokemonsprites { sprites }
    }
    pokemon_v2_pokemon_aggregate(
      where: { name: { _ilike: $search } }
    ) {
      aggregate { count }
    }
  }
`;

const POKEMON_DETAIL_QUERY = `
  query PokemonDetail($id: Int!) {
    pokemon_v2_pokemon_by_pk(id: $id) {
      id
      name
      height
      weight
      base_experience
      pokemon_v2_pokemontypes(order_by: { slot: asc }) {
        pokemon_v2_type { name }
      }
      pokemon_v2_pokemonstats {
        base_stat
        pokemon_v2_stat { name }
      }
      pokemon_v2_pokemonsprites { sprites }
      pokemon_v2_pokemonspecy {
        capture_rate
        pokemon_v2_pokemoncolor { name }
        pokemon_v2_pokemonspeciesflavortexts(
          where: { language_id: { _eq: 9 } }
          limit: 1
        ) { flavor_text }
        pokemon_v2_evolutionchain {
          pokemon_v2_pokemonspecies(order_by: { order: asc }) {
            id
            name
            evolves_from_species_id
            pokemon_v2_pokemonevolutions(limit: 1) {
              min_level
              pokemon_v2_evolutiontrigger { name }
            }
          }
        }
      }
    }
  }
`;

// ── Sprite extractor ──────────────────────────────────────────────────────────

function extractSprite(spritesJson: string, shiny = false): string {
  try {
    const sprites = JSON.parse(spritesJson) as Record<string, unknown>;
    const other = sprites['other'] as Record<string, unknown> | undefined;
    const official = other?.['official-artwork'] as Record<string, unknown> | undefined;

    if (shiny) {
      const s = official?.['front_shiny'] as string | null;
      if (s) return s;
    }

    const front = official?.['front_default'] as string | null;
    if (front) return front;

    return sprites['front_default'] as string ?? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${sprites['id']}.png`;
  } catch {
    return '';
  }
}

// ── TYPE COLORS (used for placeholder backgrounds + badges) ──────────────────

export const TYPE_COLORS: Record<string, string> = {
  normal: '#A8A77A', fire: '#EE8130', water: '#6390F0',
  electric: '#F7D02C', grass: '#7AC74C', ice: '#96D9D6',
  fighting: '#C22E28', poison: '#A33EA1', ground: '#E2BF65',
  flying: '#A98FF3', psychic: '#F95587', bug: '#A6B91A',
  rock: '#B6A136', ghost: '#735797', dragon: '#6F35FC',
  dark: '#705746', steel: '#B7B7CE', fairy: '#D685AD',
};

// ── STAT max values for normalization (gen 8 record holders) ─────────────────

const STAT_MAX: Record<string, number> = {
  hp: 255, attack: 185, defense: 230,
  'special-attack': 194, 'special-defense': 230, speed: 200,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches and transforms a page of Pokémon.
 * The transformation is the key Nexus advantage:
 * PokeAPI returns ~8KB per Pokémon, we return ~300 bytes.
 */
export async function fetchPokemonList(opts: {
  page: number;
  limit: number;
  search: string;
}): Promise<{ pokemon: PokemonListItem[]; total: number; cached: boolean }> {
  const key = `list:${opts.page}:${opts.limit}:${opts.search}`;

  return shieldCache(key, async () => {
    const offset = (opts.page - 1) * opts.limit;
    const search = opts.search ? `%${opts.search}%` : '%';

    const data = await gql<GqlPokemonListResponse['data']>(POKEMON_LIST_QUERY, {
      limit: opts.limit,
      offset,
      search,
    });

    // ── DATA TRANSFORMATION at the Edge ────────────────────────────────────
    // Input:  ~8KB per Pokemon (full sprite JSON, all forms, gender diffs, etc.)
    // Output: ~300 bytes per Pokemon (only what the card needs)
    const pokemon: PokemonListItem[] = data.pokemon_v2_pokemon.map(p => {
      const types = p.pokemon_v2_pokemontypes.map(t => t.pokemon_v2_type.name);
      const spritesRaw = p.pokemon_v2_pokemonsprites[0]?.sprites ?? '{}';
      const sprite = extractSprite(spritesRaw);
      const color = TYPE_COLORS[types[0] ?? 'normal'] ?? '#A8A77A';

      return { id: p.id, name: p.name, types, sprite, color };
    });

    return {
      pokemon,
      total: data.pokemon_v2_pokemon_aggregate.aggregate.count,
      cached: false,
    };
  });
}

/**
 * Fetches full Pokémon detail.
 *
 * ONE GraphQL query resolves:
 *   - Basic info (name, height, weight)
 *   - All types
 *   - All 6 stats (normalized for radar chart)
 *   - Official artwork sprite + shiny
 *   - Flavor text (description)
 *   - Complete evolution chain
 *
 * In REST/REST-Next.js this would be 3-4 sequential fetches (waterfall).
 */
export async function fetchPokemonDetail(id: number): Promise<PokemonDetail> {
  return shieldCache(`detail:${id}`, async () => {
    const data = await gql<GqlPokemonDetailResponse['data']>(POKEMON_DETAIL_QUERY, { id });
    const p = data.pokemon_v2_pokemon_by_pk;

    if (!p) throw new Error(`Pokémon #${id} not found`);

    const types = p.pokemon_v2_pokemontypes.map(t => t.pokemon_v2_type.name);
    const spritesRaw = p.pokemon_v2_pokemonsprites[0]?.sprites ?? '{}';
    const sprite = extractSprite(spritesRaw);
    const spriteShiny = extractSprite(spritesRaw, true);
    const species = p.pokemon_v2_pokemonspecy;
    const colorName = species?.pokemon_v2_pokemoncolor?.name ?? types[0] ?? 'normal';
    const color = TYPE_COLORS[colorName] ?? TYPE_COLORS[types[0] ?? 'normal'] ?? '#A8A77A';

    const description = species
      ?.pokemon_v2_pokemonspeciesflavortexts[0]
      ?.flavor_text
      ?.replace(/\f/g, ' ')
      ?.replace(/\n/g, ' ')
      ?? 'No description available.';

    // Normalize stats for radar chart (0-100 scale)
    const stats: PokemonStat[] = p.pokemon_v2_pokemonstats.map(s => ({
      name: s.pokemon_v2_stat.name,
      value: s.base_stat,
      max: STAT_MAX[s.pokemon_v2_stat.name] ?? 255,
    }));

    // Resolve evolution chain
    const evolutionChain: EvolutionNode[] = [];
    const chainSpecies = species?.pokemon_v2_evolutionchain?.pokemon_v2_pokemonspecies ?? [];

    for (const evo of chainSpecies) {
      const evoSprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${evo.id}.png`;
      const evoData = evo.pokemon_v2_pokemonevolutions[0];

      evolutionChain.push({
        id: evo.id,
        name: evo.name,
        sprite: evoSprite,
        minLevel: evoData?.min_level ?? null,
        trigger: evoData?.pokemon_v2_evolutiontrigger?.name ?? null,
      });
    }

    return {
      id: p.id,
      name: p.name,
      height: p.height,
      weight: p.weight,
      baseExperience: p.base_experience,
      types,
      sprite,
      spriteShiny,
      color,
      description,
      stats,
      evolutionChain,
      captureRate: species?.capture_rate ?? 0,
    };
  }) as Promise<PokemonDetail>;
}

/**
 * Clears the Shield Cache.
 * Useful in tests or when you know the API has been updated.
 */
export function clearCache(pattern?: string): void {
  if (pattern) {
    for (const key of cache.keys()) {
      if (key.includes(pattern)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}
