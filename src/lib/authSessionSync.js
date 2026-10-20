// BUG-005128 / BUG-005129: keep browsing and checkout identity synchronized
// when the same Supabase account signs in/out in a different browser tab.
//
// Important: Supabase API calls from within onAuthStateChange can deadlock.
// Schedule the profile read outside the callback and invalidate stale reads
// when the user signs out or another account signs in.
export function createAuthSessionSynchronizer({
  client,
  buildUser,
  onUser,
  onRecovery = () => {},
  onProfileUnavailable = () => {},
  defer = callback => setTimeout(callback, 0),
}) {
  let generation = 0;
  let active = true;
  let accountId = null;

  const handle = (event, session) => {
    if (!active) return;
    const sessionId = session?.user?.id;
    const nextAccountId = typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
    if (event === "PASSWORD_RECOVERY") {
      // Recovery replaces the current auth context even when its account ID
      // is unchanged. Retire queued/in-flight profile reads before opening UI.
      generation++;
      accountId = nextAccountId;
      onUser(null, event);
      if (nextAccountId) onRecovery();
      return;
    }
    if (event === "SIGNED_OUT" || !nextAccountId) {
      generation++;
      accountId = null;
      onUser(null, event);
      return;
    }
    if (!["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) return;

    const turn = ++generation;
    if (accountId !== nextAccountId) {
      // Remove the previous account before waiting for the new profile.
      // Same-account refreshes keep their current UI while rehydrating.
      accountId = nextAccountId;
      onUser(null, "ACCOUNT_CHANGED");
    }
    // Intentionally NOT awaited in the auth event callback.
    defer(async () => {
      if (!active || generation !== turn) return;
      try {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (!active || generation !== turn) return;
        const currentSession = sessionData?.session;
        if (sessionError || currentSession?.user?.id !== nextAccountId) {
          onUser(null, "SESSION_CHANGED");
          return;
        }
        const { data: profile, error } = await client
          .from("profiles")
          .select("id, name, role")
          .eq("id", currentSession.user.id)
          .single();
        if (!active || generation !== turn) return;
        if (error || profile?.id !== nextAccountId || !["driver", "host"].includes(profile.role)) {
          onUser(null, "PROFILE_UNAVAILABLE");
          onProfileUnavailable();
          return;
        }
        // Storage can change while the profile request is pending, before
        // its auth notification reaches this tab. Recheck before publishing
        // and use the latest same-account metadata (e.g. saved vehicles).
        const { data: latestData, error: latestError } = await client.auth.getSession();
        if (!active || generation !== turn) return;
        const latestSession = latestData?.session;
        if (latestError || latestSession?.user?.id !== nextAccountId) {
          onUser(null, "SESSION_CHANGED");
          return;
        }
        onUser(buildUser(profile, latestSession.user), event);
      } catch {
        if (!active || generation !== turn) return;
        onUser(null, "PROFILE_UNAVAILABLE");
        onProfileUnavailable();
      }
    });
  };

  const { data: listener } = client.auth.onAuthStateChange(handle);
  return () => {
    active = false;
    generation++;
    listener?.subscription?.unsubscribe();
  };
}
