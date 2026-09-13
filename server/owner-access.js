// Only the server-authenticated identity can receive this exemption.
export function hasPermanentOwnerAccess(req) {
  return req.isAuthenticatedUser === true &&
    req.user?.id === req.userId &&
    String(req.user?.email || '').trim().toLowerCase() === 'johnmichaelkuczynski@gmail.com';
}

export function permanentOwnerState() {
  return {
    authenticated: true, owner: true, paid: true, tier: 'highest',
    subscriptionStatus: 'owner', unlimitedCredits: true,
    credits: null, used: 0, limit: null, remaining: null,
    expiresAt: null, stripeCustomerId: null, stripeSubscriptionId: null
  };
}