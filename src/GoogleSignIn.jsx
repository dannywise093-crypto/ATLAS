import React, { useEffect, useRef, useState } from "react";

const GOOGLE_CLIENT_ID = "170041686354-of35b5ml5hd40h5tjqpotki075ps820e.apps.googleusercontent.com";
const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

export default function GoogleSignIn({ children }) {
  const buttonRef = useRef(null);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Checking your ATLAS session…");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.user) throw new Error("No active session");
        return data.user;
      })
      .then((account) => {
        if (active) { setUser(account); setStatus("Signed in"); }
      })
      .catch(() => {
        if (active) { setUser(null); setStatus("Sign in with Google to continue."); }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading || user || !buttonRef.current) return;
    let active = true;
    const render = () => {
      if (!active || !window.google?.accounts?.id || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response?.credential) return;
          setBusy(true);
          setStatus("Verifying your Google account…");
          try {
            const result = await fetch("/api/auth/google", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential })
            });
            const data = await result.json().catch(() => ({}));
            if (!result.ok || !data.user) throw new Error(data.error || "Google sign-in failed.");
            if (active) { setUser(data.user); setStatus("Signed in"); }
          } catch (error) {
            if (active) setStatus(error.message || "Google sign-in failed");
          } finally {
            if (active) setBusy(false);
          }
        }
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "filled_black", size: "large", shape: "pill",
        text: "continue_with", width: 260
      });
    };
    if (window.google?.accounts?.id) render();
    else {
      let script = document.querySelector('script[src="' + GOOGLE_SCRIPT + '"]');
      if (!script) {
        script = document.createElement("script");
        script.src = GOOGLE_SCRIPT;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
      script.addEventListener("error", () => {
        if (active) setStatus("Google sign-in could not load. Check your connection and retry.");
      });
    }
    return () => { active = false; };
  }, [loading, user]);

  async function signOut() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST", credentials: "same-origin"
      });
      if (!response.ok) throw new Error("Sign-out request failed.");
      window.google?.accounts?.id?.disableAutoSelect();
      setUser(null);
      setStatus("You have signed out.");
    } catch {
      setStatus("Could not sign out. Please retry.");
    } finally { setBusy(false); }
  }

  if (loading) {
    return <main className="atlas-login-screen"><div className="atlas-login-card"><div className="atlas-login-mark">A</div><h1>ATLAS AI</h1><p>Checking your secure session…</p></div></main>;
  }

  if (!user) {
    return <main className="atlas-login-screen">
      <section className="atlas-login-card" aria-labelledby="atlas-login-title">
        <div className="atlas-login-mark">A</div>
        <p className="atlas-login-eyebrow">PRIVATE AI WORKSPACE</p>
        <h1 id="atlas-login-title">Welcome to ATLAS</h1>
        <p className="atlas-login-copy">Sign in with your Google account to access your ATLAS workspace.</p>
        <div className="atlas-login-google" ref={buttonRef} />
        <p className="atlas-login-status" role="status" aria-live="polite">{busy ? "Verifying your account…" : status}</p>
        <small>Your account is verified before the workspace is opened.</small>
      </section>
    </main>;
  }

  return <div className="atlas-authenticated-shell">
    <div className="atlas-session-bar">
      <span>{user.name || user.email}</span>
      <button type="button" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
    </div>
    {children}
  </div>;
}
