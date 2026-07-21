import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";
import { branding } from "@/lib/branding";
import { formatDate, formatDateTime } from "@/lib/date";
import { balanceDue, firstPopulatedTier, invoiceOptionLabels, selectedSubtotal, selectedTotal } from "@/lib/invoice";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem, Tier } from "@/lib/types";

export type InvoicePdfDocumentProps = {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
  signatures?: InvoiceSignature[];
};

type InvoiceViewModel = {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  selectedTier?: Tier;
  subtotal: number;
  tax: number;
  total: number;
  customerSignature?: InvoiceSignature;
  technicianSignature?: InvoiceSignature;
};

export function InvoicePdfDocument({ invoice, job, customer, items, signatures = [] }: InvoicePdfDocumentProps) {
  const selectedTier = firstPopulatedTier(invoice);
  const selectedInvoice = selectedTier ? { ...invoice, selectedTier } : invoice;
  const selectedItems = selectedTier
    ? items.filter((item) => item.tier === selectedTier).sort((left, right) => left.sortOrder - right.sortOrder)
    : [];
  const subtotal = selectedTier ? selectedSubtotal(selectedInvoice) : 0;
  const total = selectedTier ? selectedTotal(selectedInvoice) : 0;
  const activeSignatures = signatures.filter((signature) => signature.status === "active");
  const viewModel: InvoiceViewModel = {
    invoice: selectedInvoice,
    job,
    customer,
    selectedTier,
    subtotal,
    tax: total - subtotal,
    total,
    customerSignature: activeSignatures.find((signature) => signature.purpose === "invoice_approval"),
    technicianSignature: activeSignatures.find((signature) => signature.purpose === "technician_acknowledgement")
  };

  const addressWeight = [customer.name, customer.addressLine1, customer.addressLine2, customer.city, customer.email, job.serviceAddress]
    .filter(Boolean)
    .join(" ").length;
  const totalItemUnits = selectedItems.reduce((sum, item) => sum + itemUnits(item), 0);
  const singlePage = totalItemUnits <= 4 && addressWeight <= 300 && (invoice.notes || job.notes).length <= 340;
  const itemPages = singlePage ? [selectedItems] : paginateItems(selectedItems, addressWeight > 300 ? 6 : 8, 15);
  const totalPages = singlePage ? 1 : itemPages.length + 1;

  return (
    <Document
      title={`${invoice.invoiceNumber} - ${customer.name}`}
      author={branding.businessName}
      subject="Service invoice"
      creator="Fast Track HVAC + Plumbing"
    >
      {singlePage ? (
        <Page size="LETTER" style={styles.page}>
          <DocumentHeader invoice={invoice} />
          <InvoiceIntro model={viewModel} />
          <ServiceHeading model={viewModel} />
          <LineItemsTable items={selectedItems} />
          <InvoiceSummary model={viewModel} compact />
          <DocumentFooter invoice={invoice} pageNumber={1} totalPages={1} />
        </Page>
      ) : (
        <>
          {itemPages.map((pageItems, index) => (
            <Page key={`items-${index}`} size="LETTER" style={styles.page}>
              <DocumentHeader invoice={invoice} />
              {index === 0 ? (
                <>
                  <InvoiceIntro model={viewModel} />
                  <ServiceHeading model={viewModel} />
                </>
              ) : (
                <ContinuationHeading title="Approved work continued" invoice={invoice} />
              )}
              <LineItemsTable items={pageItems} />
              <DocumentFooter invoice={invoice} pageNumber={index + 1} totalPages={totalPages} />
            </Page>
          ))}
          <Page size="LETTER" style={styles.page}>
            <DocumentHeader invoice={invoice} />
            <ContinuationHeading title="Invoice summary & approval" invoice={invoice} />
            <InvoiceSummary model={viewModel} />
            <DocumentFooter invoice={invoice} pageNumber={totalPages} totalPages={totalPages} />
          </Page>
        </>
      )}
    </Document>
  );
}

function DocumentHeader({ invoice }: { invoice: Invoice }) {
  const logoSource = typeof window === "undefined"
    ? `${process.cwd()}/public${branding.invoiceLogoPath}`
    : branding.invoiceLogoPath;
  return (
    <View style={styles.header}>
      <View style={styles.brandBlock}>
        <Image src={logoSource} style={styles.brandLogo} />
        <View style={styles.brandCopy}>
          <Text style={styles.brandName}>{branding.businessName}</Text>
          <Text style={styles.brandContact}>{branding.address}</Text>
          <Text style={styles.brandContact}>{branding.phone}  |  {branding.email}</Text>
        </View>
      </View>
      <View style={styles.invoiceBlock}>
        <Text style={styles.invoiceTitle}>INVOICE</Text>
        <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
      </View>
      <View style={styles.headerRule} />
    </View>
  );
}

function DocumentFooter({ invoice, pageNumber, totalPages }: { invoice: Invoice; pageNumber: number; totalPages: number }) {
  return (
    <View fixed style={styles.footer}>
      <Text>{branding.website}  |  {invoice.invoiceNumber}</Text>
      <Text>Page {pageNumber} of {totalPages}</Text>
    </View>
  );
}

function InvoiceIntro({ model }: { model: InvoiceViewModel }) {
  const { invoice, job, customer } = model;
  const billToAddress = [customer.addressLine1, customer.addressLine2, `${customer.city}, ${customer.state} ${customer.zip}`]
    .filter(Boolean)
    .join("\n");
  const serviceDate = job.arrivedAt ?? job.scheduledAt;
  return (
    <>
      <View style={styles.invoiceIntro}>
        <View style={styles.partyColumn}>
          <Text style={styles.kicker}>BILL TO</Text>
          <Text style={styles.partyName}>{customer.name}</Text>
          <Text style={styles.bodyText}>{billToAddress}</Text>
          <Text style={styles.bodyText}>{customer.phone}</Text>
          {customer.email ? <Text style={styles.bodyText}>{customer.email}</Text> : null}
        </View>
        <View style={styles.partyColumn}>
          <Text style={styles.kicker}>SERVICE LOCATION</Text>
          <Text style={styles.partyName}>{job.serviceAddress}</Text>
          <Text style={styles.bodyText}>{job.description}</Text>
        </View>
      </View>
      <View style={styles.factGrid}>
        <Fact label="Issue date" value={formatDate(invoice.createdAt)} />
        <Fact label="Service date" value={formatDate(serviceDate)} />
        <Fact label="Approval" value="Customer approved" />
        <Fact label="Payment" value={paymentLabel(invoice.paymentStatus)} last />
      </View>
    </>
  );
}

function ServiceHeading({ model }: { model: InvoiceViewModel }) {
  return (
    <View style={styles.sectionHeading}>
      <View>
        <Text style={styles.kicker}>SERVICE DETAILS</Text>
        <Text style={styles.sectionTitle}>{invoiceOptionLabels[model.invoice.optionLabel]}</Text>
      </View>
      <Text style={styles.sectionAmount}>{money(model.total)}</Text>
    </View>
  );
}

function ContinuationHeading({ title, invoice }: { title: string; invoice: Invoice }) {
  return (
    <View style={styles.continuationHeading}>
      <View><Text style={styles.kicker}>SERVICE INVOICE</Text><Text style={styles.continuationTitle}>{title}</Text></View>
      <View style={styles.continuationMeta}><Text>{invoice.invoiceNumber}</Text><Text>{formatDate(invoice.createdAt)}</Text></View>
    </View>
  );
}

function LineItemsTable({ items }: { items: JobLineItem[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderText, styles.descriptionColumn]}>DESCRIPTION</Text>
        <Text style={[styles.tableHeaderText, styles.qtyColumn]}>QTY</Text>
        <Text style={[styles.tableHeaderText, styles.rateColumn]}>RATE</Text>
        <Text style={[styles.tableHeaderText, styles.amountColumn]}>AMOUNT</Text>
      </View>
      {items.length > 0 ? items.map((item, index) => (
        <View key={item.id} wrap={false} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlternate : {}]}>
          <Text style={[styles.tableCell, styles.descriptionColumn]}>{item.description}</Text>
          <Text style={[styles.tableCell, styles.numericCell, styles.qtyColumn]}>{formatQuantity(item.quantity)}</Text>
          <Text style={[styles.tableCell, styles.numericCell, styles.rateColumn]}>{money(item.unitPrice)}</Text>
          <Text style={[styles.tableCell, styles.numericCell, styles.amountColumn]}>{money(item.quantity * item.unitPrice)}</Text>
        </View>
      )) : (
        <View style={styles.emptyRow}><Text style={styles.emptyText}>No approved work items are selected.</Text></View>
      )}
    </View>
  );
}

function InvoiceSummary({ model, compact = false }: { model: InvoiceViewModel; compact?: boolean }) {
  const { invoice, job, customerSignature, technicianSignature } = model;
  return (
    <View style={compact ? styles.compactSummary : styles.summaryPageBody}>
      <View style={styles.summaryArea}>
        <View style={styles.notesCard}>
          <Text style={styles.kicker}>WORK SUMMARY & NOTES</Text>
          <Text style={styles.notesText}>{invoice.notes || job.notes || "No additional notes."}</Text>
        </View>
        <View style={styles.totalsCard}>
          <TotalRow label="Subtotal" value={money(model.subtotal)} />
          <TotalRow label={`Tax (${percent(invoice.taxRate)})`} value={money(model.tax)} />
          <TotalRow label="Total" value={money(model.total)} strong />
          <TotalRow label="Paid" value={money(invoice.amountPaid)} />
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>BALANCE DUE</Text>
            <Text style={styles.balanceValue}>{money(balanceDue(invoice))}</Text>
          </View>
        </View>
      </View>

      <View style={styles.paymentNotice}>
        <Text style={styles.paymentNoticeTitle}>PAYMENT STATUS: {paymentLabel(invoice.paymentStatus).toUpperCase()}</Text>
        <Text style={styles.paymentNoticeText}>Reference {invoice.invoiceNumber} with payment. Card details are never collected on this document.</Text>
      </View>

      <View style={styles.approvalSection}>
        <Text style={styles.kicker}>REVIEW & APPROVAL</Text>
        <Text style={styles.approvalTerms}>The signer confirms that the listed work and charges were reviewed and approved. The signature is linked to this invoice and retained with an audit timestamp.</Text>
        <View style={styles.signatureGrid}>
          <SignatureBlock signature={customerSignature} title="Customer approval" wide={!technicianSignature} />
          {technicianSignature ? <SignatureBlock signature={technicianSignature} title="Technician / company" /> : null}
        </View>
      </View>

      <View style={styles.thankYou}>
        <Text style={styles.thankYouTitle}>Thank you for choosing Fast Track.</Text>
        <Text style={styles.thankYouText}>Questions? Call {branding.phone} or email {branding.email}.</Text>
      </View>
    </View>
  );
}

function Fact({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fact, last ? styles.factLast : {}]}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={[styles.totalRow, strong ? styles.totalRowStrong : {}]}>
      <Text style={strong ? styles.totalStrongText : styles.totalText}>{label}</Text>
      <Text style={strong ? styles.totalStrongText : styles.totalText}>{value}</Text>
    </View>
  );
}

function SignatureBlock({ signature, title, wide = false }: { signature?: InvoiceSignature; title: string; wide?: boolean }) {
  return (
    <View style={[styles.signatureCard, wide ? styles.signatureCardWide : {}]}>
      <Text style={styles.signatureTitle}>{title}</Text>
      <View style={styles.signatureImageArea}>
        {signature?.imageUrl ? <Image src={signature.imageUrl} style={styles.signatureImage} /> : <Text style={styles.signaturePending}>Signature not saved</Text>}
      </View>
      <View style={styles.signatureLine} />
      <Text style={styles.signatureName}>{signature?.signerName ?? "Pending"}</Text>
      <Text style={styles.signatureMeta}>{signature ? `${roleLabel(signature.signerRole)}  |  ${formatDateTime(signature.signedAt)}` : "No approval timestamp"}</Text>
    </View>
  );
}

function paginateItems(items: JobLineItem[], firstCapacity: number, continuationCapacity: number) {
  if (items.length === 0) return [[]];
  const pages: JobLineItem[][] = [];
  let page: JobLineItem[] = [];
  let used = 0;
  let capacity = firstCapacity;
  for (const item of items) {
    const units = itemUnits(item);
    if (page.length > 0 && used + units > capacity) {
      pages.push(page);
      page = [];
      used = 0;
      capacity = continuationCapacity;
    }
    page.push(item);
    used += units;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function itemUnits(item: JobLineItem) {
  return Math.max(1, Math.ceil(item.description.length / 110));
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function paymentLabel(status: Invoice["paymentStatus"]) {
  if (status === "partially_paid") return "Partially paid";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function roleLabel(role: InvoiceSignature["signerRole"]) {
  if (role === "customer") return "Customer";
  if (role === "technician") return "Technician";
  return "Company";
}

const colors = {
  ink: "#102A36",
  muted: "#5F6F78",
  line: "#DCE5E9",
  soft: "#F4F8F9",
  brand: "#164E63",
  accent: "#F97316",
  white: "#FFFFFF",
  green: "#166534"
};

const styles = StyleSheet.create({
  page: { paddingTop: 30, paddingRight: 40, paddingBottom: 46, paddingLeft: 40, backgroundColor: colors.white, color: colors.ink, fontFamily: "Helvetica", fontSize: 8.6, lineHeight: 1.35 },
  header: { position: "relative", height: 66, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  brandBlock: { flexDirection: "row", alignItems: "center", width: "72%" },
  brandLogo: { width: 48, height: 38, marginRight: 10, objectFit: "contain" },
  brandCopy: { flex: 1 },
  brandName: { color: colors.brand, fontSize: 13, fontWeight: 700, marginBottom: 1 },
  brandContact: { color: colors.muted, fontSize: 7.2, marginBottom: 1 },
  invoiceBlock: { alignItems: "flex-end", minWidth: 92 },
  invoiceTitle: { color: colors.brand, fontSize: 17, fontWeight: 700, letterSpacing: 1.1, lineHeight: 1.05 },
  invoiceNumber: { color: colors.muted, fontSize: 8.5, marginTop: 3, lineHeight: 1.1 },
  headerRule: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: colors.accent },
  invoiceIntro: { flexDirection: "row", marginBottom: 10 },
  partyColumn: { width: "50%", paddingRight: 16 },
  kicker: { color: colors.accent, fontSize: 6.8, fontWeight: 700, letterSpacing: 0.75, marginBottom: 4 },
  partyName: { color: colors.ink, fontSize: 10, fontWeight: 700, marginBottom: 2 },
  bodyText: { color: colors.muted, fontSize: 7.8, marginBottom: 1 },
  factGrid: { flexDirection: "row", borderWidth: 1, borderColor: colors.line, borderRadius: 6, marginBottom: 12, backgroundColor: colors.soft },
  fact: { width: "25%", paddingVertical: 6, paddingHorizontal: 9, borderRightWidth: 1, borderRightColor: colors.line },
  factLast: { borderRightWidth: 0 },
  factLabel: { color: colors.muted, fontSize: 6.3, textTransform: "uppercase", marginBottom: 2 },
  factValue: { color: colors.ink, fontSize: 7.8, fontWeight: 700, textTransform: "capitalize" },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 },
  sectionTitle: { fontSize: 12.5, fontWeight: 700 },
  sectionAmount: { color: colors.brand, fontSize: 13.5, fontWeight: 700 },
  continuationHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 10 },
  continuationTitle: { color: colors.ink, fontSize: 14, fontWeight: 700 },
  continuationMeta: { alignItems: "flex-end", color: colors.muted, fontSize: 7.5 },
  table: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, overflow: "hidden", marginBottom: 10 },
  tableHeader: { flexDirection: "row", backgroundColor: colors.brand, paddingVertical: 6, paddingHorizontal: 9 },
  tableHeaderText: { color: colors.white, fontSize: 6.5, fontWeight: 700, letterSpacing: 0.35 },
  tableRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 9, borderTopWidth: 1, borderTopColor: colors.line },
  tableRowAlternate: { backgroundColor: colors.soft },
  tableCell: { color: colors.ink, fontSize: 7.7, paddingRight: 7 },
  numericCell: { textAlign: "right", paddingRight: 0 },
  descriptionColumn: { width: "56%" },
  qtyColumn: { width: "10%", textAlign: "right" },
  rateColumn: { width: "17%", textAlign: "right" },
  amountColumn: { width: "17%", textAlign: "right" },
  emptyRow: { padding: 12, alignItems: "center" },
  emptyText: { color: colors.muted, fontSize: 8 },
  compactSummary: { marginTop: 0 },
  summaryPageBody: { paddingTop: 4 },
  summaryArea: { flexDirection: "row", marginBottom: 9 },
  notesCard: { width: "56%", minHeight: 70, marginRight: 14, padding: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 6 },
  notesText: { color: colors.muted, fontSize: 7.8 },
  totalsCard: { width: "44%", borderWidth: 1, borderColor: colors.line, borderRadius: 6, overflow: "hidden" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 9, borderBottomWidth: 1, borderBottomColor: colors.line },
  totalRowStrong: { backgroundColor: colors.soft },
  totalText: { color: colors.muted, fontSize: 7.5 },
  totalStrongText: { color: colors.ink, fontSize: 8, fontWeight: 700 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 9, backgroundColor: colors.brand },
  balanceLabel: { color: colors.white, fontSize: 7.2, fontWeight: 700 },
  balanceValue: { color: colors.white, fontSize: 9.5, fontWeight: 700 },
  paymentNotice: { padding: 7, borderLeftWidth: 3, borderLeftColor: colors.green, backgroundColor: "#F0FDF4", marginBottom: 9 },
  paymentNoticeTitle: { color: colors.green, fontSize: 6.8, fontWeight: 700, marginBottom: 2 },
  paymentNoticeText: { color: colors.muted, fontSize: 7.4 },
  approvalSection: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, marginBottom: 8 },
  approvalTerms: { color: colors.muted, fontSize: 7.2, marginBottom: 6 },
  signatureGrid: { flexDirection: "row" },
  signatureCard: { width: "50%", minHeight: 76, padding: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 6 },
  signatureCardWide: { width: "100%" },
  signatureTitle: { color: colors.ink, fontSize: 7.4, fontWeight: 700 },
  signatureImageArea: { height: 34, justifyContent: "center", alignItems: "center", marginTop: 1 },
  signatureImage: { width: 145, height: 32, objectFit: "contain" },
  signaturePending: { color: colors.muted, fontSize: 7.3 },
  signatureLine: { height: 1, backgroundColor: colors.ink, marginBottom: 2 },
  signatureName: { color: colors.ink, fontSize: 7.5, fontWeight: 700 },
  signatureMeta: { color: colors.muted, fontSize: 6.2, marginTop: 1 },
  thankYou: { alignItems: "center", paddingTop: 3 },
  thankYouTitle: { color: colors.brand, fontSize: 9.5, fontWeight: 700, marginBottom: 1 },
  thankYouText: { color: colors.muted, fontSize: 6.9 },
  footer: { position: "absolute", left: 40, right: 40, bottom: 20, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 5, color: colors.muted, fontSize: 6.5 }
});
