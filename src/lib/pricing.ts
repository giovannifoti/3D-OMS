import type { MaterialKey, MaterialProfile, PriceBreakdown, PricingInputs, PrintMetrics, ShippingMethod } from "../types";

export const MATERIALS: MaterialProfile[] = [
  { key: "pla", name: "PLA", costPerKg: 15.99, density: 1.24, diameterMm: 1.75, wastePercent: 8 },
];

export const PRINTER_PROFILE = {
  name: "Anycubic Kobra X",
  ratedPowerKw: 1.45,
  averagePowerFactor: 0.35,
  defaultAveragePowerKw: roundTo(1.45 * 0.35, 3),
  energyCostKwh: 0.25,
  machineRate: 0.05,
} as const;

export const SURCHARGES = {
  color: 0.5,
  stoneEffect: 0.5,
} as const;

export const SHIPPING_OPTIONS: Record<ShippingMethod, { label: string; shortLabel: string; cost: number }> = {
  inpost: {
    label: "Punto di ritiro InPost",
    shortLabel: "Ritiro InPost",
    cost: 5.5,
  },
  home: {
    label: "Consegna a domicilio",
    shortLabel: "Consegna a domicilio",
    cost: 8.5,
  },
};

export const DEFAULT_SHIPPING_METHOD: ShippingMethod = "inpost";

export const DEFAULT_PRICING: PricingInputs = {
  materialKey: "pla",
  quantity: 1,
  manualMinutes: 120,
  filamentGrams: 50,
  laborMinutes: 0,
  laborRate: 0,
  machineRate: PRINTER_PROFILE.machineRate,
  powerKw: PRINTER_PROFILE.defaultAveragePowerKw,
  energyCostKwh: PRINTER_PROFILE.energyCostKwh,
  setupFee: 0,
  failureRiskPercent: 0,
  marginPercent: 125,
  vatPercent: 22,
  includeVat: false,
  color: "Bianco",
  finish: "Standard",
};

export function getMaterial(key: MaterialKey): MaterialProfile {
  return MATERIALS.find((material) => material.key === key) ?? MATERIALS[0];
}

export function gramsFromFilamentMm(lengthMm: number, material: MaterialProfile): number {
  const radius = material.diameterMm / 2;
  const volumeMm3 = Math.PI * radius * radius * lengthMm;
  const volumeCm3 = volumeMm3 / 1000;
  return volumeCm3 * material.density;
}

export function gramsFromVolume(volumeCm3: number, material: MaterialProfile): number {
  return volumeCm3 * material.density;
}

export function suggestPricingFromMetrics(
  metrics: PrintMetrics,
  previous: PricingInputs = DEFAULT_PRICING,
): PricingInputs {
  const selectedMaterial = getMaterial("pla");
  const filamentFromLength = metrics.filamentMm
    ? gramsFromFilamentMm(metrics.filamentMm, selectedMaterial)
    : undefined;
  const filamentFromMeters = metrics.filamentMeters
    ? gramsFromFilamentMm(metrics.filamentMeters * 1000, selectedMaterial)
    : undefined;
  const filamentFromVolume = metrics.volumeCm3
    ? gramsFromVolume(metrics.volumeCm3, selectedMaterial) * 0.45
    : undefined;

  return {
    ...previous,
    materialKey: "pla",
    machineRate: PRINTER_PROFILE.machineRate,
    powerKw: previous.powerKw || PRINTER_PROFILE.defaultAveragePowerKw,
    energyCostKwh: PRINTER_PROFILE.energyCostKwh,
    manualMinutes: Math.max(5, Math.round(metrics.printTimeMinutes ?? previous.manualMinutes)),
    filamentGrams: roundTo(
      Math.max(1, metrics.filamentGrams ?? filamentFromLength ?? filamentFromMeters ?? filamentFromVolume ?? previous.filamentGrams),
      1,
    ),
  };
}

export function calculatePrice(inputs: PricingInputs): PriceBreakdown {
  const material = getMaterial(inputs.materialKey);
  const hours = inputs.manualMinutes / 60;
  const quantity = Math.max(1, inputs.quantity);
  const materialWithWaste = inputs.filamentGrams * (1 + material.wastePercent / 100);
  const materialCost = (materialWithWaste / 1000) * material.costPerKg * quantity;
  const averagePowerKw = inputs.powerKw || PRINTER_PROFILE.defaultAveragePowerKw;
  const energyCost = hours * averagePowerKw * inputs.energyCostKwh * quantity;
  const machineCost = hours * inputs.machineRate * quantity;
  const laborCost = 0;
  const subtotalCost = materialCost + energyCost + machineCost;
  const riskBuffer = subtotalCost * (inputs.failureRiskPercent / 100);
  const marginBase = subtotalCost + riskBuffer;
  const marginAmount = marginBase * (inputs.marginPercent / 100);
  const colorSurcharge = inputs.color === "Colore" ? SURCHARGES.color * quantity : 0;
  const finishSurcharge = inputs.finish === "Effetto pietra" ? SURCHARGES.stoneEffect * quantity : 0;
  const netPrice = marginBase + marginAmount + colorSurcharge + finishSurcharge;
  const vatAmount = inputs.includeVat ? netPrice * (inputs.vatPercent / 100) : 0;
  const grossPrice = netPrice + vatAmount;
  const unitPrice = grossPrice / quantity;

  return {
    materialCost,
    energyCost,
    machineCost,
    laborCost,
    setupFee: inputs.setupFee,
    riskBuffer,
    subtotalCost,
    marginAmount,
    netPrice,
    vatAmount,
    grossPrice,
    unitPrice,
    colorSurcharge,
    finishSurcharge,
  };
}

export function applyShippingToBreakdown(
  breakdown: PriceBreakdown,
  shippingMethod: ShippingMethod,
  quantity: number,
  pricing: Pick<PricingInputs, "includeVat" | "vatPercent">,
): PriceBreakdown {
  const shippingGrossPrice = getShippingOption(shippingMethod).cost;
  const vatRate = pricing.includeVat ? pricing.vatPercent / 100 : 0;
  const shippingNetPrice = vatRate ? roundTo(shippingGrossPrice / (1 + vatRate), 2) : shippingGrossPrice;
  const netPrice = roundTo(breakdown.netPrice + shippingNetPrice, 2);
  const grossPrice = roundTo(breakdown.grossPrice + shippingGrossPrice, 2);
  return {
    ...breakdown,
    netPrice,
    vatAmount: grossPrice - netPrice,
    grossPrice,
    unitPrice: grossPrice / Math.max(1, quantity),
  };
}

export function getShippingOption(shippingMethod: ShippingMethod) {
  return SHIPPING_OPTIONS[shippingMethod];
}

export function applyManualUnitPriceToBreakdown(
  breakdown: PriceBreakdown,
  manualUnitPrice: number | undefined,
  quantity: number,
  pricing: Pick<PricingInputs, "includeVat" | "vatPercent">,
): PriceBreakdown {
  const normalizedManualUnitPrice = normalizeManualUnitPrice(manualUnitPrice);
  if (!normalizedManualUnitPrice) {
    return breakdown;
  }
  const normalizedQuantity = Math.max(1, quantity);
  const vatRate = pricing.includeVat ? pricing.vatPercent / 100 : 0;
  const surchargeNetPrice = breakdown.colorSurcharge + breakdown.finishSurcharge;
  const surchargeGrossPrice = roundTo(surchargeNetPrice * (1 + vatRate), 2);
  const grossPrice = roundTo(normalizedManualUnitPrice * normalizedQuantity + surchargeGrossPrice, 2);
  const netPrice = vatRate ? roundTo(grossPrice / (1 + vatRate), 2) : grossPrice;
  return {
    ...breakdown,
    netPrice,
    vatAmount: grossPrice - netPrice,
    grossPrice,
    unitPrice: grossPrice / normalizedQuantity,
  };
}

export function normalizeManualUnitPrice(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return roundTo(value, 2);
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
