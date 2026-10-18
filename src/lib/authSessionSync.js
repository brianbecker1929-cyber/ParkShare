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

  const handle = (event, session) => {
    if (!active) return;
    if (event === "PASSWORD_RECOVERY") onRecovery();
    if (event === "SIGNED_OUT" || !session?.user?.id) {
      generation++;
      onUser(null, event);
      return;
    }
    if (!["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) return;

    const turn = ++generation;
    // Intentionally NOT awaited in the auth event callback.
    defer(async () => {
      if (!active || generation !== turn) return;
      try {
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (!active || generation !== turn) return;
        const currentSession = sessionData?.session;
        if (sessionError || !currentSession?.user?.id || currentSession.user.id !== session.user.id) {
          onUser(null, "SESSION_CHANGED");
          return;
        }
        const { data: profile, error } = await client
          .from("profiles")
          .select("id, name, role")
          .eq("id", currentSession.user.id)
          .single();
        if (!active || generation !== turn) return;
        if (error || !profile) {
          onUser(null, "PROFILE_UNAVAILABLE");
          onProfileUnavailable();
          return;
        }
        onUser(buildUser(profile, currentSession.user), event);
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
