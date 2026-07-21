import { describe, expect, it, vi } from "vitest";
import {
  buildInvoiceEmailMessage,
  getInvoiceDeliveryConfiguration,
  InvoiceDeliveryError,
  sendInvoiceEmail
} from "@/lib/invoice-delivery";

describe("invoice email delivery", () => {
  it("requires both private Resend configuration values", () => {
    expect(getInvoiceDeliveryConfiguration({})).toEqual({
      configured: false,
      missing: ["RESEND_API_KEY", "INVOICE_FROM_EMAIL"]
    });
    expect(getInvoiceDeliveryConfiguration({
      RESEND_API_KEY: "re_secret",
      INVOICE_FROM_EMAIL: "Fast Track <invoices@example.com>"
    })).toEqual({ configured: true, missing: [] });
  });

  it("attaches the exact PDF and uses an idempotent Resend request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_invoice_123" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);

    const result = await sendInvoiceEmail({
      to: "customer@example.com",
      subject: "INV-104 from Fast Track",
      text: "Invoice attached",
      html: "<p>Invoice attached</p>",
      idempotencyKey: "invoice/invoice-1/hash/recipient",
      filename: "INV-104 / Customer.pdf",
      pdfBytes
    }, {
      env: {
        RESEND_API_KEY: "re_secret",
        INVOICE_FROM_EMAIL: "Fast Track <invoices@example.com>"
      },
      fetchImpl
    });

    expect(result).toEqual({ provider: "resend", messageId: "email_invoice_123", status: "accepted" });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.resend.com/emails");
    expect(headers.get("Authorization")).toBe("Bearer re_secret");
    expect(headers.get("Idempotency-Key")).toBe("invoice/invoice-1/hash/recipient");
    expect(body).toMatchObject({
      from: "Fast Track <invoices@example.com>",
      to: ["customer@example.com"],
      attachments: [{
        filename: "INV-104-Customer.pdf",
        content: Buffer.from(pdfBytes).toString("base64"),
        content_type: "application/pdf"
      }]
    });
  });

  it("fails closed when the provider rejects the message", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      name: "validation_error",
      message: "sensitive provider detail"
    }), {
      status: 422,
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;

    const error = await sendInvoiceEmail({
      to: "customer@example.com",
      subject: "Invoice",
      text: "Invoice",
      html: "<p>Invoice</p>",
      idempotencyKey: "invoice/invoice-1/hash/recipient",
      filename: "invoice.pdf",
      pdfBytes: new Uint8Array([1])
    }, {
      env: { RESEND_API_KEY: "re_secret", INVOICE_FROM_EMAIL: "invoices@example.com" },
      fetchImpl
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvoiceDeliveryError);
    expect(error).toMatchObject({
      message: "The email provider rejected the invoice.",
      code: "validation_error",
      status: 422,
      retryable: false
    });
    expect(JSON.stringify(error)).not.toContain("sensitive provider detail");
  });

  it("escapes customer content in the HTML message", () => {
    const message = buildInvoiceEmailMessage({
      customerName: "<Customer & Co>",
      invoiceNumber: "INV-1",
      balanceLabel: "$106.00",
      businessName: "Fast Track",
      businessPhone: "(703) 555-0100",
      businessEmail: "billing@example.com"
    });

    expect(message.html).toContain("&lt;Customer &amp; Co&gt;");
    expect(message.html).not.toContain("<Customer & Co>");
  });
});
