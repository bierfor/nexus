/**
 * Server-side validation for NexusFlow publish (called from the generated Server Action sidecar).
 * @param {unknown} input
 * @returns {{ ok: boolean; message: string; receivedAt?: string }}
 */
export function validateFlowPayload(input) {
  const nodes = input && typeof input === 'object' ? input.nodes : null;
  const edges = input && typeof input === 'object' ? input.edges : null;
  const flowId = input && typeof input === 'object' ? String(input.flowId ?? '') : '';
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return { ok: false, message: 'Payload inválido: se esperaban nodes y edges.' };
  }
  const ids = new Set();
  for (const n of nodes) {
    if (n && typeof n === 'object' && n.id) ids.add(String(n.id));
  }
  const orphan = edges.some(
    (e) =>
      !e ||
      typeof e !== 'object' ||
      !ids.has(String(e.from)) ||
      !ids.has(String(e.to)),
  );
  if (orphan) {
    return { ok: false, message: 'Rechazado: arista huérfana' };
  }
  return {
    ok: true,
    message: `Flujo ${flowId || 'default'} validado en el servidor (${nodes.length} nodos, ${edges.length} aristas).`,
    receivedAt: new Date().toISOString(),
  };
}
