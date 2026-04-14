# @nexus_js/bridge

Nexus Bridge is the security-first foundation for:

- legacy discovery (DB/APIs)
- canonical model generation (`canonical-model.json`)
- secure generators (GraphQL SDL + Shield defaults)

## CLI

Use via `@nexus_js/cli`:

- `nexus bridge add postgres --dsn-env BRIDGE_POSTGRES_URL --schema public`
- `nexus bridge discover`
- `nexus bridge verify`
- `nexus bridge generate`
- `nexus bridge ui --port 4600`

## Security defaults

- No data sampling by default (schema-only discovery).
- Sensitive fields are classified and `secret` fields are excluded from generated SDL.
- Shield defaults are emitted with introspection disabled.
