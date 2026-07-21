import { branding } from "@/lib/branding";
import type { Invoice, InvoiceOptionLabel, JobLineItem, Tier } from "@/lib/types";

const tierKeys: Tier[] = ["standard", "good", "better", "best"];

export function subtotalForTier(items: JobLineItem[], tier: Tier): number {
  return items
    .filter((item) => item.tier === tier)
    .reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
}

export function totalsForItems(items: JobLineItem[], taxRate = branding.taxRate) {
  const subtotals = Object.fromEntries(
    tierKeys.map((tier) => [tier, subtotalForTier(items, tier)])
  ) as Record<Tier, number>;

  return {
    subtotalStandard: roundMoney(subtotals.standard),
    subtotalGood: roundMoney(subtotals.good),
    subtotalBetter: roundMoney(subtotals.better),
    subtotalBest: roundMoney(subtotals.best),
    taxRate,
    totalStandard: roundMoney(subtotals.standard * (1 + taxRate)),
    totalGood: roundMoney(subtotals.good * (1 + taxRate)),
    totalBetter: roundMoney(subtotals.better * (1 + taxRate)),
    totalBest: roundMoney(subtotals.best * (1 + taxRate))
  };
}

export function buildInvoiceDraft(params: {
  id: string;
  jobId: string;
  invoiceNumber: string;
  createdBy: string;
  existing?: Invoice;
  items: JobLineItem[];
}): Invoice {
  const totals = totalsForItems(params.items);
  return {
    id: params.existing?.id ?? params.id,
    jobId: params.jobId,
    invoiceNumber: params.existing?.invoiceNumber ?? params.invoiceNumber,
    selectedTier: params.existing?.selectedTier,
    ...totals,
    status: params.existing?.status ?? "draft",
    optionLabel: params.existing?.optionLabel ?? "approved_work",
    notes: params.existing?.notes ?? "",
    paymentStatus: params.existing?.paymentStatus ?? "unpaid",
    amountPaid: params.existing?.amountPaid ?? 0,
    approvalStatus: params.existing?.approvalStatus ?? "not_signed",
    approvedAt: params.existing?.approvedAt,
    pdfStoragePath: params.existing?.pdfStoragePath,
    pdfVersion: params.existing?.pdfVersion ?? 0,
    pdfGeneratedAt: params.existing?.pdfGeneratedAt,
    pdfSha256: params.existing?.pdfSha256,
    pdfSizeBytes: params.existing?.pdfSizeBytes,
    sentToEmail: params.existing?.sentToEmail,
    sentAt: params.existing?.sentAt,
    createdAt: params.existing?.createdAt ?? new Date().toISOString(),
    createdBy: params.existing?.createdBy ?? params.createdBy,
    updatedAt: new Date().toISOString()
  };
}

export function invoiceNumber(sequence: number): string {
  return `INV-${String(sequence).padStart(6, "0")}`;
}

export function selectedTotal(invoice: Invoice): number {
  if (invoice.selectedTier === "standard") return invoice.totalStandard ?? 0;
  if (invoice.selectedTier === "good") return invoice.totalGood;
  if (invoice.selectedTier === "better") return invoice.totalBetter;
  if (invoice.selectedTier === "best") return invoice.totalBest;
  return invoice.totalStandard || invoice.totalBetter || invoice.totalGood || invoice.totalBest;
}

export function selectedSubtotal(invoice: Invoice): number {
  if (invoice.selectedTier === "standard") return invoice.subtotalStandard ?? 0;
  if (invoice.selectedTier === "good") return invoice.subtotalGood;
  if (invoice.selectedTier === "better") return invoice.subtotalBetter;
  if (invoice.selectedTier === "best") return invoice.subtotalBest;
  return 0;
}

export function balanceDue(invoice: Invoice): number {
  return roundMoney(Math.max(0, selectedTotal(invoice) - invoice.amountPaid));
}

export function firstPopulatedTier(invoice: Invoice): Tier | undefined {
  if (invoice.selectedTier) return invoice.selectedTier;
  if ((invoice.totalStandard ?? 0) > 0) return "standard";
  if (invoice.totalGood > 0) return "good";
  if (invoice.totalBetter > 0) return "better";
  if (invoice.totalBest > 0) return "best";
  return undefined;
}

export const invoiceOptionLabels: Record<InvoiceOptionLabel, string> = {
  standard_service: "Standard service",
  approved_work: "Approved work",
  selected_option: "Selected option",
  custom_estimate: "Custom estimate"
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
