import React, { useEffect, useRef, useState } from "react";

const GOOGLE_CLIENT_ID = "170041686354-of35b5ml5hd40h5tjqpotki075ps820e.apps.googleusercontent.com";
const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

export default function GoogleSignIn() {
  const buttonRef = useRef(null);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Checking account…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : { user: null })
      .then((data) => { if (active) { setUser(data.user || null); setStatus(data.user ? "Signed in" : "Not signed in"); } })
      .catch(() => { if (active) setStatus("Sign-in service unavailable"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (user || !buttonRef.current) return;
    let active = true;
    const render = () => {
      if (!active || !window.google?.accounts?.id || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response?.credential || busy) return;
          setBusy(true);
          setStatus("Verifying Google account…");
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
      window.google.accounts.id.renderButton(buttonRef.current, { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", width: 210 });
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
    }
    return () => { active = false; };
  }, [user, busy]);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      window.google?.accounts?.id?.disableAutoSelect();
      setUser(null);
      setStatus("Signed out");
    } catch {
      setStatus("Could not sign out. Please retry.");
    } finally { setBusy(false); }
  }

  return <div className="atlas-auth-control" aria-live="polite">
    {user ? <><span className="atlas-auth-user" title={user.email}>{user.name || user.email}</span><button type="button" className="atlas-auth-button" onClick={signOut} disabled={busy}>Sign out</button></> :
      <><div ref={buttonRef} className="atlas-google-button"/><span className="atlas-auth-status">{busy ? "Verifying…" : status}</span></>}
  </div>;
}
