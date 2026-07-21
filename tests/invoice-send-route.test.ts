import { beforeEach, describe, expect, it, vi } from "vitest";

const routeHarness = vi.hoisted(() => ({
  requireServerActor: vi.fn(),
  requireOwner: vi.fn(),
  loadInvoiceBundle: vi.fn(),
  assertInvoicePdfIntegrity: vi.fn(),
  assertInvoiceFieldWorkflow: vi.fn(),
  assertSignatureDocumentCurrent: vi.fn(),
  invoiceDocumentHash: vi.fn(),
  sendInvoiceEmail: vi.fn(),
  invoiceFromRow: vi.fn()
}));

vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return {
    ...actual,
    requireServerActor: routeHarness.requireServerActor,
    requireOwner: routeHarness.requireOwner
  };
});

vi.mock("@/lib/invoice-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoice-server")>();
  return {
    ...actual,
    loadInvoiceBundle: routeHarness.loadInvoiceBundle,
    assertInvoicePdfIntegrity: routeHarness.assertInvoicePdfIntegrity,
    assertInvoiceFieldWorkflow: routeHarness.assertInvoiceFieldWorkflow,
    assertSignatureDocumentCurrent: routeHarness.assertSignatureDocumentCurrent,
    invoiceDocumentHash: routeHarness.invoiceDocumentHash
  };
});

vi.mock("@/lib/invoice-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoice-delivery")>();
  return { ...actual, sendInvoiceEmail: routeHarness.sendInvoiceEmail };
});

vi.mock("@/lib/supabase-mappers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-mappers")>();
  return { ...actual, invoiceFromRow: routeHarness.invoiceFromRow };
});

import { PATCH } from "@/app/api/invoices/[id]/route";
import { InvoiceDeliveryError } from "@/lib/invoice-delivery";

const INVOICE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const PDF_BYTES = new TextEncoder().encode("%PDF-invoice-email-test");

describe("invoice send API", () => {
  beforeEach(() => {
    for (const mock of Object.values(routeHarness)) mock.mockReset();
    routeHarness.invoiceDocumentHash.mockReturnValue("document-hash");
    routeHarness.assertInvoiceFieldWorkflow.mockReturnValue({ authorizedTier: "better" });
    routeHarness.loadInvoiceBundle.mockResolvedValue(invoiceBundle());
    routeHarness.invoiceFromRow.mockImplementation((row) => row);
  });

  it("marks an invoice sent only after Resend accepts the PDF attachment", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.sendInvoiceEmail.mockResolvedValue({
      provider: "resend",
      messageId: "email_invoice_1",
      status: "accepted"
    });

    const response = await PATCH(request("customer@example.com"), context());

    expect(response.status).toBe(200);
    expect(routeHarness.sendInvoiceEmail).toHaveBeenCalledOnce();
    const delivery = routeHarness.sendInvoiceEmail.mock.calls[0][0];
    expect(delivery).toMatchObject({
      to: "customer@example.com",
      filename: "INV-104-Jordan Customer.pdf",
      idempotencyKey: expect.stringContaining(REQUEST_ID)
    });
    expect(Array.from(delivery.pdfBytes)).toEqual(Array.from(PDF_BYTES));
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({
      sent_to_email: "customer@example.com",
      status: "sent"
    }));
    expect(routeHarness.sendInvoiceEmail.mock.invocationCallOrder[0]).toBeLessThan(database.update.mock.invocationCallOrder[0]);
  });

  it("keeps the invoice unsent when the email provider rejects it", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.sendInvoiceEmail.mockRejectedValue(new InvoiceDeliveryError({
      message: "The email provider rejected the invoice.",
      code: "validation_error",
      status: 422
    }));

    const response = await PATCH(request("customer@example.com"), context());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, error: "The email provider rejected the invoice." });
    expect(database.update).not.toHaveBeenCalled();
  });

  it("returns actionable configuration help without updating sent metadata", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.sendInvoiceEmail.mockRejectedValue(new InvoiceDeliveryError({
      message: "Invoice email delivery is not configured.",
      code: "not_configured"
    }));

    const response = await PATCH(request("customer@example.com"), context());

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("RESEND_API_KEY and INVOICE_FROM_EMAIL");
    expect(database.update).not.toHaveBeenCalled();
  });
});

function request(email: string) {
  return new Request(`http://localhost/api/invoices/${INVOICE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "send", email, requestId: REQUEST_ID })
  }) as never;
}

function context() {
  return { params: Promise.resolve({ id: INVOICE_ID }) };
}

function actor(database: ReturnType<typeof createDatabase>) {
  return {
    authUserId: "auth-owner",
    user: { id: "owner-1", role: "owner" },
    supabase: { from: database.from, storage: database.storage }
  };
}

function createDatabase() {
  const signatureQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn()
  };
  signatureQuery.select.mockReturnValue(signatureQuery);
  signatureQuery.eq.mockReturnValue(signatureQuery);
  signatureQuery.in.mockResolvedValue({
    data: [{
      id: "authorization-1",
      purpose: "work_authorization",
      status: "active",
      selected_tier: "better",
      document_sha256: "authorization-hash",
      created_at: "2026-07-21T12:00:00.000Z",
      rejected_at: null
    }, {
      id: "completion-1",
      purpose: "work_completion",
      status: "active",
      document_sha256: "completion-hash",
      created_at: "2026-07-21T12:30:00.000Z",
      rejected_at: null
    }],
    error: null
  });

  const updateQuery = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn()
  };
  updateQuery.eq.mockReturnValue(updateQuery);
  updateQuery.select.mockReturnValue(updateQuery);
  updateQuery.maybeSingle.mockResolvedValue({ data: invoiceBundle().invoice, error: null });
  const update = vi.fn(() => updateQuery);
  const from = vi.fn((table: string) => table === "invoice_signatures"
    ? signatureQuery
    : { update });
  const download = vi.fn(async () => ({
    data: new Blob([PDF_BYTES], { type: "application/pdf" }),
    error: null
  }));
  const storage = { from: vi.fn(() => ({ download })) };
  return { from, storage, update };
}

function invoiceBundle() {
  return {
    invoice: {
      id: INVOICE_ID,
      jobId: "job-1",
      invoiceNumber: "INV-104",
      selectedTier: "better",
      subtotalGood: 0,
      subtotalBetter: 100,
      subtotalBest: 0,
      taxRate: 0.06,
      totalGood: 0,
      totalBetter: 106,
      totalBest: 0,
      status: "draft",
      optionLabel: "approved_work",
      notes: "Completed work",
      paymentStatus: "unpaid",
      amountPaid: 0,
      approvalStatus: "signed",
      approvedAt: "2026-07-21T12:00:00.000Z",
      pdfStoragePath: `${INVOICE_ID}/invoice-v1.pdf`,
      pdfVersion: 1,
      pdfGeneratedAt: "2026-07-21T13:00:00.000Z",
      pdfSha256: "f".repeat(64),
      pdfSizeBytes: PDF_BYTES.byteLength,
      createdAt: "2026-07-21T11:00:00.000Z",
      createdBy: "owner-1",
      updatedAt: "2026-07-21T13:00:00.000Z"
    },
    customer: {
      id: "customer-1",
      name: "Jordan Customer",
      email: "customer@example.com"
    },
    job: { id: "job-1" },
    items: []
  };
}
