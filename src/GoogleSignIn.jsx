import React, { useEffect, useRef, useState } from "react";

const GOOGLE_CLIENT_ID = "170041686354-of35b5ml5hd40h5tjqpotki075ps820e.apps.googleusercontent.com";
const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

const buttonStyle = {
  border: 0, borderRadius: 999, padding: "10px 15px", cursor: "pointer",
  font: "inherit", fontWeight: 650
};

export default function GoogleSignIn({ children }) {
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);

    fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.user) throw new Error(data.error || "No active session");
        return data.user;
      })
      .then((account) => {
        if (!active) return;
        try { localStorage.setItem("atlas-user-scope", account.id); } catch {}
        setUser(account);
        setStatus("");
      })
      .catch((error) => {
        try { localStorage.removeItem("atlas-user-scope"); } catch {}
        if (active) {
          setUser(null);
          setStatus(error?.name === "AbortError"
            ? "Session check timed out. Please sign in again."
            : "Sign in with Google to continue.");
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (loading || user || !buttonRef.current) return;
    let active = true;
    let script = document.querySelector('script[src="' + GOOGLE_SCRIPT + '"]');

    const render = () => {
      if (!active || !window.google?.accounts?.id || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: false,
        callback: async (response) => {
          if (!response?.credential) return;
          setBusy(true);
          setStatus("Signing in…");
          try {
            const result = await fetch("/api/auth/google", {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential })
            });
            const data = await result.json().catch(() => ({}));
            if (!result.ok || !data.user) throw new Error(data.error || "Google sign-in failed.");
            try { localStorage.setItem("atlas-user-scope", data.user.id); } catch {}
            if (active) {
              setUser(data.user);
              setStatus("");
            }
          } catch (error) {
            if (active) setStatus(error?.message || "Google sign-in failed. Please retry.");
          } finally {
            if (active) setBusy(false);
          }
        }
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "filled_black", size: "large", shape: "pill",
        text: "continue_with", width: 280
      });
    };

    if (window.google?.accounts?.id) render();
    else {
      const created = !script;
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
      return () => {
        active = false;
        script?.removeEventListener("load", render);
        if (created && script?.parentNode) script.parentNode.removeChild(script);
      };
    }

    return () => { active = false; };
  }, [loading, user]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setMenuOpen(false);
    setStatus("Signing out…");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `Sign-out failed (HTTP ${response.status}).`);
      }
      window.google?.accounts?.id?.disableAutoSelect();
      try { localStorage.removeItem("atlas-user-scope"); } catch {}
      setUser(null);
      window.location.replace("/");
    } catch (error) {
      setStatus(error?.message || "Could not sign out. Please retry.");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="atlas-login-screen" aria-live="polite">
        <div className="atlas-login-card">
          <div className="atlas-login-mark">A</div>
          <h1>ATLAS</h1>
          <p>Checking your session…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="atlas-login-screen">
        <section className="atlas-login-card" aria-labelledby="atlas-login-title">
          <div className="atlas-login-mark">A</div>
          <p className="atlas-login-eyebrow">YOUR PERSONAL AI WORKSPACE</p>
          <h1 id="atlas-login-title">Welcome to ATLAS</h1>
          <p className="atlas-login-copy">Sign in to continue to your AI workspace.</p>
          <div className="atlas-login-google" ref={buttonRef} />
          <p className="atlas-login-status" role="status" aria-live="polite">
            {busy ? "Signing in…" : status || "Secure sign-in with Google"}
          </p>
          <small>Your workspace is private to your account.</small>
        </section>
      </main>
    );
  }

  const displayName = user.name || user.email || "ATLAS account";
  const initials = displayName.trim().split(/\\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <div className="atlas-authenticated-shell">
      <header style={{
        position: "sticky", top: 0, zIndex: 1000, display: "flex",
        justifyContent: "flex-end", alignItems: "center", padding: "10px 18px",
        background: "rgba(12, 14, 18, 0.94)", borderBottom: "1px solid rgba(255,255,255,.09)",
        backdropFilter: "blur(14px)"
      }}>
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            aria-label="Open account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            disabled={busy}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "5px 12px 5px 5px",
              border: "1px solid rgba(255,255,255,.14)", borderRadius: 999,
              background: "rgba(255,255,255,.06)", color: "#fff", cursor: "pointer"
            }}
          >
            <span style={{
              width: 34, height: 34, display: "grid", placeItems: "center",
              borderRadius: "50%", background: "#343b49", color: "#fff",
              fontWeight: 700, overflow: "hidden"
            }}>
              {user.picture
                ? <img src={user.picture} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : initials}
            </span>
            <span style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
              {displayName}
            </span>
            <span aria-hidden="true" style={{ opacity: .75, fontSize: 12 }}>▾</span>
          </button>

          {menuOpen && (
            <div role="menu" style={{
              position: "absolute", right: 0, top: "calc(100% + 10px)", width: 260,
              padding: 8, borderRadius: 16, background: "#191d25",
              border: "1px solid rgba(255,255,255,.13)",
              boxShadow: "0 16px 48px rgba(0,0,0,.45)", color: "#fff"
            }}>
              <div style={{ padding: "10px 12px 13px", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                <div style={{ fontWeight: 650, fontSize: 14 }}>{displayName}</div>
                <div style={{ opacity: .65, fontSize: 12, marginTop: 4, overflowWrap: "anywhere" }}>{user.email}</div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={signOut}
                disabled={busy}
                style={{
                  ...buttonStyle, width: "100%", marginTop: 8, textAlign: "left",
                  color: "#fff", background: "rgba(255,255,255,.08)"
                }}
              >
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </header>
      {status && <div role="status" aria-live="polite" style={{ padding: "8px 18px", color: "#f5c46a", fontSize: 13 }}>{status}</div>}
      {children}
    </div>
  );
}
