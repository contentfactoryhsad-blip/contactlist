import Link from "next/link";

export default function HomePage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">LGE Creative Hub</h1>
        <p className="page-subtitle">
          Submit and track Airtable access requests across regions, subsidiaries,
          and branches.
        </p>
      </div>

      <div className="grid grid-2">
        <div className="card home-card">
          <h2>New Request</h2>
          <p>Submit a new access request with all mandatory details.</p>
          <Link href="/request">
            <button className="primary">Start Request</button>
          </Link>
        </div>
        <div className="card home-card">
          <h2>Access Review</h2>
          <p>Review your access details and submit verified updates.</p>
          <Link href="/my-access">
            <button className="secondary">Start Review</button>
          </Link>
        </div>
        <div className="card home-card">
          <h2>My Requests</h2>
          <p>See your submitted requests, current status, and admin comments.</p>
          <Link href="/my-requests">
            <button className="secondary">View My Requests</button>
          </Link>
        </div>
        <div className="card home-card">
          <h2>Admin Dashboard</h2>
          <p>Review, edit, and export requests and active access lists.</p>
          <Link href="/admin">
            <button className="secondary">Open Admin</button>
          </Link>
        </div>
      </div>
    </div>
  );
}
