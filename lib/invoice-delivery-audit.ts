import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeEmailRecipient,
  toUsE164Phone
} from "@/lib/appointment-confirmations";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Invoice delivery audit operations can only run on the server.");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_.:-]+$/;
const SAFE_CODE_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type InvoiceDeliveryAuditChannel = "email" | "sms";
export type InvoiceDeliveryAuditProvider = "resend" | "sendgrid" | "twilio";
export type InvoiceDeliveryAuditStatus = "processing" | "accepted" | "failed" | "delivery_unknown";
export type InvoiceDeliveryClaimDecision =
  | "send"
  | "already_accepted"
  | "in_flight"
  | "already_failed"
  | "delivery_unknown";

export type InvoiceDeliveryClaim = {
  auditId: string;
  decision: InvoiceDeliveryClaimDecision;
  status: InvoiceDeliveryAuditStatus;
  completionToken?: string;
  provider?: InvoiceDeliveryAuditProvider;
  providerMessageId?: string;
  providerStatus?: string;
  errorCode?: string;
  claimedAt: string;
  completedAt?: string;
};

export type InvoiceDeliveryAuditRecord = {
  id: string;
  requestId: string;
  invoiceId: string;
  channel: InvoiceDeliveryAuditChannel;
  destinationHash: string;
  pdfSha256: string;
  workflowRevision: number;
  status: InvoiceDeliveryAuditStatus;
  provider?: InvoiceDeliveryAuditProvider;
  providerMessageId?: string;
  providerStatus?: string;
  errorCode?: string;
  requestedBy: string;
  claimedAt: string;
  acceptedAt?: string;
  failedAt?: string;
  deliveryUnknownAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceDeliveryOutcome =
  | {
      status: "accepted";
      provider: InvoiceDeliveryAuditProvider;
      providerMessageId: string;
      providerStatus?: string;
    }
  | {
      status: "failed" | "delivery_unknown";
      provider: InvoiceDeliveryAuditProvider;
      providerStatus?: string;
      errorCode: string;
    };

export class InvoiceDeliveryAuditError extends Error {
  readonly code: "invalid_input" | "claim_failed" | "record_failed" | "invalid_response";
  readonly databaseCode?: string;

  constructor(input: {
    message: string;
    code: InvoiceDeliveryAuditError["code"];
    databaseCode?: string;
  }) {
    super(input.message);
    this.name = "InvoiceDeliveryAuditError";
    this.code = input.code;
    this.databaseCode = input.databaseCode;
  }
}

export function invoiceDeliveryDestinationHash(
  channel: InvoiceDeliveryAuditChannel,
  destination: string
): string {
  const canonical = canonicalDestination(channel, destination);
  if (!canonical) {
    throw auditError("Invoice delivery destination is invalid.", "invalid_input");
  }
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function auditStatusForProviderErrorCode(
  errorCode: string
): "failed" | "delivery_unknown" {
  return ["network_error", "timeout", "invalid_response"].includes(errorCode)
    ? "delivery_unknown"
    : "failed";
}

export async function claimInvoiceDelivery(
  client: SupabaseClient,
  input: {
    requestId: string;
    invoiceId: string;
    channel: InvoiceDeliveryAuditChannel;
    destination: string;
    pdfSha256: string;
    workflowRevision: number;
    requestedBy: string;
  }
): Promise<InvoiceDeliveryClaim> {
  const requestId = normalizedUuid(input.requestId, "Invoice delivery request ID");
  const invoiceId = normalizedUuid(input.invoiceId, "Invoice ID");
  const requestedBy = normalizedUuid(input.requestedBy, "Invoice delivery requester");
  const pdfSha256 = input.pdfSha256.trim().toLowerCase();
  if (!SHA256_PATTERN.test(pdfSha256)) {
    throw auditError("Invoice PDF digest is invalid.", "invalid_input");
  }
  if (!Number.isSafeInteger(input.workflowRevision) || input.workflowRevision < 0) {
    throw auditError("Invoice workflow revision is invalid.", "invalid_input");
  }
  const destinationHash = invoiceDeliveryDestinationHash(input.channel, input.destination);

  const { data, error } = await client.rpc("claim_invoice_delivery", {
    p_request_id: requestId,
    p_invoice_id: invoiceId,
    p_channel: input.channel,
    p_destination_hash: destinationHash,
    p_pdf_sha256: pdfSha256,
    p_workflow_revision: input.workflowRevision,
    p_requested_by: requestedBy
  });
  if (error) {
    throw auditError(
      "Invoice delivery could not be claimed.",
      "claim_failed",
      safeDatabaseCode(error.code)
    );
  }

  return parseClaim(singleRow(data, "Invoice delivery claim returned an invalid response."));
}

export async function recordInvoiceDeliveryOutcome(
  client: SupabaseClient,
  input: {
    requestId: string;
    completionToken: string;
    outcome: InvoiceDeliveryOutcome;
  }
): Promise<InvoiceDeliveryAuditRecord> {
  const requestId = normalizedUuid(input.requestId, "Invoice delivery request ID");
  const completionToken = normalizedUuid(input.completionToken, "Invoice delivery completion token");
  validateProviderForOutcome(input.outcome);

  const { data, error } = await client.rpc("record_invoice_delivery_result", {
    p_request_id: requestId,
    p_claim_token: completionToken,
    p_status: input.outcome.status,
    p_provider: input.outcome.provider,
    p_provider_message_id: input.outcome.status === "accepted"
      ? input.outcome.providerMessageId
      : null,
    p_provider_status: input.outcome.providerStatus ?? null,
    p_error_code: input.outcome.status === "accepted" ? null : input.outcome.errorCode
  });
  if (error) {
    throw auditError(
      "Invoice delivery result could not be recorded.",
      "record_failed",
      safeDatabaseCode(error.code)
    );
  }

  return parseAuditRecord(singleRow(data, "Invoice delivery result returned an invalid response."));
}

function parseClaim(row: Record<string, unknown>): InvoiceDeliveryClaim {
  const auditId = safeUuid(row.audit_id);
  const decision = safeClaimDecision(row.decision);
  const status = safeStatus(row.delivery_status);
  const completionToken = optionalUuid(row.completion_token);
  const provider = optionalProvider(row.delivery_provider);
  const providerMessageId = optionalIdentifier(row.delivery_provider_message_id, 256);
  const providerStatus = optionalIdentifier(row.delivery_provider_status, 80);
  const errorCode = optionalCode(row.delivery_error_code);
  const claimedAt = safeTimestamp(row.claimed_at);
  const completedAt = optionalTimestamp(row.completed_at);

  const expectedStatus: Record<InvoiceDeliveryClaimDecision, InvoiceDeliveryAuditStatus> = {
    send: "processing",
    in_flight: "processing",
    already_accepted: "accepted",
    already_failed: "failed",
    delivery_unknown: "delivery_unknown"
  };
  const processingDecision = decision === "send" || decision === "in_flight";
  if (
    !auditId
    || !decision
    || !status
    || !claimedAt
    || expectedStatus[decision] !== status
    || (decision === "send" ? !completionToken : Boolean(completionToken))
    || (processingDecision && Boolean(provider || providerMessageId || providerStatus || errorCode || completedAt))
    || (!processingDecision && !completedAt)
    || (decision === "already_accepted" && (!provider || !providerMessageId || Boolean(errorCode)))
    || (decision === "already_failed" && (!provider || !errorCode || Boolean(providerMessageId)))
    || (decision === "delivery_unknown" && (!provider || !errorCode || Boolean(providerMessageId)))
  ) {
    throw auditError("Invoice delivery claim returned an invalid response.", "invalid_response");
  }

  return {
    auditId,
    decision,
    status,
    completionToken,
    provider,
    providerMessageId,
    providerStatus,
    errorCode,
    claimedAt,
    completedAt
  };
}

function parseAuditRecord(row: Record<string, unknown>): InvoiceDeliveryAuditRecord {
  const id = safeUuid(row.id);
  const requestId = safeUuid(row.request_id);
  const invoiceId = safeUuid(row.invoice_id);
  const channel = safeChannel(row.channel);
  const destinationHash = safeSha256(row.destination_hash);
  const pdfSha256 = safeSha256(row.pdf_sha256);
  const workflowRevision = safeNonnegativeInteger(row.workflow_revision);
  const status = safeStatus(row.status);
  const provider = optionalProvider(row.provider);
  const providerMessageId = optionalIdentifier(row.provider_message_id, 256);
  const providerStatus = optionalIdentifier(row.provider_status, 80);
  const errorCode = optionalCode(row.error_code);
  const requestedBy = safeUuid(row.requested_by);
  const claimedAt = safeTimestamp(row.claimed_at);
  const acceptedAt = optionalTimestamp(row.accepted_at);
  const failedAt = optionalTimestamp(row.failed_at);
  const deliveryUnknownAt = optionalTimestamp(row.delivery_unknown_at);
  const createdAt = safeTimestamp(row.created_at);
  const updatedAt = safeTimestamp(row.updated_at);
  if (
    !id
    || !requestId
    || !invoiceId
    || !channel
    || !destinationHash
    || !pdfSha256
    || workflowRevision === undefined
    || !status
    || !requestedBy
    || !claimedAt
    || !createdAt
    || !updatedAt
    || (status === "accepted" && (!provider || !providerMessageId || !acceptedAt))
    || (status === "failed" && (!provider || !errorCode || !failedAt))
    || (status === "delivery_unknown" && (!provider || !errorCode || !deliveryUnknownAt))
  ) {
    throw auditError("Invoice delivery result returned an invalid response.", "invalid_response");
  }

  return {
    id,
    requestId,
    invoiceId,
    channel,
    destinationHash,
    pdfSha256,
    workflowRevision,
    status,
    provider,
    providerMessageId,
    providerStatus,
    errorCode,
    requestedBy,
    claimedAt,
    acceptedAt,
    failedAt,
    deliveryUnknownAt,
    createdAt,
    updatedAt
  };
}

function validateProviderForOutcome(outcome: InvoiceDeliveryOutcome): void {
  const provider = optionalProvider(outcome.provider);
  if (!provider) throw auditError("Invoice delivery provider is invalid.", "invalid_input");
  if (outcome.providerStatus !== undefined && !safeIdentifier(outcome.providerStatus, 80)) {
    throw auditError("Invoice delivery provider status is invalid.", "invalid_input");
  }
  if (outcome.status === "accepted") {
    if (!safeIdentifier(outcome.providerMessageId, 256)) {
      throw auditError("Invoice delivery provider message ID is invalid.", "invalid_input");
    }
    return;
  }
  if (!safeCode(outcome.errorCode)) {
    throw auditError("Invoice delivery error code is invalid.", "invalid_input");
  }
}

function canonicalDestination(
  channel: InvoiceDeliveryAuditChannel,
  destination: string
): string | undefined {
  if (channel === "email") return normalizeEmailRecipient(destination)?.toLowerCase();
  if (channel === "sms") return toUsE164Phone(destination);
  return undefined;
}

function normalizedUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw auditError(`${label} is invalid.`, "invalid_input");
  }
  return normalized;
}

function singleRow(data: unknown, message: string): Record<string, unknown> {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : undefined) : data;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw auditError(message, "invalid_response");
  }
  return row as Record<string, unknown>;
}

function safeUuid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function optionalUuid(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return safeUuid(value);
}

function safeSha256(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return SHA256_PATTERN.test(normalized) ? normalized : undefined;
}

function safeNonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeChannel(value: unknown): InvoiceDeliveryAuditChannel | undefined {
  return value === "email" || value === "sms" ? value : undefined;
}

function safeStatus(value: unknown): InvoiceDeliveryAuditStatus | undefined {
  return value === "processing" || value === "accepted" || value === "failed" || value === "delivery_unknown"
    ? value
    : undefined;
}

function safeClaimDecision(value: unknown): InvoiceDeliveryClaimDecision | undefined {
  return value === "send"
    || value === "already_accepted"
    || value === "in_flight"
    || value === "already_failed"
    || value === "delivery_unknown"
    ? value
    : undefined;
}

function optionalProvider(value: unknown): InvoiceDeliveryAuditProvider | undefined {
  return value === "resend" || value === "sendgrid" || value === "twilio" ? value : undefined;
}

function safeIdentifier(value: string, maxLength: number): boolean {
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= maxLength
    && SAFE_IDENTIFIER_PATTERN.test(normalized);
}

function optionalIdentifier(value: unknown, maxLength: number): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !safeIdentifier(value, maxLength)) return undefined;
  return value.trim();
}

function safeCode(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 80 && SAFE_CODE_PATTERN.test(normalized);
}

function optionalCode(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !safeCode(value)) return undefined;
  return value.trim();
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return safeTimestamp(value);
}

function safeDatabaseCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length <= 20 && /^[a-zA-Z0-9_]+$/.test(normalized) ? normalized : undefined;
}

function auditError(
  message: string,
  code: InvoiceDeliveryAuditError["code"],
  databaseCode?: string
): InvoiceDeliveryAuditError {
  return new InvoiceDeliveryAuditError({ message, code, databaseCode });
}
