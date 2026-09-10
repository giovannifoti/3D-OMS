import type { FrequentProduct, Order, PaymentDetails } from "../types";

const ORDERS_STORAGE_KEY = "gestionale-stampa-3d.orders";
const PRODUCTS_STORAGE_KEY = "gestionale-stampa-3d.frequent-products";
const PAYMENT_DETAILS_STORAGE_KEY = "gestionale-stampa-3d.payment-details";

export const DEFAULT_PAYMENT_DETAILS: PaymentDetails = {
  holder: "Intestatario non configurato",
  iban: "IBAN non configurato",
  bank: "Banca non configurata",
  depositPercent: 25,
};

export function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOrders(orders: Order[]): void {
  localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
}

export function loadProducts(): FrequentProduct[] {
  try {
    const raw = localStorage.getItem(PRODUCTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProducts(products: FrequentProduct[]): void {
  localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(products));
}

export function loadPaymentDetails(): PaymentDetails {
  try {
    const raw = localStorage.getItem(PAYMENT_DETAILS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PAYMENT_DETAILS;
    }
    return normalizePaymentDetails(JSON.parse(raw));
  } catch {
    return DEFAULT_PAYMENT_DETAILS;
  }
}

export function savePaymentDetails(details: PaymentDetails): void {
  localStorage.setItem(PAYMENT_DETAILS_STORAGE_KEY, JSON.stringify(normalizePaymentDetails(details)));
}

export function makeOrderId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function makeQuoteNumber(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PR-${stamp}-${suffix}`;
}

function normalizePaymentDetails(details: Partial<PaymentDetails>): PaymentDetails {
  return {
    holder: typeof details.holder === "string" && details.holder.trim() ? details.holder.trim() : DEFAULT_PAYMENT_DETAILS.holder,
    iban: typeof details.iban === "string" && details.iban.trim() ? details.iban.trim().replace(/\s+/g, " ") : DEFAULT_PAYMENT_DETAILS.iban,
    bank: typeof details.bank === "string" && details.bank.trim() ? details.bank.trim() : DEFAULT_PAYMENT_DETAILS.bank,
    depositPercent: 25,
  };
}
