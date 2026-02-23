"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ErrorModal from "@/components/ErrorModal";

export const dynamic = "force-dynamic";

function SiteLoginContent() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const nextUrl = useMemo(() => {
    const next = searchParams.get("next");
    if (!next || next.startsWith("http")) return "/";
    return next;
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/site-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = data?.error ?? "Login failed. Please try again.";
        setError(message);
        setShowErrorModal(true);
        return;
      }

      window.location.href = nextUrl;
    } catch (err) {
      setError("Network error. Please try again.");
      setShowErrorModal(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card card">
        <div className="login-brand">
          <img
            className="login-logo"
            src="/lg-logo-full.png"
            alt="LG logo"
          />
          <div className="login-brand-text">
            <div className="login-brand-title">Creative Hub</div>
            <div className="login-brand-subtitle">
              Airtable Access Request
            </div>
          </div>
        </div>
        <div className="login-header">
          <div className="login-title">Portal Access</div>
          <div className="login-subtitle">
            Enter the portal password to continue.
          </div>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="site-password">Password</label>
          <div className="password-field">
            <input
              id="site-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M2.1 12a11.2 11.2 0 0 1 3.4-4.2l-1.5-1.5 1.4-1.4 16.6 16.6-1.4 1.4-2.7-2.7a11 11 0 0 1-5.9 1.8c-4.5 0-8.4-2.6-10.4-6.1Zm9.9 4.9c1.5 0 2.9-.4 4.1-1l-1.7-1.7a3.5 3.5 0 0 1-4.6-4.6L8 7.8a8.9 8.9 0 0 0-3.5 4.2 9.9 9.9 0 0 0 7.5 4.9Zm8.3-2.8-2.2-2.2a8.9 8.9 0 0 0-12.5-12.5l2.2 2.2a8.9 8.9 0 0 1 12.5 12.5Zm-6.1-1.1-3.6-3.6a3.5 3.5 0 0 1 3.6 3.6Z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 5c4.6 0 8.6 2.7 10.6 6.6-2 4-6 6.4-10.6 6.4S3.4 15.6 1.4 11.6C3.4 7.7 7.4 5 12 5Zm0 2c-3.4 0-6.5 1.9-8.2 4.6 1.7 2.7 4.8 4.4 8.2 4.4s6.5-1.7 8.2-4.4C18.5 8.9 15.4 7 12 7Zm0 2.2a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Zm0 2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z"
                    fill="currentColor"
                  />
                </svg>
              )}
            </button>
          </div>
          {error ? <p className="login-error">{error}</p> : null}
          <button className="primary" type="submit" disabled={loading}>
            {loading ? "Checking..." : "Enter Portal"}
          </button>
        </form>
      </div>
      {showErrorModal && error ? (
        <ErrorModal
          title="Login failed"
          message={error}
          onClose={() => setShowErrorModal(false)}
        />
      ) : null}
    </div>
  );
}

export default function SiteLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-shell">
          <div className="login-card card">
            <div className="login-header">
              <div className="login-title">Loading...</div>
            </div>
          </div>
        </div>
      }
    >
      <SiteLoginContent />
    </Suspense>
  );
}
