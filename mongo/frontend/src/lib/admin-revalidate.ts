/** Invalida etiquetas de caché de Next tras cambios en admin (cookie de sesión). */
export async function revalidatePublicTags(tags: string[]): Promise<void> {
  if (!tags.length) return;
  try {
    const res = await fetch("/api/admin/revalidate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) {
      console.warn("revalidatePublicTags:", res.status, await res.text());
    }
  } catch (e) {
    console.warn("revalidatePublicTags:", e);
  }
}
