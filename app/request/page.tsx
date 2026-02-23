import RequestForm from "@/components/RequestForm";

export default function RequestPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">New Access Request</h1>
        <p className="page-subtitle">
          Complete every required field. Submission is blocked if the branch quota
          is exceeded or a duplicate exists. Use your email to track requests.
        </p>
      </div>
      <RequestForm />
    </div>
  );
}
