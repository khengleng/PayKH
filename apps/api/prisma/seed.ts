/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { hashPassword, generateApiKey, ids } from '@paykh/security';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'owner@demo.paykh.dev';
const DEMO_PASSWORD = 'Password123!';

async function seedPlans() {
  const plans = [
    { id: 'plan_free', name: 'Free', monthlyPaidQuota: 100, priceUsdCents: 0 },
    { id: 'plan_starter', name: 'Starter', monthlyPaidQuota: 1000, priceUsdCents: 900 },
    { id: 'plan_growth', name: 'Growth', monthlyPaidQuota: 5000, priceUsdCents: 4900 },
    { id: 'plan_enterprise', name: 'Enterprise', monthlyPaidQuota: -1, priceUsdCents: 0 },
  ];
  for (const plan of plans) {
    await prisma.plan.upsert({ where: { id: plan.id }, create: plan, update: plan });
  }
  console.log(`✓ Seeded ${plans.length} plans`);
}

async function seedDemoMerchant() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log(`• Demo merchant already exists (${DEMO_EMAIL}) — skipping`);
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const orgId = ids.organization();
  const storeId = ids.store();

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: DEMO_EMAIL, passwordHash, name: 'Demo Owner', emailVerifiedAt: new Date() },
    });
    await tx.organization.create({
      data: { id: orgId, name: 'Demo Merchant Co', planId: 'plan_free' },
    });
    await tx.organizationMember.create({
      data: { organizationId: orgId, userId: user.id, role: 'OWNER' },
    });
    await tx.store.create({
      data: {
        id: storeId,
        organizationId: orgId,
        name: 'Demo Coffee Shop',
        branding: {
          create: {
            displayName: 'Demo Coffee Shop',
            primaryColor: '#0F766E',
            supportEmail: 'support@demo.paykh.dev',
            customMessage: 'Thank you for your order!',
          },
        },
      },
    });
  });

  const key = generateApiKey('test');
  await prisma.apiKey.create({
    data: {
      id: ids.apiKey(),
      storeId,
      mode: 'TEST',
      label: 'Default test key',
      tokenHash: key.tokenHash,
      displayPrefix: key.displayPrefix,
      last4: key.last4,
    },
  });

  console.log('\n✓ Seeded demo merchant');
  console.log('  ---------------------------------------------');
  console.log(`  Login email : ${DEMO_EMAIL}`);
  console.log(`  Password    : ${DEMO_PASSWORD}`);
  console.log(`  Store id     : ${storeId}`);
  console.log(`  TEST API key : ${key.token}`);
  console.log('  (Store this key now — it is not retrievable again.)');
  console.log('  ---------------------------------------------\n');
}

/** Add developer + analyst teammates to the demo org so every role is testable. */
async function seedDemoTeam() {
  const owner = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!owner) return;
  const membership = await prisma.organizationMember.findFirst({ where: { userId: owner.id }, select: { organizationId: true } });
  if (!membership) return;
  const orgId = membership.organizationId;

  const teammates: { email: string; name: string; role: 'DEVELOPER' | 'ANALYST' }[] = [
    { email: 'dev@demo.paykh.dev', name: 'Demo Developer', role: 'DEVELOPER' },
    { email: 'analyst@demo.paykh.dev', name: 'Demo Analyst', role: 'ANALYST' },
  ];
  for (const t of teammates) {
    const existing = await prisma.user.findUnique({ where: { email: t.email } });
    if (existing) { console.log(`• ${t.role} already exists (${t.email}) — skipping`); continue; }
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const user = await prisma.user.create({ data: { email: t.email, passwordHash, name: t.name, emailVerifiedAt: new Date() } });
    await prisma.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: t.role } });
    console.log(`✓ Seeded ${t.role}: ${t.email} / ${DEMO_PASSWORD}`);
  }
}

async function seedPlatformAdmin() {
  const email = 'admin@paykh.dev';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`• Platform admin already exists (${email}) — skipping`);
    return;
  }
  const passwordHash = await hashPassword('AdminPassword123!');
  await prisma.user.create({
    data: { email, passwordHash, name: 'Platform Admin', isPlatformAdmin: true, emailVerifiedAt: new Date() },
  });
  console.log('\n✓ Seeded platform admin');
  console.log('  ---------------------------------------------');
  console.log(`  Admin email : ${email}`);
  console.log('  Password    : AdminPassword123!');
  console.log('  ---------------------------------------------\n');
}

async function main() {
  await seedPlans();
  await seedDemoMerchant();
  await seedDemoTeam();
  await seedPlatformAdmin();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
