import MyAccess from "@/components/MyAccess";

export default function MyAccessPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Access Review</h1>
        <p className="page-subtitle">
          Search your name or email to review and update your access details.
        </p>
      </div>
      <MyAccess />
    </div>
  );
}
