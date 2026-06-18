import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { branding } from "@/lib/branding";
import { tierLabels } from "@/lib/data-store";
import { formatDate } from "@/lib/date";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, Job, JobLineItem, Tier } from "@/lib/types";

const tierOrder: Tier[] = ["good", "better", "best"];

const authorizationText =
  "An estimate includes diagnosis/estimate, parts, and labor. I hereby authorize repairs and agree to pay for them upon completion of the job. If repairs require a part order, I agree to pay a deposit. I understand that the deposited amount will apply to the total for the trip to install parts. Company/technicians are not responsible for damages.";

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
  const selectedTier = invoice.selectedTier ?? "good";
  const selectedSubtotal = totalFor(invoice, selectedTier, "subtotal");
  const selectedTotal = totalFor(invoice, selectedTier, "total");
  const selectedTax = selectedTotal - selectedSubtotal;

  return (
    <Document title={invoice.invoiceNumber} author={branding.businessName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.logoBlock}>
            <Text style={styles.logoMain}>FAST TRACK</Text>
            <Text style={styles.logoSub}>REPAIR SERVICE</Text>
          </View>
          <View style={styles.contactBlock}>
            <Text style={styles.contactLine}>13817 Fount Beattie Ct.</Text>
            <Text style={styles.contactLine}>CENTREVILLE, VA 20121</Text>
            <Text style={styles.contactLine}>PHONE: +1 7038995615</Text>
            <Text style={styles.contactLine}>E-MAIL: Info@fasttrackdmv.org</Text>
            <Text style={styles.contactLine}>WEBSITE: WWW.FASTTRACKDMV.ORG</Text>
          </View>
          <View style={styles.invoiceMeta}>
            <View style={styles.metaLine}>
              <Text style={styles.metaLabel}>INVOICE NO:</Text>
              <Text style={styles.metaValue}>{invoice.invoiceNumber}</Text>
            </View>
            <View style={styles.metaLine}>
              <Text style={styles.metaLabel}>DATE:</Text>
              <Text style={styles.metaValue}>{formatDate(invoice.createdAt)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.bodyGrid}>
          <View style={styles.leftColumn}>
            <CustomerTable customer={customer} job={job} />
            <EquipmentTable />
            <Band title="NATURE OF SERVICE REQUEST" />
            <Box minHeight={40}>
              <Text style={styles.valueText}>{job.description}</Text>
            </Box>
            <Band title="GOOD / BETTER / BEST OPTIONS" />
            <View style={styles.optionsTable}>
              {tierOrder.map((tier) => (
                <TierOption
                  key={tier}
                  tier={tier}
                  invoice={invoice}
                  items={items.filter((item) => item.tier === tier)}
                  selected={tier === selectedTier}
                />
              ))}
            </View>
            <Band title="SERVICE PERFORMED / DIAGNOSIS" />
            <Box minHeight={50}>
              <Text style={styles.valueText}>{job.notes || "Diagnosis and work performed will be recorded here."}</Text>
            </Box>
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                WE DO NOT USE HOURLY RATE where parts or service are required. The app records parts, service, photos,
                authorization, and invoice totals so the technician does not need to carry the paper sheet.
              </Text>
            </View>
            <View style={styles.paymentBox}>
              <Text style={styles.paymentTitle}>PAYMENT</Text>
              <Text style={styles.paymentText}>Payment method: cash, check, card, or payment link.</Text>
              <Text style={styles.paymentText}>Production app should use Stripe/Square payment links. Do not store raw card number or CVV.</Text>
            </View>
          </View>

          <View style={styles.rightColumn}>
            <View style={styles.stateBand}>
              <Text style={styles.stateText}>DC</Text>
              <Text style={styles.stateText}>MD</Text>
              <Text style={styles.stateText}>VA</Text>
            </View>

            <Section title="AUTHORIZATION OF REPAIR">
              <Text style={styles.termsText}>{authorizationText}</Text>
              <Signature label="CUSTOMER SIGNATURE" />
            </Section>

            <Section title="COMPLETION OF WORK">
              <Text style={styles.termsText}>I hereby acknowledge satisfactory performance of completion of repairs.</Text>
              <Signature label="CUSTOMER SIGNATURE / DATE" />
            </Section>

            <View style={styles.couponBox}>
              <Text style={styles.couponBig}>$50 OFF</Text>
              <Text style={styles.couponText}>ON YOUR NEXT</Text>
              <Text style={styles.couponText}>COMPLETE REPAIR</Text>
            </View>

            <CostSummary
              subtotal={selectedSubtotal}
              tax={selectedTax}
              total={selectedTotal}
              taxRate={invoice.taxRate}
              selectedTier={selectedTier}
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}

function CustomerTable({ customer, job }: { customer: Customer; job: Job }) {
  return (
    <View style={styles.table}>
      <View style={styles.row}>
        <Field label="CUSTOMER NAME" value={customer.name} flex={2} />
        <Field label="PHONE" value={customer.phone} flex={1} />
      </View>
      <View style={styles.row}>
        <Field label="JOB STREET" value={customer.addressLine1} flex={1} />
      </View>
      <View style={styles.row}>
        <Field label="UNIT NO." value={customer.addressLine2 ?? ""} flex={0.8} />
        <Field label="CITY" value={customer.city} flex={1} />
        <Field label="STATE" value={customer.state} flex={0.55} />
        <Field label="ZIP CODE" value={customer.zip} flex={0.8} />
      </View>
      <View style={styles.row}>
        <Field label="CUSTOMER EMAIL" value={customer.email ?? ""} flex={1} />
      </View>
      <View style={styles.row}>
        <Field label="SERVICE ADDRESS" value={job.serviceAddress} flex={1} />
      </View>
    </View>
  );
}

function EquipmentTable() {
  return (
    <View style={styles.table}>
      {[1, 2].map((index) => (
        <View key={index}>
          <View style={styles.row}>
            <Field label={`APPLIANCE ${index} TYPE / BRAND`} value="" flex={1} />
          </View>
          <View style={styles.row}>
            <Field label="MODEL NO." value="" flex={1} />
            <Field label="SERIAL NO. / MFG. NO." value="" flex={1} />
          </View>
        </View>
      ))}
    </View>
  );
}

function TierOption({
  tier,
  invoice,
  items,
  selected
}: {
  tier: Tier;
  invoice: Invoice;
  items: JobLineItem[];
  selected: boolean;
}) {
  const subtotal = totalFor(invoice, tier, "subtotal");
  const total = totalFor(invoice, tier, "total");

  return (
    <View style={[styles.optionBlock, selected ? styles.optionSelected : {}]}>
      <View style={styles.optionHead}>
        <Text style={styles.optionTitle}>{tierLabels[tier]}{selected ? " - SELECTED" : ""}</Text>
        <Text style={styles.optionTotal}>{money(total)}</Text>
      </View>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>No items on this option.</Text>
      ) : (
        items.slice(0, 4).map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.itemDescription}>{item.description}</Text>
            <Text style={styles.itemAmount}>{item.quantity} x {money(item.unitPrice)}</Text>
          </View>
        ))
      )}
      <View style={styles.optionFoot}>
        <Text style={styles.mutedText}>{items.length} line item{items.length === 1 ? "" : "s"}</Text>
        <Text style={styles.mutedText}>Subtotal {money(subtotal)}</Text>
      </View>
    </View>
  );
}

function CostSummary({
  subtotal,
  tax,
  total,
  taxRate,
  selectedTier
}: {
  subtotal: number;
  tax: number;
  total: number;
  taxRate: number;
  selectedTier: Tier;
}) {
  const rows = [
    ["JOB COST", money(subtotal)],
    ["SERVICE CALL", "Included"],
    ["SUB-TOTAL", money(subtotal)],
    [`TAX ${percent(taxRate)}`, money(tax)],
    ["DEPOSIT", "$0.00"],
    ["PAY THIS AMOUNT", money(total)]
  ];

  return (
    <View style={styles.costTable}>
      <View style={styles.costSelected}>
        <Text style={styles.costSelectedLabel}>APPROVED OPTION</Text>
        <Text style={styles.costSelectedValue}>{tierLabels[selectedTier]}</Text>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.costRow}>
          <Text style={styles.costLabel}>{label}</Text>
          <Text style={styles.costValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function Field({ label, value, flex }: { label: string; value: string; flex: number }) {
  return (
    <View style={[styles.field, { flex }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value || " "}</Text>
    </View>
  );
}

function Band({ title }: { title: string }) {
  return (
    <View style={styles.band}>
      <Text style={styles.bandText}>{title}</Text>
    </View>
  );
}

function Box({ children, minHeight }: { children: ReactNode; minHeight: number }) {
  return <View style={[styles.box, { minHeight }]}>{children}</View>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.rightSection}>
      <Band title={title} />
      <View style={styles.rightSectionBody}>{children}</View>
    </View>
  );
}

function Signature({ label }: { label: string }) {
  return (
    <View style={styles.signatureBlock}>
      <Text style={styles.signatureX}>X</Text>
      <View style={styles.signatureLine} />
      <Text style={styles.signatureLabel}>{label}</Text>
    </View>
  );
}

function totalFor(invoice: Invoice, tier: Tier, kind: "subtotal" | "total") {
  if (tier === "good") return kind === "subtotal" ? invoice.subtotalGood : invoice.totalGood;
  if (tier === "best") return kind === "subtotal" ? invoice.subtotalBest : invoice.totalBest;
  return kind === "subtotal" ? invoice.subtotalBetter : invoice.totalBetter;
}

const blue = "#173977";
const band = "#8799cc";
const line = "#173977";

const styles = StyleSheet.create({
  page: {
    padding: 28,
    color: blue,
    fontFamily: "Helvetica",
    fontSize: 7.4,
    lineHeight: 1.25
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8
  },
  logoBlock: {
    width: 118,
    paddingTop: 12
  },
  logoMain: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 0.8
  },
  logoSub: {
    fontSize: 7,
    fontWeight: 700,
    marginTop: 2
  },
  contactBlock: {
    flex: 1,
    paddingTop: 3
  },
  contactLine: {
    fontSize: 9.6,
    fontWeight: 700,
    marginBottom: 2
  },
  invoiceMeta: {
    width: 154,
    paddingTop: 8
  },
  metaLine: {
    flexDirection: "row",
    marginBottom: 14
  },
  metaLabel: {
    width: 62,
    fontSize: 10,
    fontWeight: 700
  },
  metaValue: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: line,
    fontSize: 9,
    fontWeight: 700,
    paddingBottom: 2
  },
  bodyGrid: {
    flexDirection: "row"
  },
  leftColumn: {
    width: "63%",
    paddingRight: 6
  },
  rightColumn: {
    width: "37%"
  },
  table: {
    borderWidth: 1,
    borderColor: line,
    marginBottom: 4
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: line
  },
  field: {
    minHeight: 20,
    borderRightWidth: 1,
    borderRightColor: line,
    paddingHorizontal: 4,
    paddingVertical: 3
  },
  fieldLabel: {
    fontSize: 5.8,
    fontWeight: 700,
    marginBottom: 2
  },
  fieldValue: {
    color: "#111827",
    fontSize: 7.2,
    fontWeight: 700
  },
  band: {
    backgroundColor: band,
    borderColor: line,
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 4
  },
  bandText: {
    color: blue,
    fontSize: 8,
    fontWeight: 700,
    textAlign: "center"
  },
  box: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: line,
    padding: 5,
    marginBottom: 4
  },
  valueText: {
    color: "#17202a",
    fontSize: 7.6,
    fontWeight: 700
  },
  optionsTable: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: line,
    marginBottom: 4
  },
  optionBlock: {
    borderBottomWidth: 1,
    borderBottomColor: line,
    padding: 5
  },
  optionSelected: {
    backgroundColor: "#eef6ff"
  },
  optionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3
  },
  optionTitle: {
    fontSize: 8,
    fontWeight: 700
  },
  optionTotal: {
    color: "#17202a",
    fontSize: 9,
    fontWeight: 700
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2
  },
  itemDescription: {
    color: "#17202a",
    flex: 1,
    fontSize: 7
  },
  itemAmount: {
    color: "#17202a",
    fontSize: 7,
    textAlign: "right",
    width: 70
  },
  optionFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2
  },
  mutedText: {
    color: "#536173",
    fontSize: 6.6
  },
  emptyText: {
    color: "#536173",
    fontSize: 7,
    marginBottom: 2
  },
  noticeBox: {
    borderWidth: 1,
    borderColor: line,
    padding: 5,
    minHeight: 36,
    marginBottom: 4
  },
  noticeText: {
    fontSize: 6.4,
    fontWeight: 700
  },
  paymentBox: {
    borderWidth: 1,
    borderColor: line,
    padding: 5,
    minHeight: 38
  },
  paymentTitle: {
    fontSize: 7,
    fontWeight: 700,
    marginBottom: 2
  },
  paymentText: {
    color: "#17202a",
    fontSize: 6.6
  },
  stateBand: {
    backgroundColor: band,
    borderWidth: 1,
    borderColor: line,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 5,
    marginBottom: 4
  },
  stateText: {
    fontSize: 10,
    fontWeight: 700
  },
  rightSection: {
    marginBottom: 4
  },
  rightSectionBody: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: line,
    padding: 6,
    minHeight: 82
  },
  termsText: {
    color: "#17202a",
    fontSize: 6.8,
    fontWeight: 700,
    marginBottom: 8
  },
  signatureBlock: {
    marginTop: 8
  },
  signatureX: {
    fontSize: 11,
    fontWeight: 700
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: line,
    marginLeft: 18,
    marginTop: -9,
    height: 10
  },
  signatureLabel: {
    fontSize: 5.5,
    fontWeight: 700,
    marginLeft: 30,
    marginTop: 2
  },
  couponBox: {
    borderWidth: 1,
    borderColor: line,
    padding: 10,
    marginBottom: 4,
    textAlign: "center"
  },
  couponBig: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 3,
    textAlign: "center"
  },
  couponText: {
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 2,
    textAlign: "center"
  },
  costTable: {
    borderWidth: 1,
    borderColor: line
  },
  costSelected: {
    borderBottomWidth: 1,
    borderBottomColor: line,
    padding: 5
  },
  costSelectedLabel: {
    fontSize: 6,
    fontWeight: 700
  },
  costSelectedValue: {
    color: "#17202a",
    fontSize: 9,
    fontWeight: 700
  },
  costRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: line,
    minHeight: 22
  },
  costLabel: {
    width: 88,
    borderRightWidth: 1,
    borderRightColor: line,
    fontSize: 8,
    fontWeight: 700,
    padding: 5
  },
  costValue: {
    color: "#17202a",
    flex: 1,
    fontSize: 8,
    fontWeight: 700,
    padding: 5,
    textAlign: "right"
  }
});
