"use client";

import { Check } from "lucide-react";
import { tierLabels, tierOptions } from "@/lib/data-store";
import { money } from "@/lib/money";
import type { InvoicePaymentStatus, Tier } from "@/lib/types";
import styles from "./InvoiceWorkspace.module.css";

export type InvoiceWorkspaceActionId =
  | "save_review"
  | "collect_customer_signature"
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

export function resolveInvoiceWorkspaceAction(input: {
  canManageInvoice: boolean;
  selectedSaved: boolean;
  reviewDirty: boolean;
  approvalSaved: boolean;
  pdfGenerated: boolean;
  deliveryRecorded: boolean;
  paymentStatus: InvoicePaymentStatus;
  paymentEditorOpen: boolean;
}): InvoiceWorkspaceAction {
  if (!input.selectedSaved || input.reviewDirty) {
    if (!input.canManageInvoice) {
      return {
        id: "return_to_job",
        label: "Return to job",
        title: "Owner review needed",
        helper: "An owner must choose and save the invoice scope before approval can continue."
      };
    }
    return {
      id: "save_review",
      label: "Save invoice details",
      title: input.selectedSaved ? "Save your changes" : "Choose the invoice scope",
      helper: "Save the chosen work and total before asking the customer to approve it."
    };
  }

  if (!input.approvalSaved) {
    return {
      id: "collect_customer_signature",
      label: "Add customer signature",
      title: "Customer approval",
      helper: "Ask the customer to review the chosen scope and balance, then sign."
    };
  }

  if (input.paymentEditorOpen && input.canManageInvoice && input.deliveryRecorded) {
    return {
      id: "save_payment",
      label: "Save payment record",
      title: "Confirm the payment record",
      helper: "This records a payment status only; it does not charge the customer."
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
      label: "Record as sent",
      title: "Record customer delivery",
      helper: "Email delivery is not active. Share the invoice separately, then record the destination here."
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
    return (
      <div className={styles.lockedScope} data-testid="locked-invoice-scope">
        <span>Chosen scope</span>
        <strong>{neutralLabel}</strong>
        <p>The approved document keeps one neutral service scope. Reject the saved signature before changing signed content.</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="estimate-scope-heading">
      <p id="estimate-scope-heading" className={styles.truthNote}>
        Compare estimate options here only. After approval, the invoice uses one neutral chosen scope.
      </p>
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
              onClick={() => onSelect(tier)}
              disabled={!canEdit || itemCount === 0}
            >
              <span>{tierLabels[tier]} estimate</span>
              <strong>{money(totalByTier[tier])}</strong>
              <small>{itemCount} item{itemCount === 1 ? "" : "s"}</small>
              {selectedTier === tier ? <Check size={15} aria-label="Selected" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
