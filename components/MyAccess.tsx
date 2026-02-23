"use client";

import { useEffect, useMemo, useState } from "react";
import ErrorModal from "@/components/ErrorModal";

type AccessRecord = {
  id: string;
  fields: {
    Region?: string;
    Subsidiary?: string;
    Branch?: string;
    Name?: string;
    Email?: string;
    Position?: string;
    RR?: string;
    AirtableAccess?: string;
    ActivatedAt?: string;
  };
};

type ApiError = {
  error: string;
  code?: string;
  contactEmail?: string;
  attemptsLeft?: number;
};

const accessOptions = ["Viewer", "Editor", "Related mail recipient"] as const;
const OTP_TTL_SECONDS = 150;

export default function MyAccess() {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<AccessRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<AccessRecord | null>(null);
  const [position, setPosition] = useState("");
  const [rr, setRr] = useState("");
  const [access, setAccess] = useState<
    (typeof accessOptions)[number] | ""
  >("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(
    null
  );
  const [contactEmail, setContactEmail] = useState("");

  useEffect(() => {
    async function loadContact() {
      try {
        const res = await fetch("/api/public/settings");
        if (!res.ok) return;
        const data = await res.json();
        setContactEmail(data.centralAdminEmail ?? "");
      } catch {
        // ignore
      }
    }
    loadContact();
  }, []);

  useEffect(() => {
    if (!otpExpiresAt) {
      setTimeLeft(0);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, otpExpiresAt - Date.now());
      setTimeLeft(Math.floor(remaining / 1000));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [otpExpiresAt]);

  const canResend = otpSent && timeLeft === 0;

  const formattedTimeLeft = useMemo(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, [timeLeft]);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      setModal({
        title: "Enter a search term",
        message: "Please enter a name or email address."
      });
      return;
    }
    setLoading(true);
    setSuccess(null);
    setSelected(null);
    setSearched(false);
    try {
      const res = await fetch(
        `/api/me/access?query=${encodeURIComponent(query.trim())}`
      );
      if (!res.ok) {
        const data: ApiError = await res.json().catch(() => ({
          error: "Search failed."
        }));
        setModal({
          title: "Search failed",
          message: data.error ?? "Please try again."
        });
        setRecords([]);
        return;
      }
      const data = await res.json();
      setRecords(data.records ?? []);
      setSearched(true);
    } catch (error) {
      setModal({
        title: "Search failed",
        message: "Please try again."
      });
    } finally {
      setLoading(false);
    }
  }

  function startEdit(record: AccessRecord) {
    setSelected(record);
    setPosition(record.fields.Position ?? "");
    setRr(record.fields.RR ?? "");
    setAccess(
      (record.fields.AirtableAccess as (typeof accessOptions)[number]) ?? ""
    );
    setOtpSent(false);
    setOtpCode("");
    setOtpExpiresAt(null);
    setSuccess(null);
  }

  async function requestOtp() {
    if (!selected) return;
    setSendingOtp(true);
    setSuccess(null);
    try {
      const res = await fetch("/api/me/access/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: selected.id })
      });
      if (!res.ok) {
        const data: ApiError = await res.json().catch(() => ({
          error: "Failed to send verification code."
        }));
        throw new Error(data.error ?? "Failed to send verification code.");
      }
      const data = await res.json();
      setOtpSent(true);
      setOtpCode("");
      setOtpExpiresAt(Date.now() + (data.ttlSeconds ?? OTP_TTL_SECONDS) * 1000);
      setSuccess(
        `A verification code was sent to ${selected.fields.Email ?? "your email"}.`
      );
    } catch (error) {
      setModal({
        title: "Unable to send code",
        message:
          error instanceof Error ? error.message : "Please try again."
      });
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyAndSave() {
    if (!selected) return;
    if (otpCode.trim().length !== 6) {
      setModal({
        title: "Invalid code",
        message: "Please enter the 6-digit verification code."
      });
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch("/api/me/access/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: selected.id,
          code: otpCode.trim(),
          position,
          rr,
          access
        })
      });
      if (!res.ok) {
        const data: ApiError = await res.json().catch(() => ({
          error: "Verification failed."
        }));
        const attempts =
          data.attemptsLeft !== undefined
            ? ` Attempts left: ${data.attemptsLeft}.`
            : "";
        throw new Error(`${data.error ?? "Verification failed."}${attempts}`);
      }
      const data = await res.json();
      setSuccess("Your access details were updated successfully.");
      setOtpSent(false);
      setOtpCode("");
      setOtpExpiresAt(null);
      if (data.record) {
        const updated = data.record as AccessRecord;
        setSelected(updated);
        setRecords((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item))
        );
      }
    } catch (error) {
      setModal({
        title: "Update failed",
        message:
          error instanceof Error ? error.message : "Please try again."
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="card">
      <form onSubmit={handleSearch} className="grid" style={{ gap: 12 }}>
        <div className="grid" style={{ gridTemplateColumns: "1fr auto" }}>
          <div>
            <label>Search by name or email</label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter name or email"
            />
          </div>
          <button className="secondary" type="submit" disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      {contactEmail && (
        <div className="notice" style={{ marginTop: 16 }}>
          If the access owner has left the company, please inform the admin team
          at <strong>{contactEmail}</strong>.
        </div>
      )}

      {searched && records.length === 0 && (
        <p style={{ marginTop: 16 }}>No access records found.</p>
      )}

      {records.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Region</th>
                <th>Branch</th>
                <th>Name</th>
                <th>Email</th>
                <th>Access</th>
                <th>Position</th>
                <th>R&amp;R</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.fields.Region}</td>
                  <td>{record.fields.Branch}</td>
                  <td>{record.fields.Name}</td>
                  <td>{record.fields.Email}</td>
                  <td>{record.fields.AirtableAccess}</td>
                  <td>{record.fields.Position}</td>
                  <td>{record.fields.RR}</td>
                  <td>
                    <button
                      className="secondary btn-sm"
                      onClick={() => startEdit(record)}
                      type="button"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="card" style={{ marginTop: 24 }}>
          <h3>Request Updates</h3>
          <div className="grid grid-2">
            <div>
              <label>Name</label>
              <input value={selected.fields.Name ?? ""} disabled />
            </div>
            <div>
              <label>Email</label>
              <input value={selected.fields.Email ?? ""} disabled />
            </div>
            <div>
              <label>Position</label>
              <input
                value={position}
                onChange={(event) => setPosition(event.target.value)}
              />
            </div>
            <div>
              <label>R&amp;R</label>
              <input value={rr} onChange={(event) => setRr(event.target.value)} />
            </div>
            <div>
              <label>Airtable Access</label>
              <select
                value={access}
                onChange={(event) =>
                  setAccess(
                    event.target.value as (typeof accessOptions)[number]
                  )
                }
              >
                <option value="">Select</option>
                {accessOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              className="primary"
              type="button"
              onClick={requestOtp}
              disabled={sendingOtp}
            >
              {sendingOtp ? "Sending..." : "Send Verification Code"}
            </button>
            {otpSent && timeLeft > 0 && (
              <span style={{ alignSelf: "center", color: "var(--ink-2)" }}>
                Code expires in {formattedTimeLeft}
              </span>
            )}
            {canResend && (
              <button
                className="secondary"
                type="button"
                onClick={requestOtp}
              >
                Resend Code
              </button>
            )}
          </div>

          {otpSent && (
            <div className="grid" style={{ marginTop: 16 }}>
              <div>
                <label>Verification Code</label>
                <input
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value)}
                  placeholder="6-digit code"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <button
                className="primary"
                type="button"
                onClick={verifyAndSave}
                disabled={verifying}
              >
                {verifying ? "Verifying..." : "Verify & Save"}
              </button>
            </div>
          )}

          {success && <div className="notice" style={{ marginTop: 16 }}>{success}</div>}
        </div>
      )}

      {modal && (
        <ErrorModal
          title={modal.title}
          message={modal.message}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
