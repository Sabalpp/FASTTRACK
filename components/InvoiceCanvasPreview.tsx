"use client";

import { useEffect, useRef } from "react";
import { formatDate } from "@/lib/date";
import { firstPopulatedTier, invoiceOptionLabels, selectedSubtotal, selectedTotal } from "@/lib/invoice";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, Job, JobLineItem } from "@/lib/types";

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;
const INK = "#102a36";
const MUTED = "#5f6f78";
const LINE = "#dce5e9";
const BRAND = "#164e63";
const ACCENT = "#f97316";

export function InvoiceCanvasPreview({ invoice, job, customer, items }: {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = PAGE_WIDTH * ratio;
    canvas.height = PAGE_HEIGHT * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawInvoice(context, invoice, job, customer, items);
  }, [customer, invoice, items, job]);

  return (
    <div className="invoice-canvas-shell">
      <canvas
        ref={canvasRef}
        className="invoice-canvas"
        width={PAGE_WIDTH}
        height={PAGE_HEIGHT}
        role="img"
        aria-label={`${invoice.invoiceNumber} invoice preview`}
      />
    </div>
  );
}

function drawInvoice(
  context: CanvasRenderingContext2D,
  invoice: Invoice,
  job: Job,
  customer: Customer,
  items: JobLineItem[]
) {
  const selectedTier = firstPopulatedTier(invoice);
  const selectedInvoice = selectedTier ? { ...invoice, selectedTier } : invoice;
  const selectedItems = selectedTier ? items.filter((item) => item.tier === selectedTier) : [];
  const subtotal = selectedTier ? selectedSubtotal(selectedInvoice) : 0;
  const total = selectedTier ? selectedTotal(selectedInvoice) : 0;

  context.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  roundedRect(context, 48, 40, 52, 52, 12, BRAND);
  drawText(context, "FT", 74, 73, "700 20px Arial", "#fff", "center");
  drawText(context, "Fast Track Repair Service", 116, 61, "700 22px Arial", BRAND);
  drawText(context, "13817 Fount Beattie Ct., Centreville, VA 20121", 116, 81, "12px Arial", MUTED);
  drawText(context, "INVOICE", 768, 62, "700 27px Arial", BRAND, "right");
  drawText(context, invoice.invoiceNumber, 768, 84, "700 13px Arial", MUTED, "right");
  context.fillStyle = ACCENT;
  context.fillRect(48, 108, 720, 4);

  drawText(context, "BILL TO", 48, 153, "700 10px Arial", ACCENT);
  drawText(context, customer.name, 48, 178, "700 18px Arial", INK);
  drawText(context, customer.addressLine1, 48, 199, "13px Arial", MUTED);
  drawText(context, `${customer.city}, ${customer.state} ${customer.zip}`, 48, 218, "13px Arial", MUTED);
  drawText(context, customer.phone, 48, 237, "13px Arial", MUTED);

  drawText(context, "SERVICE LOCATION", 426, 153, "700 10px Arial", ACCENT);
  wrapText(context, job.serviceAddress, 426, 178, 342, 20, "700 15px Arial", INK, 2);
  wrapText(context, job.description, 426, 225, 342, 18, "12px Arial", MUTED, 2);

  roundedRect(context, 48, 276, 720, 70, 8, "#f4f8f9", LINE);
  const facts = [
    ["ISSUE DATE", formatDate(invoice.createdAt)],
    ["SERVICE DATE", formatDate(job.completedAt ?? job.arrivedAt ?? job.scheduledAt)],
    ["STATUS", invoice.status.replace("_", " ")],
    ["PAYMENT", invoice.paymentStatus.replace("_", " ")]
  ];
  facts.forEach(([label, value], index) => {
    const x = 65 + index * 178;
    drawText(context, label, x, 301, "700 9px Arial", MUTED);
    drawText(context, value, x, 326, "700 13px Arial", INK);
  });

  drawText(context, "SERVICE DETAILS", 48, 393, "700 10px Arial", ACCENT);
  drawText(context, invoiceOptionLabels[invoice.optionLabel], 48, 421, "700 22px Arial", INK);
  drawText(context, money(total), 768, 421, "700 22px Arial", BRAND, "right");

  const tableTop = 448;
  context.fillStyle = BRAND;
  context.fillRect(48, tableTop, 720, 38);
  drawText(context, "DESCRIPTION", 62, tableTop + 24, "700 10px Arial", "#fff");
  drawText(context, "QTY", 580, tableTop + 24, "700 10px Arial", "#fff", "right");
  drawText(context, "RATE", 676, tableTop + 24, "700 10px Arial", "#fff", "right");
  drawText(context, "AMOUNT", 754, tableTop + 24, "700 10px Arial", "#fff", "right");

  const visibleItems = selectedItems.slice(0, 8);
  visibleItems.forEach((item, index) => {
    const y = tableTop + 38 + index * 52;
    context.fillStyle = index % 2 ? "#f7fafb" : "#fff";
    context.fillRect(48, y, 720, 52);
    context.strokeStyle = LINE;
    context.strokeRect(48, y, 720, 52);
    wrapText(context, item.description, 62, y + 22, 440, 16, "13px Arial", INK, 2);
    drawText(context, String(item.quantity), 580, y + 30, "13px Arial", INK, "right");
    drawText(context, money(item.unitPrice), 676, y + 30, "13px Arial", INK, "right");
    drawText(context, money(item.quantity * item.unitPrice), 754, y + 30, "700 13px Arial", INK, "right");
  });

  if (visibleItems.length === 0) drawText(context, "Approved work has not been selected.", 62, tableTop + 78, "13px Arial", MUTED);
  if (selectedItems.length > visibleItems.length) {
    drawText(context, `+ ${selectedItems.length - visibleItems.length} more item(s) on the generated PDF`, 62, tableTop + 38 + visibleItems.length * 52 + 24, "12px Arial", MUTED);
  }

  const totalsY = Math.min(850, tableTop + 70 + Math.max(visibleItems.length, 1) * 52);
  roundedRect(context, 492, totalsY, 276, 144, 8, "#f4f8f9", LINE);
  totalLine(context, "Subtotal", money(subtotal), totalsY + 28);
  totalLine(context, `Tax (${percent(invoice.taxRate)})`, money(total - subtotal), totalsY + 55);
  totalLine(context, "Paid", money(invoice.amountPaid), totalsY + 82);
  context.fillStyle = BRAND;
  context.fillRect(492, totalsY + 94, 276, 50);
  drawText(context, "BALANCE DUE", 508, totalsY + 125, "700 12px Arial", "#fff");
  drawText(context, money(Math.max(0, total - invoice.amountPaid)), 752, totalsY + 125, "700 18px Arial", "#fff", "right");

  drawText(context, invoice.approvalStatus === "signed" ? "CUSTOMER APPROVAL SAVED" : "CUSTOMER SIGNATURE PENDING", 48, 1000, "700 10px Arial", invoice.approvalStatus === "signed" ? "#166534" : MUTED);
  drawText(context, `${invoice.invoiceNumber}  ·  Preview`, 768, 1020, "11px Arial", MUTED, "right");
}

function totalLine(context: CanvasRenderingContext2D, label: string, value: string, y: number) {
  drawText(context, label, 508, y, "12px Arial", MUTED);
  drawText(context, value, 752, y, "700 12px Arial", INK, "right");
}

function drawText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "left"
) {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillText(value, x, y);
}

function wrapText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  font: string,
  color: string,
  maxLines: number
) {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = "left";
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((lineValue, index) => context.fillText(lineValue, x, y + index * lineHeight));
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string
) {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
  } else {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  }
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.stroke();
  }
}
