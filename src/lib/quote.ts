import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { Customer, DiscountMode, Order, PriceBreakdown, PricingInputs, PrintMetrics, QuoteItem, ShippingMethod } from "../types";
import {
  DEFAULT_PRICING,
  PRINTER_PROFILE,
  applyManualUnitPriceToBreakdown,
  calculatePrice,
  getShippingOption,
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
  baseBreakdown: PriceBreakdown;
  breakdown: PriceBreakdown;
  shippingMethod: ShippingMethod;
  discountMode: DiscountMode;
  discountValue: number;
  discountAmount: number;
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
  shipping?: {
    label: string;
    cost: number;
  };
  discount?: {
    label: string;
    amount: number;
  };
  notes: string;
};

type PdfAssets = {
  markDataUrl?: string;
};

const COLORS = {
  navy: [18, 18, 29] as [number, number, number],
  blue: [76, 110, 245] as [number, number, number],
  magenta: [224, 48, 179] as [number, number, number],
  lime: [188, 255, 48] as [number, number, number],
  paleBlue: [242, 246, 255] as [number, number, number],
  border: [219, 226, 242] as [number, number, number],
  text: [24, 26, 39] as [number, number, number],
  muted: [95, 104, 125] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

const BRAND_MARK_SRC = "/brand/logo-mark.png";

const PAYMENT_DETAILS = {
  holder: "Intestatario non configurato",
  iban: "IBAN non configurato",
  bank: "Banca non configurata",
  depositPercent: 25,
} as const;

export async function openQuote(payload: QuotePayload): Promise<void> {
  const document = createQuotePdfDocument(payload, await loadPdfAssets());
  document.save(`${safeFileName(payload.quoteNumber)}.pdf`);
}

export async function openOrderQuote(order: Order): Promise<void> {
  const document = createOrderQuotePdfDocument(order, await loadPdfAssets());
  document.save(`${safeFileName(order.quoteNumber)}.pdf`);
}

export function createQuotePdfDocument(payload: QuotePayload, assets: PdfAssets = {}): jsPDF {
  const shipping = getShippingOption(payload.shippingMethod);
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
          unitPrice: payload.baseBreakdown.netPrice / Math.max(1, payload.pricing.quantity),
          totalPrice: payload.baseBreakdown.netPrice,
        },
      ];

  return createPdf({
    quoteNumber: payload.quoteNumber,
    date: new Date().toLocaleDateString("it-IT"),
    customer: payload.customer,
    customerNumber: payload.customerNumber,
    lines,
    netPrice: payload.baseBreakdown.netPrice,
    vatAmount: payload.baseBreakdown.vatAmount,
    grossPrice: payload.breakdown.grossPrice,
    includeVat: payload.pricing.includeVat,
    vatPercent: payload.pricing.vatPercent,
    shipping: {
      label: shipping.label,
      cost: shipping.cost,
    },
    discount: getQuoteDiscount(payload.discountMode, payload.discountValue, payload.discountAmount),
    notes: payload.notes,
  }, assets);
}

export function createOrderQuotePdfDocument(order: Order, assets: PdfAssets = {}): jsPDF {
  const shipping = getSavedOrderShipping(order);
  const discount = getSavedOrderDiscount(order);
  const productTotals = getSavedOrderProductTotals(order, shipping?.cost, discount?.amount);
  const lines = order.items?.length
    ? buildSavedOrderLines(order)
    : [buildSavedOrderSingleLine(order, productTotals.netPrice)];
  return createPdf({
    quoteNumber: order.quoteNumber,
    date: new Date(order.createdAt).toLocaleDateString("it-IT"),
    customer: order.customer,
    customerNumber: order.customerNumber,
    lines,
    netPrice: productTotals.netPrice,
    vatAmount: productTotals.vatAmount,
    grossPrice: order.grossPrice,
    includeVat: Boolean(order.includeVat),
    vatPercent: order.vatPercent ?? 22,
    shipping,
    discount,
    notes: order.notes,
  }, assets);
}

function createPdf(payload: PdfPayload, assets: PdfAssets): jsPDF {
  const document = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = document.internal.pageSize.getWidth();
  const margin = 18;

  document.setProperties({
    title: `Preventivo ${payload.quoteNumber}`,
    subject: "Preventivo stampa 3D Artigiani del3d",
    author: "Artigiani del3d",
    creator: "Artigiani del3d",
  });

  drawPdfHeader(document, {
    assets,
    label: "PREVENTIVO STAMPA 3D",
    title: payload.quoteNumber,
    date: payload.date,
    margin,
    pageWidth,
  });

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
  const totalsHeight = getTotalsHeight(payload);
  const totalsY = ensureSpace(document, tableEndY + 8, totalsHeight + 34, margin);
  drawTotals(document, payload, totalsY, pageWidth, margin);
  drawNotes(document, payload.notes, totalsY + totalsHeight + 10, pageWidth, margin);
  drawPaymentPage(document, payload, assets);

  return document;
}

function drawTotals(document: jsPDF, payload: PdfPayload, y: number, pageWidth: number, margin: number): void {
  const width = 88;
  const x = pageWidth - margin - width;
  const height = getTotalsHeight(payload);
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

  let lastDetailY = payload.includeVat ? y + 14 : y + 7;
  if (payload.discount) {
    const discountY = lastDetailY + 7;
    document.setFontSize(8.5);
    document.setTextColor(...COLORS.muted);
    document.text(cleanPdfText(payload.discount.label), x + 5, discountY);
    document.setTextColor(...COLORS.text);
    document.text(`- ${formatPdfCurrency(payload.discount.amount)}`, x + width - 5, discountY, { align: "right" });
    lastDetailY = discountY;
  }

  if (payload.shipping) {
    const shippingY = lastDetailY + 7;
    document.setFontSize(8.5);
    document.setTextColor(...COLORS.muted);
    document.text(cleanPdfText(payload.shipping.label), x + 5, shippingY);
    document.setTextColor(...COLORS.text);
    document.text(formatPdfCurrency(payload.shipping.cost), x + width - 5, shippingY, { align: "right" });
    lastDetailY = shippingY;
  }

  const totalY = lastDetailY + 11;
  document.setDrawColor(...COLORS.blue);
  document.line(x + 5, totalY - 5, x + width - 5, totalY - 5);
  document.setFont("helvetica", "bold");
  document.setFontSize(12);
  document.setTextColor(...COLORS.navy);
  document.text("TOTALE", x + 5, totalY);
  document.text(formatPdfCurrency(payload.grossPrice), x + width - 5, totalY, { align: "right" });
}

function drawPaymentPage(document: jsPDF, payload: PdfPayload, assets: PdfAssets): void {
  document.addPage();
  const pageWidth = document.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  const depositAmount = Math.ceil((payload.grossPrice * PAYMENT_DETAILS.depositPercent) / 100);

  drawPdfHeader(document, {
    assets,
    label: "PAGAMENTO",
    title: "Dettagli di pagamento",
    date: payload.date,
    margin,
    pageWidth,
    rightText: payload.quoteNumber,
  });

  const depositY = 56;
  const depositHeight = 74;
  document.setFillColor(...COLORS.paleBlue);
  document.setDrawColor(...COLORS.border);
  document.roundedRect(margin, depositY, contentWidth, depositHeight, 2, 2, "FD");
  document.setTextColor(...COLORS.blue);
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.text("IL PAGAMENTO PUÒ AVVENIRE IN DUE MODALITA'", margin + 6, depositY + 10);
  document.setTextColor(...COLORS.text);
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  const installmentLines = document.splitTextToSize(
    `1. Acconto del ${PAYMENT_DETAILS.depositPercent}% entro 48 ore dall'invio del preventivo e saldo rimanente prima della spedizione.`,
    contentWidth - 12,
  );
  document.text(installmentLines, margin + 6, depositY + 20, { lineHeightFactor: 1.25 });
  const fullPaymentY = depositY + 20 + installmentLines.length * 4.2 + 3;
  const fullPaymentLines = document.splitTextToSize(
    "2. Pagamento in un'unica soluzione entro 48 ore dall'invio del preventivo.",
    contentWidth - 12,
  );
  document.text(fullPaymentLines, margin + 6, fullPaymentY, { lineHeightFactor: 1.25 });
  document.setTextColor(...COLORS.blue);
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.text(`ACCONTO ${PAYMENT_DETAILS.depositPercent}%`, margin + 6, depositY + 57);
  document.setFontSize(17);
  document.setTextColor(...COLORS.navy);
  document.text(formatPdfCurrency(depositAmount), margin + 6, depositY + 69);

  const paymentY = 144;
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

}

function drawPdfHeader(
  document: jsPDF,
  options: {
    assets: PdfAssets;
    label: string;
    title: string;
    date: string;
    margin: number;
    pageWidth: number;
    rightText?: string;
  },
): void {
  const { assets, label, title, date, margin, pageWidth, rightText } = options;
  document.setFillColor(...COLORS.navy);
  document.rect(0, 0, pageWidth, 44, "F");
  if (assets.markDataUrl) {
    document.addImage(assets.markDataUrl, "PNG", margin, 9, 24, 24);
  } else {
    document.setDrawColor(...COLORS.blue);
    document.setLineWidth(0.8);
    document.roundedRect(margin, 9, 24, 24, 4, 4, "S");
  }

  const textX = margin + 31;
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.setTextColor(...COLORS.lime);
  document.text("ARTIGIANI DEL3D", textX, 13);
  document.setTextColor(...COLORS.white);
  document.setFontSize(8.5);
  document.text(label, textX, 20);
  document.setFontSize(19);
  document.text(cleanPdfText(title), textX, 31);

  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.setTextColor(215, 222, 238);
  if (rightText) {
    document.text(cleanPdfText(rightText), pageWidth - margin, 17, { align: "right" });
    document.text(date, pageWidth - margin, 23, { align: "right" });
  } else {
    document.text(date, pageWidth - margin, 22, { align: "right" });
  }
  document.setFillColor(...COLORS.magenta);
  document.rect(0, 43, pageWidth * 0.58, 1, "F");
  document.setFillColor(...COLORS.blue);
  document.rect(pageWidth * 0.58, 43, pageWidth * 0.42, 1, "F");
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

function buildSavedOrderSingleLine(order: Order, netPrice: number): PdfLine {
  return {
    name: order.fileName || "Stampa 3D",
    quantity: order.quantity,
    unitPrice: netPrice / Math.max(1, order.quantity),
    totalPrice: netPrice,
  };
}

function getSavedOrderShipping(order: Order): PdfPayload["shipping"] {
  if (!order.shippingMethod) {
    return undefined;
  }
  const option = getShippingOption(order.shippingMethod);
  return {
    label: option.label,
    cost: order.shippingCost ?? option.cost,
  };
}

function getQuoteDiscount(discountMode: DiscountMode, discountValue: number, discountAmount: number): PdfPayload["discount"] {
  if (!discountAmount) {
    return undefined;
  }
  return {
    label: getDiscountLabel(discountMode, discountValue),
    amount: discountAmount,
  };
}

function getSavedOrderDiscount(order: Order): PdfPayload["discount"] {
  if (!order.discountAmount) {
    return undefined;
  }
  return {
    label: getDiscountLabel(order.discountMode ?? "amount", order.discountValue ?? 0),
    amount: order.discountAmount,
  };
}

function getDiscountLabel(discountMode: DiscountMode, discountValue: number): string {
  if (discountMode === "percent" && discountValue > 0) {
    return `Sconto ${formatPdfNumber(discountValue)}%`;
  }
  return "Sconto";
}

function getSavedOrderProductTotals(order: Order, shippingCost = 0, discountAmount = 0): { netPrice: number; vatAmount: number } {
  const vatRate = order.includeVat ? (order.vatPercent ?? 22) / 100 : 0;
  const shippingNetPrice = vatRate ? shippingCost / (1 + vatRate) : shippingCost;
  const discountNetPrice = vatRate ? discountAmount / (1 + vatRate) : discountAmount;
  const productNetPrice = roundPdfMoney(order.netPrice - shippingNetPrice + discountNetPrice);
  const productGrossPrice = roundPdfMoney(order.grossPrice - shippingCost + discountAmount);
  return {
    netPrice: productNetPrice,
    vatAmount: roundPdfMoney(productGrossPrice - productNetPrice),
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

function getTotalsHeight(payload: PdfPayload): number {
  return 23 + (payload.includeVat ? 8 : 0) + (payload.discount ? 8 : 0) + (payload.shipping ? 8 : 0);
}

async function loadPdfAssets(): Promise<PdfAssets> {
  return {
    markDataUrl: await loadImageDataUrl(BRAND_MARK_SRC),
  };
}

async function loadImageDataUrl(src: string): Promise<string | undefined> {
  try {
    const response = await fetch(src);
    if (!response.ok) {
      return undefined;
    }
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(typeof reader.result === "string" ? reader.result : undefined));
      reader.addEventListener("error", () => resolve(undefined));
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

function roundPdfMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatPdfCurrency(value: number): string {
  return `${new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)} EUR`;
}

function formatPdfNumber(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function cleanPdfText(value: string): string {
  return value.replaceAll("€", "EUR").replaceAll("·", "-");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "preventivo";
}
