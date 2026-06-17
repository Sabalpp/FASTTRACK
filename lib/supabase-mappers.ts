import { normalizePhone } from "@/lib/phone";
import type {
  AllowedUser,
  AppState,
  CallLog,
  CallLogEvent,
  Customer,
  Invoice,
  Job,
  JobLineItem,
  JobPhoto,
  Part
} from "@/lib/types";

type DbPayload = Record<string, unknown>;

type AllowedUserRow = {
  id: string;
  email: string;
  role: AllowedUser["role"];
  display_name: string;
  active: boolean;
  created_at: string;
};

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  phone_digits: string | null;
  email: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  zip: string;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

type JobRow = {
  id: string;
  customer_id: string;
  assigned_tech_id: string | null;
  status: Job["status"];
  scheduled_at: string;
  service_address: string;
  description: string;
  notes: string | null;
  originating_call_id: string | null;
  created_at: string;
  completed_at: string | null;
};

type JobPhotoRow = {
  id: string;
  job_id: string;
  storage_path: string;
  kind: JobPhoto["kind"];
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

type PartRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  default_price: string | number;
  unit: Part["unit"];
  active: boolean;
  created_at: string;
};

type JobLineItemRow = {
  id: string;
  job_id: string;
  part_id: string | null;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  tier: JobLineItem["tier"];
  is_manual: boolean;
  sort_order: number;
};

type InvoiceRow = {
  id: string;
  job_id: string;
  invoice_number: string;
  selected_tier: Invoice["selectedTier"] | null;
  subtotal_good: string | number;
  subtotal_better: string | number;
  subtotal_best: string | number;
  tax_rate: string | number;
  total_good: string | number;
  total_better: string | number;
  total_best: string | number;
  status: Invoice["status"];
  pdf_storage_path: string | null;
  sent_to_email: string | null;
  sent_at: string | null;
  created_at: string;
  created_by: string | null;
};

type CallLogRow = {
  id: string;
  external_id: string;
  customer_id: string | null;
  direction: CallLog["direction"];
  caller_phone: string;
  caller_phone_digits: string | null;
  caller_name: string | null;
  tracking_number: string | null;
  started_at: string;
  duration_seconds: number;
  answered: boolean;
  recording_url: string | null;
  transcript: string | null;
  summary: string | null;
  source: string | null;
  tags: string[] | null;
  score: number | null;
  raw_payload: unknown;
  received_at: string;
};

type CallLogEventRow = {
  id: string;
  call_log_id: string | null;
  event_type: CallLogEvent["eventType"];
  signature_valid: boolean;
  processed_ok: boolean;
  error: string | null;
  received_at: string;
};

export function createEmptyAppState(): AppState {
  return {
    allowedUsers: [],
    customers: [],
    jobs: [],
    jobPhotos: [],
    parts: [],
    jobLineItems: [],
    invoices: [],
    callLogs: [],
    callLogEvents: []
  };
}

export function allowedUserFromRow(row: AllowedUserRow): AllowedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    displayName: row.display_name,
    active: row.active,
    createdAt: row.created_at
  };
}

export function allowedUserToRow(user: AllowedUser): DbPayload {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    display_name: user.displayName,
    active: user.active,
    created_at: user.createdAt
  };
}

export function allowedUserPatchToRow(input: Partial<AllowedUser>): DbPayload {
  const row: DbPayload = {};
  if (input.email !== undefined) row.email = input.email;
  if (input.role !== undefined) row.role = input.role;
  if (input.displayName !== undefined) row.display_name = input.displayName;
  if (input.active !== undefined) row.active = input.active;
  return row;
}

export function customerFromRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    phoneDigits: row.phone_digits ?? normalizePhone(row.phone),
    email: row.email ?? undefined,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2 ?? undefined,
    city: row.city,
    state: row.state,
    zip: row.zip,
    notes: row.notes ?? "",
    createdAt: row.created_at,
    createdBy: row.created_by ?? ""
  };
}

export function customerToRow(customer: Customer): DbPayload {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email || null,
    address_line1: customer.addressLine1,
    address_line2: customer.addressLine2 || null,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    notes: customer.notes,
    created_at: customer.createdAt,
    created_by: customer.createdBy || null
  };
}

export function customerPatchToRow(input: Partial<Customer>): DbPayload {
  const row: DbPayload = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.phone !== undefined) row.phone = input.phone;
  if (input.email !== undefined) row.email = input.email || null;
  if (input.addressLine1 !== undefined) row.address_line1 = input.addressLine1;
  if (input.addressLine2 !== undefined) row.address_line2 = input.addressLine2 || null;
  if (input.city !== undefined) row.city = input.city;
  if (input.state !== undefined) row.state = input.state;
  if (input.zip !== undefined) row.zip = input.zip;
  if (input.notes !== undefined) row.notes = input.notes;
  if (input.createdBy !== undefined) row.created_by = input.createdBy || null;
  return row;
}

export function jobFromRow(row: JobRow): Job {
  return {
    id: row.id,
    customerId: row.customer_id,
    assignedTechId: row.assigned_tech_id ?? undefined,
    status: row.status,
    scheduledAt: row.scheduled_at,
    serviceAddress: row.service_address,
    description: row.description,
    notes: row.notes ?? "",
    originatingCallId: row.originating_call_id ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined
  };
}

export function jobToRow(job: Job): DbPayload {
  return {
    id: job.id,
    customer_id: job.customerId,
    assigned_tech_id: job.assignedTechId || null,
    status: job.status,
    scheduled_at: job.scheduledAt,
    service_address: job.serviceAddress,
    description: job.description,
    notes: job.notes,
    originating_call_id: job.originatingCallId || null,
    created_at: job.createdAt,
    completed_at: job.completedAt || null
  };
}

export function jobPatchToRow(input: Partial<Job>): DbPayload {
  const row: DbPayload = {};
  if (input.customerId !== undefined) row.customer_id = input.customerId;
  if (input.assignedTechId !== undefined) row.assigned_tech_id = input.assignedTechId || null;
  if (input.status !== undefined) row.status = input.status;
  if (input.scheduledAt !== undefined) row.scheduled_at = input.scheduledAt;
  if (input.serviceAddress !== undefined) row.service_address = input.serviceAddress;
  if (input.description !== undefined) row.description = input.description;
  if (input.notes !== undefined) row.notes = input.notes;
  if (input.originatingCallId !== undefined) row.originating_call_id = input.originatingCallId || null;
  if (input.completedAt !== undefined) row.completed_at = input.completedAt || null;
  return row;
}

export function jobPhotoFromRow(row: JobPhotoRow): JobPhoto {
  return {
    id: row.id,
    jobId: row.job_id,
    storagePath: row.storage_path,
    kind: row.kind,
    caption: row.caption ?? undefined,
    uploadedBy: row.uploaded_by ?? "",
    uploadedAt: row.uploaded_at
  };
}

export function jobPhotoToRow(photo: JobPhoto): DbPayload {
  return {
    id: photo.id,
    job_id: photo.jobId,
    storage_path: photo.storagePath,
    kind: photo.kind,
    caption: photo.caption || null,
    uploaded_by: photo.uploadedBy || null,
    uploaded_at: photo.uploadedAt
  };
}

export function partFromRow(row: PartRow): Part {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku ?? undefined,
    category: row.category,
    defaultPrice: Number(row.default_price),
    unit: row.unit,
    active: row.active,
    createdAt: row.created_at
  };
}

export function partToRow(part: Part): DbPayload {
  return {
    id: part.id,
    name: part.name,
    sku: part.sku || null,
    category: part.category,
    default_price: part.defaultPrice,
    unit: part.unit,
    active: part.active,
    created_at: part.createdAt
  };
}

export function lineItemFromRow(row: JobLineItemRow): JobLineItem {
  return {
    id: row.id,
    jobId: row.job_id,
    partId: row.part_id ?? undefined,
    description: row.description,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    tier: row.tier,
    isManual: row.is_manual,
    sortOrder: row.sort_order
  };
}

export function lineItemToRow(item: JobLineItem): DbPayload {
  return {
    id: item.id,
    job_id: item.jobId,
    part_id: item.partId || null,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    tier: item.tier,
    is_manual: item.isManual,
    sort_order: item.sortOrder
  };
}

export function lineItemPatchToRow(input: Partial<JobLineItem>): DbPayload {
  const row: DbPayload = {};
  if (input.partId !== undefined) row.part_id = input.partId || null;
  if (input.description !== undefined) row.description = input.description;
  if (input.quantity !== undefined) row.quantity = input.quantity;
  if (input.unitPrice !== undefined) row.unit_price = input.unitPrice;
  if (input.tier !== undefined) row.tier = input.tier;
  if (input.isManual !== undefined) row.is_manual = input.isManual;
  if (input.sortOrder !== undefined) row.sort_order = input.sortOrder;
  return row;
}

export function invoiceFromRow(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    jobId: row.job_id,
    invoiceNumber: row.invoice_number,
    selectedTier: row.selected_tier ?? undefined,
    subtotalGood: Number(row.subtotal_good),
    subtotalBetter: Number(row.subtotal_better),
    subtotalBest: Number(row.subtotal_best),
    taxRate: Number(row.tax_rate),
    totalGood: Number(row.total_good),
    totalBetter: Number(row.total_better),
    totalBest: Number(row.total_best),
    status: row.status,
    pdfStoragePath: row.pdf_storage_path ?? undefined,
    sentToEmail: row.sent_to_email ?? undefined,
    sentAt: row.sent_at ?? undefined,
    createdAt: row.created_at,
    createdBy: row.created_by ?? ""
  };
}

export function invoiceToRow(invoice: Invoice): DbPayload {
  return {
    id: invoice.id,
    job_id: invoice.jobId,
    invoice_number: invoice.invoiceNumber,
    selected_tier: invoice.selectedTier || null,
    subtotal_good: invoice.subtotalGood,
    subtotal_better: invoice.subtotalBetter,
    subtotal_best: invoice.subtotalBest,
    tax_rate: invoice.taxRate,
    total_good: invoice.totalGood,
    total_better: invoice.totalBetter,
    total_best: invoice.totalBest,
    status: invoice.status,
    pdf_storage_path: invoice.pdfStoragePath || null,
    sent_to_email: invoice.sentToEmail || null,
    sent_at: invoice.sentAt || null,
    created_at: invoice.createdAt,
    created_by: invoice.createdBy || null
  };
}

export function invoicePatchToRow(input: Partial<Invoice>): DbPayload {
  const row: DbPayload = {};
  if (input.invoiceNumber !== undefined) row.invoice_number = input.invoiceNumber;
  if (input.selectedTier !== undefined) row.selected_tier = input.selectedTier || null;
  if (input.subtotalGood !== undefined) row.subtotal_good = input.subtotalGood;
  if (input.subtotalBetter !== undefined) row.subtotal_better = input.subtotalBetter;
  if (input.subtotalBest !== undefined) row.subtotal_best = input.subtotalBest;
  if (input.taxRate !== undefined) row.tax_rate = input.taxRate;
  if (input.totalGood !== undefined) row.total_good = input.totalGood;
  if (input.totalBetter !== undefined) row.total_better = input.totalBetter;
  if (input.totalBest !== undefined) row.total_best = input.totalBest;
  if (input.status !== undefined) row.status = input.status;
  if (input.pdfStoragePath !== undefined) row.pdf_storage_path = input.pdfStoragePath || null;
  if (input.sentToEmail !== undefined) row.sent_to_email = input.sentToEmail || null;
  if (input.sentAt !== undefined) row.sent_at = input.sentAt || null;
  if (input.createdBy !== undefined) row.created_by = input.createdBy || null;
  return row;
}

export function callLogFromRow(row: CallLogRow): CallLog {
  return {
    id: row.id,
    externalId: row.external_id,
    customerId: row.customer_id ?? undefined,
    direction: row.direction,
    callerPhone: row.caller_phone,
    callerPhoneDigits: row.caller_phone_digits ?? normalizePhone(row.caller_phone),
    callerName: row.caller_name ?? undefined,
    trackingNumber: row.tracking_number ?? undefined,
    startedAt: row.started_at,
    durationSeconds: row.duration_seconds,
    answered: row.answered,
    recordingUrl: row.recording_url ?? undefined,
    transcript: row.transcript ?? undefined,
    summary: row.summary ?? undefined,
    source: row.source ?? undefined,
    tags: row.tags ?? undefined,
    score: row.score ?? undefined,
    rawPayload: row.raw_payload,
    receivedAt: row.received_at
  };
}

export function callLogEventFromRow(row: CallLogEventRow): CallLogEvent {
  return {
    id: row.id,
    callLogId: row.call_log_id ?? undefined,
    eventType: row.event_type,
    signatureValid: row.signature_valid,
    processedOk: row.processed_ok,
    error: row.error ?? undefined,
    receivedAt: row.received_at
  };
}
