export const APPOINTMENT_TEMPLATE_VERSION = "appointment-v1";
export const BUSINESS_TIME_ZONE = "America/New_York";

export type AppointmentEventType = "confirmation" | "reschedule" | "cancellation" | "manual_resend";
export type AppointmentDeliveryChannel = "email" | "sms";
export type AppointmentDeliveryStatus =
  | "pending"
  | "sent"
  | "skipped"
  | "queued"
  | "processing"
  | "accepted"
  | "failed"
  | "suppressed"
  | "cancelled";

export type AppointmentConfirmationInput = {
  businessName: string;
  businessPhone?: string;
  customerName: string;
  scheduledAt: string;
  arrivalWindowEndAt: string;
  serviceAddress?: string;
  policyText?: string;
  eventType?: AppointmentEventType;
};

export type AppointmentConfirmationCopy = {
  subject: string;
  text: string;
  html: string;
  sms: string;
  windowLabel: string;
};

export type AppointmentDeliverySummaryItem = {
  channel: AppointmentDeliveryChannel;
  status: AppointmentDeliveryStatus;
};

export function formatAppointmentWindow(
  scheduledAt: string,
  arrivalWindowEndAt: string
): string {
  const start = parseTimestamp(scheduledAt, "Appointment start time");
  const end = parseTimestamp(arrivalWindowEndAt, "Appointment window end time");
  if (end.getTime() <= start.getTime()) {
    throw new Error("Appointment window end time must be after its start time.");
  }

  const startDate = dateParts(start);
  const endDate = dateParts(end);
  const startTime = timeParts(start);
  const endTime = timeParts(end);

  if (startDate.key === endDate.key) {
    return `${startDate.label}, ${startTime}–${endTime}`;
  }

  return `${startDate.label}, ${startTime}–${endDate.label}, ${endTime}`;
}

export function buildAppointmentConfirmation(
  input: AppointmentConfirmationInput
): AppointmentConfirmationCopy {
  const businessName = cleanInline(input.businessName, 100) || "Service team";
  const customerName = cleanInline(input.customerName, 120) || "there";
  const serviceAddress = cleanInline(input.serviceAddress, 300);
  const businessPhone = cleanInline(input.businessPhone, 40);
  const policyText = cleanInline(
    input.policyText,
    600
  ) || "Please allow the technician to arrive at any time during this service window.";
  const windowLabel = formatAppointmentWindow(input.scheduledAt, input.arrivalWindowEndAt);
  const isReschedule = input.eventType === "reschedule";
  const isCancellation = input.eventType === "cancellation";
  const actionLabel = isCancellation ? "cancelled" : isReschedule ? "updated" : "confirmed";
  const subjectLabel = isCancellation ? "Appointment cancelled" : isReschedule ? "Appointment updated" : "Appointment confirmed";
  const subject = `${subjectLabel} | ${businessName}`;

  const textLines = [
    `Hi ${customerName},`,
    "",
    `Your service appointment with ${businessName} is ${actionLabel}.`,
    `Arrival window: ${windowLabel}`,
    serviceAddress ? `Service address: ${serviceAddress}` : undefined,
    "",
    `Policy: ${policyText}`,
    businessPhone ? `Questions or changes? Call ${businessPhone}.` : undefined
  ].filter((line): line is string => line !== undefined);

  const statusColor = isCancellation ? "#a33b2f" : isReschedule ? "#8a5a14" : "#176b55";
  const statusBackground = isCancellation ? "#fff1ef" : isReschedule ? "#fff8e8" : "#edf8f3";
  const detailRows = [
    `<tr><td style="padding:12px 0;border-bottom:1px solid #e6ecef;color:#66747c;font-size:13px;width:34%;">Arrival window</td><td style="padding:12px 0;border-bottom:1px solid #e6ecef;color:#17252d;font-weight:700;font-size:14px;">${escapeHtml(windowLabel)}</td></tr>`,
    serviceAddress ? `<tr><td style="padding:12px 0;color:#66747c;font-size:13px;vertical-align:top;">Service address</td><td style="padding:12px 0;color:#17252d;font-weight:700;font-size:14px;">${escapeHtml(serviceAddress)}</td></tr>` : ""
  ].filter(Boolean).join("");
  const html = [
    `<div style="margin:0;padding:32px 16px;background:#f4f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17252d;">`,
    `<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dce5e8;border-radius:16px;overflow:hidden;">`,
    `<div style="padding:24px 28px;background:#123f4a;color:#ffffff;"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.78;">${escapeHtml(businessName)}</div><h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;font-weight:800;">Appointment ${actionLabel}</h1></div>`,
    `<div style="padding:28px;">`,
    `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Hi ${escapeHtml(customerName)},</p>`,
    `<p style="margin:0 0 20px;font-size:16px;line-height:1.6;">Your service appointment with <strong>${escapeHtml(businessName)}</strong> is ${actionLabel}.</p>`,
    `<div style="margin:0 0 22px;padding:4px 18px;border-radius:10px;background:${statusBackground};border-left:4px solid ${statusColor};"><table role="presentation" style="width:100%;border-collapse:collapse;">${detailRows}</table></div>`,
    `<div style="margin:0 0 22px;padding:16px 18px;border-radius:10px;background:#f5f8f9;"><div style="margin:0 0 6px;color:#66747c;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Important</div><p style="margin:0;color:#35454d;font-size:14px;line-height:1.6;">${escapeHtml(policyText)}</p></div>`,
    businessPhone ? `<p style="margin:0;color:#35454d;font-size:14px;line-height:1.6;">Questions or changes? Call <strong>${escapeHtml(businessPhone)}</strong>.</p>` : "",
    `</div><div style="padding:16px 28px;border-top:1px solid #e6ecef;color:#728087;font-size:12px;line-height:1.5;">Please keep this email for your appointment details.</div>`,
    `</div></div>`
  ].join("");

  const smsParts = [
    `${businessName}: Your service appointment is ${actionLabel} for ${windowLabel}.`,
    serviceAddress ? `Address: ${serviceAddress}.` : undefined,
    `Policy: ${policyText}`,
    businessPhone ? `Questions? ${businessPhone}.` : undefined,
    "Reply STOP to opt out."
  ].filter((part): part is string => part !== undefined);

  return {
    subject,
    text: textLines.join("\n"),
    html,
    sms: smsParts.join(" "),
    windowLabel
  };
}

export function appointmentTextToHtml(text: string): string {
  return `<p>${escapeHtml(text).replace(/\r?\n/g, "<br />")}</p>`;
}

export function normalizeEmailRecipient(input: string | null | undefined): string | undefined {
  const email = String(input ?? "").trim();
  if (email.length === 0 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return undefined;
  }
  return email;
}

export function toUsE164Phone(input: string | null | undefined): string | undefined {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

export function maskEmail(input: string | null | undefined): string {
  const email = normalizeEmailRecipient(input);
  if (!email) return "Invalid email";

  const separator = email.lastIndexOf("@");
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

export function maskPhone(input: string | null | undefined): string {
  const phone = toUsE164Phone(input);
  return phone ? `***-***-${phone.slice(-4)}` : "Invalid phone";
}

export function maskAppointmentRecipient(
  channel: AppointmentDeliveryChannel,
  recipient: string | null | undefined
): string {
  return channel === "email" ? maskEmail(recipient) : maskPhone(recipient);
}

export function maskNotificationDestination(
  channel: AppointmentDeliveryChannel | string,
  destination: string | null | undefined
): string {
  return channel === "email" ? maskEmail(destination) : maskPhone(destination);
}

export function notificationStatusLabel(status: string): string {
  if (status === "queued") return "Queued";
  if (status === "processing") return "Sending";
  if (status === "accepted") return "Accepted";
  if (status === "failed") return "Failed";
  if (status === "suppressed") return "Skipped";
  if (status === "cancelled") return "Cancelled";
  return status.replace(/_/g, " ");
}

export function buildAppointmentIdempotencyKey(input: {
  jobId: string;
  channel: AppointmentDeliveryChannel;
  recipient: string;
  scheduledAt: string;
  arrivalWindowEndAt: string;
  eventType?: AppointmentEventType;
  templateVersion?: string;
  revision?: number;
  messageSubject?: string;
  messageBody?: string;
  serviceAddress?: string;
}): string {
  const eventType = input.eventType ?? "confirmation";
  const templateVersion = input.templateVersion ?? APPOINTMENT_TEMPLATE_VERSION;
  const scheduledAt = parseTimestamp(input.scheduledAt, "Appointment start time");
  const arrivalWindowEndAt = parseTimestamp(input.arrivalWindowEndAt, "Appointment window end time");
  if (arrivalWindowEndAt.getTime() <= scheduledAt.getTime()) {
    throw new Error("Appointment window end time must be after its start time.");
  }
  const recipient = input.channel === "email"
    ? normalizeEmailRecipient(input.recipient)?.toLowerCase()
    : toUsE164Phone(input.recipient);
  if (!recipient) throw new Error("Appointment notification recipient is invalid.");
  const canonical = JSON.stringify({
    jobId: input.jobId,
    channel: input.channel,
    recipient,
    scheduledAt: scheduledAt.toISOString(),
    arrivalWindowEndAt: arrivalWindowEndAt.toISOString(),
    eventType,
    templateVersion,
    revision: input.revision ?? null,
    messageSubject: input.messageSubject ?? null,
    messageBody: input.messageBody ?? null,
    serviceAddress: input.serviceAddress ?? null
  });
  const digest = stableDigest(canonical);
  const safeJobId = input.jobId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "job";
  return `appointment/${eventType}/${input.channel}/${safeJobId}/${digest}`;
}

export function summarizeAppointmentDeliveries(items: AppointmentDeliverySummaryItem[]): string {
  if (items.length === 0) return "No confirmation requested";

  const channelOrder: AppointmentDeliveryChannel[] = ["email", "sms"];
  return [...items]
    .sort((a, b) => channelOrder.indexOf(a.channel) - channelOrder.indexOf(b.channel))
    .map((item) => `${item.channel === "email" ? "Email" : "Text"} ${deliveryStatusLabel(item.status)}`)
    .join(" · ");
}

function deliveryStatusLabel(status: AppointmentDeliveryStatus): string {
  if (status === "sent") return "sent";
  if (status === "accepted") return "accepted";
  if (status === "failed") return "failed";
  if (status === "skipped" || status === "suppressed") return "skipped";
  if (status === "cancelled") return "cancelled";
  if (status === "processing") return "sending";
  return "pending";
}

function parseTimestamp(value: string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date;
}

function dateParts(date: Date): { key: string; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    key: `${values.year}-${values.month}-${values.day}`,
    label: `${values.weekday}, ${values.month} ${values.day}, ${values.year}`
  };
}

function timeParts(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function cleanInline(value: string | null | undefined, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stableDigest(value: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b1, 0x85ebca77, 0xc2b2ae3d];
  return seeds.map((seed, seedIndex) => {
    let hash = seed;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index) + seedIndex;
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }).join("");
}
