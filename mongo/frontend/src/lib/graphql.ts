/** URL por defecto solo para desarrollo local. */
const DEFAULT_GRAPHQL_URL = "http://127.0.0.1:4000/graphql";

function trimSlash(s: string): string {
  return s.trim().replace(/\/+$/, "");
}

/** Evita `.../graphql/graphql` si alguien pega la URL completa en BACKEND_URL. */
function baseToGraphqlUrl(base: string): string {
  const b = trimSlash(base);
  return b.endsWith("/graphql") ? b : `${b}/graphql`;
}

/**
 * URL del GraphQL para **fetch en el servidor** (RSC, `feed.xml`, etc.).
 * Prioriza `BACKEND_URL` (solo servidor en Vercel/Railway) para no depender del bundle público.
 */
export function serverGraphqlUrl(): string {
  const backend = process.env.BACKEND_URL?.trim();
  if (backend) return baseToGraphqlUrl(backend);
  const pub = process.env.NEXT_PUBLIC_GRAPHQL_URL?.trim();
  if (pub) return pub;
  return DEFAULT_GRAPHQL_URL;
}

/**
 * URL del GraphQL **en el navegador** (contador de vistas, Apollo si se usa en cliente).
 * Debe ser una variable `NEXT_PUBLIC_*` (o `NEXT_PUBLIC_BACKEND_URL` + `/graphql`).
 */
export function graphqlEndpoint(): string {
  const explicit = process.env.NEXT_PUBLIC_GRAPHQL_URL?.trim();
  if (explicit) return explicit;
  const pubBase = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (pubBase) return baseToGraphqlUrl(pubBase);
  return DEFAULT_GRAPHQL_URL;
}

type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

export type GqlFetchOptions = {
  revalidate?: number;
  tags?: string[];
};

export async function gql<T>(
  document: string,
  variables?: Record<string, unknown>,
  init?: GqlFetchOptions,
): Promise<T> {
  const next: { revalidate?: number; tags?: string[] } = {};
  if (init?.revalidate === 0) {
    next.revalidate = 0;
  } else if (init?.revalidate != null) {
    next.revalidate = init.revalidate;
  } else {
    next.revalidate = 60;
  }
  if (init?.tags && init.tags.length > 0) {
    next.tags = init.tags;
  }

  const url = serverGraphqlUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
    next,
  });

  if (!res.ok) {
    throw new Error(
      `GraphQL HTTP ${res.status} (${url}). En el host del front define BACKEND_URL con la URL pública del API (ej. https://tu-api.railway.app), sin barra final.`,
    );
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  if (!json.data) {
    throw new Error("Respuesta GraphQL sin data");
  }
  return json.data;
}
