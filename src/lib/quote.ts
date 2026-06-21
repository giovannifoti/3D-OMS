import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { Customer, Order, PriceBreakdown, PricingInputs, PrintMetrics, QuoteItem } from "../types";
import {
  DEFAULT_PRICING,
  PRINTER_PROFILE,
  applyManualUnitPriceToBreakdown,
  calculatePrice,
  normalizeManualUnitPrice,
} from "./pricing";

type QuoteLinePayload = {
  item: QuoteItem;
  breakdown: PriceBreakdown;
};

type QuotePayload = {
  quoteNumber: string;
  customer: Customer;
  customerNumber: string;
  metrics: PrintMetrics;
  pricing: PricingInputs;
  breakdown: PriceBreakdown;
  items?: QuoteLinePayload[];
  notes: string;
};

type PdfLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

type PdfPayload = {
  quoteNumber: string;
  date: string;
  customer: Customer;
  customerNumber: string;
  lines: PdfLine[];
  netPrice: number;
  vatAmount: number;
  grossPrice: number;
  includeVat: boolean;
  vatPercent: number;
  notes: string;
};

const COLORS = {
  navy: [16, 40, 72] as [number, number, number],
  blue: [29, 111, 216] as [number, number, number],
  paleBlue: [234, 242, 255] as [number, number, number],
  border: [215, 226, 238] as [number, number, number],
  text: [23, 32, 42] as [number, number, number],
  muted: [100, 115, 134] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

const PAYMENT_DETAILS = {
  holder: "Intestatario non configurato",
  iban: "IBAN non configurato",
  bank: "Banca non configurata",
  depositPercent: 25,
} as const;

export function openQuote(payload: QuotePayload): void {
  const document = createQuotePdfDocument(payload);
  document.save(`${safeFileName(payload.quoteNumber)}.pdf`);
}

export function openOrderQuote(order: Order): void {
  const document = createOrderQuotePdfDocument(order);
  document.save(`${safeFileName(order.quoteNumber)}.pdf`);
}

export function createQuotePdfDocument(payload: QuotePayload): jsPDF {
  const lines = payload.items?.length
    ? payload.items.map(({ item, breakdown }) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: breakdown.netPrice / Math.max(1, item.quantity),
        totalPrice: breakdown.netPrice,
      }))
    : [
        {
          name: payload.metrics.fileName || "Stampa 3D",
          quantity: payload.pricing.quantity,
          unitPrice: payload.breakdown.netPrice / Math.max(1, payload.pricing.quantity),
          totalPrice: payload.breakdown.netPrice,
        },
      ];

  return createPdf({
    quoteNumber: payload.quoteNumber,
    date: new Date().toLocaleDateString("it-IT"),
    customer: payload.customer,
    customerNumber: payload.customerNumber,
    lines,
    netPrice: payload.breakdown.netPrice,
    vatAmount: payload.breakdown.vatAmount,
    grossPrice: payload.breakdown.grossPrice,
    includeVat: payload.pricing.includeVat,
    vatPercent: payload.pricing.vatPercent,
    notes: payload.notes,
  });
}

export function createOrderQuotePdfDocument(order: Order): jsPDF {
  const lines = order.items?.length ? buildSavedOrderLines(order) : [buildSavedOrderSingleLine(order)];
  return createPdf({
    quoteNumber: order.quoteNumber,
    date: new Date(order.createdAt).toLocaleDateString("it-IT"),
    customer: order.customer,
    customerNumber: order.customerNumber,
    lines,
    netPrice: order.netPrice,
    vatAmount: order.grossPrice - order.netPrice,
    grossPrice: order.grossPrice,
    includeVat: Boolean(order.includeVat),
    vatPercent: order.vatPercent ?? 22,
    notes: order.notes,
  });
}

function createPdf(payload: PdfPayload): jsPDF {
  const document = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = document.internal.pageSize.getWidth();
  const margin = 18;

  document.setProperties({
    title: `Preventivo ${payload.quoteNumber}`,
    subject: "Preventivo stampa 3D",
    author: "",
    creator: "",
  });

  document.setFillColor(...COLORS.navy);
  document.rect(0, 0, pageWidth, 44, "F");
  document.setTextColor(...COLORS.white);
  document.setFont("helvetica", "bold");
  document.setFontSize(9);
  document.text("PREVENTIVO STAMPA 3D", margin, 16);
  document.setFontSize(21);
  document.text(cleanPdfText(payload.quoteNumber), margin, 29);
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  document.text(payload.date, pageWidth - margin, 20, { align: "right" });

  const customerLines = compactCustomerLines(payload.customer, payload.customerNumber);
  const customerBoxHeight = Math.max(24, 14 + customerLines.length * 5);
  const customerY = 52;
  document.setFillColor(...COLORS.paleBlue);
  document.setDrawColor(...COLORS.border);
  document.roundedRect(margin, customerY, pageWidth - margin * 2, customerBoxHeight, 2, 2, "FD");
  document.setTextColor(...COLORS.blue);
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.text("CLIENTE", margin + 5, customerY + 7);
  document.setTextColor(...COLORS.text);
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  document.text(customerLines.map(cleanPdfText), margin + 5, customerY + 13, { lineHeightFactor: 1.25 });

  autoTable(document, {
    startY: customerY + customerBoxHeight + 9,
    margin: { left: margin, right: margin },
    head: [["Prodotto", "Quantita", "Materiale", "Prezzo unitario", "Totale"]],
    body: payload.lines.map((line) => [
      cleanPdfText(line.name),
      line.quantity.toString(),
      "PLA",
      formatPdfCurrency(line.unitPrice),
      formatPdfCurrency(line.totalPrice),
    ]),
    theme: "plain",
    styles: {
      cellPadding: 4,
      font: "helvetica",
      fontSize: 9,
      lineColor: COLORS.border,
      lineWidth: { bottom: 0.2 },
      textColor: COLORS.text,
      valign: "middle",
    },
    headStyles: {
      fillColor: COLORS.navy,
      textColor: COLORS.white,
      fontStyle: "bold",
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: [248, 251, 255] },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: 24, halign: "center" },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 34, halign: "right" },
      4: { cellWidth: 34, halign: "right", fontStyle: "bold" },
    },
  });

  const tableEndY = getLastTableY(document);
  const totalsHeight = payload.includeVat ? 39 : 31;
  const totalsY = ensureSpace(document, tableEndY + 8, totalsHeight + 34, margin);
  drawTotals(document, payload, totalsY, pageWidth, margin);
  drawNotes(document, payload.notes, totalsY + totalsHeight + 10, pageWidth, margin);
  drawPaymentPage(document, payload);

  return document;
}

function drawTotals(document: jsPDF, payload: PdfPayload, y: number, pageWidth: number, margin: number): void {
  const width = 78;
  const x = pageWidth - margin - width;
  const height = payload.includeVat ? 39 : 31;
  document.setFillColor(...COLORS.paleBlue);
  document.setDrawColor(...COLORS.border);
  document.roundedRect(x, y, width, height, 2, 2, "FD");
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(...COLORS.muted);
  document.text("Subtotale", x + 5, y + 7);
  document.setTextColor(...COLORS.text);
  document.text(formatPdfCurrency(payload.netPrice), x + width - 5, y + 7, { align: "right" });

  if (payload.includeVat) {
    document.setTextColor(...COLORS.muted);
    document.text(`IVA ${payload.vatPercent}%`, x + 5, y + 14);
    document.setTextColor(...COLORS.text);
    document.text(formatPdfCurrency(payload.vatAmount), x + width - 5, y + 14, { align: "right" });
  }

  const shippingY = payload.includeVat ? y + 21 : y + 14;
  document.setTextColor(...COLORS.muted);
  document.text("Spese di spedizione", x + 5, shippingY);
  document.setTextColor(...COLORS.text);
  document.text("Da concordare", x + width - 5, shippingY, { align: "right" });

  const totalY = shippingY + 11;
  document.setDrawColor(...COLORS.blue);
  document.line(x + 5, totalY - 5, x + width - 5, totalY - 5);
  document.setFont("helvetica", "bold");
  document.setFontSize(12);
  document.setTextColor(...COLORS.navy);
  document.text("TOTALE", x + 5, totalY);
  document.text(formatPdfCurrency(payload.grossPrice), x + width - 5, totalY, { align: "right" });
}

function drawPaymentPage(document: jsPDF, payload: PdfPayload): void {
  document.addPage();
  const pageWidth = document.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  const depositAmount = (payload.grossPrice * PAYMENT_DETAILS.depositPercent) / 100;

  document.setFillColor(...COLORS.navy);
  document.rect(0, 0, pageWidth, 44, "F");
  document.setTextColor(...COLORS.white);
  document.setFont("helvetica", "bold");
  document.setFontSize(9);
  document.text("PAGAMENTO", margin, 16);
  document.setFontSize(21);
  document.text("Dettagli di pagamento", margin, 29);
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.text(cleanPdfText(payload.quoteNumber), pageWidth - margin, 17, { align: "right" });
  document.text(payload.date, pageWidth - margin, 23, { align: "right" });

  const depositY = 56;
  const depositHeight = 43;
  document.setFillColor(...COLORS.paleBlue);
  document.setDrawColor(...COLORS.border);
  document.roundedRect(margin, depositY, contentWidth, depositHeight, 2, 2, "FD");
  document.setTextColor(...COLORS.blue);
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.text("ACCONTO PER L'INIZIO DEL LAVORO", margin + 6, depositY + 10);
  document.setTextColor(...COLORS.text);
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  document.text(
    `Per iniziare il lavoro deve essere versato un acconto pari al ${PAYMENT_DETAILS.depositPercent}% del totale.`,
    margin + 6,
    depositY + 20,
  );
  document.setFont("helvetica", "bold");
  document.setFontSize(18);
  document.setTextColor(...COLORS.navy);
  document.text(formatPdfCurrency(depositAmount), margin + 6, depositY + 34);

  const paymentY = 113;
  const paymentHeight = 65;
  document.setTextColor(...COLORS.blue);
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.text("DATI PER IL BONIFICO", margin, paymentY);
  document.setFillColor(248, 251, 255);
  document.setDrawColor(...COLORS.border);
  document.roundedRect(margin, paymentY + 6, contentWidth, paymentHeight, 2, 2, "FD");

  const labelX = margin + 7;
  const valueX = margin + 42;
  const firstRowY = paymentY + 20;
  document.setFontSize(9);
  document.setFont("helvetica", "bold");
  document.setTextColor(...COLORS.muted);
  document.text("Intestatario", labelX, firstRowY);
  document.text("IBAN", labelX, firstRowY + 17);
  document.text("Banca", labelX, firstRowY + 34);

  document.setTextColor(...COLORS.text);
  document.setFont("helvetica", "normal");
  document.setFontSize(11);
  document.text(PAYMENT_DETAILS.holder, valueX, firstRowY);
  document.setFont("courier", "bold");
  document.setFontSize(10.5);
  document.text(PAYMENT_DETAILS.iban, valueX, firstRowY + 17);
  document.setFont("helvetica", "normal");
  document.setFontSize(11);
  document.text(PAYMENT_DETAILS.bank, valueX, firstRowY + 34);

  document.setFontSize(9);
  document.setTextColor(...COLORS.muted);
  document.text("Il lavoro iniziera alla ricezione dell'acconto.", margin, paymentY + paymentHeight + 18);
}

function drawNotes(document: jsPDF, notes: string, requestedY: number, pageWidth: number, margin: number): void {
  const cleanNotes = cleanPdfText(notes.trim());
  if (!cleanNotes) {
    return;
  }
  const lines = document.splitTextToSize(cleanNotes, pageWidth - margin * 2);
  const height = 11 + lines.length * 4;
  const y = ensureSpace(document, requestedY, height, margin);
  document.setTextColor(...COLORS.blue);
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.text("NOTE", margin, y);
  document.setTextColor(...COLORS.text);
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.text(lines, margin, y + 6, { lineHeightFactor: 1.3 });
}

function buildSavedOrderLines(order: Order): PdfLine[] {
  const pricing = savedOrderPricing(order);
  return (order.items ?? []).map((item) => {
    const automaticBreakdown = calculatePrice({
      ...pricing,
      quantity: item.quantity,
      manualMinutes: item.manualMinutes,
      filamentGrams: item.filamentGrams,
      color: item.color ?? pricing.color,
      finish: item.finish ?? pricing.finish,
    });
    const manualUnitPrice = normalizeManualUnitPrice(
      item.manualUnitPrice ?? (item.manualPrice ? item.manualPrice / Math.max(1, item.quantity) : undefined),
    );
    const breakdown = applyManualUnitPriceToBreakdown(
      automaticBreakdown,
      manualUnitPrice,
      item.quantity,
      pricing,
    );
    return {
      name: item.name,
      quantity: item.quantity,
      unitPrice: breakdown.netPrice / Math.max(1, item.quantity),
      totalPrice: breakdown.netPrice,
    };
  });
}

function buildSavedOrderSingleLine(order: Order): PdfLine {
  return {
    name: order.fileName || "Stampa 3D",
    quantity: order.quantity,
    unitPrice: order.netPrice / Math.max(1, order.quantity),
    totalPrice: order.netPrice,
  };
}

function savedOrderPricing(order: Order): PricingInputs {
  return {
    ...DEFAULT_PRICING,
    materialKey: order.materialKey,
    quantity: order.quantity,
    manualMinutes: order.metrics.printTimeMinutes ?? DEFAULT_PRICING.manualMinutes,
    filamentGrams: order.metrics.filamentGrams ?? DEFAULT_PRICING.filamentGrams,
    machineRate: order.machineRate ?? PRINTER_PROFILE.machineRate,
    powerKw: order.averagePowerKw ?? PRINTER_PROFILE.defaultAveragePowerKw,
    energyCostKwh: order.energyCostKwh ?? PRINTER_PROFILE.energyCostKwh,
    marginPercent: order.marginPercent ?? 125,
    vatPercent: order.vatPercent ?? DEFAULT_PRICING.vatPercent,
    includeVat: Boolean(order.includeVat),
    color: order.color || "Bianco",
    finish: order.finish || "Standard",
  };
}

function compactCustomerLines(customer: Customer, customerNumber: string): string[] {
  return [
    customer.name || "Cliente",
    customerNumber ? `Numero cliente: ${customerNumber}` : "",
    customer.phone ? `Telefono: ${customer.phone}` : "",
    customer.email ? `Email: ${customer.email}` : "",
  ].filter(Boolean);
}

function ensureSpace(document: jsPDF, requestedY: number, requiredHeight: number, margin: number): number {
  const pageHeight = document.internal.pageSize.getHeight();
  if (requestedY + requiredHeight <= pageHeight - margin) {
    return requestedY;
  }
  document.addPage();
  return margin;
}

function getLastTableY(document: jsPDF): number {
  return (document as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 90;
}

function formatPdfCurrency(value: number): string {
  return `${new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)} EUR`;
}

function cleanPdfText(value: string): string {
  return value.replaceAll("€", "EUR").replaceAll("·", "-");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "preventivo";
}
