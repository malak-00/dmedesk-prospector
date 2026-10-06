// Sign-in lockout rules, kept pure so they can be tested without a database.
// 5 wrong passwords in a row lock the account for 15 minutes; a good sign-in
// resets the count. Storage is app_users.failed_logins / locked_until (sql/027).

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

// Minutes still to wait, or 0 when the account may be tried.
export function lockMinutesLeft(row, now = Date.now()) {
  const until = row && row.locked_until ? Date.parse(row.locked_until) : NaN;
  if (Number.isNaN(until) || until <= now) return 0;
  return Math.max(1, Math.ceil((until - now) / 60000));
}

// What to store after a wrong password.
export function afterFailedLogin(row, now = Date.now()) {
  const failed = (Number((row && row.failed_logins) || 0)) + 1;
  if (failed >= MAX_FAILED_LOGINS) {
    return { failed_logins: 0, locked_until: new Date(now + LOCK_MINUTES * 60000).toISOString(), locked: true };
  }
  return { failed_logins: failed, locked_until: null, locked: false };
}

export function lockedMessage(minutes) {
  return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask an admin to unlock the account.`;
}
