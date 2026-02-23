"use client";

import { useEffect, useState } from "react";

type RequestRecord = {
  id: string;
  createdDateTime?: string;
  fields: {
    RequestType?: string;
    Region?: string;
    Subsidiary?: string;
    Branch?: string;
    AirtableAccess?: string;
    RequestedAccess?: string;
    Status?: string;
    AdminComment?: string;
  };
};

export default function MyRequests() {
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      if (!email) {
        setRecords([]);
        setLoading(false);
        return;
      }
      const res = await fetch(`/api/me/requests?email=${encodeURIComponent(email)}`);
      if (!res.ok) {
        setRecords([]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setRecords(data.records ?? []);
      setLoading(false);
    }
    load();
  }, [email]);

  return (
    <div className="card">
      <div className="grid" style={{ gridTemplateColumns: "1fr auto" }}>
        <div>
          <label>Requester Email</label>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            type="email"
          />
        </div>
      </div>
      {loading ? (
        <p>Loading your requests...</p>
      ) : !email ? (
        <p>Enter your email to see your requests.</p>
      ) : records.length === 0 ? (
        <p>No requests found.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Branch</th>
              <th>Access</th>
              <th>Requested</th>
              <th>Status</th>
              <th>Admin Comment</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.fields.RequestType ?? "New Access"}</td>
                <td>{record.fields.Branch}</td>
                <td>{record.fields.AirtableAccess}</td>
                <td>{record.fields.RequestedAccess ?? "-"}</td>
                <td>{record.fields.Status}</td>
                <td>{record.fields.AdminComment || "-"}</td>
                <td>
                  {record.createdDateTime
                    ? new Date(record.createdDateTime).toLocaleString()
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
