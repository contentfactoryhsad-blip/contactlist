"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ErrorModal from "@/components/ErrorModal";

type AirtableRecord<T> = { id: string; fields: T };

type RequestFields = {
  RequestType?: string;
  Region?: string;
  Subsidiary?: string;
  Branch?: string;
  Name?: string;
  Position?: string;
  RR?: string;
  RequesterEmail?: string;
  AirtableAccess?: string;
  CurrentAccess?: string;
  RequestedAccess?: string;
  ChangeReason?: string;
  Status?: string;
  AdminComment?: string;
  Created?: string;
};

type ActiveFields = {
  Region?: string;
  Subsidiary?: string;
  Branch?: string;
  Name?: string;
  Position?: string;
  RR?: string;
  Email?: string;
  AirtableAccess?: string;
  ActivatedAt?: string;
};

type Settings = {
  centralAdminEmail?: string;
  adminNotifyRecipients?: string;
};

type HierarchyRow = {
  Region: string;
  Subsidiary: string;
  Branch: string;
};

const statusOptions = [
  "Request Submitted",
  "Pending",
  "On Hold",
  "Completed"
];

const ADMIN_PASSWORD_KEY = "adminPassword";
const ADMIN_PASSWORD_EXPIRES_KEY = "adminPasswordExpiresAt";
const ADMIN_SESSION_MS = 24 * 60 * 60 * 1000;

export default function AdminDashboard() {
  const [requests, setRequests] = useState<AirtableRecord<RequestFields>[]>([]);
  const [activeAccess, setActiveAccess] = useState<
    AirtableRecord<ActiveFields>[]
  >([]);
  const [settings, setSettings] = useState<Settings>({});
  const [settingsOriginal, setSettingsOriginal] = useState<Settings>({});
  const [hierarchy, setHierarchy] = useState<HierarchyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(
    null
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);
  const adminPasswordRef = useRef("");
  const [editing, setEditing] = useState<
    AirtableRecord<RequestFields> | null
  >(null);
  const [editingActive, setEditingActive] =
    useState<AirtableRecord<ActiveFields> | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingActive, setSavingActive] = useState(false);
  const [sendingNotifyId, setSendingNotifyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<AirtableRecord<RequestFields> | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingActiveId, setDeletingActiveId] = useState<string | null>(null);
  const [deleteActiveTarget, setDeleteActiveTarget] =
    useState<AirtableRecord<ActiveFields> | null>(null);
  const [deleteActiveReason, setDeleteActiveReason] = useState("");
  const [deleteActiveError, setDeleteActiveError] = useState<string | null>(
    null
  );
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);
  const [requestFilters, setRequestFilters] = useState({
    region: "",
    branch: "",
    access: "",
    search: ""
  });
  const [activeFilters, setActiveFilters] = useState({
    region: "",
    branch: "",
    access: "",
    search: ""
  });

  function getStoredPassword() {
    if (typeof window === "undefined") return "";
    const stored = window.localStorage.getItem(ADMIN_PASSWORD_KEY) ?? "";
    const expiresAt = Number(
      window.localStorage.getItem(ADMIN_PASSWORD_EXPIRES_KEY) ?? "0"
    );
    if (!stored || !expiresAt || Date.now() > expiresAt) {
      window.localStorage.removeItem(ADMIN_PASSWORD_KEY);
      window.localStorage.removeItem(ADMIN_PASSWORD_EXPIRES_KEY);
      return "";
    }
    return stored;
  }

  async function loadAll(
    passwordOverride?: string,
    options?: { silent?: boolean }
  ) {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    let unauthorized = false;
    try {
      const password = passwordOverride ?? adminPasswordRef.current;
      if (!password) {
        setIsAuthed(false);
        if (!silent) {
          setLoading(false);
        }
        return;
      }
      const stored = getStoredPassword();
      if (!stored || stored !== password) {
        setIsAuthed(false);
        if (!silent) {
          setLoading(false);
        }
        return;
      }
      const headers = { "x-admin-password": password };
      const [reqRes, actRes, setRes, hierRes] = await Promise.all([
        fetch("/api/admin/requests", { headers }),
        fetch("/api/admin/active-access", { headers }),
        fetch("/api/admin/settings", { headers }),
        fetch("/api/reference/hierarchy")
      ]);

      if (!reqRes.ok) {
        if (reqRes.status === 401 || reqRes.status === 403) {
          unauthorized = true;
          throw new Error("Admin access required.");
        }
        throw new Error("Unable to load admin data. Please try again.");
      }

      const reqData = await reqRes.json();
      const actData = await actRes.json();
      const setData = await setRes.json();
      const hierData = await hierRes.json();
      setRequests(reqData.records ?? []);
      setActiveAccess(actData.records ?? []);
      setSettings(setData ?? {});
      setSettingsOriginal(setData ?? {});
      setHierarchy(hierData.rows ?? []);
      setIsAuthed(true);
    } catch (error) {
      if (unauthorized) {
        setIsAuthed(false);
      }
      setModal({
        title: "Unable to load admin data",
        message:
          error instanceof Error
            ? error.message
            : "Please confirm you are an admin."
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const stored = getStoredPassword();
    if (stored) {
      setAdminPassword(stored);
      adminPasswordRef.current = stored;
      loadAll(stored);
    } else {
      setLoading(false);
    }
    const interval = setInterval(() => loadAll(undefined, { silent: true }), 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    adminPasswordRef.current = adminPassword;
  }, [adminPassword]);

  const regionOptions = useMemo(() => {
    return Array.from(new Set(hierarchy.map((row) => row.Region))).sort();
  }, [hierarchy]);

  const subsidiaryOptions = useMemo(() => {
    if (!editing?.fields.Region) {
      return [];
    }
    return Array.from(
      new Set(
        hierarchy
          .filter((row) => row.Region === editing.fields.Region)
          .map((row) => row.Subsidiary)
      )
    ).sort();
  }, [hierarchy, editing?.fields.Region]);

  const branchOptions = useMemo(() => {
    if (!editing?.fields.Region || !editing?.fields.Subsidiary) {
      return [];
    }
    return Array.from(
      new Set(
        hierarchy
          .filter(
            (row) =>
              row.Region === editing.fields.Region &&
              row.Subsidiary === editing.fields.Subsidiary
          )
          .map((row) => row.Branch)
      )
    ).sort();
  }, [hierarchy, editing?.fields.Region, editing?.fields.Subsidiary]);

  const activeRegionOptions = useMemo(() => {
    return Array.from(
      new Set(activeAccess.map((row) => row.fields.Region).filter(Boolean))
    ).sort();
  }, [activeAccess]);

  const activeBranchOptions = useMemo(() => {
    return Array.from(
      new Set(activeAccess.map((row) => row.fields.Branch).filter(Boolean))
    ).sort();
  }, [activeAccess]);

  const activeAccessOptions = useMemo(() => {
    return Array.from(
      new Set(
        activeAccess.map((row) => row.fields.AirtableAccess).filter(Boolean)
      )
    ).sort();
  }, [activeAccess]);

  const requestRegionOptions = useMemo(() => {
    return Array.from(
      new Set(requests.map((row) => row.fields.Region).filter(Boolean))
    ).sort();
  }, [requests]);

  const requestBranchOptions = useMemo(() => {
    return Array.from(
      new Set(requests.map((row) => row.fields.Branch).filter(Boolean))
    ).sort();
  }, [requests]);

  const requestAccessOptions = useMemo(() => {
    return Array.from(
      new Set(
        requests.map((row) => row.fields.AirtableAccess).filter(Boolean)
      )
    ).sort();
  }, [requests]);

  function normalizeSearch(value: string) {
    return value.trim().toLowerCase();
  }

  function matchesSearch(value: string, query: string) {
    if (!query) return true;
    return value.toLowerCase().includes(query);
  }

  const filteredRequests = useMemo(() => {
    const search = normalizeSearch(requestFilters.search);
    return requests.filter((record) => {
      const fields = record.fields;
      if (requestFilters.region && fields.Region !== requestFilters.region) {
        return false;
      }
      if (requestFilters.branch && fields.Branch !== requestFilters.branch) {
        return false;
      }
      if (requestFilters.access && fields.AirtableAccess !== requestFilters.access) {
        return false;
      }
      const haystack = [
        fields.Region,
        fields.Subsidiary,
        fields.Branch,
        fields.Name,
        fields.Position,
        fields.RR,
        fields.RequesterEmail,
        fields.AirtableAccess,
        fields.Status,
        fields.AdminComment
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesSearch(haystack, search);
    });
  }, [requests, requestFilters]);

  const filteredActive = useMemo(() => {
    const search = normalizeSearch(activeFilters.search);
    return activeAccess.filter((record) => {
      const fields = record.fields;
      if (activeFilters.region && fields.Region !== activeFilters.region) {
        return false;
      }
      if (activeFilters.branch && fields.Branch !== activeFilters.branch) {
        return false;
      }
      if (activeFilters.access && fields.AirtableAccess !== activeFilters.access) {
        return false;
      }
      const haystack = [
        fields.Region,
        fields.Subsidiary,
        fields.Branch,
        fields.Name,
        fields.Email,
        fields.Position,
        fields.RR,
        fields.AirtableAccess
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesSearch(haystack, search);
    });
  }, [activeAccess, activeFilters]);

  function normalizeSettings(value: Settings) {
    const centralAdminEmail = (value.centralAdminEmail ?? "").trim();
    const adminNotifyRecipients = (value.adminNotifyRecipients ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    return { centralAdminEmail, adminNotifyRecipients };
  }

  async function handleSettingsSaveWithAuth(event: React.FormEvent) {
    event.preventDefault();
    const normalizedCurrent = normalizeSettings(settings);
    const normalizedOriginal = normalizeSettings(settingsOriginal);
    if (
      normalizedCurrent.centralAdminEmail ===
        normalizedOriginal.centralAdminEmail &&
      normalizedCurrent.adminNotifyRecipients ===
        normalizedOriginal.adminNotifyRecipients
    ) {
      setModal({
        title: "No changes",
        message: "There are no changes to save."
      });
      return;
    }
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": adminPassword
        },
        body: JSON.stringify(settings)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setModal({
          title: "Settings update failed",
          message: data.error ?? "Please try again."
        });
        return;
      }
      setModal({
        title: "Settings saved",
        message: "Admin settings were updated successfully."
      });
      setSettingsOriginal(settings);
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setQuotaWarning(null);
    const res = await fetch(`/api/admin/requests/${editing.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": adminPassword
      },
      body: JSON.stringify(editing.fields)
    });

    const data = await res.json();

    if (!res.ok) {
      setModal({
        title: "Update failed",
        message: data.error ?? "Please try again."
      });
      setSaving(false);
      return;
    }

    if (data.quotaExceeded) {
      setQuotaWarning(
        "This update reaches or exceeds the branch quota. Please review access limits."
      );
    }

    setEditing(null);
    setSaving(false);
    loadAll(undefined, { silent: true });
  }

  async function saveActiveEdit() {
    if (!editingActive) return;
    setSavingActive(true);
    const res = await fetch(`/api/admin/active-access/${editingActive.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": adminPassword
      },
      body: JSON.stringify(editingActive.fields)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setModal({
        title: "Update failed",
        message: data.error ?? "Please try again."
      });
      setSavingActive(false);
      return;
    }

    setEditingActive(null);
    setSavingActive(false);
    loadAll(undefined, { silent: true });
  }

  async function notifyRequester(recordId: string) {
    setSendingNotifyId(recordId);
    try {
      const res = await fetch(`/api/admin/requests/${recordId}/notify`, {
        method: "POST",
        headers: { "x-admin-password": adminPassword }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Notification failed.");
      }
      setModal({
        title: "Notification sent",
        message: "The requester has been notified."
      });
    } catch (error) {
      setModal({
        title: "Notification failed",
        message:
          error instanceof Error ? error.message : "Please try again."
      });
    } finally {
      setSendingNotifyId(null);
    }
  }

  function openDeleteModal(record: AirtableRecord<RequestFields>) {
    setDeleteTarget(record);
    setDeleteReason("");
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const reason = deleteReason.trim();
    if (!reason) {
      setDeleteError("Please enter a delete reason.");
      return;
    }

    setDeletingId(deleteTarget.id);
    try {
      const res = await fetch(`/api/admin/requests/${deleteTarget.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": adminPassword
        },
        body: JSON.stringify({ reason })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed.");
      }
      await loadAll(undefined, { silent: true });
      setDeleteTarget(null);
    } catch (error) {
      setModal({
        title: "Delete failed",
        message:
          error instanceof Error
            ? error.message
            : "Please try again."
      });
    } finally {
      setDeletingId(null);
    }
  }

  function openActiveDeleteModal(record: AirtableRecord<ActiveFields>) {
    setDeleteActiveTarget(record);
    setDeleteActiveReason("");
    setDeleteActiveError(null);
  }

  async function confirmActiveDelete() {
    if (!deleteActiveTarget) return;
    const reason = deleteActiveReason.trim();
    if (!reason) {
      setDeleteActiveError("Please enter a delete reason.");
      return;
    }

    setDeletingActiveId(deleteActiveTarget.id);
    try {
      const res = await fetch(
        `/api/admin/active-access/${deleteActiveTarget.id}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-admin-password": adminPassword
          },
          body: JSON.stringify({ reason })
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed.");
      }
      await loadAll(undefined, { silent: true });
      setDeleteActiveTarget(null);
    } catch (error) {
      setModal({
        title: "Delete failed",
        message:
          error instanceof Error
            ? error.message
            : "Please try again."
      });
    } finally {
      setDeletingActiveId(null);
    }
  }

  async function downloadExport(path: string, filename: string) {
    try {
      const res = await fetch(path, {
        headers: { "x-admin-password": adminPassword }
      });
      if (!res.ok) {
        throw new Error("Export failed.");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setModal({
        title: "Export failed",
        message: "Please check the admin password and try again."
      });
    }
  }

  if (loading) {
    return <div className="card">Loading admin dashboard...</div>;
  }

  if (!isAuthed) {
    return (
      <div className="card">
        <h2>Admin Access</h2>
        <p>Enter the admin password to access the dashboard.</p>
        <div className="grid">
          <input
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            placeholder="Admin password"
          />
          <button
            className="primary"
            onClick={() => {
              const expiresAt = Date.now() + ADMIN_SESSION_MS;
              window.localStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);
              window.localStorage.setItem(
                ADMIN_PASSWORD_EXPIRES_KEY,
                String(expiresAt)
              );
              loadAll(adminPassword);
            }}
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Central Admin Settings</h2>
        <form onSubmit={handleSettingsSaveWithAuth} className="grid">
          <div>
            <label>Central Admin Email (sender)</label>
            <input
              value={settings.centralAdminEmail ?? ""}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  centralAdminEmail: event.target.value
                })
              }
              required
            />
          </div>
          <div>
            <label>Admin Notify Recipients (one per line)</label>
            <textarea
              value={settings.adminNotifyRecipients ?? ""}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  adminNotifyRecipients: event.target.value
                })
              }
            />
          </div>
          <button className="primary" type="submit">
            {savingSettings ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="grid" style={{ gridTemplateColumns: "1fr auto" }}>
          <h2>Requests</h2>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              className="secondary btn-sm"
              onClick={() =>
                downloadExport("/api/admin/export/requests.xlsx", "Requests.xlsx")
              }
            >
              Export Requests
            </button>
            <button
              className="secondary btn-sm"
              onClick={() => loadAll(undefined, { silent: true })}
            >
              Refresh Now
            </button>
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 2fr" }}>
          <div>
            <label>Region</label>
            <select
              value={requestFilters.region}
              onChange={(event) =>
                setRequestFilters({ ...requestFilters, region: event.target.value })
              }
            >
              <option value="">All</option>
              {requestRegionOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Branch</label>
            <select
              value={requestFilters.branch}
              onChange={(event) =>
                setRequestFilters({ ...requestFilters, branch: event.target.value })
              }
            >
              <option value="">All</option>
              {requestBranchOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Access</label>
            <select
              value={requestFilters.access}
              onChange={(event) =>
                setRequestFilters({ ...requestFilters, access: event.target.value })
              }
            >
              <option value="">All</option>
              {requestAccessOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Search</label>
            <input
              value={requestFilters.search}
              onChange={(event) =>
                setRequestFilters({ ...requestFilters, search: event.target.value })
              }
              placeholder="Search name, email, branch, status..."
            />
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Region</th>
              <th>Subsidiary</th>
              <th>Branch</th>
              <th>Position</th>
              <th>R&amp;R</th>
              <th>Access</th>
              <th>Requested</th>
              <th>Status</th>
              <th>Requester</th>
              <th>Admin Comment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRequests.map((record) => (
              <tr key={record.id}>
                <td>{record.fields.RequestType ?? "New Access"}</td>
                <td>{record.fields.Region}</td>
                <td>{record.fields.Subsidiary}</td>
                <td>{record.fields.Branch}</td>
                <td>{record.fields.Position}</td>
                <td>{record.fields.RR}</td>
                <td>{record.fields.AirtableAccess}</td>
                <td>{record.fields.RequestedAccess ?? "-"}</td>
                <td>{record.fields.Status}</td>
                <td>{record.fields.RequesterEmail}</td>
                <td>{record.fields.AdminComment || "-"}</td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="secondary btn-sm"
                      onClick={() => setEditing(record)}
                    >
                      Edit
                    </button>
                    <button
                      className="secondary btn-sm"
                      onClick={() => notifyRequester(record.id)}
                      disabled={sendingNotifyId === record.id}
                    >
                      {sendingNotifyId === record.id ? "Sending..." : "Notify"}
                    </button>
                    <button
                      className="secondary btn-sm"
                      onClick={() => openDeleteModal(record)}
                      disabled={deletingId === record.id}
                    >
                      {deletingId === record.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="grid" style={{ gridTemplateColumns: "1fr auto" }}>
          <h2>Active Access</h2>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              className="secondary btn-sm"
              onClick={() =>
                downloadExport(
                  "/api/admin/export/active-access.xlsx",
                  "ActiveAccess.xlsx"
                )
              }
            >
              Export Active Access
            </button>
            <button
              className="secondary btn-sm"
              onClick={() => loadAll(undefined, { silent: true })}
            >
              Refresh Now
            </button>
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 2fr" }}>
          <div>
            <label>Region</label>
            <select
              value={activeFilters.region}
              onChange={(event) =>
                setActiveFilters({ ...activeFilters, region: event.target.value })
              }
            >
              <option value="">All</option>
              {activeRegionOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Branch</label>
            <select
              value={activeFilters.branch}
              onChange={(event) =>
                setActiveFilters({ ...activeFilters, branch: event.target.value })
              }
            >
              <option value="">All</option>
              {activeBranchOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Access</label>
            <select
              value={activeFilters.access}
              onChange={(event) =>
                setActiveFilters({ ...activeFilters, access: event.target.value })
              }
            >
              <option value="">All</option>
              {activeAccessOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Search</label>
            <input
              value={activeFilters.search}
              onChange={(event) =>
                setActiveFilters({ ...activeFilters, search: event.target.value })
              }
              placeholder="Search name, email, branch..."
            />
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Region</th>
              <th>Subsidiary</th>
              <th>Branch</th>
              <th>Access</th>
              <th>Name</th>
              <th>Email</th>
              <th>Position</th>
              <th>R&amp;R</th>
              <th>Activated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredActive.map((record) => (
              <tr key={record.id}>
                <td>{record.fields.Region}</td>
                <td>{record.fields.Subsidiary}</td>
                <td>{record.fields.Branch}</td>
                <td>{record.fields.AirtableAccess}</td>
                <td>{record.fields.Name}</td>
                <td>{record.fields.Email}</td>
                <td>{record.fields.Position}</td>
                <td>{record.fields.RR}</td>
                <td>
                  {record.fields.ActivatedAt
                    ? new Date(record.fields.ActivatedAt).toLocaleDateString()
                    : "-"}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="secondary btn-sm"
                    onClick={() => setEditingActive(record)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary btn-sm"
                    onClick={() => openActiveDeleteModal(record)}
                    disabled={deletingActiveId === record.id}
                  >
                    {deletingActiveId === record.id ? "Deleting..." : "Delete"}
                  </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Edit Request</h3>
            {quotaWarning && <div className="notice">{quotaWarning}</div>}
            <div className="grid">
              <div>
                <label>Request Type</label>
                <input
                  value={editing.fields.RequestType ?? "New Access"}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: {
                        ...editing.fields,
                        RequestType: event.target.value
                      }
                    })
                  }
                />
              </div>
              <div>
                <label>Region</label>
                <select
                  value={editing.fields.Region ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: { ...editing.fields, Region: event.target.value }
                    })
                  }
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
                <label>Subsidiary</label>
                <select
                  value={editing.fields.Subsidiary ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: {
                        ...editing.fields,
                        Subsidiary: event.target.value
                      }
                    })
                  }
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
                <label>Branch</label>
                <select
                  value={editing.fields.Branch ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: { ...editing.fields, Branch: event.target.value }
                    })
                  }
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
                <label>Name</label>
                <input
                  value={editing.fields.Name ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: { ...editing.fields, Name: event.target.value }
                    })
                  }
                />
              </div>
              <div>
                <label>Position</label>
                <input
                  value={editing.fields.Position ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: { ...editing.fields, Position: event.target.value }
                    })
                  }
                />
              </div>
              <div>
                <label>R&R</label>
                <input
                  value={editing.fields.RR ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: { ...editing.fields, RR: event.target.value }
                    })
                  }
                />
              </div>
              <div>
                <label>Requester Email</label>
                <input
                  value={editing.fields.RequesterEmail ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: {
                        ...editing.fields,
                        RequesterEmail: event.target.value
                      }
                    })
                  }
                />
              </div>
              <div>
                <label>Airtable Access</label>
                <select
                  value={editing.fields.AirtableAccess ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: {
                        ...editing.fields,
                        AirtableAccess: event.target.value
                      }
                    })
                  }
                >
                  <option value="Viewer">Viewer</option>
                  <option value="Editor">Editor</option>
                  <option value="Related mail recipient">
                    Related mail recipient
                  </option>
                </select>
              </div>
              <div>
                <label>Current Access</label>
                <input
                  value={editing.fields.CurrentAccess ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: {
                        ...editing.fields,
                        CurrentAccess: event.target.value
                      }
                    })
                  }
                />
              </div>
              <div>
                <label>Requested Access</label>
                <input
                  value={editing.fields.RequestedAccess ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: {
                        ...editing.fields,
                        RequestedAccess: event.target.value
                      }
                    })
                  }
                />
              </div>
              <div>
                <label>Status</label>
                <select
                  value={editing.fields.Status ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: { ...editing.fields, Status: event.target.value }
                    })
                  }
                >
                  {statusOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Admin Comment</label>
                <textarea
                  value={editing.fields.AdminComment ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: {
                        ...editing.fields,
                        AdminComment: event.target.value
                      }
                    })
                  }
                />
              </div>
              <div>
                <label>Change Reason</label>
                <textarea
                  value={editing.fields.ChangeReason ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      fields: {
                        ...editing.fields,
                        ChangeReason: event.target.value
                      }
                    })
                  }
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button className="primary" onClick={saveEdit} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button
                className="secondary"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {editingActive && (
        <div className="modal-backdrop" onClick={() => setEditingActive(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Edit Active Access</h3>
            <div className="grid">
              <div>
                <label>Region</label>
                <select
                  value={editingActive.fields.Region ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: {
                        ...editingActive.fields,
                        Region: event.target.value
                      }
                    })
                  }
                >
                  <option value="">Select</option>
                  {regionOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  {editingActive.fields.Region &&
                    !regionOptions.includes(editingActive.fields.Region) && (
                      <option value={editingActive.fields.Region}>
                        {editingActive.fields.Region}
                      </option>
                    )}
                </select>
              </div>
              <div>
                <label>Subsidiary</label>
                <input
                  value={editingActive.fields.Subsidiary ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: {
                        ...editingActive.fields,
                        Subsidiary: event.target.value
                      }
                    })
                  }
                />
              </div>
              <div>
                <label>Branch</label>
                <input
                  value={editingActive.fields.Branch ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: {
                        ...editingActive.fields,
                        Branch: event.target.value
                      }
                    })
                  }
                />
              </div>
              <div>
                <label>Name</label>
                <input
                  value={editingActive.fields.Name ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: { ...editingActive.fields, Name: event.target.value }
                    })
                  }
                />
              </div>
              <div>
                <label>Email</label>
                <input
                  value={editingActive.fields.Email ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: { ...editingActive.fields, Email: event.target.value }
                    })
                  }
                />
              </div>
              <div>
                <label>Position</label>
                <input
                  value={editingActive.fields.Position ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: {
                        ...editingActive.fields,
                        Position: event.target.value
                      }
                    })
                  }
                />
              </div>
              <div>
                <label>R&R</label>
                <input
                  value={editingActive.fields.RR ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: { ...editingActive.fields, RR: event.target.value }
                    })
                  }
                />
              </div>
              <div>
                <label>Access</label>
                <select
                  value={editingActive.fields.AirtableAccess ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: {
                        ...editingActive.fields,
                        AirtableAccess: event.target.value
                      }
                    })
                  }
                >
                  <option value="Viewer">Viewer</option>
                  <option value="Editor">Editor</option>
                  <option value="Related mail recipient">
                    Related mail recipient
                  </option>
                </select>
              </div>
              <div>
                <label>Activated At</label>
                <input
                  value={editingActive.fields.ActivatedAt ?? ""}
                  onChange={(event) =>
                    setEditingActive({
                      ...editingActive,
                      fields: {
                        ...editingActive.fields,
                        ActivatedAt: event.target.value
                      }
                    })
                  }
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button
                className="primary"
                onClick={saveActiveEdit}
                disabled={savingActive}
              >
                {savingActive ? "Saving..." : "Save Changes"}
              </button>
              <button
                className="secondary"
                onClick={() => setEditingActive(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <ErrorModal
          title={modal.title}
          message={modal.message}
          onClose={() => setModal(null)}
        />
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Delete Request</h3>
            <p>
              This will move the request to the DeletedRequests log and notify the
              requester and admins.
            </p>
            <div className="grid">
              <div>
                <label>Requester</label>
                <div>{deleteTarget.fields.RequesterEmail ?? "-"}</div>
              </div>
              <div>
                <label>Branch</label>
                <div>{deleteTarget.fields.Branch ?? "-"}</div>
              </div>
              <div>
                <label>Access</label>
                <div>{deleteTarget.fields.AirtableAccess ?? "-"}</div>
              </div>
              <div>
                <label>Delete Reason</label>
                <textarea
                  value={deleteReason}
                  onChange={(event) => {
                    setDeleteReason(event.target.value);
                    if (deleteError) setDeleteError(null);
                  }}
                  placeholder="Reason for deleting this request"
                  required
                />
                {deleteError && (
                  <div style={{ color: "var(--danger, #b00020)" }}>
                    {deleteError}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button
                className="primary"
                onClick={confirmDelete}
                disabled={deletingId === deleteTarget.id}
              >
                {deletingId === deleteTarget.id ? "Deleting..." : "Confirm Delete"}
              </button>
              <button
                className="secondary"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteActiveTarget && (
        <div
          className="modal-backdrop"
          onClick={() => setDeleteActiveTarget(null)}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Delete Active Access</h3>
            <p>
              This will move the active access record to the DeletedActiveAccess
              log.
            </p>
            <div className="grid">
              <div>
                <label>Name</label>
                <div>{deleteActiveTarget.fields.Name ?? "-"}</div>
              </div>
              <div>
                <label>Email</label>
                <div>{deleteActiveTarget.fields.Email ?? "-"}</div>
              </div>
              <div>
                <label>Branch</label>
                <div>{deleteActiveTarget.fields.Branch ?? "-"}</div>
              </div>
              <div>
                <label>Access</label>
                <div>{deleteActiveTarget.fields.AirtableAccess ?? "-"}</div>
              </div>
              <div>
                <label>Delete Reason</label>
                <textarea
                  value={deleteActiveReason}
                  onChange={(event) => {
                    setDeleteActiveReason(event.target.value);
                    if (deleteActiveError) setDeleteActiveError(null);
                  }}
                  placeholder="Reason for deleting this active access"
                  required
                />
                {deleteActiveError && (
                  <div style={{ color: "var(--danger, #b00020)" }}>
                    {deleteActiveError}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button
                className="primary"
                onClick={confirmActiveDelete}
                disabled={deletingActiveId === deleteActiveTarget.id}
              >
                {deletingActiveId === deleteActiveTarget.id
                  ? "Deleting..."
                  : "Confirm Delete"}
              </button>
              <button
                className="secondary"
                onClick={() => setDeleteActiveTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
