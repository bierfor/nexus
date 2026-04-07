# Server Actions - Patrón Seguro y Simple

Server Actions en Nexus son **100% seguras por defecto** y **cero configuración**. 

## Características de Seguridad Automáticas

✅ **CSRF Protection** - Header `x-nexus-action` requerido  
✅ **Cookies seguras** - `ctx.setCookie()` con HttpOnly, SameSite  
✅ **Rate limiting** - Configurable por acción  
✅ **Progressive Enhancement** - Funciona sin JavaScript  
✅ **Idempotency** - Previene double-submit  

## Patrón Básico

### 1. Define la acción en cualquier `.nx` file

```typescript
---
import { createAction } from '@nexus_js/server';

const myAction = createAction(async (data, ctx) => {
  // Tu lógica aquí
  const name = String(data.name || '');
  
  // Cookies se envían automáticamente
  ctx.setCookie('session', 'value', {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7 // 7 días
  });
  
  return { success: true };
});
---
```

### 2. Crea un form HTML nativo - ¡SIN JavaScript!

```html
<form method="post" action="/_nexus/action/myAction">
  <input name="name" required />
  <button type="submit">Submit</button>
</form>
```

**¡Eso es todo!** El interceptor automático maneja:
- ✅ CSRF header (`x-nexus-action: 1`)
- ✅ Loading states
- ✅ Redirects
- ✅ Errores

## Ejemplos Comunes

### Login con validación de campos

```typescript
const loginAction = createAction(async (data, ctx) => {
  const email = String(data.email || '').trim();
  const password = String(data.password || '');
  
  // Validación
  if (!email.includes('@')) {
    throw new ActionError('Invalid email', {
      fieldErrors: { email: 'Invalid email address' }
    });
  }
  
  // Autenticación
  const user = await db.login(email, password);
  
  // Cookie de sesión
  ctx.setCookie('session', user.token, {
    httpOnly: true,
    secure: ctx.url.protocol === 'https:',
    sameSite: 'Lax',
    maxAge: 14 * 24 * 60 * 60 // 14 días
  });
  
  return { success: true, user };
});
```

HTML con clase especial `.auth-form` para field errors:

```html
<form class="auth-form" method="post" action="/_nexus/action/loginAction">
  <div>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required />
    <span id="email-error" class="field-err"></span>
  </div>
  
  <div>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required />
    <span id="password-error" class="field-err"></span>
  </div>
  
  <span class="err"></span>
  <button type="submit">Sign in</button>
</form>
```

### Logout

```typescript
const logout = createAction(async (_input, ctx) => {
  // Limpiar cookies
  ctx.setCookie('session', '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
  });
  
  // Redirect automático
  return ctx.redirect('/');
});
```

```html
<form method="post" action="/_nexus/action/logout">
  <button type="submit">Log out</button>
</form>
```

### Create/Update con Rate Limiting

```typescript
const createLink = createAction(
  async (data, ctx) => {
    const url = String(data.url || '');
    
    // Validación
    if (!url.startsWith('http')) {
      throw new ActionError('Invalid URL');
    }
    
    // Crear en DB
    const link = await db.links.create({
      url,
      userId: ctx.locals.userId,
    });
    
    return { link };
  },
  {
    rateLimit: { window: '1m', max: 10 }, // 10 por minuto
    idempotent: true, // Cachea duplicados
  }
);
```

## Configuración del Interceptor (Una sola vez)

Crea `/public/auth.js` (ya incluido en proyectos Nexus):

```javascript
// Se carga automáticamente en <head> del layout
// Intercepta TODOS los forms a /_nexus/action/*
// Añade header x-nexus-action: 1
// Maneja redirects, errores, cookies
```

Cárgalo en tu `+layout.nx`:

```html
<head>
  <!-- ... otros tags ... -->
  <script src="/auth.js" defer></script>
</head>
```

## Seguridad Avanzada

### Custom Validation (Zod)

```typescript
import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
  passwordConfirm: z.string(),
}).refine(data => data.password === data.passwordConfirm, {
  message: "Passwords don't match",
  path: ['passwordConfirm'],
});

const register = createAction(async (data, ctx) => {
  const result = registerSchema.safeParse(data);
  
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    result.error.issues.forEach(issue => {
      fieldErrors[issue.path[0]] = issue.message;
    });
    throw new ActionError('Validation failed', { fieldErrors });
  }
  
  // ...
});
```

### CSRF + Origin Validation

Automático en producción:
- ✅ Verifica `Origin` vs `Referer`
- ✅ Bloquea `null` origin
- ✅ Valida action signatures (HMAC)

### Environment Variables

```env
# Requerido en producción
NEXUS_SECRET=tu-secreto-de-32-chars-minimo

# Cookie de sesión personalizada
NEXUS_SESSION_COOKIE=my_app_session
```

## Progressive Enhancement

Si JavaScript NO está disponible:
1. Form se envía como POST normal
2. Server procesa con `FormData`
3. Redirect con 303 See Other
4. Errores en query params

¡100% funcional sin JavaScript!

## Tips

1. **Usa nombres descriptivos**: `loginAction`, `createLinkAction`
2. **Siempre valida input**: Nunca confíes en el cliente
3. **Limpia cookies al logout**: `maxAge: 0`
4. **Rate limit acciones sensibles**: Login, register, create
5. **Usa `ctx.redirect()`**: Automático, seguro
6. **Field errors para forms complejos**: Clase `.auth-form` + `#field-error` spans

## Debugging

Ver logs en consola del navegador:

```
[Nexus] Intercepting form: /_nexus/action/loginAction
[Nexus] Response status: 200
[Nexus] Success! Redirecting to: /dashboard
```

Ver logs del servidor:

```
POST /_nexus/action/loginAction  200  336ms ⚡ action
```

## Resumen

Server Actions en Nexus son:
- 🔒 **Seguras por defecto** - CSRF, cookies, rate limiting
- 🎯 **Simples de usar** - Forms nativos HTML
- ⚡ **Rápidas** - Progressive enhancement
- 🛡️ **Robustas** - Idempotency, retries, validación

¡No necesitas configurar nada más! Solo crea el action y el form.
