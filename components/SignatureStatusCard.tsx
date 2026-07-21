"use client";

import { CheckCircle2, CircleX, Clock3, PenLine, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { formatDateTime } from "@/lib/date";
import type { InvoiceSignature } from "@/lib/types";

export function SignatureStatusCard({
  title,
  signature,
  rejectedSignature,
  loading,
  error,
  drawLabel = "Draw signature",
  onDraw,
  onRetry,
  onReject,
  canReject = false,
  drawDisabled = false
}: {
  title: string;
  signature?: InvoiceSignature;
  rejectedSignature?: InvoiceSignature;
  loading?: boolean;
  error?: string;
  drawLabel?: string;
  onDraw: () => void;
  onRetry?: () => void;
  onReject?: (reason: string) => Promise<void>;
  canReject?: boolean;
  drawDisabled?: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState<string | undefined>();

  async function reject() {
    if (!onReject || reason.trim().length < 5) return;
    setRejectBusy(true);
    setRejectError(undefined);
    try {
      await onReject(reason.trim());
      setRejecting(false);
      setReason("");
    } catch (error) {
      setRejectError(error instanceof Error ? error.message : "The signature could not be rejected.");
    } finally {
      setRejectBusy(false);
    }
  }

  const state = loading ? "loading" : error ? "failed" : signature ? "signed" : rejectedSignature ? "rejected" : "not-signed";

  return (
    <section className={`signature-status-card signature-state-${state}`}>
      <div className="signature-status-heading">
        <div className="signature-state-icon" aria-hidden="true">
          {state === "signed" ? <CheckCircle2 size={21} />
            : state === "failed" || state === "rejected" ? <CircleX size={21} />
              : state === "loading" ? <RefreshCw size={21} />
                : <Clock3 size={21} />}
        </div>
        <div>
          <p className="eyebrow">{title}</p>
          <strong>{state === "signed" ? "Signed"
            : state === "failed" ? "Signature failed"
              : state === "rejected" ? "Signature rejected"
                : state === "loading" ? "Loading signature..."
                  : "Not signed"}</strong>
          <span>
            {signature ? `${signature.signerName} · ${formatDateTime(signature.signedAt)}`
              : error ?? rejectedSignature?.rejectionReason ?? "Collect and save a signature to continue."}
          </span>
        </div>
      </div>

      {signature?.imageUrl ? <img className="saved-signature-image" src={signature.imageUrl} alt={`Saved signature from ${signature.signerName}`} /> : null}

      {rejecting ? (
        <div className="signature-reject-panel">
          <label>
            <span>Reason for rejection</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: signer asked to redraw" />
          </label>
          {rejectError ? <p className="field-error" role="alert">{rejectError}</p> : null}
          <div>
            <Button variant="secondary" onClick={() => setRejecting(false)} disabled={rejectBusy}>Cancel</Button>
            <Button variant="danger" onClick={() => void reject()} disabled={rejectBusy || reason.trim().length < 5}>
              {rejectBusy ? "Rejecting..." : "Reject signature"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="signature-status-actions">
          {state === "failed" && onRetry ? <Button variant="secondary" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> Retry</Button> : null}
          <Button onClick={onDraw} disabled={loading || drawDisabled}><PenLine size={16} aria-hidden="true" /> {signature ? "Replace signature" : drawLabel}</Button>
          {signature && canReject && onReject ? (
            <Button variant="secondary" onClick={() => setRejecting(true)}><ShieldAlert size={16} aria-hidden="true" /> Reject</Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
