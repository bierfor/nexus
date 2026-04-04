type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

export async function adminGql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/api/admin/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 401) {
    throw new Error("Sesión caducada o no iniciada. Entra de nuevo en /admin/login.");
  }

  let json: GraphQLResponse<T>;
  try {
    json = (await res.json()) as GraphQLResponse<T>;
  } catch {
    throw new Error(`Respuesta no JSON (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const msg = json.errors?.[0]?.message;
    if (res.status === 503) {
      throw new Error(
        msg ??
          "Añade ADMIN_SECRET en frontend/.env.local (igual que backend/.env) y reinicia Next.",
      );
    }
    throw new Error(msg ?? `HTTP ${res.status}`);
  }

  if (json.errors?.length) {
    const m = json.errors[0].message;
    if (m === "No autorizado") {
      throw new Error(
        "No autorizado: ADMIN_SECRET del frontend y del backend deben ser exactamente el mismo (revisa .env.local y .env, sin comillas raras). Reinicia backend y Next.",
      );
    }
    throw new Error(m);
  }

  if (!json.data) {
    throw new Error("Sin datos");
  }
  return json.data;
}

export async function uploadCoverImage(file: File): Promise<{ url: string; publicId: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/media/upload", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (res.status === 401) {
    throw new Error("Sesión caducada o no iniciada. Entra de nuevo en /admin/login.");
  }
  const json = (await res.json()) as { error?: string; url?: string; publicId?: string };
  if (!res.ok || !json.url) {
    throw new Error(json.error ?? "Error al subir imagen");
  }
  return { url: json.url, publicId: json.publicId ?? "" };
}
