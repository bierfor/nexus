import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { signAdminSessionToken } from "./jwt-admin.js";
import { clientIp } from "./client-ip.js";
import { recordLoginAttempt } from "./login-rate-limit.js";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Hash bcrypt fijo (contraseña desconocida) para igualar tiempo si el email no existe. */
const DUMMY_PASSWORD_HASH =
  "$2b$12$mrBw51m/oCp7gEMs6lJSjO8dUf3Ndgonf7yZvl/mlRBOYfDr7FkrS";

export async function postAdminLogin(req: Request, res: Response): Promise<void> {
  const ip = clientIp(req);
  if (!recordLoginAttempt(ip)) {
    res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos." });
    return;
  }

  const body = req.body as { email?: unknown; password?: unknown };
  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!emailRegex.test(emailRaw) || password.length === 0) {
    res.status(400).json({ ok: false, error: "Credenciales incorrectas" });
    return;
  }

  let token: string;
  try {
    const user = await prisma.adminUser.findUnique({ where: { email: emailRaw } });
    if (!user) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      res.status(401).json({ ok: false, error: "Credenciales incorrectas" });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ ok: false, error: "Credenciales incorrectas" });
      return;
    }
    try {
      token = await signAdminSessionToken({ sub: user.id, email: user.email });
    } catch (e) {
      console.error("signAdminSessionToken:", e);
      const message =
        e instanceof Error
          ? e.message
          : "No se pudo firmar la sesión (revisa ADMIN_JWT_SECRET en backend/.env).";
      res.status(503).json({ ok: false, error: message });
      return;
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
    return;
  }

  res.json({ ok: true, token });
}
