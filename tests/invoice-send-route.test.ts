import { beforeEach, describe, expect, it, vi } from "vitest";

const routeHarness = vi.hoisted(() => ({
  requireServerActor: vi.fn(),
  requireOwner: vi.fn(),
  loadInvoiceBundle: vi.fn(),
  assertInvoicePdfIntegrity: vi.fn(),
  assertInvoiceFieldWorkflow: vi.fn(),
  validateInvoiceWorkAuthorization: vi.fn(),
  assertSignatureDocumentCurrent: vi.fn(),
  invoiceDocumentHash: vi.fn(),
  sendInvoiceEmail: vi.fn(),
  sendInvoiceSms: vi.fn(),
  getInvoiceDeliveryConfiguration: vi.fn(),
  claimInvoiceDelivery: vi.fn(),
  recordInvoiceDeliveryOutcome: vi.fn(),
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
    validateInvoiceWorkAuthorization: routeHarness.validateInvoiceWorkAuthorization,
    assertSignatureDocumentCurrent: routeHarness.assertSignatureDocumentCurrent,
    invoiceDocumentHash: routeHarness.invoiceDocumentHash
  };
});

vi.mock("@/lib/invoice-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoice-delivery")>();
  return {
    ...actual,
    sendInvoiceEmail: routeHarness.sendInvoiceEmail,
    sendInvoiceSms: routeHarness.sendInvoiceSms,
    getInvoiceDeliveryConfiguration: routeHarness.getInvoiceDeliveryConfiguration
  };
});

vi.mock("@/lib/invoice-delivery-audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoice-delivery-audit")>();
  return {
    ...actual,
    claimInvoiceDelivery: routeHarness.claimInvoiceDelivery,
    recordInvoiceDeliveryOutcome: routeHarness.recordInvoiceDeliveryOutcome
  };
});

vi.mock("@/lib/supabase-mappers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-mappers")>();
  return { ...actual, invoiceFromRow: routeHarness.invoiceFromRow };
});

import { GET, PATCH } from "@/app/api/invoices/[id]/route";
import { InvoiceDeliveryError } from "@/lib/invoice-delivery";
import { HttpError } from "@/lib/server-auth";

const INVOICE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const PDF_BYTES = new TextEncoder().encode("%PDF-invoice-email-test");

describe("invoice send API", () => {
  beforeEach(() => {
    for (const mock of Object.values(routeHarness)) mock.mockReset();
    routeHarness.invoiceDocumentHash.mockReturnValue("document-hash");
    routeHarness.assertInvoiceFieldWorkflow.mockReturnValue({ authorizedTier: "better" });
    routeHarness.validateInvoiceWorkAuthorization.mockReturnValue(undefined);
    routeHarness.loadInvoiceBundle.mockResolvedValue(invoiceBundle());
    routeHarness.invoiceFromRow.mockImplementation((row) => row);
    routeHarness.getInvoiceDeliveryConfiguration.mockReturnValue({
      email: { configured: true, provider: "resend", missing: ["SENDGRID_API_KEY or RESEND_API_KEY", "INVOICE_FROM_EMAIL or TRANSACTIONAL_FROM_EMAIL"] },
      sms: { configured: true, provider: "twilio", credentialMode: "auth_token", linkTtlSeconds: 604800, missing: [] }
    });
    routeHarness.claimInvoiceDelivery.mockResolvedValue({
      auditId: "33333333-3333-4333-8333-333333333333",
      decision: "send",
      status: "processing",
      completionToken: "44444444-4444-4444-8444-444444444444",
      claimedAt: "2026-07-22T12:00:00.000Z"
    });
    routeHarness.recordInvoiceDeliveryOutcome.mockResolvedValue({ status: "accepted" });
  });

  it("marks an invoice sent only after Resend accepts the PDF attachment", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.sendInvoiceEmail.mockResolvedValue({
      provider: "resend",
      messageId: "email_invoice_1",
      status: "accepted",
      channel: "email",
      destination: "customer@example.com"
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
    expect(routeHarness.claimInvoiceDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      pdfSha256: "f".repeat(64),
      workflowRevision: 7
    }));
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({
      sent_to_email: "customer@example.com",
      status: "sent"
    }));
    expect(routeHarness.sendInvoiceEmail.mock.invocationCallOrder[0]).toBeLessThan(database.update.mock.invocationCallOrder[0]);
    expect(database.updateEq).toHaveBeenCalledWith("pdf_workflow_revision", 7);
    expect((await response.json()).delivery).toMatchObject({
      provider: "resend",
      channel: "email",
      destination: "customer@example.com"
    });
  });

  it("texts a seven-day private PDF link only with transactional SMS consent", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.loadInvoiceBundle.mockResolvedValue(invoiceBundle({
      customer: {
        phone: "(703) 555-1212",
        phoneDigits: "7035551212",
        smsConsentStatus: "opted_in"
      }
    }));
    routeHarness.sendInvoiceSms.mockResolvedValue({
      provider: "twilio",
      messageId: `SM${"a".repeat(32)}`,
      status: "accepted",
      channel: "sms",
      destination: "+17035551212"
    });

    const response = await PATCH(smsRequest("(703) 555-1212"), context());

    expect(response.status).toBe(200);
    expect(database.createSignedUrl).toHaveBeenCalledWith(
      `${INVOICE_ID}/invoice-v1.pdf`,
      604800
    );
    expect(routeHarness.sendInvoiceSms).toHaveBeenCalledOnce();
    expect(routeHarness.sendInvoiceSms.mock.calls[0][0]).toMatchObject({
      to: "+17035551212",
      body: expect.stringContaining("Signed invoice INV-104 link: https://storage.example.test/private-invoice-token")
    });
    expect(routeHarness.sendInvoiceSms.mock.calls[0][0].body).toContain("not a promotion");
    const sentPatch = database.update.mock.calls[0][0] as Record<string, unknown>;
    expect(sentPatch).not.toHaveProperty("sent_to_email");
    expect(sentPatch).toMatchObject({ sent_at: expect.any(String), status: "sent" });
    expect((await response.json()).delivery).toMatchObject({
      provider: "twilio",
      channel: "sms",
      destination: "+17035551212"
    });
  });

  it("blocks invoice SMS before creating a link when transactional consent is absent", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.loadInvoiceBundle.mockResolvedValue(invoiceBundle({
      customer: {
        phone: "(703) 555-1212",
        phoneDigits: "7035551212",
        smsConsentStatus: "unknown"
      }
    }));

    const response = await PATCH(smsRequest("(703) 555-1212"), context());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("marketing consent remains separate");
    expect(database.createSignedUrl).not.toHaveBeenCalled();
    expect(routeHarness.sendInvoiceSms).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });

  it("honors the customer's transactional email preference without treating it as marketing consent", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.loadInvoiceBundle.mockResolvedValue(invoiceBundle({
      customer: { emailNotificationsEnabled: false }
    }));

    const response = await PATCH(request("customer@example.com"), context());

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("transactional email updates are disabled");
    expect(routeHarness.sendInvoiceEmail).not.toHaveBeenCalled();
    expect(database.download).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });

  it("keeps both providers behind the existing final-signature gate", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.assertInvoiceFieldWorkflow.mockImplementation(() => {
      throw new HttpError(409, "Final field signatures are required.");
    });

    const emailResponse = await PATCH(request("customer@example.com"), context());
    const smsResponse = await PATCH(smsRequest("(703) 555-1212"), context());

    expect(emailResponse.status).toBe(409);
    expect(smsResponse.status).toBe(409);
    expect(routeHarness.sendInvoiceEmail).not.toHaveBeenCalled();
    expect(routeHarness.sendInvoiceSms).not.toHaveBeenCalled();
    expect(database.download).not.toHaveBeenCalled();
    expect(database.createSignedUrl).not.toHaveBeenCalled();
    expect(database.update).not.toHaveBeenCalled();
  });

  it("loads an unsigned invoice draft without consulting signatures", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));

    const response = await GET(new Request(`http://localhost/api/invoices/${INVOICE_ID}`) as never, context());

    expect(response.status).toBe(200);
    expect(routeHarness.assertInvoiceFieldWorkflow).not.toHaveBeenCalled();
    expect(database.from).not.toHaveBeenCalled();
  });

  it("reviews an unsigned invoice while keeping final send gated", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));

    const response = await PATCH(reviewRequest(), context());

    expect(response.status).toBe(200);
    expect(routeHarness.validateInvoiceWorkAuthorization).toHaveBeenCalledOnce();
    expect(routeHarness.assertInvoiceFieldWorkflow).not.toHaveBeenCalled();
    expect(database.update).toHaveBeenCalledWith(expect.objectContaining({
      selected_tier: "good",
      option_label: "approved_work"
    }));
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

  it("replays an accepted audit result without sending a duplicate provider message", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.claimInvoiceDelivery.mockResolvedValue({
      auditId: "33333333-3333-4333-8333-333333333333",
      decision: "already_accepted",
      status: "accepted",
      provider: "sendgrid",
      providerMessageId: "sendgrid-message-1",
      providerStatus: "accepted",
      claimedAt: "2026-07-22T12:00:00.000Z",
      completedAt: "2026-07-22T12:00:01.000Z"
    });

    const response = await PATCH(request("customer@example.com"), context());

    expect(response.status).toBe(200);
    expect(routeHarness.sendInvoiceEmail).not.toHaveBeenCalled();
    expect(routeHarness.recordInvoiceDeliveryOutcome).not.toHaveBeenCalled();
    expect(database.update).toHaveBeenCalledOnce();
    expect((await response.json()).delivery).toMatchObject({ provider: "sendgrid", messageId: "sendgrid-message-1" });
  });

  it("fences an in-flight request instead of retrying Twilio", async () => {
    const database = createDatabase();
    routeHarness.requireServerActor.mockResolvedValue(actor(database));
    routeHarness.loadInvoiceBundle.mockResolvedValue(invoiceBundle({
      customer: { phone: "(703) 555-1212", phoneDigits: "7035551212", smsConsentStatus: "opted_in" }
    }));
    routeHarness.claimInvoiceDelivery.mockResolvedValue({
      auditId: "33333333-3333-4333-8333-333333333333",
      decision: "in_flight",
      status: "processing",
      claimedAt: "2026-07-22T12:00:00.000Z"
    });

    const response = await PATCH(smsRequest("(703) 555-1212"), context());

    expect(response.status).toBe(409);
    expect(routeHarness.sendInvoiceSms).not.toHaveBeenCalled();
    expect(database.createSignedUrl).not.toHaveBeenCalled();
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
    const payload = await response.json();
    expect(payload.error).toContain("SENDGRID_API_KEY or RESEND_API_KEY");
    expect(payload.error).toContain("INVOICE_FROM_EMAIL or TRANSACTIONAL_FROM_EMAIL");
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

function smsRequest(phone: string) {
  return new Request(`http://localhost/api/invoices/${INVOICE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "send", channel: "sms", phone, requestId: REQUEST_ID })
  }) as never;
}

function reviewRequest() {
  return new Request(`http://localhost/api/invoices/${INVOICE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "review",
      selectedTier: "good",
      optionLabel: "approved_work",
      notes: "Draft review before signatures"
    })
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
  const update = vi.fn((_patch: Record<string, unknown>) => updateQuery);
  const from = vi.fn((table: string) => table === "invoice_signatures"
    ? signatureQuery
    : { update });
  const download = vi.fn(async () => ({
    data: new Blob([PDF_BYTES], { type: "application/pdf" }),
    error: null
  }));
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: "https://storage.example.test/private-invoice-token" },
    error: null
  }));
  const storage = { from: vi.fn(() => ({ download, createSignedUrl })) };
  return { from, storage, update, updateEq: updateQuery.eq, download, createSignedUrl };
}

type TestCustomer = {
  id: string;
  name: string;
  email: string;
  emailNotificationsEnabled: boolean;
  phone: string;
  phoneDigits: string;
  smsConsentStatus: "unknown" | "opted_in" | "opted_out";
};

function invoiceBundle(overrides: {
  customer?: Partial<TestCustomer>;
} = {}): {
  invoice: Record<string, unknown>;
  customer: TestCustomer;
  job: { id: string; workflowRevision: number };
  items: Array<{ id: string; tier: string }>;
} {
  const customer: TestCustomer = {
    id: "customer-1",
    name: "Jordan Customer",
    email: "customer@example.com",
    emailNotificationsEnabled: true,
    phone: "(703) 555-1212",
    phoneDigits: "7035551212",
    smsConsentStatus: "unknown" as const,
    ...overrides.customer
  };
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
      pdfWorkflowRevision: 7,
      createdAt: "2026-07-21T11:00:00.000Z",
      createdBy: "owner-1",
      updatedAt: "2026-07-21T13:00:00.000Z"
    },
    customer,
    job: { id: "job-1", workflowRevision: 7 },
    items: [{ id: "line-1", tier: "good" }]
  };
}
