import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Example: Create test user (optional - remove in production)
  // const testUser = await prisma.user.upsert({
  //   where: { telegramId: BigInt(123456789) },
  //   update: {},
  //   create: {
  //     telegramId: BigInt(123456789),
  //     username: 'test_user',
  //     lastActive: new Date(),
  //   },
  // });
  // console.log('Created test user:', testUser);

  console.log('Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
