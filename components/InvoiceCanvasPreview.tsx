"use client";

import { useEffect, useRef } from "react";
import { branding } from "@/lib/branding";
import { formatDate } from "@/lib/date";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, Job, JobLineItem, Tier } from "@/lib/types";

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;
const tierNames: Record<Tier, string> = {
  good: "Good",
  better: "Better",
  best: "Best"
};

export function InvoiceCanvasPreview({
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = PAGE_WIDTH * pixelRatio;
    canvas.height = PAGE_HEIGHT * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawInvoicePage(context, invoice, job, customer, items);
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

function drawInvoicePage(
  context: CanvasRenderingContext2D,
  invoice: Invoice,
  job: Job,
  customer: Customer,
  items: JobLineItem[]
) {
  const selectedTier = invoice.selectedTier ?? "better";
  const selectedItems = items.filter((item) => item.tier === selectedTier);
  const subtotal = totalFor(invoice, selectedTier, "subtotal");
  const total = totalFor(invoice, selectedTier, "total");
  const tax = total - subtotal;

  context.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  text(context, branding.businessName, 56, 66, "700 26px Inter, Arial, sans-serif", "#17202a");
  text(context, branding.address, 56, 98, "14px Inter, Arial, sans-serif", "#4b5563");
  text(context, branding.phone, 56, 119, "14px Inter, Arial, sans-serif", "#4b5563");
  text(context, branding.email, 56, 140, "14px Inter, Arial, sans-serif", "#4b5563");
  text(context, branding.website, 56, 161, "14px Inter, Arial, sans-serif", "#4b5563");
  text(context, branding.licenseNumber, 56, 182, "14px Inter, Arial, sans-serif", "#4b5563");

  text(context, "Invoice", 665, 68, "700 13px Inter, Arial, sans-serif", "#64748b", "right");
  text(context, invoice.invoiceNumber, 760, 98, "700 22px Inter, Arial, sans-serif", "#17202a", "right");
  text(context, formatDate(invoice.createdAt), 760, 123, "14px Inter, Arial, sans-serif", "#4b5563", "right");
  pill(context, invoice.status.toUpperCase(), 682, 140, 78, 26, "#eef5f3", "#166534");

  line(context, 56, 198, 760, 198, "#17202a", 2);

  sectionLabel(context, "Bill To", 56, 240);
  text(context, customer.name, 56, 266, "700 16px Inter, Arial, sans-serif", "#17202a");
  text(context, customer.email ?? "No email on file", 56, 291, "14px Inter, Arial, sans-serif", "#4b5563");
  text(context, customer.phone, 56, 313, "14px Inter, Arial, sans-serif", "#4b5563");
  wrapText(context, job.serviceAddress, 56, 335, 305, 20, "14px Inter, Arial, sans-serif", "#4b5563");

  sectionLabel(context, "Approved Work", 430, 240);
  wrapText(context, job.description, 430, 266, 320, 22, "700 16px Inter, Arial, sans-serif", "#17202a");
  text(context, `Selected option: ${tierNames[selectedTier]}`, 430, 326, "14px Inter, Arial, sans-serif", "#4b5563");
  text(context, `Scheduled: ${formatDate(job.scheduledAt)}`, 430, 348, "14px Inter, Arial, sans-serif", "#4b5563");

  roundedRect(context, 56, 404, 704, 88, 10, "#f6f8fb", "#e4eaf0");
  sectionLabel(context, "Customer Approved Option", 78, 437);
  text(context, tierNames[selectedTier], 78, 467, "700 24px Inter, Arial, sans-serif", "#17202a");
  text(context, money(total), 736, 462, "700 25px Inter, Arial, sans-serif", "#17202a", "right");

  roundedRect(context, 56, 530, 704, 1, 0, "#d8dee6");
  tableHeader(context, 56, 530);
  let cursorY = 584;

  if (selectedItems.length === 0) {
    text(context, "No line items were added to this option.", 76, cursorY + 16, "14px Inter, Arial, sans-serif", "#64748b");
    cursorY += 54;
  } else {
    selectedItems.slice(0, 9).forEach((item) => {
      line(context, 56, cursorY - 18, 760, cursorY - 18, "#edf1f4", 1);
      wrapText(context, item.description, 76, cursorY, 350, 18, "13px Inter, Arial, sans-serif", "#17202a");
      text(context, String(item.quantity), 490, cursorY, "13px Inter, Arial, sans-serif", "#17202a", "right");
      text(context, money(item.unitPrice), 620, cursorY, "13px Inter, Arial, sans-serif", "#17202a", "right");
      text(context, money(item.quantity * item.unitPrice), 736, cursorY, "13px Inter, Arial, sans-serif", "#17202a", "right");
      cursorY += 52;
    });
  }

  roundedRect(context, 480, Math.max(cursorY + 20, 740), 280, 126, 10, "#f8fafc", "#d8dee6");
  const summaryY = Math.max(cursorY + 54, 774);
  text(context, "Subtotal", 504, summaryY, "14px Inter, Arial, sans-serif", "#334155");
  text(context, money(subtotal), 736, summaryY, "14px Inter, Arial, sans-serif", "#334155", "right");
  text(context, `Tax ${percent(invoice.taxRate)}`, 504, summaryY + 32, "14px Inter, Arial, sans-serif", "#334155");
  text(context, money(tax), 736, summaryY + 32, "14px Inter, Arial, sans-serif", "#334155", "right");
  line(context, 504, summaryY + 54, 736, summaryY + 54, "#17202a", 1);
  text(context, "Total Due", 504, summaryY + 82, "700 17px Inter, Arial, sans-serif", "#17202a");
  text(context, money(total), 736, summaryY + 82, "700 17px Inter, Arial, sans-serif", "#17202a", "right");

  line(context, 56, 982, 760, 982, "#d8dee6", 1);
  text(context, `Thank you for choosing ${branding.businessName}.`, 56, 1010, "13px Inter, Arial, sans-serif", "#64748b");
  text(context, `Questions: ${branding.phone} | ${branding.email}`, 56, 1032, "13px Inter, Arial, sans-serif", "#64748b");
}

function tableHeader(context: CanvasRenderingContext2D, x: number, y: number) {
  roundedRect(context, x, y, 704, 42, 8, "#eef2f6", "#d8dee6");
  sectionLabel(context, "Description", 76, y + 27);
  sectionLabel(context, "Qty", 468, y + 27);
  sectionLabel(context, "Rate", 590, y + 27);
  sectionLabel(context, "Line Total", 686, y + 27);
}

function totalFor(invoice: Invoice, tier: Tier, kind: "subtotal" | "total") {
  if (tier === "good") return kind === "subtotal" ? invoice.subtotalGood : invoice.totalGood;
  if (tier === "best") return kind === "subtotal" ? invoice.subtotalBest : invoice.totalBest;
  return kind === "subtotal" ? invoice.subtotalBetter : invoice.totalBetter;
}

function sectionLabel(context: CanvasRenderingContext2D, value: string, x: number, y: number) {
  text(context, value.toUpperCase(), x, y, "700 10px Inter, Arial, sans-serif", "#64748b");
}

function text(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "left"
) {
  context.fillStyle = color;
  context.font = font;
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
  color: string
) {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = "left";
  const words = value.split(/\s+/);
  let lineValue = "";
  let lineY = y;

  words.forEach((word) => {
    const testLine = lineValue ? `${lineValue} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && lineValue) {
      context.fillText(lineValue, x, lineY);
      lineValue = word;
      lineY += lineHeight;
    } else {
      lineValue = testLine;
    }
  });

  if (lineValue) context.fillText(lineValue, x, lineY);
}

function line(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
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
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
  }
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
  }
}

function pill(context: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, height: number, fill: string, color: string) {
  roundedRect(context, x, y, width, height, height / 2, fill);
  text(context, value, x + width / 2, y + 17, "700 10px Inter, Arial, sans-serif", color, "center");
}
