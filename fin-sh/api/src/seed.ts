import { AdPlacement, User } from './models.js';
import { hashPassword } from './auth.js';

/**
 * First-run admin from env + demo ad row so the free dashboard has something to show.
 */
export async function runSeed(): Promise<void> {
  const email = process.env['FIN_SH_ADMIN_EMAIL']?.trim().toLowerCase();
  const pass = process.env['FIN_SH_ADMIN_PASSWORD'];
  if (email && pass) {
    const hasAdmin = await User.exists({ role: 'admin' });
    if (!hasAdmin) {
      await User.create({
        email,
        passwordHash: await hashPassword(pass),
        name: process.env['FIN_SH_ADMIN_NAME']?.trim() || 'Admin',
        plan: 'business',
        role: 'admin',
      });
      console.log('[fin-sh-api] Seeded admin user:', email);
    }
  }

  const adCount = await AdPlacement.countDocuments();
  if (adCount === 0) {
    await AdPlacement.create({
      title: 'Fin.sh Pro',
      body:
        'Shown on free short-link redirects before the destination. Upgrade to Premium to skip this step and unlock QR Studio.',
      targetUrl: 'https://github.com/bierfor/nexus/tree/main/fin-sh',
      imageUrl: '',
      regions: '*',
      priority: 10,
      active: true,
      audiencePlan: 'free',
    });
    console.log('[fin-sh-api] Seeded default ad placement');
  }
}
