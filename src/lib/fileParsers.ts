import JSZip from "jszip";
import type {
  Bounds,
  BoxSize,
  EmptyPreview,
  FilamentUsage,
  MeshPreview,
  ParsedFile,
  PrintMetrics,
  ToolpathPreview,
  ToolpathSegment,
} from "../types";

const MAX_TOOLPATH_SEGMENTS = 55000;

type Position = {
  x: number;
  y: number;
  z: number;
  e: number;
};

type RawMesh = {
  vertices: number[];
  indices: number[];
};

type ObjectNode = {
  mesh?: RawMesh;
  components: Array<{ objectId: string; transform: Matrix3mf }>;
};

type Matrix3mf = number[];

type Extracted3mfGeometry = {
  vertices: number[];
  indices: number[];
  bounds: Bounds;
};

const IDENTITY_MATRIX: Matrix3mf = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export async function parsePrintFile(file: File): Promise<ParsedFile> {
  const extension = file.name.toLowerCase().split(".").pop();

  if (extension === "gcode" || extension === "gco" || extension === "gc") {
    const text = await file.text();
    return parseGcodeText(text, file.name, file.size, true);
  }

  if (extension === "3mf") {
    return parse3mf(file);
  }

  return {
    metrics: createBaseMetrics(file.name, file.size, "unknown", [
      "Formato non riconosciuto. Carica un file .3mf o .gcode.",
    ]),
    preview: { kind: "empty", message: "Formato non supportato." },
  };
}

function parseGcodeText(
  text: string,
  fileName: string,
  fileSize: number,
  includePreview: boolean,
): ParsedFile {
  const metrics = createBaseMetrics(fileName, fileSize, "gcode", []);
  const segments: ToolpathSegment[] = [];
  const bounds = createEmptyBounds();
  const pos: Position = { x: 0, y: 0, z: 0, e: 0 };
  const extruderPositions = new Map<string, number>([["0", 0]]);
  const filamentByToolMm = new Map<string, number>();
  const zLevels = new Set<string>();
  let isAbsolute = true;
  let isExtruderAbsolute = true;
  let totalExtrudedMm = 0;
  let currentTool = "0";
  let layer = 0;
  let lastZKey = "";
  let skippedSegments = 0;

  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    updateGcodeMetadata(rawLine, metrics);
    const command = rawLine.split(";")[0].trim();
    if (!command) {
      continue;
    }

    const code = command.toUpperCase();
    if (code.startsWith("G90")) {
      isAbsolute = true;
      continue;
    }
    if (code.startsWith("G91")) {
      isAbsolute = false;
      continue;
    }
    if (code.startsWith("M82")) {
      isExtruderAbsolute = true;
      continue;
    }
    if (code.startsWith("M83")) {
      isExtruderAbsolute = false;
      continue;
    }

    const toolChange = code.match(/^T(\d+)\b/);
    if (toolChange) {
      currentTool = toolChange[1];
      pos.e = extruderPositions.get(currentTool) ?? 0;
      continue;
    }

    if (code.startsWith("G92")) {
      const params = parseGcodeParams(command);
      pos.x = params.X ?? pos.x;
      pos.y = params.Y ?? pos.y;
      pos.z = params.Z ?? pos.z;
      if (params.E !== undefined) {
        pos.e = params.E;
        extruderPositions.set(currentTool, params.E);
      }
      continue;
    }

    if (!code.startsWith("G0") && !code.startsWith("G1")) {
      continue;
    }

    const params = parseGcodeParams(command);
    const next: Position = { ...pos };
    if (params.X !== undefined) {
      next.x = isAbsolute ? params.X : pos.x + params.X;
    }
    if (params.Y !== undefined) {
      next.y = isAbsolute ? params.Y : pos.y + params.Y;
    }
    if (params.Z !== undefined) {
      next.z = isAbsolute ? params.Z : pos.z + params.Z;
    }

    const hasExtrusion = params.E !== undefined;
    const currentExtruderPosition = extruderPositions.get(currentTool) ?? pos.e;
    const nextE = hasExtrusion
      ? isExtruderAbsolute
        ? params.E ?? currentExtruderPosition
        : currentExtruderPosition + (params.E ?? 0)
      : currentExtruderPosition;
    const extrudedDelta = hasExtrusion
      ? isExtruderAbsolute
        ? Math.max(0, nextE - currentExtruderPosition)
        : Math.max(0, params.E ?? 0)
      : 0;
    const moved = next.x !== pos.x || next.y !== pos.y || next.z !== pos.z;
    const extrudingMove = extrudedDelta > 0 && moved;

    if (extrudingMove) {
      const zKey = next.z.toFixed(3);
      if (zKey !== lastZKey) {
        lastZKey = zKey;
        layer += 1;
        zLevels.add(zKey);
      }
      expandBounds(bounds, pos.x, pos.y, pos.z);
      expandBounds(bounds, next.x, next.y, next.z);
      if (includePreview && segments.length < MAX_TOOLPATH_SEGMENTS) {
        segments.push({
          from: [pos.x, pos.y, pos.z],
          to: [next.x, next.y, next.z],
          layer,
        });
      } else if (includePreview) {
        skippedSegments += 1;
      }
      totalExtrudedMm += extrudedDelta;
      filamentByToolMm.set(currentTool, (filamentByToolMm.get(currentTool) ?? 0) + extrudedDelta);
    }

    pos.x = next.x;
    pos.y = next.y;
    pos.z = next.z;
    pos.e = nextE;
    extruderPositions.set(currentTool, nextE);
  }

  if (totalExtrudedMm > 0) {
    setFilamentLength(metrics, totalExtrudedMm);
    mergeToolpathFilaments(metrics, filamentByToolMm);
  }

  normalizeFilamentMetrics(metrics);

  if (zLevels.size > 0) {
    metrics.layerCount = zLevels.size;
  }

  if (isFiniteBounds(bounds)) {
    metrics.boundingBox = boundsToBox(bounds);
  }

  if (!metrics.printTimeMinutes) {
    metrics.warnings.push("Tempo di stampa non trovato nel G-code: inseriscilo o correggilo nel pannello prezzi.");
  }
  if (!metrics.filamentGrams && !metrics.filamentMm && !metrics.filamentMeters) {
    metrics.warnings.push("Filamento non trovato nel G-code: inserisci i grammi nel pannello prezzi.");
  }
  if (skippedSegments > 0) {
    metrics.warnings.push(`Anteprima alleggerita: ${skippedSegments.toLocaleString("it-IT")} segmenti oltre il limite non sono stati disegnati.`);
  }

  const preview: ToolpathPreview | EmptyPreview = segments.length
    ? { kind: "toolpath", segments, bounds: isFiniteBounds(bounds) ? bounds : undefined }
    : { kind: "empty", message: "Nessun percorso estruso trovato nel G-code." };

  return { metrics, preview };
}

async function parse3mf(file: File): Promise<ParsedFile> {
  const metrics = createBaseMetrics(file.name, file.size, "3mf", []);

  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    await merge3mfArchiveMetadata(zip, metrics);

    const modelFiles = Object.values(zip.files).filter((entry) => !entry.dir && /\.model$/i.test(entry.name));
    const preferredModelFile = modelFiles.find(
      (entry) => !entry.dir && /(^|\/)3dmodel\.model$/i.test(entry.name),
    );
    const orderedModelFiles = preferredModelFile
      ? [preferredModelFile, ...modelFiles.filter((entry) => entry !== preferredModelFile)]
      : modelFiles;

    if (!orderedModelFiles.length) {
      normalizeFilamentMetrics(metrics);
      if (hasPrintEstimate(metrics)) {
        return {
          metrics,
          preview: { kind: "empty", message: "Dati di stampa letti dal 3MF." },
        };
      }
      return {
        metrics: {
          ...metrics,
          warnings: ["Il 3MF non contiene un modello leggibile."],
        },
        preview: { kind: "empty", message: "Modello 3MF non trovato." },
      };
    }

    let bestGeometry: Extracted3mfGeometry | undefined;
    for (const modelFile of orderedModelFiles) {
      const xml = await modelFile.async("string");
      const document = new DOMParser().parseFromString(xml, "application/xml");
      if (elements(document, "parsererror").length) {
        continue;
      }

      merge3mfModelMetadata(document, metrics);
      const geometry = extract3mfGeometry(document);
      if (!bestGeometry || geometry.vertices.length > bestGeometry.vertices.length) {
        bestGeometry = geometry;
      }
    }

    const embeddedGcode = Object.values(zip.files).find((entry) => !entry.dir && /\.gcode$/i.test(entry.name));
    if (embeddedGcode) {
      const embedded = parseGcodeText(await embeddedGcode.async("string"), file.name, file.size, false);
      mergeGcodeMetrics(metrics, embedded.metrics);
    }

    normalizeFilamentMetrics(metrics);

    const vertices = bestGeometry?.vertices ?? [];
    const indices = bestGeometry?.indices ?? [];
    const bounds = bestGeometry?.bounds ?? createEmptyBounds();

    if (!vertices.length || !indices.length) {
      if (!hasPrintEstimate(metrics)) {
        metrics.warnings.push("Geometria non trovata nel 3MF. Il file potrebbe contenere solo impostazioni di slicing.");
      }
      return {
        metrics,
        preview: {
          kind: "empty",
          message: hasPrintEstimate(metrics)
            ? "Dati di stampa letti dal 3MF."
            : "Nessuna geometria disponibile.",
        },
      };
    }

    metrics.boundingBox = isFiniteBounds(bounds) ? boundsToBox(bounds) : undefined;
    metrics.volumeCm3 = calculateMeshVolumeCm3(vertices, indices);

    if (!metrics.printTimeMinutes) {
      metrics.warnings.push("Il 3MF mostra la geometria, ma non contiene un tempo di stampa leggibile: inseriscilo nel pannello prezzi.");
    }
    if (!metrics.filamentGrams && !metrics.filamentMm && metrics.volumeCm3) {
      metrics.warnings.push("Filamento stimato dalla geometria: per un preventivo preciso usa un G-code o correggi i grammi.");
    }

    const preview: MeshPreview = {
      kind: "mesh",
      vertices,
      indices,
      bounds: isFiniteBounds(bounds) ? bounds : undefined,
    };

    return { metrics, preview };
  } catch (error) {
    return {
      metrics: {
        ...metrics,
        warnings: [`Errore lettura 3MF: ${error instanceof Error ? error.message : "file non valido"}`],
      },
      preview: { kind: "empty", message: "Impossibile leggere il 3MF." },
    };
  }
}

function updateGcodeMetadata(line: string, metrics: PrintMetrics): void {
  const clean = line.trim();
  if (!clean) {
    return;
  }
  const lower = clean.toLowerCase();

  const timeSeconds = clean.match(/^\s*;?\s*time\s*:\s*(\d+)/i)?.[1];
  if (timeSeconds && !metrics.printTimeMinutes) {
    metrics.printTimeMinutes = Number(timeSeconds) / 60;
  }

  if (!metrics.printTimeMinutes && (/(estimated|print|printing|total).*time|tempo/i.test(clean) || /printing_time|print_time/i.test(clean))) {
    const value = getAssignedValue(clean);
    const minutes = parseDurationToMinutes(value);
    if (minutes) {
      metrics.printTimeMinutes = minutes;
    }
  }

  if (lower.includes("filament") || lower.includes("filamento") || lower.includes("extruder") || lower.includes("material")) {
    updateFilamentMetadata(clean, metrics);
  }

  const printer = clean.match(/(?:printer_model|printer|generated by)\s*[=:]\s*([^;]+)/i)?.[1];
  if (!metrics.detectedPrinter && printer) {
    metrics.detectedPrinter = printer.trim();
  }
}

async function merge3mfArchiveMetadata(zip: JSZip, metrics: PrintMetrics): Promise<void> {
  const metadataEntries = Object.values(zip.files).filter((entry) => !entry.dir && isLikely3mfMetadataEntry(entry.name));
  for (const entry of metadataEntries.slice(0, 40)) {
    try {
      mergeSlicerTextMetadata(await entry.async("string"), metrics);
    } catch {
      // Binary or unsupported metadata entries are ignored; other entries may still contain the estimate.
    }
  }
  normalizeFilamentMetrics(metrics);
}

function isLikely3mfMetadataEntry(name: string): boolean {
  return /(^|\/)metadata\//i.test(name) || /\.(config|ini|txt|xml|json)$/i.test(name);
}

function mergeSlicerTextMetadata(text: string, metrics: PrintMetrics): void {
  for (const line of text.split(/\r?\n/)) {
    updateGcodeMetadata(line, metrics);
  }

  for (const match of text.matchAll(/(?:name|key)\s*=\s*["']([^"']+)["'][^>]*\bvalue\s*=\s*["']([^"']*)["']/gi)) {
    updateGcodeMetadata(`${match[1]} = ${match[2]}`, metrics);
  }

  for (const match of text.matchAll(/<metadata[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([^<]+)<\/metadata>/gi)) {
    updateGcodeMetadata(`${match[1]} = ${match[2]}`, metrics);
  }
}

function merge3mfModelMetadata(document: Document, metrics: PrintMetrics): void {
  for (const metadata of elements(document, "metadata")) {
    const name = metadata.getAttribute("name") ?? metadata.getAttribute("key") ?? metadata.getAttribute("type");
    const value = metadata.getAttribute("value") ?? metadata.textContent;
    if (name && value) {
      updateGcodeMetadata(`${name} = ${value}`, metrics);
    }
  }
}

function updateFilamentMetadata(line: string, metrics: PrintMetrics): void {
  const materialValues = parseFilamentTextValues(line, [
    /filament(?:_|\s|-)?type/i,
    /filament(?:_|\s|-)?settings(?:_|\s|-)?id/i,
    /material(?:_|\s|-)?type/i,
  ]);
  if (materialValues.length) {
    mergeFilamentTextList(metrics, "material", materialValues);
  }

  const colorValues = parseFilamentTextValues(line, [
    /filament(?:_|\s|-)?colou?r/i,
    /extruder(?:_|\s|-)?colou?r/i,
  ]);
  if (colorValues.length) {
    mergeFilamentTextList(metrics, "color", colorValues);
  }

  const usage = parseFilamentUsageValues(line);
  if (usage) {
    mergeFilamentUsageValues(metrics, usage.unit, usage.values, usage.isTotal);
  }
}

function parseFilamentTextValues(line: string, keyPatterns: RegExp[]): string[] {
  const key = getMetadataKey(line);
  const haystack = `${key} ${line}`;
  if (!keyPatterns.some((pattern) => pattern.test(haystack))) {
    return [];
  }

  const assigned = getAssignedValue(line);
  if (!assigned || assigned === line) {
    return [];
  }
  return parseTextList(assigned);
}

function parseFilamentUsageValues(line: string): { unit: "grams" | "meters" | "millimeters"; values: number[]; isTotal: boolean } | undefined {
  const key = getMetadataKey(line).toLowerCase();
  const lower = line.toLowerCase();
  const context = `${key} ${lower}`;
  if (!/(filament|filamento|used_filament|total_filament)/i.test(context)) {
    return undefined;
  }
  if (/(filament|filamento)(?:_|\s|-)?(?:type|settings|colou?r)\b/i.test(context)) {
    return undefined;
  }

  const assigned = getAssignedValue(line);
  const assignedLower = assigned.toLowerCase();
  const unit = detectFilamentUnit(context, assignedLower);
  if (!unit) {
    return undefined;
  }

  const values = parseNumberList(assigned);
  return values.length ? { unit, values, isTotal: /\b(total|totale)\b/i.test(context) } : undefined;
}

function detectFilamentUnit(context: string, value: string): "grams" | "meters" | "millimeters" | undefined {
  if (/\[mm\]|(?:^|[\s_-])mm(?:$|[\s_-])|millimeters?|millimetri|used_mm|length_mm|filament_mm/.test(context) || /[0-9][0-9.,]*\s*mm\b/.test(value)) {
    return "millimeters";
  }
  if (/\[g\]|(?:^|[\s_-])g(?:$|[\s_-])|grams?|grammi|weight|used_g|filament_g|filament_weight|total_filament_used_g/.test(context) || /[0-9][0-9.,]*\s*g\b/.test(value)) {
    return "grams";
  }
  if (/\[m\]|(?:^|[\s_-])m(?:$|[\s_-])|meters?|metri|used_m|filament_m/.test(context) || /[0-9][0-9.,]*\s*m\b/.test(value)) {
    return "meters";
  }
  return undefined;
}

function mergeFilamentUsageValues(
  metrics: PrintMetrics,
  unit: "grams" | "meters" | "millimeters",
  values: number[],
  isTotal: boolean,
): void {
  const finiteValues = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!finiteValues.length) {
    return;
  }

  if (finiteValues.length > 1 && !isTotal) {
    const filaments = ensureFilamentUsages(metrics, finiteValues.length);
    finiteValues.forEach((value, index) => {
      if (value > 0) {
        setFilamentUsageField(filaments[index], unit, value);
      }
    });
    setFilamentTotal(metrics, unit, finiteValues.reduce((total, value) => total + value, 0));
    return;
  }

  const cleanValues = finiteValues.filter((value) => value > 0);
  if (!cleanValues.length) {
    return;
  }
  const total = cleanValues.reduce((sum, value) => sum + value, 0);
  setFilamentTotal(metrics, unit, total);
  if (!metrics.filaments?.length) {
    setFilamentUsageField(ensureFilamentUsages(metrics, 1)[0], unit, total);
  }
}

function mergeToolpathFilaments(metrics: PrintMetrics, filamentByToolMm: Map<string, number>): void {
  const entries = Array.from(filamentByToolMm.entries()).filter(([, millimeters]) => millimeters > 0);
  if (!entries.length) {
    return;
  }

  if (entries.length > 1) {
    const filaments = ensureFilamentUsages(metrics, entries.length);
    entries.forEach(([tool, millimeters], index) => {
      const filament = filaments[index];
      if (!filament.material && !filament.color) {
        filament.label = `Estrusore T${tool}`;
      }
      setFilamentUsageField(filament, "millimeters", millimeters);
    });
  }

  setFilamentLength(metrics, entries.reduce((total, [, millimeters]) => total + millimeters, 0));
}

function mergeFilamentTextList(metrics: PrintMetrics, field: "material" | "color", values: string[]): void {
  const cleanValues = values.map(cleanMetadataValue).filter(Boolean);
  if (!cleanValues.length) {
    return;
  }

  const existingCount = metrics.filaments?.length ?? 0;
  const broadcastSingleMaterial = field === "material" && cleanValues.length === 1 && existingCount > 1;
  const filaments = ensureFilamentUsages(metrics, broadcastSingleMaterial ? existingCount : cleanValues.length);
  if (broadcastSingleMaterial) {
    filaments.forEach((filament) => {
      filament[field] = cleanValues[0];
    });
  } else {
    cleanValues.forEach((value, index) => {
      filaments[index][field] = value;
    });
  }

  refreshFilamentLabels(metrics);
}

function ensureFilamentUsages(metrics: PrintMetrics, count: number): FilamentUsage[] {
  const filaments = metrics.filaments ? [...metrics.filaments] : [];
  for (let index = filaments.length; index < count; index += 1) {
    filaments.push({
      index,
      label: `Filamento ${index + 1}`,
    });
  }
  metrics.filaments = filaments;
  return filaments;
}

function setFilamentUsageField(filament: FilamentUsage, unit: "grams" | "meters" | "millimeters", value: number): void {
  if (unit === "grams") {
    const rounded = roundMetric(value, 3);
    filament.grams = Math.max(filament.grams ?? 0, rounded);
    return;
  }
  if (unit === "meters") {
    const rounded = roundMetric(value, 4);
    filament.meters = Math.max(filament.meters ?? 0, rounded);
    filament.millimeters = Math.max(filament.millimeters ?? 0, rounded * 1000);
    return;
  }
  const rounded = roundMetric(value, 1);
  filament.millimeters = Math.max(filament.millimeters ?? 0, rounded);
  filament.meters = Math.max(filament.meters ?? 0, rounded / 1000);
}

function setFilamentTotal(metrics: PrintMetrics, unit: "grams" | "meters" | "millimeters", value: number): void {
  if (unit === "grams") {
    metrics.filamentGrams = Math.max(metrics.filamentGrams ?? 0, roundMetric(value, 3));
    return;
  }
  if (unit === "meters") {
    setFilamentLength(metrics, value * 1000);
    return;
  }
  setFilamentLength(metrics, value);
}

function setFilamentLength(metrics: PrintMetrics, lengthMm: number): void {
  const roundedMm = roundMetric(lengthMm, 1);
  metrics.filamentMm = Math.max(metrics.filamentMm ?? 0, roundedMm);
  metrics.filamentMeters = roundMetric(metrics.filamentMm / 1000, 4);
}

function normalizeFilamentMetrics(metrics: PrintMetrics): void {
  const hasQuantifiedFilaments = (metrics.filaments ?? []).some(hasFilamentQuantity);
  const filaments = (metrics.filaments ?? [])
    .filter((filament) => hasFilamentData(filament) && (!hasQuantifiedFilaments || hasFilamentQuantity(filament)))
    .map((filament, index) => ({
      ...filament,
      index,
      label: makeFilamentLabel(filament, index),
    }));

  if (filaments.length) {
    metrics.filaments = filaments;
    const grams = sumFilamentField(filaments, "grams");
    const millimeters = filaments.reduce((total, filament) => {
      const lengthMm = filament.millimeters ?? (filament.meters ? filament.meters * 1000 : 0);
      return total + (Number.isFinite(lengthMm) ? lengthMm : 0);
    }, 0);
    if (grams > 0) {
      metrics.filamentGrams = Math.max(metrics.filamentGrams ?? 0, roundMetric(grams, 3));
    }
    if (millimeters > 0) {
      setFilamentLength(metrics, millimeters);
    }

    const materials = uniqueValues(filaments.map((filament) => filament.material));
    if (materials.length) {
      metrics.detectedMaterial = materials.join(" + ");
    }
  }
}

function refreshFilamentLabels(metrics: PrintMetrics): void {
  metrics.filaments = metrics.filaments?.map((filament, index) => ({
    ...filament,
    index,
    label: makeFilamentLabel(filament, index),
  }));
}

function hasFilamentData(filament: FilamentUsage): boolean {
  return Boolean(
    filament.material
      || filament.color
      || (Number.isFinite(filament.grams) && filament.grams)
      || (Number.isFinite(filament.millimeters) && filament.millimeters)
      || (Number.isFinite(filament.meters) && filament.meters),
  );
}

function hasFilamentQuantity(filament: FilamentUsage): boolean {
  return Boolean(
    (Number.isFinite(filament.grams) && filament.grams)
      || (Number.isFinite(filament.millimeters) && filament.millimeters)
      || (Number.isFinite(filament.meters) && filament.meters),
  );
}

function makeFilamentLabel(filament: FilamentUsage, index: number): string {
  const parts = [filament.material, filament.color].map(cleanMetadataValue).filter(Boolean);
  return parts.length ? parts.join(" ") : filament.label || `Filamento ${index + 1}`;
}

function sumFilamentField(filaments: FilamentUsage[], field: "grams"): number {
  return filaments.reduce((total, filament) => {
    const value = filament[field] ?? 0;
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(cleanMetadataValue).filter(Boolean)));
}

function parseTextList(value: string): string[] {
  const normalized = value.trim().replace(/^\[|\]$/g, "");
  return normalized
    .split(/[;|,]/)
    .map(cleanMetadataValue)
    .filter(Boolean);
}

function parseNumberList(value: string): number[] {
  const normalized = value.trim();
  const explicitParts =
    normalized.includes(";") || normalized.includes("|")
      ? normalized.split(/[;|]/)
      : normalized.includes(".") && normalized.includes(",")
      ? normalized.split(",")
      : /,\s+/.test(normalized)
      ? normalized.split(/,\s+/)
      : undefined;

  if (explicitParts) {
    return explicitParts
      .map((part) => part.match(/-?[0-9]+(?:[.,][0-9]+)?/)?.[0])
      .filter((part): part is string => Boolean(part))
      .map(parseLocaleNumber)
      .filter((number) => Number.isFinite(number));
  }

  return Array.from(value.matchAll(/-?[0-9]+(?:[.,][0-9]+)?/g))
    .map((match) => parseLocaleNumber(match[0]))
    .filter((number) => Number.isFinite(number));
}

function getMetadataKey(line: string): string {
  const attributeKey = line.match(/\b(?:name|key)\s*=\s*["']([^"']+)["']/i)?.[1];
  if (attributeKey) {
    return attributeKey;
  }

  const normalized = line.replace(/^\s*;\s*/, "");
  const separatorIndex = normalized.search(/[:=]/);
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex).trim() : normalized.trim();
}

function getAssignedValue(line: string): string {
  const attributeValue = line.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1];
  if (attributeValue !== undefined) {
    return attributeValue.trim();
  }

  const normalized = line.replace(/^\s*;\s*/, "");
  const separatorIndex = normalized.search(/[:=]/);
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1).trim() : normalized.trim();
}

function cleanMetadataValue(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
}

function hasPrintEstimate(metrics: PrintMetrics): boolean {
  return Boolean(metrics.printTimeMinutes || metrics.filamentGrams || metrics.filamentMm || metrics.filamentMeters || metrics.filaments?.length);
}

function roundMetric(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseDurationToMinutes(value: string): number | undefined {
  const normalized = value.toLowerCase().replaceAll(",", ".").trim();
  const colon = normalized.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const first = Number(colon[1]);
    const second = Number(colon[2]);
    const third = Number(colon[3] ?? 0);
    return colon[3] ? first * 60 + second + third / 60 : first + second / 60;
  }

  let minutes = 0;
  let matched = false;
  const units = normalized.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(days?|giorni?|d|hours?|hrs?|ore?|h|minutes?|mins?|minuti?|m|seconds?|secs?|secondi?|s)\b/g);
  for (const match of units) {
    const amount = Number(match[1]);
    const unit = match[2];
    matched = true;
    if (/^d|day|giorn/.test(unit)) {
      minutes += amount * 1440;
    } else if (/^h|hour|hr|or/.test(unit)) {
      minutes += amount * 60;
    } else if (/^m|min/.test(unit)) {
      minutes += amount;
    } else {
      minutes += amount / 60;
    }
  }
  return matched && minutes > 0 ? minutes : undefined;
}

function parseGcodeParams(command: string): Partial<Record<"X" | "Y" | "Z" | "E" | "F", number>> {
  const params: Partial<Record<"X" | "Y" | "Z" | "E" | "F", number>> = {};
  for (const match of command.matchAll(/([XYZEF])\s*(-?[0-9]+(?:\.[0-9]+)?)/gi)) {
    const key = match[1].toUpperCase() as "X" | "Y" | "Z" | "E" | "F";
    params[key] = Number(match[2]);
  }
  return params;
}

function extract3mfGeometry(document: Document): Extracted3mfGeometry {
  const modelElement = firstElement(document, "model");
  const unitScale = unitToMm(modelElement?.getAttribute("unit"));
  const objects = parse3mfObjects(document, unitScale);
  const buildItems = elements(document, "item").filter((item) => item.parentElement && tagMatches(item.parentElement, "build"));
  const vertices: number[] = [];
  const indices: number[] = [];
  const bounds = createEmptyBounds();

  if (buildItems.length) {
    for (const item of buildItems) {
      const objectId = item.getAttribute("objectid");
      if (!objectId) {
        continue;
      }
      appendObjectMesh(objectId, objects, [parseTransform(item.getAttribute("transform"))], vertices, indices, bounds);
    }
  } else {
    for (const objectId of objects.keys()) {
      appendObjectMesh(objectId, objects, [], vertices, indices, bounds);
    }
  }

  return { vertices, indices, bounds };
}

function parse3mfObjects(document: Document, unitScale: number): Map<string, ObjectNode> {
  const result = new Map<string, ObjectNode>();

  for (const object of elements(document, "object")) {
    const id = object.getAttribute("id");
    if (!id) {
      continue;
    }

    const meshElement = firstChildElement(object, "mesh");
    const componentsElement = firstChildElement(object, "components");
    const node: ObjectNode = { components: [] };

    if (meshElement) {
      const vertices: number[] = [];
      const indices: number[] = [];
      for (const vertex of elements(meshElement, "vertex")) {
        vertices.push(
          parseFloat(vertex.getAttribute("x") ?? "0") * unitScale,
          parseFloat(vertex.getAttribute("y") ?? "0") * unitScale,
          parseFloat(vertex.getAttribute("z") ?? "0") * unitScale,
        );
      }
      for (const triangle of elements(meshElement, "triangle")) {
        indices.push(
          Number(triangle.getAttribute("v1") ?? 0),
          Number(triangle.getAttribute("v2") ?? 0),
          Number(triangle.getAttribute("v3") ?? 0),
        );
      }
      node.mesh = { vertices, indices };
    }

    if (componentsElement) {
      for (const component of elements(componentsElement, "component")) {
        const objectId = component.getAttribute("objectid");
        if (objectId) {
          node.components.push({
            objectId,
            transform: parseTransform(component.getAttribute("transform")),
          });
        }
      }
    }

    result.set(id, node);
  }

  return result;
}

function appendObjectMesh(
  objectId: string,
  objects: Map<string, ObjectNode>,
  transforms: Matrix3mf[],
  vertices: number[],
  indices: number[],
  bounds: Bounds,
  stack: string[] = [],
): void {
  if (stack.includes(objectId)) {
    return;
  }
  const node = objects.get(objectId);
  if (!node) {
    return;
  }

  if (node.mesh) {
    const offset = vertices.length / 3;
    for (let i = 0; i < node.mesh.vertices.length; i += 3) {
      let point: [number, number, number] = [
        node.mesh.vertices[i],
        node.mesh.vertices[i + 1],
        node.mesh.vertices[i + 2],
      ];
      for (const transform of transforms) {
        point = applyTransform(point, transform);
      }
      vertices.push(point[0], point[1], point[2]);
      expandBounds(bounds, point[0], point[1], point[2]);
    }
    for (const index of node.mesh.indices) {
      indices.push(index + offset);
    }
  }

  for (const component of node.components) {
    appendObjectMesh(
      component.objectId,
      objects,
      [component.transform, ...transforms],
      vertices,
      indices,
      bounds,
      [...stack, objectId],
    );
  }
}

function parseTransform(value: string | null): Matrix3mf {
  if (!value) {
    return IDENTITY_MATRIX;
  }
  const numbers = value
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((number) => Number.isFinite(number));
  return numbers.length === 12 ? numbers : IDENTITY_MATRIX;
}

function applyTransform(point: [number, number, number], matrix: Matrix3mf): [number, number, number] {
  const [x, y, z] = point;
  return [
    x * matrix[0] + y * matrix[3] + z * matrix[6] + matrix[9],
    x * matrix[1] + y * matrix[4] + z * matrix[7] + matrix[10],
    x * matrix[2] + y * matrix[5] + z * matrix[8] + matrix[11],
  ];
}

function calculateMeshVolumeCm3(vertices: number[], indices: number[]): number {
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ai = indices[i] * 3;
    const bi = indices[i + 1] * 3;
    const ci = indices[i + 2] * 3;
    const ax = vertices[ai];
    const ay = vertices[ai + 1];
    const az = vertices[ai + 2];
    const bx = vertices[bi];
    const by = vertices[bi + 1];
    const bz = vertices[bi + 2];
    const cx = vertices[ci];
    const cy = vertices[ci + 1];
    const cz = vertices[ci + 2];
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(volume / 6) / 1000;
}

function mergeGcodeMetrics(target: PrintMetrics, source: PrintMetrics): void {
  target.printTimeMinutes = target.printTimeMinutes ?? source.printTimeMinutes;
  target.filamentGrams = Math.max(target.filamentGrams ?? 0, source.filamentGrams ?? 0) || undefined;
  target.filamentMeters = Math.max(target.filamentMeters ?? 0, source.filamentMeters ?? 0) || undefined;
  target.filamentMm = Math.max(target.filamentMm ?? 0, source.filamentMm ?? 0) || undefined;
  target.filaments = mergeFilamentUsages(target.filaments, source.filaments);
  target.layerCount = target.layerCount ?? source.layerCount;
  target.detectedPrinter = target.detectedPrinter ?? source.detectedPrinter;
  target.detectedMaterial = target.detectedMaterial ?? source.detectedMaterial;
  normalizeFilamentMetrics(target);
}

function mergeFilamentUsages(
  targetFilaments: FilamentUsage[] | undefined,
  sourceFilaments: FilamentUsage[] | undefined,
): FilamentUsage[] | undefined {
  if (!sourceFilaments?.length) {
    return targetFilaments;
  }
  if (!targetFilaments?.length) {
    return sourceFilaments;
  }

  const next = [...targetFilaments];
  sourceFilaments.forEach((source, index) => {
    const target = next[index] ?? { index, label: `Filamento ${index + 1}` };
    next[index] = {
      ...target,
      label: source.label || target.label,
      grams: Math.max(target.grams ?? 0, source.grams ?? 0) || target.grams,
      meters: Math.max(target.meters ?? 0, source.meters ?? 0) || target.meters,
      millimeters: Math.max(target.millimeters ?? 0, source.millimeters ?? 0) || target.millimeters,
      material: target.material ?? source.material,
      color: target.color ?? source.color,
    };
  });

  return next;
}

function createBaseMetrics(fileName: string, fileSize: number, kind: PrintMetrics["kind"], warnings: string[]): PrintMetrics {
  return {
    fileName,
    fileSize,
    kind,
    warnings,
  };
}

function createEmptyBounds(): Bounds {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
}

function expandBounds(bounds: Bounds, x: number, y: number, z: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

function isFiniteBounds(bounds: Bounds): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX);
}

function boundsToBox(bounds: Bounds): BoxSize {
  return {
    x: Math.max(0, bounds.maxX - bounds.minX),
    y: Math.max(0, bounds.maxY - bounds.minY),
    z: Math.max(0, bounds.maxZ - bounds.minZ),
  };
}

function unitToMm(unit: string | null | undefined): number {
  switch (unit?.toLowerCase()) {
    case "micron":
      return 0.001;
    case "centimeter":
      return 10;
    case "inch":
      return 25.4;
    case "foot":
      return 304.8;
    case "meter":
      return 1000;
    case "millimeter":
    default:
      return 1;
  }
}

function firstElement(document: Document, tag: string): Element | undefined {
  return elements(document, tag)[0];
}

function firstChildElement(element: Element, tag: string): Element | undefined {
  return Array.from(element.children).find((child) => tagMatches(child, tag));
}

function elements(root: Document | Element, tag: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((element) => tagMatches(element, tag));
}

function tagMatches(element: Element, tag: string): boolean {
  const expected = tag.toLowerCase();
  const localName = (element.localName || "").toLowerCase();
  const tagName = element.tagName.toLowerCase();
  return localName === expected || tagName === expected || tagName.endsWith(`:${expected}`);
}

function parseLocaleNumber(value: string): number {
  return Number(value.replace(",", "."));
}
