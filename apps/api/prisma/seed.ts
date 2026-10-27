/**
 * Development seed: one admin and a few demo colleagues.
 * Passwords come from .env (SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD) and are test-only values.
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

const demoUsers = [
  { username: 'alex.morgan', displayName: 'Alex Morgan', jobTitle: 'Product Manager', department: 'Product' },
  { username: 'priya.sharma', displayName: 'Priya Sharma', jobTitle: 'Software Engineer', department: 'Engineering' },
  { username: 'daniel.kim', displayName: 'Daniel Kim', jobTitle: 'UX Designer', department: 'Design' },
  { username: 'sara.lopez', displayName: 'Sara Lopez', jobTitle: 'Engineering Manager', department: 'Engineering' },
];

async function main() {
  const adminUsername = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (!adminPassword || !demoPassword) {
    throw new Error('Set SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD in apps/api/.env');
  }

  await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      username: adminUsername,
      displayName: 'TeamSphere Admin',
      email: `${adminUsername}@teamsphere.local`,
      role: 'admin',
      jobTitle: 'IT Administrator',
      department: 'IT',
      passwordHash: await hash(adminPassword),
    },
  });

  const demoHash = await hash(demoPassword);
  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, email: `${u.username}@teamsphere.local`, passwordHash: demoHash },
    });
  }

  console.log(`Seeded admin "${adminUsername}" and ${demoUsers.length} demo users.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
