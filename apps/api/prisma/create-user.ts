/**
 * Create a TeamSphere account, or reset an existing account's password, from the command line.
 * Works in production (no seed data needed). The password is prompted for, never passed on the command line.
 *
 *   pnpm --filter @teamsphere/api user:create -- --username jane.doe --name "Jane Doe" [--email jane@company.com] [--role admin|user|guest]
 *   pnpm --filter @teamsphere/api user:create -- --username jane.doe --reset-password
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Reads a line without echoing it to the terminal. */
function askHidden(question: string): Promise<string> {
  const muted = new Writable({ write: (_c, _e, cb) => cb() });
  process.stdout.write(question);
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.TEAMSPHERE_NEW_PASSWORD; // for scripted/CI use
  if (fromEnv) return fromEnv;
  const first = await askHidden('Password (8+ characters): ');
  const second = await askHidden('Repeat password: ');
  if (first !== second) throw new Error('Passwords do not match');
  return first;
}

async function main() {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* use real environment */
  }
  const prisma = new PrismaClient();
  try {
    const username = arg('username')?.toLowerCase();
    if (!username || !/^[a-z0-9._-]{3,64}$/.test(username)) {
      throw new Error('Pass --username (3-64 chars: letters, numbers, dot, dash, underscore)');
    }

    if (process.argv.includes('--reset-password')) {
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) throw new Error(`No account named "${username}"`);
      const password = await readPassword();
      if (password.length < 8) throw new Error('Password must be at least 8 characters');
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(password), isActive: true } });
      await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      console.log(`Password reset for "${username}". Existing sessions were signed out.`);
      return;
    }

    const displayName = arg('name');
    if (!displayName) throw new Error('Pass --name "Display Name"');
    const role = (arg('role') ?? 'user') as UserRole;
    if (!['admin', 'user', 'guest'].includes(role)) throw new Error('--role must be admin, user or guest');
    const email = arg('email')?.toLowerCase();
    if (await prisma.user.findFirst({ where: { OR: [{ username }, ...(email ? [{ email }] : [])] } })) {
      throw new Error('That username or email already exists. Use --reset-password to change a password.');
    }
    const password = await readPassword();
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    await prisma.user.create({
      data: { username, displayName, email, role, authProvider: 'local', passwordHash: await hash(password) },
    });
    console.log(`Created ${role} account "${username}".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
