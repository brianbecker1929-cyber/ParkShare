import React, {useEffect, useRef, useState} from "react";

// A Driver remains a Driver. Creating or signing in to a separate Host
// account is an explicit user action, never a browser-side role update.
export default function HostOnboarding({accountId, auth, onClose, onReady}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owner = useRef({active: true, changed: false, pending: false});
  const panel = useRef(null);
  useEffect(() => {
    const context = owner.current;
    context.active = true;
    const previous = document.activeElement;
    panel.current?.focus();
    const {data} = auth.onAuthStateChange((event, session) => {
      if (!context.active) return;
      if (event === "PASSWORD_RECOVERY" || session?.user?.id && session.user.id !== accountId || event === "SIGNED_OUT" && !context.pending) {
        context.changed = true;
        setError("Your session changed. Close this dialog and try again.");
      }
    });
    return () => {
      context.active = false;
      data?.subscription?.unsubscribe();
      if (previous?.isConnected) previous.focus();
    };
  }, [accountId, auth]);
  const close = () => {
    if (owner.current.pending) return;
    owner.current.active = false;
    onClose();
  };
  const proceed = async screen => {
    const context = owner.current;
    const current = () => context.active && !context.changed && owner.current === context;
    if (!current() || context.pending) return;
    context.pending = true;
    setBusy(true); setError("");
    try {
      const before = await auth.getSession();
      if (!current()) return;
      if (before.error || before.data?.session?.user?.id !== accountId) throw new Error("Your session changed. Close this dialog and try again.");
      const result = await auth.signOut({scope: "local"});
      if (!current()) return;
      if (result.error) throw new Error("We couldn't sign you out. Please try again.");
      const after = await auth.getSession();
      if (!current()) return;
      if (after.error || after.data?.session) throw new Error("We couldn't confirm sign-out. Close this dialog and try again.");
      context.active = false;
      onReady(screen);
    } catch (failure) {
      if (current()) setError(failure.message || "Unable to continue. Please try again.");
    } finally {
      context.pending = false;
      if (context.active) setBusy(false);
    }
  };
  const button = {padding: "12px 16px", borderRadius: 10, border: "1px solid #CBD1D8", font: "inherit", cursor: busy ? "default" : "pointer", whiteSpace: "normal"};
  return <div style={{position: "fixed", inset: 0, zIndex: 3000, background: "rgba(14,27,46,.6)", display: "grid", placeItems: "center", padding: 20}} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const controls = [...panel.current.querySelectorAll("button:not(:disabled)")];
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    }
  }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ps-host-onboarding-title" aria-describedby="ps-host-onboarding-description" style={{background: "white", color: "#0E1B2E", borderRadius: 20, padding: 24, width: "100%", maxWidth: 440, maxHeight: "90dvh", overflowY: "auto", fontFamily: "'Poppins', sans-serif", boxSizing: "border-box"}}>
      <h2 id="ps-host-onboarding-title" style={{marginTop: 0}}>Start hosting on ParkShare</h2>
      <p id="ps-host-onboarding-description">You're signed in as a Driver. To list your space, create a separate Host account using a different email address, or sign in to an existing Host account.</p>
      <p>Your Driver account and bookings will stay available when you sign back in. Continuing will sign you out of this browser session.</p>
      {error && <p role="alert">{error}</p>}
      <div style={{display: "flex", flexDirection: "column", gap: 12}}>
        <button type="button" disabled={busy || owner.current.changed} style={{...button, background: "#FFC107", fontWeight: 700}} onClick={() => proceed("signup")}>{busy ? "Signing out…" : "Sign out & create Host account"}</button>
        <button type="button" disabled={busy || owner.current.changed} style={{...button, background: "white"}} onClick={() => proceed("signin")}>Sign out & sign in as Host</button>
        <button type="button" disabled={busy} style={{...button, background: "white"}} onClick={close}>Stay on this page</button>
      </div>
    </section>
  </div>;
}
