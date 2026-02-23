import AdminDashboard from "@/components/AdminDashboard";

export default function AdminPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Admin Dashboard</h1>
        <p className="page-subtitle">
          Edit requests, manage settings, and export access lists.
        </p>
      </div>
      <AdminDashboard />
    </div>
  );
}
