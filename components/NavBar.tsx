"use client";

import Link from "next/link";

export default function NavBar() {
  return (
    <nav className="nav">
      <div className="nav-brand">
        <img className="brand-logo-full" src="/lg-logo-full.png" alt="LG logo" />
        <div className="brand-text">
          <div className="brand-title">Creative Hub</div>
          <div className="brand-subtitle">Airtable Access Request</div>
        </div>
      </div>
      <div className="nav-links nav-links-row">
        <Link href="/">Home</Link>
        <Link href="/request">New Request</Link>
        <Link href="/my-access">Access Review</Link>
        <Link href="/my-requests">My Requests</Link>
        <Link href="/admin">Admin</Link>
      </div>
    </nav>
  );
}
