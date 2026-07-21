export type Role = "owner" | "tech" | "call_center";
export type JobStatus = "scheduled" | "in_progress" | "complete" | "cancelled";
export type PhotoKind = "before" | "after" | "other";
export type Unit = "each" | "hour" | "lb" | "visit" | "other";
export type Tier = "good" | "better" | "best";
export type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";
export type CallDirection = "inbound" | "outbound";
export type CallEventType = "pre_call" | "post_call" | "call_modified" | "unknown";

export type AllowedUser = {
  id: string;
  email: string;
  role: Role;
  displayName: string;
  active: boolean;
  createdAt: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  phoneDigits: string;
  email?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  createdAt: string;
  createdBy: string;
};

export type Job = {
  id: string;
  customerId: string;
  assignedTechId?: string | null;
  status: JobStatus;
  scheduledAt: string;
  arrivalWindowEndAt: string;
  arrivedAt?: string;
  serviceAddress: string;
  description: string;
  notes: string;
  originatingCallId?: string;
  createdAt: string;
  completedAt?: string | null;
};

export type JobPhoto = {
  id: string;
  jobId: string;
  storagePath: string;
  kind: PhotoKind;
  caption?: string;
  uploadedBy: string;
  uploadedAt: string;
};

export type Part = {
  id: string;
  name: string;
  sku?: string;
  category: string;
  defaultPrice: number;
  unit: Unit;
  active: boolean;
  createdAt: string;
};

export type JobLineItem = {
  id: string;
  jobId: string;
  partId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  tier: Tier;
  isManual: boolean;
  sortOrder: number;
};

export type Invoice = {
  id: string;
  jobId: string;
  invoiceNumber: string;
  selectedTier?: Tier;
  subtotalGood: number;
  subtotalBetter: number;
  subtotalBest: number;
  taxRate: number;
  totalGood: number;
  totalBetter: number;
  totalBest: number;
  status: InvoiceStatus;
  pdfStoragePath?: string;
  sentToEmail?: string;
  sentAt?: string;
  createdAt: string;
  createdBy: string;
};

export type CallLog = {
  id: string;
  externalId: string;
  customerId?: string;
  direction: CallDirection;
  callerPhone: string;
  callerPhoneDigits: string;
  callerName?: string;
  trackingNumber?: string;
  startedAt: string;
  durationSeconds: number;
  answered: boolean;
  recordingUrl?: string;
  transcript?: string;
  summary?: string;
  source?: string;
  tags?: string[];
  score?: number;
  rawPayload?: unknown;
  receivedAt: string;
};

export type CallLogEvent = {
  id: string;
  callLogId?: string;
  eventType: CallEventType;
  signatureValid: boolean;
  processedOk: boolean;
  error?: string;
  receivedAt: string;
};

export type AppState = {
  allowedUsers: AllowedUser[];
  customers: Customer[];
  jobs: Job[];
  jobPhotos: JobPhoto[];
  parts: Part[];
  jobLineItems: JobLineItem[];
  invoices: Invoice[];
  callLogs: CallLog[];
  callLogEvents: CallLogEvent[];
};
