"use client";

import { useEffect, useMemo, useState } from "react";
import ErrorModal from "@/components/ErrorModal";

type HierarchyRow = {
  Region: string;
  Subsidiary: string;
  Branch: string;
};

type ApiError = {
  error: string;
  code?: string;
  contactEmail?: string;
};

const accessOptions = ["Viewer", "Editor"] as const;

export default function RequestForm() {
  const [hierarchy, setHierarchy] = useState<HierarchyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState("");
  const [subsidiary, setSubsidiary] = useState("");
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [rr, setRr] = useState("");
  const [access, setAccess] = useState<(typeof accessOptions)[number] | "">("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(
    null
  );

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/reference/hierarchy");
        const data = await res.json();
        setHierarchy(data.rows ?? []);
      } catch (error) {
        setModal({
          title: "Unable to load reference data",
          message: "Please refresh the page or contact the admin team."
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const regionOptions = useMemo(() => {
    return Array.from(new Set(hierarchy.map((row) => row.Region))).sort();
  }, [hierarchy]);

  const subsidiaryOptions = useMemo(() => {
    return Array.from(
      new Set(
        hierarchy
          .filter((row) => row.Region === region)
          .map((row) => row.Subsidiary)
      )
    ).sort();
  }, [hierarchy, region]);

  const branchOptions = useMemo(() => {
    return Array.from(
      new Set(
        hierarchy
          .filter(
            (row) => row.Region === region && row.Subsidiary === subsidiary
          )
          .map((row) => row.Branch)
      )
    ).sort();
  }, [hierarchy, region, subsidiary]);

  useEffect(() => {
    if (!subsidiaryOptions.includes(subsidiary)) {
      setSubsidiary("");
    }
  }, [subsidiaryOptions, subsidiary]);

  useEffect(() => {
    if (!branchOptions.includes(branch)) {
      setBranch("");
    }
  }, [branchOptions, branch]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSuccess(null);

    if (
      !region ||
      !subsidiary ||
      !branch ||
      !name ||
      !position ||
      !rr ||
      !access ||
      !email
    ) {
      setModal({
        title: "Missing required fields",
        message: "Please complete every required field before submitting."
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region,
          subsidiary,
          branch,
          name,
          position,
          rr,
          access,
          email
        })
      });

      if (!res.ok) {
        const err: ApiError = await res.json();
        setModal({
          title: "Request blocked",
          message: err.contactEmail
            ? `${err.error} Contact: ${err.contactEmail}`
            : err.error
        });
        return;
      }

      setSuccess("Your request has been submitted successfully.");
      setRegion("");
      setSubsidiary("");
      setBranch("");
      setName("");
      setPosition("");
      setRr("");
      setAccess("");
      setEmail("");
    } catch (error) {
      setModal({
        title: "Submission failed",
        message: "Please try again or contact the admin team."
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      {loading ? (
        <p>Loading reference data...</p>
      ) : (
        <form onSubmit={handleSubmit} className="grid">
          <div className="grid grid-2">
            <div>
              <label>Region *</label>
              <select
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                required
              >
                <option value="">Select</option>
                {regionOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Subsidiary *</label>
              <select
                value={subsidiary}
                onChange={(event) => setSubsidiary(event.target.value)}
                required
                disabled={!region}
              >
                <option value="">Select</option>
                {subsidiaryOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Branch *</label>
              <select
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                required
                disabled={!subsidiary}
              >
                <option value="">Select</option>
                {branchOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Name *</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div>
              <label>Position *</label>
              <input
                value={position}
                onChange={(event) => setPosition(event.target.value)}
                required
              />
            </div>
            <div>
              <label>R&R *</label>
              <input
                value={rr}
                onChange={(event) => setRr(event.target.value)}
                required
              />
            </div>
            <div>
              <label>Airtable Access *</label>
              <select
                value={access}
                onChange={(event) =>
                  setAccess(event.target.value as (typeof accessOptions)[number])
                }
                required
              >
                <option value="">Select</option>
                {accessOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Requester Email *</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                placeholder="name@company.com"
              />
            </div>
          </div>

          {success && <div className="notice">{success}</div>}

          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </form>
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
