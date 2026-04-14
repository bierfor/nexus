# @nexus_js/bridge-postgres

Postgres schema discovery connector for Nexus Bridge.

## Usage

Set an environment variable with a read-only DSN:

- `BRIDGE_POSTGRES_URL=postgres://...`

Then run:

- `nexus bridge add postgres --dsn-env BRIDGE_POSTGRES_URL --schema public`
- `nexus bridge discover`

## Security

- Introspection uses `information_schema` (schema-only).
- Connection defaults are conservative (single connection, timeouts).
