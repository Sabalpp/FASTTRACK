"use client";

import { useEffect, useRef } from "react";
import { formatDate } from "@/lib/date";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, Job, JobLineItem, Tier } from "@/lib/types";

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;
const BLUE = "#173977";
const BAND = "#8799cc";
const DARK = "#17202a";
const MUTED = "#536173";

const tierNames: Record<Tier, string> = {
  good: "Good",
  better: "Better",
  best: "Best"
};

const tierOrder: Tier[] = ["good", "better", "best"];

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
    drawPaperInvoice(context, invoice, job, customer, items);
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

function drawPaperInvoice(
  context: CanvasRenderingContext2D,
  invoice: Invoice,
  job: Job,
  customer: Customer,
  items: JobLineItem[]
) {
  const selectedTier = invoice.selectedTier ?? "good";
  const subtotal = totalFor(invoice, selectedTier, "subtotal");
  const total = totalFor(invoice, selectedTier, "total");
  const tax = total - subtotal;

  context.clearRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  drawHeader(context, invoice);

  const leftX = 44;
  const leftW = 466;
  const rightX = 526;
  const rightW = 246;
  let leftY = 210;
  let rightY = 210;

  leftY = drawCustomerTable(context, leftX, leftY, leftW, customer, job) + 10;
  leftY = drawEquipmentTable(context, leftX, leftY, leftW) + 10;
  leftY = drawBandBox(context, leftX, leftY, leftW, "NATURE OF SERVICE REQUEST", job.description, 82) + 10;
  leftY = drawOptions(context, leftX, leftY, leftW, invoice, items, selectedTier) + 10;
  leftY = drawBandBox(
    context,
    leftX,
    leftY,
    leftW,
    "SERVICE PERFORMED / DIAGNOSIS",
    job.notes || "Diagnosis and work performed will be recorded here.",
    76
  ) + 10;
  leftY = drawNotice(context, leftX, leftY, leftW) + 10;
  drawPaymentNotice(context, leftX, leftY, leftW);

  rightY = drawStateBand(context, rightX, rightY, rightW) + 10;
  rightY = drawAuthorization(context, rightX, rightY, rightW) + 10;
  rightY = drawCompletion(context, rightX, rightY, rightW) + 10;
  rightY = drawCoupon(context, rightX, rightY, rightW) + 10;
  drawCostTable(context, rightX, rightY, rightW, selectedTier, subtotal, tax, total, invoice.taxRate);
}

function drawHeader(context: CanvasRenderingContext2D, invoice: Invoice) {
  text(context, "FAST TRACK", 52, 72, "700 25px Arial, sans-serif", BLUE);
  text(context, "REPAIR SERVICE", 94, 93, "700 10px Arial, sans-serif", BLUE);

  const contactX = 245;
  const lines = [
    "13817 Fount Beattie Ct.",
    "CENTREVILLE, VA 20121",
    "PHONE: +1 7038995615",
    "E-MAIL: Info@fasttrackdmv.org",
    "WEBSITE: WWW.FASTTRACKDMV.ORG"
  ];
  lines.forEach((lineValue, index) => {
    text(context, lineValue, contactX, 56 + index * 22, "700 15px Georgia, serif", BLUE);
  });

  text(context, "INVOICE NO:", 602, 66, "700 15px Georgia, serif", BLUE);
  line(context, 705, 66, 768, 66, BLUE, 1);
  text(context, invoice.invoiceNumber, 767, 61, "700 11px Arial, sans-serif", DARK, "right");
  text(context, "DATE:", 602, 109, "700 18px Georgia, serif", BLUE);
  line(context, 662, 109, 768, 109, BLUE, 1);
  text(context, formatDate(invoice.createdAt), 767, 104, "700 11px Arial, sans-serif", DARK, "right");

  line(context, 44, 178, 772, 178, BLUE, 2);
}

function drawCustomerTable(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  customer: Customer,
  job: Job
) {
  const rows = [
    [
      { label: "CUSTOMER NAME", value: customer.name, w: width * 0.64 },
      { label: "PHONE", value: customer.phone, w: width * 0.36 }
    ],
    [{ label: "JOB STREET", value: customer.addressLine1, w: width }],
    [
      { label: "UNIT NO.", value: customer.addressLine2 ?? "", w: width * 0.22 },
      { label: "CITY", value: customer.city, w: width * 0.34 },
      { label: "STATE", value: customer.state, w: width * 0.16 },
      { label: "ZIP CODE", value: customer.zip, w: width * 0.28 }
    ],
    [{ label: "CUSTOMER EMAIL", value: customer.email ?? "", w: width }],
    [{ label: "SERVICE ADDRESS", value: job.serviceAddress, w: width }]
  ];

  let cursorY = y;
  rows.forEach((row) => {
    let cursorX = x;
    row.forEach((field) => {
      drawField(context, cursorX, cursorY, field.w, 32, field.label, field.value);
      cursorX += field.w;
    });
    cursorY += 32;
  });
  return cursorY;
}

function drawEquipmentTable(context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  let cursorY = y;
  [1, 2].forEach((index) => {
    drawField(context, x, cursorY, width, 32, `APPLIANCE ${index} TYPE / BRAND`, "");
    cursorY += 32;
    drawField(context, x, cursorY, width / 2, 32, "MODEL NO.", "");
    drawField(context, x + width / 2, cursorY, width / 2, 32, "SERIAL NO. / MFG. NO.", "");
    cursorY += 32;
  });
  return cursorY;
}

function drawBandBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  title: string,
  value: string,
  height: number
) {
  band(context, x, y, width, title);
  rect(context, x, y + 24, width, height, "#ffffff", BLUE);
  wrapText(context, value, x + 10, y + 48, width - 20, 18, "700 13px Arial, sans-serif", DARK, 3);
  return y + 24 + height;
}

function drawOptions(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  invoice: Invoice,
  items: JobLineItem[],
  selectedTier: Tier
) {
  band(context, x, y, width, "GOOD / BETTER / BEST OPTIONS");
  let cursorY = y + 24;

  tierOrder.forEach((tier) => {
    const tierItems = items.filter((item) => item.tier === tier);
    const total = totalFor(invoice, tier, "total");
    rect(context, x, cursorY, width, 82, tier === selectedTier ? "#eef6ff" : "#ffffff", BLUE);
    text(context, `${tierNames[tier]}${tier === selectedTier ? " - SELECTED" : ""}`, x + 10, cursorY + 22, "700 13px Arial, sans-serif", BLUE);
    text(context, money(total), x + width - 10, cursorY + 22, "700 15px Arial, sans-serif", DARK, "right");

    if (tierItems.length === 0) {
      text(context, "No items on this option.", x + 10, cursorY + 48, "12px Arial, sans-serif", MUTED);
    } else {
      tierItems.slice(0, 2).forEach((item, index) => {
        const rowY = cursorY + 46 + index * 18;
        wrapText(context, item.description, x + 10, rowY, width - 122, 14, "12px Arial, sans-serif", DARK, 1);
        text(context, `${item.quantity} x ${money(item.unitPrice)}`, x + width - 10, rowY, "12px Arial, sans-serif", DARK, "right");
      });
    }
    cursorY += 82;
  });

  return cursorY;
}

function drawNotice(context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  rect(context, x, y, width, 54, "#ffffff", BLUE);
  wrapText(
    context,
    "WE DO NOT USE HOURLY RATE where parts or service are required. The app records parts, service, photos, authorization, and invoice totals so the technician does not need to carry the paper sheet.",
    x + 10,
    y + 20,
    width - 20,
    14,
    "700 10px Arial, sans-serif",
    BLUE,
    3
  );
  return y + 54;
}

function drawPaymentNotice(context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  rect(context, x, y, width, 54, "#ffffff", BLUE);
  text(context, "PAYMENT", x + 10, y + 20, "700 11px Arial, sans-serif", BLUE);
  wrapText(
    context,
    "Payment method: cash, check, card, or payment link. Use Stripe/Square payment links; do not store raw card number or CVV.",
    x + 10,
    y + 39,
    width - 20,
    14,
    "11px Arial, sans-serif",
    DARK,
    2
  );
}

function drawStateBand(context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  rect(context, x, y, width, 28, BAND, BLUE);
  text(context, "DC", x + width * 0.18, y + 20, "700 15px Georgia, serif", BLUE, "center");
  text(context, "MD", x + width * 0.5, y + 20, "700 15px Georgia, serif", BLUE, "center");
  text(context, "VA", x + width * 0.82, y + 20, "700 15px Georgia, serif", BLUE, "center");
  return y + 28;
}

function drawAuthorization(context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  band(context, x, y, width, "AUTHORIZATION OF REPAIR");
  rect(context, x, y + 24, width, 190, "#ffffff", BLUE);
  wrapText(
    context,
    "An estimate includes diagnosis/estimate, parts, and labor. I hereby authorize repairs and agree to pay for them upon completion of the job. If repairs require a part order, I agree to pay a deposit. Company/technicians are not responsible for damages.",
    x + 10,
    y + 48,
    width - 20,
    15,
    "700 11px Arial, sans-serif",
    DARK,
    7
  );
  signature(context, x + 24, y + 160, width - 48, "CUSTOMER SIGNATURE");
  return y + 214;
}

function drawCompletion(context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  band(context, x, y, width, "COMPLETION OF WORK");
  rect(context, x, y + 24, width, 104, "#ffffff", BLUE);
  wrapText(
    context,
    "I hereby acknowledge satisfactory performance of completion of repairs.",
    x + 10,
    y + 51,
    width - 20,
    15,
    "700 11px Arial, sans-serif",
    DARK,
    2
  );
  signature(context, x + 24, y + 94, width - 48, "CUSTOMER SIGNATURE / DATE");
  return y + 128;
}

function drawCoupon(context: CanvasRenderingContext2D, x: number, y: number, width: number) {
  rect(context, x, y, width, 94, "#ffffff", BLUE);
  rect(context, x + 10, y + 10, width - 20, 74, "#ffffff", BLUE);
  text(context, "$50 OFF", x + width / 2, y + 36, "700 22px Georgia, serif", BLUE, "center");
  text(context, "ON YOUR NEXT", x + width / 2, y + 58, "700 17px Georgia, serif", BLUE, "center");
  text(context, "COMPLETE REPAIR", x + width / 2, y + 78, "700 17px Georgia, serif", BLUE, "center");
  return y + 94;
}

function drawCostTable(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  selectedTier: Tier,
  subtotal: number,
  tax: number,
  total: number,
  taxRate: number
) {
  const rows = [
    ["APPROVED OPTION", tierNames[selectedTier]],
    ["JOB COST", money(subtotal)],
    ["SERVICE CALL", "Included"],
    ["SUB-TOTAL", money(subtotal)],
    [`TAX ${percent(taxRate)}`, money(tax)],
    ["DEPOSIT", "$0.00"],
    ["PAY THIS AMOUNT", money(total)]
  ];

  rows.forEach(([label, value], index) => {
    const rowY = y + index * 34;
    rect(context, x, rowY, width, 34, "#ffffff", BLUE);
    line(context, x + 112, rowY, x + 112, rowY + 34, BLUE, 1);
    text(context, label, x + 8, rowY + 22, "700 11px Arial, sans-serif", BLUE);
    text(context, value, x + width - 8, rowY + 22, "700 12px Arial, sans-serif", DARK, "right");
  });
}

function drawField(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, label: string, value: string) {
  rect(context, x, y, width, height, "#ffffff", BLUE);
  text(context, label, x + 6, y + 12, "700 8px Arial, sans-serif", BLUE);
  wrapText(context, value, x + 6, y + 27, width - 12, 13, "700 11px Arial, sans-serif", DARK, 1);
}

function band(context: CanvasRenderingContext2D, x: number, y: number, width: number, label: string) {
  rect(context, x, y, width, 24, BAND, BLUE);
  text(context, label, x + width / 2, y + 16, "700 11px Georgia, serif", BLUE, "center");
}

function signature(context: CanvasRenderingContext2D, x: number, y: number, width: number, label: string) {
  text(context, "X", x, y + 2, "700 16px Georgia, serif", BLUE);
  line(context, x + 26, y, x + width, y, BLUE, 1);
  text(context, label, x + 48, y + 15, "700 8px Arial, sans-serif", BLUE);
}

function totalFor(invoice: Invoice, tier: Tier, kind: "subtotal" | "total") {
  if (tier === "good") return kind === "subtotal" ? invoice.subtotalGood : invoice.totalGood;
  if (tier === "best") return kind === "subtotal" ? invoice.subtotalBest : invoice.totalBest;
  return kind === "subtotal" ? invoice.subtotalBetter : invoice.totalBetter;
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
  color: string,
  maxLines = 3
) {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = "left";
  const words = value.split(/\s+/).filter(Boolean);
  let lineValue = "";
  let lineY = y;
  let linesDrawn = 0;

  words.forEach((word) => {
    if (linesDrawn >= maxLines) return;
    const testLine = lineValue ? `${lineValue} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && lineValue) {
      context.fillText(lineValue, x, lineY);
      linesDrawn += 1;
      lineValue = word;
      lineY += lineHeight;
    } else {
      lineValue = testLine;
    }
  });

  if (lineValue && linesDrawn < maxLines) {
    context.fillText(lineValue, x, lineY);
  }
}

function line(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function rect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string
) {
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = 1;
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);
}
