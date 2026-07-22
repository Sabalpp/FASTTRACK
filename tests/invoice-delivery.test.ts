import { describe, expect, it, vi } from "vitest";
import {
  buildInvoiceEmailMessage,
  buildInvoiceSmsMessage,
  DEFAULT_INVOICE_SMS_LINK_TTL_SECONDS,
  getInvoiceDeliveryConfiguration,
  invoiceSmsLinkTtlSeconds,
  InvoiceDeliveryError,
  sendInvoiceEmail,
  sendInvoiceSms
} from "@/lib/invoice-delivery";

describe("invoice delivery configuration", () => {
  it("reports channel readiness without returning secret values", () => {
    const missing = getInvoiceDeliveryConfiguration({});
    expect(missing.email).toEqual({
      configured: false,
      provider: null,
      missing: ["SENDGRID_API_KEY or RESEND_API_KEY", "INVOICE_FROM_EMAIL or TRANSACTIONAL_FROM_EMAIL"]
    });
    expect(missing.sms.configured).toBe(false);
    expect(missing.sms.linkTtlSeconds).toBe(DEFAULT_INVOICE_SMS_LINK_TTL_SECONDS);

    const configured = getInvoiceDeliveryConfiguration({
      RESEND_API_KEY: "re_secret",
      INVOICE_FROM_EMAIL: "Fast Track <invoices@example.com>"
    });
    expect(configured.email).toEqual({ configured: true, provider: "resend", missing: [] });
    expect(JSON.stringify(configured)).not.toContain("re_secret");
  });

  it("selects SendGrid automatically and validates the optional link TTL", () => {
    const configuration = getInvoiceDeliveryConfiguration({
      SENDGRID_API_KEY: "SG.private",
      RESEND_API_KEY: "re_private",
      TRANSACTIONAL_FROM_EMAIL: "Fast Track <billing@example.com>",
      INVOICE_SMS_LINK_TTL_SECONDS: "not-a-number"
    });

    expect(configuration.email).toEqual({ configured: true, provider: "sendgrid", missing: [] });
    expect(configuration.sms.linkTtlSeconds).toBeNull();
    expect(configuration.sms.missing).toContain("INVOICE_SMS_LINK_TTL_SECONDS (integer 300-2592000)");
    expect(invoiceSmsLinkTtlSeconds({ INVOICE_SMS_LINK_TTL_SECONDS: "86400" })).toBe(86400);
    expect(invoiceSmsLinkTtlSeconds({})).toBe(DEFAULT_INVOICE_SMS_LINK_TTL_SECONDS);
  });
});

describe("invoice email delivery", () => {
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

    expect(result).toEqual({
      provider: "resend",
      messageId: "email_invoice_123",
      status: "accepted",
      channel: "email",
      destination: "customer@example.com"
    });
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

  it("uses Twilio SendGrid v3 Mail Send with a server key and PDF attachment", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 202,
      headers: { "x-message-id": "sendgrid-message-123" }
    })) as unknown as typeof fetch;
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 50]);

    const result = await sendInvoiceEmail({
      to: "customer@example.com",
      subject: "INV-105 from Fast Track",
      text: "Invoice attached",
      html: "<p>Invoice attached</p>",
      idempotencyKey: "invoice/invoice-2/hash/recipient/request",
      filename: "INV-105 Customer.pdf",
      pdfBytes
    }, {
      env: {
        SENDGRID_API_KEY: "SG.server-only-secret",
        INVOICE_FROM_EMAIL: "Fast Track Billing <billing@example.com>"
      },
      fetchImpl
    });

    expect(result).toEqual({
      provider: "sendgrid",
      messageId: "sendgrid-message-123",
      status: "accepted",
      channel: "email",
      destination: "customer@example.com"
    });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(headers.get("Authorization")).toBe("Bearer SG.server-only-secret");
    expect(body.from).toEqual({ email: "billing@example.com", name: "Fast Track Billing" });
    expect(body.personalizations[0].to).toEqual([{ email: "customer@example.com" }]);
    expect(body.personalizations[0].custom_args.app_delivery_id).toMatch(/^[a-f0-9]{64}$/);
    expect(body.personalizations[0].custom_args.app_delivery_id).not.toContain("customer");
    expect(body.content).toEqual([
      { type: "text/plain", value: "Invoice attached" },
      { type: "text/html", value: "<p>Invoice attached</p>" }
    ]);
    expect(body.attachments).toEqual([{
      content: Buffer.from(pdfBytes).toString("base64"),
      type: "application/pdf",
      filename: "INV-105-Customer.pdf",
      disposition: "attachment"
    }]);
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

describe("invoice transactional SMS copy", () => {
  it("labels the private PDF URL as an invoice and explicitly excludes promotions", () => {
    const body = buildInvoiceSmsMessage({
      invoiceNumber: "INV-106",
      balanceLabel: "$106.00",
      businessName: "Fast Track",
      businessPhone: "(703) 555-0100",
      invoiceUrl: "https://storage.example.test/signed-invoice"
    });

    expect(body).toContain("Signed invoice INV-106 link:");
    expect(body).toContain("https://storage.example.test/signed-invoice");
    expect(body).toContain("Transactional billing message; not a promotion.");
    expect(body).toContain("Reply STOP to opt out.");
  });

  it("uses Twilio Messaging without the appointment-only status callback", async () => {
    const accountSid = `AC${"a".repeat(32)}`;
    const messagingServiceSid = `MG${"b".repeat(32)}`;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      sid: `SM${"c".repeat(32)}`,
      status: "accepted"
    }), {
      status: 201,
      headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch;

    const result = await sendInvoiceSms({
      to: "(703) 555-1212",
      body: "Fast Track: Signed invoice INV-106 link: https://example.test/signed. Transactional billing message; not a promotion. Reply STOP to opt out."
    }, {
      env: {
        TWILIO_ACCOUNT_SID: accountSid,
        TWILIO_AUTH_TOKEN: "server-auth-token",
        TWILIO_API_KEY_SID: `SK${"d".repeat(32)}`,
        TWILIO_API_KEY_SECRET: "server-api-secret",
        TWILIO_MESSAGING_SERVICE_SID: messagingServiceSid,
        TWILIO_WEBHOOK_PUBLIC_URL: "https://fasttrack.example.com/api/webhooks/twilio"
      },
      fetchImpl
    });

    expect(result).toMatchObject({
      provider: "twilio",
      channel: "sms",
      destination: "+17035551212",
      messageId: `SM${"c".repeat(32)}`
    });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    const form = new URLSearchParams(String(init?.body));
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`);
    expect(form.get("MessagingServiceSid")).toBe(messagingServiceSid);
    expect(form.get("StatusCallback")).toBeNull();
  });
});
