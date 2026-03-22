import { UserState, UserSession, PendingOrder } from '../types';

// Simple in-memory session storage
// TODO: Replace with Redis or database-backed session storage for production
const sessions = new Map<number, UserSession>();

export function getSession(telegramId: number): UserSession {
  let session = sessions.get(telegramId);

  if (!session) {
    session = {
      telegramId,
      state: UserState.IDLE,
      lastActivity: new Date(),
    };
    sessions.set(telegramId, session);
  }

  // Update last activity
  session.lastActivity = new Date();

  return session;
}

export function updateSession(
  telegramId: number,
  updates: Partial<UserSession>
): UserSession {
  const session = getSession(telegramId);
  Object.assign(session, updates);
  session.lastActivity = new Date();
  return session;
}

export function clearSession(telegramId: number): void {
  sessions.delete(telegramId);
}

export function resetSessionState(telegramId: number): UserSession {
  return updateSession(telegramId, {
    state: UserState.IDLE,
    pendingOrder: undefined,
    currentPair: undefined,
  });
}

// Clean up old sessions (older than 1 hour)
setInterval(() => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  for (const [telegramId, session] of sessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      sessions.delete(telegramId);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes
