import MyRequests from "@/components/MyRequests";

export default function MyRequestsPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">My Requests</h1>
        <p className="page-subtitle">
          Enter your email to track submitted requests with status and admin comments.
        </p>
      </div>
      <MyRequests />
    </div>
  );
}
