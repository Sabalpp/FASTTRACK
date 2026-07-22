"use client";

import { Check } from "lucide-react";
import { tierLabels, tierOptions } from "@/lib/data-store";
import { money } from "@/lib/money";
import type { Invoice, InvoicePaymentStatus, Tier } from "@/lib/types";
import styles from "./InvoiceWorkspace.module.css";

export type InvoiceWorkspaceActionId =
  | "save_review"
  | "preview_draft_pdf"
  | "generate_pdf"
  | "record_sent"
  | "open_payment"
  | "save_payment"
  | "view_pdf"
  | "return_to_job";

export type InvoiceWorkspaceAction = {
  id: InvoiceWorkspaceActionId;
  label: string;
  title: string;
  helper: string;
};

export function preferredInvoiceDeliveryEmail(sentToEmail?: string, customerEmail?: string) {
  return sentToEmail ?? customerEmail ?? "";
}

export function invoiceWorkspaceStatus(invoice: Pick<Invoice, "approvalStatus" | "paymentStatus" | "pdfStoragePath" | "sentAt" | "status">) {
  if (invoice.paymentStatus === "paid") return { label: "Paid", tone: "good" } as const;
  if (invoice.paymentStatus === "partially_paid") return { label: "Partially paid", tone: "warn" } as const;
  if (invoice.paymentStatus === "refunded") return { label: "Refunded", tone: "neutral" } as const;
  if (invoice.paymentStatus === "void" || invoice.status === "cancelled") return { label: "Void", tone: "neutral" } as const;
  if (invoice.sentAt || invoice.status === "sent") return { label: "Sent · payment due", tone: "warn" } as const;
  if (invoice.pdfStoragePath) return { label: "PDF ready", tone: "warn" } as const;
  if (invoice.approvalStatus === "signed") return { label: "Approved", tone: "warn" } as const;
  return { label: "Draft", tone: "warn" } as const;
}

export function invoiceReadinessBlockers(input: {
  hasWorkAuthorization: boolean;
  tierConflict: boolean;
  hasCompletionRecord: boolean;
  reviewDirty: boolean;
}) {
  return [
    !input.hasWorkAuthorization ? "Customer work authorization is missing." : undefined,
    input.hasWorkAuthorization && input.tierConflict ? "The saved invoice scope conflicts with the customer authorization." : undefined,
    !input.hasCompletionRecord ? "Completion acknowledgment is missing." : undefined,
    input.reviewDirty ? "Invoice label or notes have unsaved changes." : undefined
  ].filter((blocker): blocker is string => Boolean(blocker));
}

export function resolveInvoiceWorkspaceAction(input: {
  canManageInvoice: boolean;
  selectedSaved: boolean;
  reviewDirty: boolean;
  fieldSignaturesReady: boolean;
  pdfGenerated: boolean;
  deliveryRecorded: boolean;
  paymentStatus: InvoicePaymentStatus;
  paymentEditorOpen: boolean;
}): InvoiceWorkspaceAction {
  if (!input.selectedSaved) {
    return {
      id: "preview_draft_pdf",
      label: "Preview draft PDF",
      title: "Authorized scope conflict",
      helper: "The bill remains available for review, but its draft PDF is marked with the scope conflict and cannot be finalized or emailed."
    };
  }

  if (input.reviewDirty) {
    if (!input.canManageInvoice) {
      return {
        id: "return_to_job",
        label: "Return to job",
        title: "Owner review needed",
        helper: "An owner must save the invoice label and notes before the PDF can be created."
      };
    }
    return {
      id: "save_review",
      label: "Save invoice details",
      title: "Save your changes",
      helper: "The signed scope and technician pricing stay locked; the owner can edit only the invoice label and notes."
    };
  }

  if (input.paymentEditorOpen && input.canManageInvoice) {
    return {
      id: "save_payment",
      label: "Save payment record",
      title: "Confirm the payment record",
      helper: "This records a payment status only; it does not charge the customer."
    };
  }

  if (!input.fieldSignaturesReady) {
    return {
      id: "preview_draft_pdf",
      label: "Preview draft PDF",
      title: "Signatures are still pending",
      helper: "Preview the complete bill now. The PDF is visibly marked as a draft and is not saved, finalized, or emailed."
    };
  }

  if (!input.pdfGenerated) {
    return {
      id: "generate_pdf",
      label: "Generate signed PDF",
      title: "Create the final document",
      helper: "Generate a protected PDF from the saved invoice and signatures."
    };
  }

  if (!input.deliveryRecorded) {
    if (!input.canManageInvoice) {
      return {
        id: "view_pdf",
        label: "View final PDF",
        title: "Final PDF ready",
        helper: "An owner can record delivery after the invoice is shared with the customer."
      };
    }
    return {
      id: "record_sent",
      label: "Email invoice PDF",
      title: "Send the final invoice",
      helper: "Email the saved signed PDF to the customer. The invoice is marked sent only after the provider accepts it."
    };
  }

  if (input.paymentStatus === "unpaid" || input.paymentStatus === "partially_paid") {
    if (!input.canManageInvoice) {
      return {
        id: "view_pdf",
        label: "View final PDF",
        title: "Delivery recorded",
        helper: "An owner can record payments against this invoice."
      };
    }
    return {
      id: "open_payment",
      label: "Record payment",
      title: "Payment is still due",
      helper: "Record cash, check, bank, or another payment received outside this app."
    };
  }

  return {
    id: "view_pdf",
    label: "View final PDF",
    title: input.paymentStatus === "paid" ? "Invoice complete" : "Invoice record complete",
    helper: input.paymentStatus === "paid"
      ? "Payment and delivery are recorded. The final document remains available below."
      : "Review the final document and recorded invoice history."
  };
}

export function InvoiceScopeEditor({
  locked,
  canEdit,
  selectedTier,
  totalByTier,
  itemCountByTier,
  neutralLabel,
  onSelect
}: {
  locked: boolean;
  canEdit: boolean;
  selectedTier?: Tier;
  totalByTier: Record<Tier, number>;
  itemCountByTier: Record<Tier, number>;
  neutralLabel: string;
  onSelect: (tier: Tier) => void;
}) {
  if (locked) {
    const itemCount = selectedTier ? itemCountByTier[selectedTier] : 0;
    return (
      <div className={styles.lockedScope} data-testid="locked-invoice-scope">
        <span>Authorized scope</span>
        <strong>{neutralLabel}</strong>
        {selectedTier ? <small>{money(totalByTier[selectedTier])} · {itemCount} item{itemCount === 1 ? "" : "s"}</small> : null}
        <p>Locked to the customer&apos;s field authorization. Technician-entered descriptions, quantities, and prices remain unchanged.</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="estimate-scope-heading">
      <div className={styles.scopeIntro}>
        <strong id="estimate-scope-heading">Choose one invoice scope</strong>
        <span>Switching replaces the current choice. It does not add another line item.</span>
      </div>
      <div className={styles.scopeGrid} aria-label="Estimate options">
        {tierOptions.map((tier) => {
          const itemCount = itemCountByTier[tier];
          return (
            <button
              key={tier}
              type="button"
              className={styles.scopeChoice}
              data-selected={selectedTier === tier}
              aria-pressed={selectedTier === tier}
              aria-label={`Use ${tierLabels[tier]} estimate, ${money(totalByTier[tier])}, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
              onClick={() => onSelect(tier)}
              disabled={!canEdit || itemCount === 0}
            >
              <span className={styles.scopeChoiceText}>
                <strong>{tierLabels[tier]}</strong>
                <small>{itemCount} item{itemCount === 1 ? "" : "s"}</small>
              </span>
              <strong className={styles.scopeChoiceAmount}>{money(totalByTier[tier])}</strong>
              <span className={styles.scopeChoiceState}>
                {selectedTier === tier ? <><Check size={15} aria-hidden="true" /> Selected</> : "Choose"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
