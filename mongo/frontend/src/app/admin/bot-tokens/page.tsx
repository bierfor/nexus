"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { adminGql } from "@/lib/admin-gql";
import { AdminSessionBar } from "@/components/admin/AdminSessionBar";

type BotRow = {
  id: string;
  name: string;
  keyId: string;
  scopes: string[];
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

const Q = `
  query BotTokensPage {
    botApiTokens {
      id
      name
      keyId
      scopes
      enabled
      lastUsedAt
      createdAt
    }
    botAvailableScopes
  }
`;

const CREATE = `
  mutation CreateBotApiToken($input: BotApiTokenCreateInput!) {
    createBotApiToken(input: $input) {
      token
      botApiToken {
        id
        name
        keyId
        scopes
        enabled
        createdAt
      }
    }
  }
`;

const UPDATE = `
  mutation UpdateBotApiToken($id: ID!, $input: BotApiTokenUpdateInput!) {
    updateBotApiToken(id: $id, input: $input) {
      id
      name
      keyId
      scopes
      enabled
      lastUsedAt
    }
  }
`;

const REVOKE = `
  mutation RevokeBotApiToken($id: ID!) {
    revokeBotApiToken(id: $id)
  }
`;

const SCOPE_HINTS: Record<string, string> = {
  "*": "Todo (equivalente a todos los permisos)",
  "flash:list": "Listar flashes incl. borradores",
  "flash:read": "Ver una flash por id (admin)",
  "flash:create": "Crear noticias relampago",
  "flash:update": "Editar flashes",
  "flash:delete": "Eliminar flashes",
  "flash:publish": "Publicar flash",
  "flash:unpublish": "Despublicar flash",
  "article:list": "Listar articulos incl. borradores",
  "article:read": "Borrador por slug / articulo por id",
  "article:create": "Crear articulos",
  "article:update": "Editar articulos",
  "article:delete": "Eliminar articulos",
  "article:publish": "Publicar articulo",
  "article:unpublish": "Despublicar articulo",
  "media:upload": "POST /media/upload (imagenes)",
};

function selectedScopes(wildcard: boolean, picked: Set<string>): string[] {
  if (wildcard) return ["*"];
  return [...picked].sort();
}

export default function AdminBotTokensPage() {
  const [rows, setRows] = useState<BotRow[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [wildcard, setWildcard] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [shownSecret, setShownSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const data = await adminGql<{ botApiTokens: BotRow[]; botAvailableScopes: string[] }>(Q);
      setRows(data.botApiTokens);
      setAvailable(data.botAvailableScopes);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const scopes = selectedScopes(wildcard, picked);
    if (!name || scopes.length === 0) {
      setErr("Nombre y al menos un permiso son obligatorios.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const data = await adminGql<{
        createBotApiToken: { token: string; botApiToken: BotRow };
      }>(CREATE, { input: { name, scopes } });
      setShownSecret(data.createBotApiToken.token);
      setNewName("");
      setWildcard(false);
      setPicked(new Set());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al crear");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(row: BotRow) {
    setErr(null);
    try {
      await adminGql(UPDATE, {
        id: row.id,
        input: { enabled: !row.enabled },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al actualizar");
    }
  }

  async function saveScopes(row: BotRow, nextScopes: string[]) {
    if (nextScopes.length === 0) {
      setErr("Debe quedar al menos un permiso.");
      return;
    }
    setErr(null);
    try {
      await adminGql(UPDATE, { id: row.id, input: { scopes: nextScopes } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar permisos");
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revocar este token? El bot dejara de poder autenticarse.")) return;
    setErr(null);
    try {
      await adminGql(REVOKE, { id });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al revocar");
    }
  }

  function togglePick(s: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  }

  return (
    <div className="space-y-8">
      <AdminSessionBar />
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">Puro Flusso · Admin</p>
        <h1 className="font-display mt-2 text-3xl text-[var(--ink)]">Tokens de API (bot IA)</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Cada token es un Bearer <code className="rounded bg-[var(--tag-bg)] px-1">pfbot_…</code> contra el GraphQL del
          backend. Los permisos son scopes independientes; el hero del sitio solo lo puede editar el admin humano (
          <code className="rounded bg-[var(--tag-bg)] px-1">ADMIN_SECRET</code>).
        </p>
      </div>

      {err ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
          {err}
        </p>
      ) : null}

      {shownSecret ? (
        <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-4">
          <p className="text-sm font-medium text-[var(--ink)]">Guarda este token ahora; no se volvera a mostrar.</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--card)] p-3 text-xs text-[var(--body)]">
            {shownSecret}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-medium uppercase tracking-wide"
              onClick={() => void navigator.clipboard.writeText(shownSecret)}
            >
              Copiar
            </button>
            <button
              type="button"
              className="text-xs text-[var(--muted)] underline"
              onClick={() => setShownSecret(null)}
            >
              Ocultar
            </button>
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="font-display text-xl text-[var(--ink)]">Nuevo token</h2>
        <form className="mt-4 space-y-4" onSubmit={(e) => void onCreate(e)}>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Nombre interno</span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--body)]"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="p. ej. Bot redaccion IA"
              autoComplete="off"
            />
          </label>
          <div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wildcard}
                onChange={(e) => setWildcard(e.target.checked)}
              />
              <span>Acceso total (scope *)</span>
            </label>
            {!wildcard ? (
              <fieldset className="mt-3 space-y-2 border-0 p-0">
                <legend className="text-xs uppercase tracking-wide text-[var(--muted)]">Permisos</legend>
                <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                  {available.map((s) => (
                    <label key={s} className="flex cursor-pointer gap-2 text-sm">
                      <input type="checkbox" checked={picked.has(s)} onChange={() => togglePick(s)} />
                      <span>
                        <code className="text-[var(--accent)]">{s}</code>
                        {SCOPE_HINTS[s] ? (
                          <span className="text-[var(--muted)]"> — {SCOPE_HINTS[s]}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--ink)] disabled:opacity-50"
          >
            {saving ? "Creando…" : "Crear token"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-display text-xl text-[var(--ink)]">Tokens activos</h2>
        {loading ? (
          <p className="mt-2 text-sm text-[var(--muted)]">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No hay tokens. Crea uno arriba.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--body)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-[var(--ink)]">{row.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      keyId <code className="text-[var(--accent)]">{row.keyId}</code>
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {row.lastUsedAt
                        ? `Ultimo uso: ${new Date(row.lastUsedAt).toLocaleString()}`
                        : "Sin uso registrado aun"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-[var(--border)] px-3 py-1 text-xs uppercase tracking-wide"
                      onClick={() => void toggleEnabled(row)}
                    >
                      {row.enabled ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-red-500/50 px-3 py-1 text-xs uppercase tracking-wide text-red-300"
                      onClick={() => void revoke(row.id)}
                    >
                      Revocar
                    </button>
                  </div>
                </div>
                <RowScopesEditor row={row} available={available} onSave={(scopes) => void saveScopes(row, scopes)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RowScopesEditor({
  row,
  available,
  onSave,
}: {
  row: BotRow;
  available: string[];
  onSave: (scopes: string[]) => void;
}) {
  const isStar = row.scopes.includes("*");
  const [wildcard, setWildcard] = useState(isStar);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(row.scopes.filter((s) => s !== "*")));

  useEffect(() => {
    setWildcard(row.scopes.includes("*"));
    setPicked(new Set(row.scopes.filter((s) => s !== "*")));
  }, [row.id, row.scopes]);

  function togglePick(s: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  }

  return (
    <div className="mt-4 border-t border-[var(--border)] pt-4">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Permisos</p>
      <label className="mt-2 flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={wildcard} onChange={(e) => setWildcard(e.target.checked)} />
        <span>Acceso total (*)</span>
      </label>
      {!wildcard ? (
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {available.map((s) => (
            <label key={s} className="flex cursor-pointer gap-2 text-xs">
              <input type="checkbox" checked={picked.has(s)} onChange={() => togglePick(s)} />
              <code>{s}</code>
            </label>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="mt-3 rounded-full border border-[var(--accent)]/40 px-3 py-1 text-xs font-medium text-[var(--accent)]"
        onClick={() => onSave(selectedScopes(wildcard, picked))}
      >
        Guardar permisos
      </button>
    </div>
  );
}
