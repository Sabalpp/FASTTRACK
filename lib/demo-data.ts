import { normalizePhone } from "@/lib/phone";
import type { AppState } from "@/lib/types";

const now = "2026-06-02T09:00:00.000Z";

// Keep the sample dispatch board useful instead of letting every open demo job
// age into an arrival exception. UTC keeps server and browser rendering aligned.
const demoToday = new Date();
demoToday.setUTCHours(0, 0, 0, 0);

function demoJobTime(dayOffset: number, hour: number, minute = 0) {
  const value = new Date(demoToday);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  value.setUTCHours(hour, minute, 0, 0);
  return value.toISOString();
}

export const demoState: AppState = {
  allowedUsers: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: "owner@fasttrack.test",
      role: "owner",
      displayName: "Jordan Owner",
      active: true,
      createdAt: now
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      email: "tech@fasttrack.test",
      role: "tech",
      displayName: "Maya Tech",
      active: true,
      createdAt: now
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      email: "tech2@fasttrack.test",
      role: "tech",
      displayName: "Carlos Tech",
      active: true,
      createdAt: now
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      email: "calls@fasttrack.test",
      role: "call_center",
      displayName: "Priya Call Center",
      active: true,
      createdAt: now
    }
  ],
  customers: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "John Smith",
      phone: "(703) 555-1234",
      phoneDigits: normalizePhone("(703) 555-1234"),
      emailNotificationsEnabled: true,
      smsConsentStatus: "opted_in",
      smsConsentAt: "2026-06-10T14:00:00.000Z",
      smsConsentSource: "customer_intake",
      email: "john.smith@example.com",
      addressLine1: "421 Maple Ridge Dr",
      city: "Ashburn",
      state: "VA",
      zip: "20147",
      notes: "Prefers afternoon appointments. Upstairs unit is noisy.",
      createdAt: "2026-05-28T15:00:00.000Z",
      createdBy: "44444444-4444-4444-4444-444444444444"
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      name: "Alicia Nguyen",
      phone: "+1 571 555 9090",
      phoneDigits: normalizePhone("+1 571 555 9090"),
      emailNotificationsEnabled: true,
      smsConsentStatus: "unknown",
      email: "alicia.nguyen@example.com",
      addressLine1: "88 Market Station Blvd",
      addressLine2: "Unit 302",
      city: "Leesburg",
      state: "VA",
      zip: "20176",
      notes: "Water heater is in a narrow utility closet.",
      createdAt: "2026-05-29T14:10:00.000Z",
      createdBy: "44444444-4444-4444-4444-444444444444"
    },
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      name: "Robert Johnson",
      phone: "703.555.7711",
      phoneDigits: normalizePhone("703.555.7711"),
      emailNotificationsEnabled: true,
      smsConsentStatus: "opted_in",
      smsConsentAt: "2026-06-12T15:30:00.000Z",
      smsConsentSource: "customer_intake",
      email: "rjohnson@example.com",
      addressLine1: "209 Old Courthouse Rd",
      city: "Vienna",
      state: "VA",
      zip: "22182",
      notes: "Ask about crawlspace access before arrival.",
      createdAt: "2026-05-30T11:35:00.000Z",
      createdBy: "11111111-1111-1111-1111-111111111111"
    },
    {
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      name: "Samira Patel",
      phone: "(703) 555-4488",
      phoneDigits: normalizePhone("(703) 555-4488"),
      emailNotificationsEnabled: true,
      smsConsentStatus: "opted_out",
      email: "samira.patel@example.com",
      addressLine1: "17 Cedar Branch Ct",
      city: "Reston",
      state: "VA",
      zip: "20191",
      notes: "Drain line has clogged twice this spring.",
      createdAt: "2026-05-31T10:25:00.000Z",
      createdBy: "44444444-4444-4444-4444-444444444444"
    }
  ],
  jobs: [
    {
      id: "job-aaaaaaaa-0001-4000-8000-000000000001",
      customerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      assignedTechId: "22222222-2222-2222-2222-222222222222",
      status: "in_progress",
      scheduledAt: demoJobTime(0, 14),
      arrivalWindowEndAt: demoJobTime(0, 17),
      arrivedAt: demoJobTime(0, 13, 52),
      serviceAddress: "421 Maple Ridge Dr, Ashburn, VA 20147",
      description: "No cooling upstairs. Customer reports unit runs constantly.",
      notes: "Outdoor unit has weak capacitor reading. Need options for repair vs replacement.",
      createdAt: "2026-06-01T17:00:00.000Z"
    },
    {
      id: "job-bbbbbbbb-0002-4000-8000-000000000002",
      customerId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      assignedTechId: "22222222-2222-2222-2222-222222222222",
      status: "scheduled",
      scheduledAt: demoJobTime(0, 18, 30),
      arrivalWindowEndAt: demoJobTime(0, 21, 30),
      serviceAddress: "88 Market Station Blvd Unit 302, Leesburg, VA 20176",
      description: "Water heater not heating consistently.",
      notes: "Bring compact tool bag for closet access.",
      createdAt: "2026-06-01T18:20:00.000Z"
    },
    {
      id: "job-cccccccc-0003-4000-8000-000000000003",
      customerId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      assignedTechId: "33333333-3333-3333-3333-333333333333",
      status: "scheduled",
      scheduledAt: demoJobTime(1, 13),
      arrivalWindowEndAt: demoJobTime(1, 16),
      serviceAddress: "209 Old Courthouse Rd, Vienna, VA 22182",
      description: "Annual HVAC inspection and thermostat upgrade quote.",
      notes: "Customer asked for good/better/best thermostat options.",
      createdAt: "2026-06-01T20:10:00.000Z"
    },
    {
      id: "job-dddddddd-0004-4000-8000-000000000004",
      customerId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      assignedTechId: "33333333-3333-3333-3333-333333333333",
      status: "complete",
      scheduledAt: demoJobTime(-1, 15),
      arrivalWindowEndAt: demoJobTime(-1, 18),
      arrivedAt: demoJobTime(-1, 15, 8),
      serviceAddress: "17 Cedar Branch Ct, Reston, VA 20191",
      description: "Drain line clearing and AC inspection.",
      notes: "Drain cleared. Recommend condensate safety switch.",
      createdAt: "2026-05-31T18:00:00.000Z",
      completedAt: demoJobTime(-1, 16, 20)
    }
  ],
  jobPhotos: [
    {
      id: "photo-0001-0000-4000-8000-000000000001",
      jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
      storagePath: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=900&q=80",
      kind: "before",
      caption: "Outdoor condenser before inspection",
      uploadedBy: "22222222-2222-2222-2222-222222222222",
      uploadedAt: "2026-06-02T14:15:00.000Z"
    }
  ],
  parts: [
    {
      id: "part-0001-0000-4000-8000-000000000001",
      name: "Diagnostic Visit",
      sku: "DIAG",
      category: "Service",
      defaultPrice: 89,
      unit: "visit",
      active: true,
      createdAt: now
    },
    {
      id: "part-0002-0000-4000-8000-000000000002",
      name: "Labor Hour",
      sku: "LABOR-HR",
      category: "Labor",
      defaultPrice: 125,
      unit: "hour",
      active: true,
      createdAt: now
    },
    {
      id: "part-0003-0000-4000-8000-000000000003",
      name: "Run Capacitor",
      sku: "CAP-45-5",
      category: "HVAC",
      defaultPrice: 245,
      unit: "each",
      active: true,
      createdAt: now
    },
    {
      id: "part-0004-0000-4000-8000-000000000004",
      name: "Condenser Coil Replacement",
      sku: "COIL-COND",
      category: "HVAC",
      defaultPrice: 1850,
      unit: "each",
      active: true,
      createdAt: now
    },
    {
      id: "part-0005-0000-4000-8000-000000000005",
      name: "Drain Line Clearing",
      sku: "DRAIN-CLEAR",
      category: "Plumbing",
      defaultPrice: 195,
      unit: "each",
      active: true,
      createdAt: now
    },
    {
      id: "part-0006-0000-4000-8000-000000000006",
      name: "Water Heater Element",
      sku: "WH-ELEMENT",
      category: "Plumbing",
      defaultPrice: 275,
      unit: "each",
      active: true,
      createdAt: now
    },
    {
      id: "part-0007-0000-4000-8000-000000000007",
      name: "Refrigerant R-410A",
      sku: "R410A",
      category: "HVAC",
      defaultPrice: 145,
      unit: "lb",
      active: true,
      createdAt: now
    },
    {
      id: "part-0008-0000-4000-8000-000000000008",
      name: "Smart Thermostat Install",
      sku: "THERMO-SMART",
      category: "HVAC",
      defaultPrice: 425,
      unit: "each",
      active: true,
      createdAt: now
    }
  ],
  jobLineItems: [
    {
      id: "line-0001-0000-4000-8000-000000000001",
      jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
      partId: "part-0001-0000-4000-8000-000000000001",
      description: "Diagnostic Visit",
      quantity: 1,
      unitPrice: 89,
      tier: "good",
      isManual: false,
      sortOrder: 1
    },
    {
      id: "line-0002-0000-4000-8000-000000000002",
      jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
      partId: "part-0003-0000-4000-8000-000000000003",
      description: "Run Capacitor Replacement",
      quantity: 1,
      unitPrice: 245,
      tier: "better",
      isManual: false,
      sortOrder: 2
    },
    {
      id: "line-0003-0000-4000-8000-000000000003",
      jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
      partId: "part-0004-0000-4000-8000-000000000004",
      description: "Condenser Coil Replacement",
      quantity: 1,
      unitPrice: 1850,
      tier: "best",
      isManual: false,
      sortOrder: 3
    },
    {
      id: "line-0004-0000-4000-8000-000000000004",
      jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
      partId: "part-0002-0000-4000-8000-000000000002",
      description: "Labor Hour",
      quantity: 2,
      unitPrice: 125,
      tier: "best",
      isManual: false,
      sortOrder: 4
    },
    {
      id: "line-0005-0000-4000-8000-000000000005",
      jobId: "job-dddddddd-0004-4000-8000-000000000004",
      partId: "part-0005-0000-4000-8000-000000000005",
      description: "Drain Line Clearing",
      quantity: 1,
      unitPrice: 195,
      tier: "good",
      isManual: false,
      sortOrder: 1
    }
  ],
  invoices: [
    {
      id: "invoice-0001-0000-4000-8000-000000000001",
      jobId: "job-dddddddd-0004-4000-8000-000000000004",
      invoiceNumber: "INV-000001",
      selectedTier: "good",
      subtotalGood: 195,
      subtotalBetter: 0,
      subtotalBest: 0,
      taxRate: 0.06,
      totalGood: 206.7,
      totalBetter: 0,
      totalBest: 0,
      status: "draft",
      optionLabel: "approved_work",
      notes: "Drain cleared and system inspected. Condensate safety switch recommended for a future visit.",
      paymentStatus: "unpaid",
      amountPaid: 0,
      approvalStatus: "not_signed",
      pdfVersion: 0,
      createdAt: "2026-06-01T16:30:00.000Z",
      createdBy: "33333333-3333-3333-3333-333333333333",
      updatedAt: "2026-06-01T16:30:00.000Z"
    }
  ],
  callLogs: [
    {
      id: "call-0001-0000-4000-8000-000000000001",
      externalId: "demo-call-001",
      customerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      direction: "inbound",
      callerPhone: "(703) 555-1234",
      callerPhoneDigits: normalizePhone("(703) 555-1234"),
      callerName: "John Smith",
      trackingNumber: "Phase 2 placeholder",
      startedAt: "2026-06-01T16:45:00.000Z",
      durationSeconds: 360,
      answered: true,
      transcript: "Phase 2 placeholder transcript. Customer reported upstairs unit is not cooling.",
      summary: "Customer called about no cooling upstairs. Schedule diagnostic visit.",
      source: "CallRail Phase 2 scaffold",
      tags: ["no-cooling", "scheduled"],
      score: 4,
      rawPayload: { demo: true },
      receivedAt: "2026-06-01T16:51:00.000Z"
    }
  ],
  callLogEvents: []
};
