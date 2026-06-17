import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { branding } from "@/lib/branding";
import { formatDate } from "@/lib/date";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, Job, JobLineItem, Tier } from "@/lib/types";

const tierNames: Record<Tier, string> = {
  good: "Good",
  better: "Better",
  best: "Best"
};

export function InvoicePdfDocument({
  invoice,
  job,
  customer,
  items
}: {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
}) {
  const selectedTier = invoice.selectedTier ?? "better";
  const selectedItems = items.filter((item) => item.tier === selectedTier);
  const subtotal = totalFor(invoice, selectedTier, "subtotal");
  const total = totalFor(invoice, selectedTier, "total");
  const tax = total - subtotal;

  return (
    <Document title={invoice.invoiceNumber} author={branding.businessName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{branding.businessName}</Text>
            <Text style={styles.small}>{branding.address}</Text>
            <Text style={styles.small}>{branding.phone}</Text>
            <Text style={styles.small}>{branding.email}</Text>
            <Text style={styles.small}>{branding.licenseNumber}</Text>
          </View>
          <View style={styles.invoiceBox}>
            <Text style={styles.invoiceTitle}>Invoice</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
            <Text style={styles.small}>{formatDate(invoice.createdAt)}</Text>
            <Text style={styles.status}>{invoice.status.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.rule} />

        <View style={styles.metaGrid}>
          <View style={styles.metaColumn}>
            <Text style={styles.label}>Bill To</Text>
            <Text style={styles.strong}>{customer.name}</Text>
            <Text style={styles.small}>{customer.email ?? "No email on file"}</Text>
            <Text style={styles.small}>{customer.phone}</Text>
            <Text style={styles.small}>{job.serviceAddress}</Text>
          </View>
          <View style={styles.metaColumn}>
            <Text style={styles.label}>Approved Work</Text>
            <Text style={styles.strong}>{job.description}</Text>
            <Text style={styles.small}>Selected option: {tierNames[selectedTier]}</Text>
            <Text style={styles.small}>Scheduled: {formatDate(job.scheduledAt)}</Text>
          </View>
        </View>

        <View style={styles.selectedBand}>
          <View>
            <Text style={styles.label}>Customer Approved Option</Text>
            <Text style={styles.optionTitle}>{tierNames[selectedTier]}</Text>
          </View>
          <Text style={styles.optionTotal}>{money(total)}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.cellDescription, styles.tableHeadText]}>Description</Text>
            <Text style={[styles.cellQty, styles.tableHeadText]}>Qty</Text>
            <Text style={[styles.cellMoney, styles.tableHeadText]}>Rate</Text>
            <Text style={[styles.cellMoney, styles.tableHeadText]}>Line Total</Text>
          </View>
          {selectedItems.length === 0 ? (
            <View style={styles.tableRow}>
              <Text style={styles.emptyLine}>No line items were added to this option.</Text>
            </View>
          ) : (
            selectedItems.map((item) => (
              <View key={item.id} style={styles.tableRow}>
                <Text style={styles.cellDescription}>{item.description}</Text>
                <Text style={styles.cellQty}>{item.quantity}</Text>
                <Text style={styles.cellMoney}>{money(item.unitPrice)}</Text>
                <Text style={styles.cellMoney}>{money(item.quantity * item.unitPrice)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.summaryBox}>
          <View style={styles.summaryLine}>
            <Text>Subtotal</Text>
            <Text>{money(subtotal)}</Text>
          </View>
          <View style={styles.summaryLine}>
            <Text>Tax {percent(invoice.taxRate)}</Text>
            <Text>{money(tax)}</Text>
          </View>
          <View style={styles.totalLine}>
            <Text>Total Due</Text>
            <Text>{money(total)}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>Thank you for choosing {branding.businessName}.</Text>
          <Text>Questions: {branding.phone} | {branding.email}</Text>
        </View>
      </Page>
    </Document>
  );
}

function totalFor(invoice: Invoice, tier: Tier, kind: "subtotal" | "total") {
  if (tier === "good") return kind === "subtotal" ? invoice.subtotalGood : invoice.totalGood;
  if (tier === "best") return kind === "subtotal" ? invoice.subtotalBest : invoice.totalBest;
  return kind === "subtotal" ? invoice.subtotalBetter : invoice.totalBetter;
}

const styles = StyleSheet.create({
  page: {
    padding: 42,
    color: "#17202a",
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.45
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  company: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 8
  },
  small: {
    color: "#4b5563",
    marginBottom: 3
  },
  invoiceBox: {
    alignItems: "flex-end"
  },
  invoiceTitle: {
    color: "#64748b",
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  invoiceNumber: {
    fontSize: 16,
    fontWeight: 700,
    marginTop: 4,
    marginBottom: 4
  },
  status: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: "#eef5f3",
    color: "#166534",
    fontSize: 8,
    fontWeight: 700
  },
  rule: {
    height: 2,
    backgroundColor: "#17202a",
    marginTop: 24,
    marginBottom: 22
  },
  metaGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24
  },
  metaColumn: {
    width: "47%"
  },
  label: {
    color: "#64748b",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: "uppercase"
  },
  strong: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 5
  },
  selectedBand: {
    backgroundColor: "#f6f8fb",
    borderRadius: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    padding: 16
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: 700
  },
  optionTotal: {
    fontSize: 20,
    fontWeight: 700
  },
  table: {
    borderColor: "#d8dee6",
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 18,
    overflow: "hidden"
  },
  tableHead: {
    backgroundColor: "#eef2f6",
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  tableHeadText: {
    color: "#475569",
    fontSize: 8,
    fontWeight: 700,
    textTransform: "uppercase"
  },
  tableRow: {
    borderTopColor: "#d8dee6",
    borderTopWidth: 1,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  cellDescription: {
    width: "55%"
  },
  cellQty: {
    textAlign: "right",
    width: "10%"
  },
  cellMoney: {
    textAlign: "right",
    width: "17.5%"
  },
  emptyLine: {
    color: "#64748b"
  },
  summaryBox: {
    alignSelf: "flex-end",
    backgroundColor: "#f8fafc",
    borderColor: "#d8dee6",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    width: 230
  },
  summaryLine: {
    color: "#334155",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8
  },
  totalLine: {
    borderTopColor: "#17202a",
    borderTopWidth: 1,
    flexDirection: "row",
    fontSize: 13,
    fontWeight: 700,
    justifyContent: "space-between",
    paddingTop: 10
  },
  footer: {
    borderTopColor: "#d8dee6",
    borderTopWidth: 1,
    bottom: 30,
    color: "#64748b",
    fontSize: 9,
    left: 42,
    paddingTop: 10,
    position: "absolute",
    right: 42
  }
});
