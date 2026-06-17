import { branding } from "@/lib/branding";
import type { Invoice, JobLineItem, Tier } from "@/lib/types";

const tierKeys: Tier[] = ["good", "better", "best"];

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
    subtotalGood: roundMoney(subtotals.good),
    subtotalBetter: roundMoney(subtotals.better),
    subtotalBest: roundMoney(subtotals.best),
    taxRate,
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
    pdfStoragePath: params.existing?.pdfStoragePath,
    sentToEmail: params.existing?.sentToEmail,
    sentAt: params.existing?.sentAt,
    createdAt: params.existing?.createdAt ?? new Date().toISOString(),
    createdBy: params.existing?.createdBy ?? params.createdBy
  };
}

export function invoiceNumber(sequence: number): string {
  return `INV-${String(sequence).padStart(6, "0")}`;
}

export function selectedTotal(invoice: Invoice): number {
  if (invoice.selectedTier === "good") return invoice.totalGood;
  if (invoice.selectedTier === "better") return invoice.totalBetter;
  if (invoice.selectedTier === "best") return invoice.totalBest;
  return invoice.totalBetter || invoice.totalGood || invoice.totalBest;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
