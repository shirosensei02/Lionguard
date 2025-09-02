import React, {useState} from "react";

type Props = {
  onRedact: () => Promise<void> | void;
};

export default function RedactButton({onRedact}: Props) {
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Redact");

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    const prev = label;
    setLabel("Redacting…");
    try {
      await onRedact();
      setLabel("Redact");
    } catch (e) {
      console.error("Redaction error:", e);
      setLabel("Retry Redact");
    } finally {
      setBusy(false);
      if (label === "Redacting…") setLabel(prev || "Redact");
    }
  };

  const buttonStyle: React.CSSProperties = {
    padding: "4px 8px",
    fontSize: "12px",
    lineHeight: "1.5",
    cursor: busy ? "not-allowed" : "pointer",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    backgroundColor: busy ? "#f3f4f6" : "#f9fafb",
    color: "#374151",
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    transition: "background-color 0.15s ease-in-out",
    opacity: busy ? 0.5 : 1,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontWeight: "400",
    textAlign: "center",
    textDecoration: "none",
    verticalAlign: "middle",
    userSelect: "none",
    outline: "none",
    animation: busy ? "pii-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" : "none",
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      style={buttonStyle}
      onMouseEnter={(e) => {
        if (!busy) {
          (e.target as HTMLElement).style.backgroundColor = "#f3f4f6";
        }
      }}
      onMouseLeave={(e) => {
        if (!busy) {
          (e.target as HTMLElement).style.backgroundColor = "#f9fafb";
        }
      }}
    >
      {label}
    </button>
  );
}
