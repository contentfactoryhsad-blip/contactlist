"use client";

export default function ErrorModal({
  title,
  message,
  onClose
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
