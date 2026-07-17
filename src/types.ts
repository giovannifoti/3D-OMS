export type FileKind = "gcode" | "3mf" | "unknown";

export type Bounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

export type BoxSize = {
  x: number;
  y: number;
  z: number;
};

export type ToolpathSegment = {
  from: [number, number, number];
  to: [number, number, number];
  layer: number;
};

export type MeshPreview = {
  kind: "mesh";
  vertices: number[];
  indices: number[];
  bounds?: Bounds;
};

export type ToolpathPreview = {
  kind: "toolpath";
  segments: ToolpathSegment[];
  bounds?: Bounds;
};

export type EmptyPreview = {
  kind: "empty";
  message: string;
};

export type PreviewData = MeshPreview | ToolpathPreview | EmptyPreview;

export type PrintMetrics = {
  fileName: string;
  fileSize: number;
  kind: FileKind;
  printTimeMinutes?: number;
  filamentGrams?: number;
  filamentMeters?: number;
  filamentMm?: number;
  volumeCm3?: number;
  layerCount?: number;
  boundingBox?: BoxSize;
  detectedPrinter?: string;
  detectedMaterial?: string;
  warnings: string[];
};

export type ParsedFile = {
  metrics: PrintMetrics;
  preview: PreviewData;
};

export type QuoteItem = {
  id: string;
  name: string;
  fileName: string;
  kind: FileKind;
  quantity: number;
  manualMinutes: number;
  filamentGrams: number;
  manualUnitPrice?: number;
  manualPrice?: number;
  color?: FilamentColor;
  finish?: PrintFinish;
  metrics: PrintMetrics;
};

export type MaterialKey = "pla";

export type MaterialProfile = {
  key: MaterialKey;
  name: string;
  costPerKg: number;
  density: number;
  diameterMm: number;
  wastePercent: number;
};

export type PricingInputs = {
  materialKey: MaterialKey;
  quantity: number;
  manualMinutes: number;
  filamentGrams: number;
  laborMinutes: number;
  laborRate: number;
  machineRate: number;
  powerKw: number;
  energyCostKwh: number;
  setupFee: number;
  failureRiskPercent: number;
  marginPercent: number;
  vatPercent: number;
  includeVat: boolean;
  color: FilamentColor;
  finish: PrintFinish;
};

export type PriceBreakdown = {
  materialCost: number;
  energyCost: number;
  machineCost: number;
  laborCost: number;
  setupFee: number;
  riskBuffer: number;
  subtotalCost: number;
  marginAmount: number;
  netPrice: number;
  vatAmount: number;
  grossPrice: number;
  unitPrice: number;
  colorSurcharge: number;
  finishSurcharge: number;
};

export type FilamentColor = "Bianco" | "Nero" | "Colore";

export type PrintFinish = "Standard" | "Effetto pietra";

export type ShippingMethod = "inpost" | "home";

export type Customer = {
  name: string;
  email: string;
  phone: string;
};

export type OrderStatus =
  | "Bozza"
  | "Preventivo inviato"
  | "Accettato"
  | "In stampa"
  | "Completato";

export type Order = {
  id: string;
  quoteNumber: string;
  createdAt: string;
  updatedAt?: string;
  status: OrderStatus;
  customer: Customer;
  customerNumber: string;
  fileName: string;
  materialKey: MaterialKey;
  quantity: number;
  color: FilamentColor;
  finish: PrintFinish;
  averagePowerKw?: number;
  energyCostKwh?: number;
  machineRate?: number;
  marginPercent?: number;
  includeVat?: boolean;
  vatPercent?: number;
  shippingMethod?: ShippingMethod;
  shippingCost?: number;
  manualUnitPrice?: number;
  manualPrice?: number;
  netPrice: number;
  grossPrice: number;
  metrics: PrintMetrics;
  items?: QuoteItem[];
  notes: string;
};

export type FrequentProduct = {
  id: string;
  name: string;
  sku: string;
  sourceFileName?: string;
  sourceKind?: FileKind;
  sourceFileSize?: number;
  boundingBox?: BoxSize;
  layerCount?: number;
  volumeCm3?: number;
  warnings?: string[];
  defaultMinutes: number;
  defaultGrams: number;
  defaultQuantity: number;
  manualUnitPrice?: number;
  manualPrice?: number;
  color: FilamentColor;
  finish: PrintFinish;
  notes: string;
};
