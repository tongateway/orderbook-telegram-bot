import { prisma } from '../database/prisma';

export async function getOrCreateUser(telegramId: number, username?: string) {
  let user = await prisma.user.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId: BigInt(telegramId),
        username: username || null,
      },
    });
  }

  return user;
}

export async function updateUserWallet(
  userId: number,
  walletAddress: string,
  walletType: string
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      walletAddress,
      walletType,
      connectedAt: new Date(),
    },
  });
}

export async function disconnectUserWallet(userId: number) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      walletAddress: null,
      walletType: null,
      connectedAt: null,
    },
  });
}

// Session functions removed - use Telegraf's built-in session middleware instead
// Example usage:
// bot.use(session());
// ctx.session.state = 'ENTERING_AMOUNT';
// ctx.session.pendingOrder = { ... };
