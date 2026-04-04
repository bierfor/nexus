/**
 * Nexus Pokédex — TypeScript Types
 *
 * These are the TRANSFORMED types — what the server block
 * sends to the client after filtering the 20KB PokeAPI response
 * down to only the ~2KB the client actually needs.
 */

export interface PokemonListItem {
  id: number;
  name: string;
  types: string[];
  /** Official artwork URL — will be proxied through @nexus_js/assets */
  sprite: string;
  /** Dominant color extracted server-side for instant placeholder */
  color: string;
}

export interface PokemonDetail {
  id: number;
  name: string;
  height: number;      // in decimetres
  weight: number;      // in hectograms
  baseExperience: number;
  types: string[];
  sprite: string;
  spriteShiny: string;
  color: string;
  description: string;
  stats: PokemonStat[];
  evolutionChain: EvolutionNode[];
  captureRate: number;
}

export interface PokemonStat {
  name: string;
  value: number;
  max: number;  // normalized for radar chart
}

export interface EvolutionNode {
  id: number;
  name: string;
  sprite: string;
  minLevel: number | null;
  trigger: string | null;
}

/** What BattleMode saves to IndexedDB via $sync({ persist: 'local' }) */
export interface BattleData {
  pokemon: PokemonDetail;
  savedAt: Date;
}

/** GraphQL response shape from PokeAPI beta */
export interface GqlPokemonListResponse {
  data: {
    pokemon_v2_pokemon: Array<{
      id: number;
      name: string;
      pokemon_v2_pokemontypes: Array<{
        pokemon_v2_type: { name: string };
      }>;
      pokemon_v2_pokemonsprites: Array<{
        sprites: string;  // JSON string
      }>;
    }>;
    pokemon_v2_pokemon_aggregate: {
      aggregate: { count: number };
    };
  };
}

export interface GqlPokemonDetailResponse {
  data: {
    pokemon_v2_pokemon_by_pk: {
      id: number;
      name: string;
      height: number;
      weight: number;
      base_experience: number;
      pokemon_v2_pokemontypes: Array<{
        pokemon_v2_type: { name: string };
      }>;
      pokemon_v2_pokemonstats: Array<{
        base_stat: number;
        pokemon_v2_stat: { name: string };
      }>;
      pokemon_v2_pokemonsprites: Array<{
        sprites: string;
      }>;
      pokemon_v2_pokemonspecy: {
        capture_rate: number;
        color_id: number;
        pokemon_v2_pokemoncolor: { name: string };
        pokemon_v2_pokemonspeciesflavortexts: Array<{
          flavor_text: string;
        }>;
        pokemon_v2_evolutionchain: {
          pokemon_v2_pokemonspecies: Array<{
            id: number;
            name: string;
            evolves_from_species_id: number | null;
            pokemon_v2_pokemonevolutions: Array<{
              min_level: number | null;
              pokemon_v2_evolutiontrigger: { name: string } | null;
            }>;
          }>;
        } | null;
      } | null;
    } | null;
  };
}
