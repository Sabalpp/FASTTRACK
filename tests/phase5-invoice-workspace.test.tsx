import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  InvoiceScopeEditor,
  preferredInvoiceDeliveryEmail,
  resolveInvoiceWorkspaceAction
} from "@/app/invoices/[id]/InvoiceWorkspaceParts";

describe("Phase 5 invoice workspace", () => {
  it("uses the two field signatures and never asks for a third customer invoice signature", () => {
    const base = {
      canManageInvoice: true,
      selectedSaved: true,
      reviewDirty: false,
      fieldSignaturesReady: true,
      pdfGenerated: false,
      deliveryRecorded: false,
      paymentStatus: "unpaid" as const,
      paymentEditorOpen: false
    };

    expect(resolveInvoiceWorkspaceAction({ ...base, fieldSignaturesReady: false }).id).toBe("return_to_job");
    expect(resolveInvoiceWorkspaceAction({ ...base, selectedSaved: false }).id).toBe("return_to_job");
    expect(resolveInvoiceWorkspaceAction({ ...base, reviewDirty: true }).id).toBe("save_review");
    expect(resolveInvoiceWorkspaceAction(base).id).toBe("generate_pdf");

    const delivery = resolveInvoiceWorkspaceAction({
      ...base,
      selectedSaved: true,
      pdfGenerated: true
    });
    expect(delivery.id).toBe("record_sent");
    expect(delivery.label).toBe("Email invoice PDF");
    expect(delivery.helper).toContain("marked sent only after the provider accepts it");

    const payment = resolveInvoiceWorkspaceAction({
      ...base,
      selectedSaved: true,
      pdfGenerated: true,
      deliveryRecorded: true
    });
    expect(payment.id).toBe("open_payment");
    expect(payment.label).toBe("Record payment");

    const savePayment = resolveInvoiceWorkspaceAction({
      ...base,
      selectedSaved: true,
      pdfGenerated: true,
      deliveryRecorded: true,
      paymentEditorOpen: true
    });
    expect(savePayment.id).toBe("save_payment");
    expect(savePayment.helper).toContain("does not charge");

    const savePaymentBeforeDelivery = resolveInvoiceWorkspaceAction({
      ...base,
      selectedSaved: true,
      pdfGenerated: true,
      deliveryRecorded: false,
      paymentEditorOpen: true
    });
    expect(savePaymentBeforeDelivery.id).toBe("save_payment");

    expect(resolveInvoiceWorkspaceAction({
      ...base,
      selectedSaved: true,
      pdfGenerated: true,
      deliveryRecorded: true,
      paymentStatus: "paid"
    }).id).toBe("view_pdf");
  });

  it("shows estimate choices before approval and only a neutral chosen scope after approval", () => {
    const onSelect = vi.fn();
    const props = {
      canEdit: true,
      selectedTier: "better" as const,
      totalByTier: { standard: 89, good: 106, better: 212, best: 318 },
      itemCountByTier: { standard: 1, good: 1, better: 2, best: 3 },
      neutralLabel: "Approved work",
      onSelect
    };
    const view = render(<InvoiceScopeEditor {...props} locked={false} />);

    expect(screen.getByRole("button", { name: /Use Standard estimate/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Use Good estimate/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Use Better estimate/i }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Use Best estimate/i }));
    expect(onSelect).toHaveBeenCalledWith("best");
    expect(screen.getByText(/Switching replaces the current choice/i)).toBeTruthy();

    view.rerender(<InvoiceScopeEditor {...props} locked />);
    expect(screen.getByTestId("locked-invoice-scope").textContent).toContain("Approved work");
    expect(screen.queryByText(/Standard estimate/i)).toBeNull();
    expect(screen.queryByText(/Good estimate/i)).toBeNull();
    expect(screen.queryByText(/Better estimate/i)).toBeNull();
    expect(screen.queryByText(/Best estimate/i)).toBeNull();
  });

  it("prefills the customer email until a recorded delivery address exists", () => {
    expect(preferredInvoiceDeliveryEmail(undefined, "customer@example.com")).toBe("customer@example.com");
    expect(preferredInvoiceDeliveryEmail("billing@example.com", "customer@example.com")).toBe("billing@example.com");
    expect(preferredInvoiceDeliveryEmail(undefined, undefined)).toBe("");
  });
});
