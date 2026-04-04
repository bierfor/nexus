/** Origin of the mongo/backend API (no trailing path). Derives from `NEXUS_GRAPHQL_URL`. */
export function graphqlOrigin(): string {
  const raw = process.env.NEXUS_GRAPHQL_URL?.trim() || 'http://127.0.0.1:4000/graphql';
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://127.0.0.1:4000';
  }
}
