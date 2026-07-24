"use client";

import { CheckCircle2, Clock3 } from "lucide-react";
import { branding } from "@/lib/branding";
import { formatDate, formatDateTime } from "@/lib/date";
import { balanceDue, firstPopulatedTier, invoiceOptionLabels, selectedSubtotal, selectedTotal } from "@/lib/invoice";
import { displayJobPhotoCaption } from "@/lib/job-photos";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem, JobPhoto } from "@/lib/types";

export function InvoicePreview({
  invoice,
  job,
  customer,
  items,
  photos = [],
  signatures = []
}: {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
  photos?: JobPhoto[];
  signatures?: InvoiceSignature[];
}) {
  const selectedTier = firstPopulatedTier(invoice);
  const selectedInvoice = selectedTier ? { ...invoice, selectedTier } : invoice;
  const selectedItems = selectedTier ? items.filter((item) => item.tier === selectedTier) : [];
  const subtotal = selectedTier ? selectedSubtotal(selectedInvoice) : 0;
  const total = selectedTier ? selectedTotal(selectedInvoice) : 0;
  const selectedTax = total - subtotal;
  const authorization = signatures.find((signature) => signature.status === "active" && signature.purpose === "work_authorization");
  const completion = signatures.find((signature) => signature.status === "active" && signature.purpose === "work_completion");
  const completionOverride = !completion && job.completionSignatureOverrideAt && job.completionSignatureOverrideReason
    ? { at: job.completionSignatureOverrideAt, reason: job.completionSignatureOverrideReason }
    : undefined;
  const skippedPhotoCheckpoints = jobPhotoCheckpointSkips(job);

  return (
    <article className="invoice-preview invoice-review-preview" aria-label="Invoice review preview">
      <div className="invoice-top">
        <div>
          <img
            className="invoice-brand-logo"
            src={branding.invoiceLogoPath}
            alt={branding.businessName}
          />
          <p className="eyebrow">Invoice preview</p>
          <h2>{branding.businessName}</h2>
          <p>{branding.address}</p>
          <p>{branding.phone} · {branding.email}</p>
        </div>
        <div className="invoice-number">
          <strong>{invoice.invoiceNumber}</strong>
          <span>Issued {formatDate(invoice.createdAt)}</span>
          <span className={`pill ${invoice.paymentStatus === "paid" ? "pill-good" : "pill-info"}`}>
            {invoice.paymentStatus.replace("_", " ")}
          </span>
        </div>
      </div>

      <div className="invoice-billto">
        <div>
          <p className="eyebrow">Bill to</p>
          <strong>{customer.name}</strong>
          <span>{customer.email || "No email on file"}</span>
          <span>{customer.phone}</span>
        </div>
        <div>
          <p className="eyebrow">Service location</p>
          <strong>{job.serviceAddress}</strong>
          <span>Service date {formatDate(job.completedAt ?? job.arrivedAt ?? job.scheduledAt)}</span>
        </div>
      </div>

      <div className="invoice-document-body">
        <div className="invoice-document-heading">
          <div>
            <p className="eyebrow">Service details</p>
            <h3>{invoiceOptionLabels[invoice.optionLabel]}</h3>
          </div>
          <strong>{money(total)}</strong>
        </div>
        <div className="invoice-line-table">
          <div className="invoice-line-head">
            <span>Description</span>
            <span>Qty</span>
            <span>Rate</span>
            <span>Amount</span>
          </div>
          {selectedItems.length === 0 ? (
            <p className="muted invoice-empty-lines">Select the approved estimate option to review invoice items.</p>
          ) : selectedItems.map((item) => (
            <div key={item.id} className="invoice-line">
              <span>{item.description}</span>
              <span>{item.quantity}</span>
              <span>{money(item.unitPrice)}</span>
              <span>{money(item.quantity * item.unitPrice)}</span>
            </div>
          ))}
        </div>
        <div className="invoice-review-summary">
          <div className="invoice-notes-preview">
            <p className="eyebrow">Work summary & notes</p>
            <p>{invoice.notes || job.notes || "No additional notes."}</p>
          </div>
          <div className="invoice-total-box">
            <p>Subtotal <span>{money(subtotal)}</span></p>
            <p>Tax {percent(invoice.taxRate)} <span>{money(selectedTax)}</span></p>
            <p>Paid <span>{money(invoice.amountPaid)}</span></p>
            <strong>Balance due <span>{money(balanceDue(selectedInvoice))}</span></strong>
          </div>
        </div>

        {photos.length > 0 || skippedPhotoCheckpoints.length > 0 ? (
          <section className="invoice-photo-record" aria-labelledby="invoice-photo-record-heading">
            <div className="invoice-photo-record-heading">
              <div>
                <p className="eyebrow">Job photo record</p>
                <h3 id="invoice-photo-record-heading">Before, after, and supporting photos</h3>
              </div>
              <span>{photoRecordCountLabel(photos.length, skippedPhotoCheckpoints.length)}</span>
            </div>
            {skippedPhotoCheckpoints.length > 0 ? (
              <div className="invoice-photo-skip-list">
                {skippedPhotoCheckpoints.map((checkpoint) => (
                  <div key={checkpoint.kind} className="invoice-photo-skip">
                    <strong>{checkpoint.kind === "before" ? "Before photo skipped" : "After photo skipped"}</strong>
                    <span>Audited field decision recorded {formatDateTime(checkpoint.at)}.</span>
                  </div>
                ))}
              </div>
            ) : null}
            {photos.length > 0 ? <div className="invoice-photo-grid">
              {sortPhotos(photos).map((photo) => {
                const renderable = /^(data:image\/|https?:\/\/|blob:)/i.test(photo.storagePath);
                const caption = displayJobPhotoCaption(photo.caption);
                return (
                  <figure key={photo.id} className="invoice-photo-card">
                    {renderable
                      ? <img src={photo.storagePath} alt={`${photoKindLabel(photo.kind)}: ${caption}`} />
                      : <div className="invoice-photo-unavailable">Photo preview unavailable</div>}
                    <figcaption>
                      <strong>{photoKindLabel(photo.kind)}</strong>
                      <span>{caption}</span>
                      <small>{formatDateTime(photo.uploadedAt)}</small>
                    </figcaption>
                  </figure>
                );
              })}
            </div> : <p className="muted">No image was stored for the audited skipped checkpoint.</p>}
          </section>
        ) : null}

        <div className="invoice-signature-grid">
          <FieldSignaturePreview
            title="Authorization of repair"
            signature={authorization}
            pending="Collect before work begins."
          />
          <FieldSignaturePreview
            title="Completion of work"
            signature={completion}
            override={completionOverride}
            pending="Collect after the repair and after photo or audited skip."
          />
        </div>
        <p className="invoice-thank-you">Thank you for choosing us.</p>
      </div>
    </article>
  );
}

function sortPhotos(photos: JobPhoto[]) {
  const order = { before: 0, after: 1, other: 2 } as const;
  return [...photos].sort((left, right) => (
    order[left.kind] - order[right.kind]
    || Date.parse(left.uploadedAt) - Date.parse(right.uploadedAt)
    || left.id.localeCompare(right.id)
  ));
}

function photoKindLabel(kind: JobPhoto["kind"]) {
  if (kind === "before") return "Before work";
  if (kind === "after") return "After work";
  return "Job photo";
}

function jobPhotoCheckpointSkips(job: Job) {
  const checkpoints: Array<{ kind: "before" | "after"; at: string }> = [];
  if (job.beforePhotosSkippedAt && job.beforePhotosSkippedBy) checkpoints.push({ kind: "before", at: job.beforePhotosSkippedAt });
  if (job.afterPhotosSkippedAt && job.afterPhotosSkippedBy) checkpoints.push({ kind: "after", at: job.afterPhotosSkippedAt });
  return checkpoints;
}

function photoRecordCountLabel(photoCount: number, skipCount: number) {
  const labels = [];
  if (photoCount > 0) labels.push(`${photoCount} photo${photoCount === 1 ? "" : "s"}`);
  if (skipCount > 0) labels.push(`${skipCount} audited skip${skipCount === 1 ? "" : "s"}`);
  return labels.join(" · ");
}

function FieldSignaturePreview({
  title,
  signature,
  override,
  pending
}: {
  title: string;
  signature?: InvoiceSignature;
  override?: { at: string; reason: string };
  pending: string;
}) {
  const complete = Boolean(signature || override);
  return (
    <div className={`invoice-signature-preview ${complete ? "signed" : "pending"}`}>
      <div className="invoice-signature-state">
        {complete ? <CheckCircle2 size={19} aria-hidden="true" /> : <Clock3 size={19} aria-hidden="true" />}
        <div>
          <strong>{title}</strong>
          <span>{signature
            ? `${signature.signerName} · ${formatDateTime(signature.signedAt)}`
            : override
              ? `Owner override · ${formatDateTime(override.at)} · ${override.reason}`
              : pending}</span>
        </div>
      </div>
      {signature?.imageUrl ? <img src={signature.imageUrl} alt={`Signature from ${signature.signerName}`} /> : null}
    </div>
  );
}
