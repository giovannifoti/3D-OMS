import { ChangeEvent, DragEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Calculator,
  Clock3,
  Edit3,
  FileArchive,
  FileText,
  History,
  Lock,
  MapPin,
  Package,
  Palette,
  PlusCircle,
  ReceiptText,
  Save,
  Search,
  Sparkles,
  Trash2,
  Truck,
  Upload,
  UserRound,
  XCircle,
  Weight,
} from "lucide-react";
import { parsePrintFile } from "./lib/fileParsers";
import {
  DEFAULT_SHIPPING_METHOD,
  DEFAULT_PRICING,
  PRINTER_PROFILE,
  SHIPPING_OPTIONS,
  SURCHARGES,
  applyManualUnitPriceToBreakdown,
  applyShippingToBreakdown,
  calculatePrice,
  formatCurrency,
  formatNumber,
  getMaterial,
  getShippingOption,
  normalizeManualUnitPrice,
  suggestPricingFromMetrics,
} from "./lib/pricing";
import { loadOrders, loadProducts, makeOrderId, makeQuoteNumber, saveOrders, saveProducts } from "./lib/storage";
import type {
  Customer,
  FrequentProduct,
  Order,
  OrderStatus,
  ParsedFile,
  PriceBreakdown,
  PricingInputs,
  PrintMetrics,
  QuoteItem,
  ShippingMethod,
} from "./types";

type ViewKey = "nuovo" | "storico" | "prodotti";

const STATUSES: OrderStatus[] = ["Bozza", "Preventivo inviato", "Accettato", "In stampa", "Completato"];
const BRAND_WORDMARK_SRC = "/brand/logo-artigianidel3d-light.png";
const DEFAULT_NOTES = "Validita preventivo: 15 giorni. Bianco e nero inclusi nel prezzo base.";

const EMPTY_CUSTOMER: Customer = {
  name: "",
  email: "",
  phone: "",
};

const EMPTY_PRODUCT: Omit<FrequentProduct, "id"> = {
  name: "",
  sku: "",
  defaultMinutes: 60,
  defaultGrams: 25,
  defaultQuantity: 1,
  color: "Bianco",
  finish: "Standard",
  notes: "",
};

function App() {
  const [view, setView] = useState<ViewKey>("nuovo");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [itemName, setItemName] = useState("Stampa personalizzata");
  const [pricing, setPricing] = useState<PricingInputs>(DEFAULT_PRICING);
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>(DEFAULT_SHIPPING_METHOD);
  const [manualQuoteUnitPrice, setManualQuoteUnitPrice] = useState<number | undefined>();
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER);
  const [customerNumber, setCustomerNumber] = useState("");
  const [notes, setNotes] = useState(DEFAULT_NOTES);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<FrequentProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productDraft, setProductDraft] = useState(EMPTY_PRODUCT);
  const [productSource, setProductSource] = useState<ParsedFile | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isParsingProduct, setIsParsingProduct] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [productDragActive, setProductDragActive] = useState(false);
  const [activeStatus, setActiveStatus] = useState<OrderStatus | "Tutti">("Tutti");
  const [orderSearch, setOrderSearch] = useState("");
  const [draftQuoteNumber, setDraftQuoteNumber] = useState(() => makeQuoteNumber());
  const [editingOrderId, setEditingOrderId] = useState<string | undefined>();
  const demoLoaded = useRef(false);

  useEffect(() => {
    setOrders(loadOrders());
    setProducts(loadProducts());
  }, []);

  useEffect(() => {
    if (demoLoaded.current || new URLSearchParams(window.location.search).get("demo") !== "gcode") {
      return;
    }
    demoLoaded.current = true;
    const demoFile = new File([DEMO_GCODE], "demo-portachiavi.gcode", { type: "text/plain" });
    void handleFile(demoFile);
  }, []);

  useEffect(() => {
    saveOrders(orders);
  }, [orders]);

  useEffect(() => {
    saveProducts(products);
  }, [products]);

  const pricedQuote = useMemo(() => {
    const rows = quoteItems.map((item) => {
      const automaticBreakdown = calculatePrice({
        ...pricing,
        quantity: item.quantity,
        manualMinutes: item.manualMinutes,
        filamentGrams: item.filamentGrams,
        color: item.color ?? pricing.color,
        finish: item.finish ?? pricing.finish,
      });
      const manualUnitPrice = getQuoteItemManualUnitPrice(item);
      return {
        item,
        automaticBreakdown,
        manualUnitPrice,
        breakdown: applyManualUnitPriceToBreakdown(automaticBreakdown, manualUnitPrice, item.quantity, pricing),
      };
    });
    const automaticBreakdown = calculatePrice(pricing);
    const baseBreakdown = rows.length
      ? combinePriceBreakdowns(rows.map((row) => row.breakdown))
      : applyManualUnitPriceToBreakdown(automaticBreakdown, manualQuoteUnitPrice, pricing.quantity, pricing);
    const totalQuantity = rows.length
      ? rows.reduce((total, row) => total + row.item.quantity, 0)
      : pricing.quantity;
    return {
      rows,
      automaticBreakdown,
      baseBreakdown,
      breakdown: applyShippingToBreakdown(baseBreakdown, shippingMethod, totalQuantity, pricing),
    };
  }, [manualQuoteUnitPrice, pricing, quoteItems, shippingMethod]);
  const breakdown = pricedQuote.breakdown;
  const quoteTotals = useMemo(
    () => ({
      files: quoteItems.length,
      quantity: quoteItems.reduce((total, item) => total + item.quantity, 0),
      minutes: quoteItems.reduce((total, item) => total + item.manualMinutes * item.quantity, 0),
      grams: quoteItems.reduce((total, item) => total + item.filamentGrams * item.quantity, 0),
    }),
    [quoteItems],
  );
  const selectedMaterial = getMaterial("pla");
  const shippingOption = getShippingOption(shippingMethod);
  const editingOrder = editingOrderId ? orders.find((order) => order.id === editingOrderId) : undefined;
  const activeQuoteNumber = editingOrder?.quoteNumber ?? draftQuoteNumber;
  const normalizedOrderSearch = orderSearch.trim().toLowerCase();
  const filteredOrders = (activeStatus === "Tutti" ? orders : orders.filter((order) => order.status === activeStatus)).filter((order) => {
    if (!normalizedOrderSearch) {
      return true;
    }
    return [order.quoteNumber, order.customer.name, order.customerNumber, order.customer.phone, order.fileName]
      .join(" ")
      .toLowerCase()
      .includes(normalizedOrderSearch);
  });
  const selectedProducts = products.filter((product) => selectedProductIds.includes(product.id));
  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const filteredProducts = normalizedProductSearch
    ? products.filter((product) =>
        [
          product.name,
          product.sku,
          product.sourceFileName,
          product.notes,
          product.color,
          product.finish,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedProductSearch),
      )
    : products;
  const quoteWarnings = quoteItems.length
    ? quoteItems.flatMap((item) => item.metrics.warnings.map((warning) => `${item.name}: ${warning}`))
    : (parsed?.metrics.warnings ?? []);
  const quoteMetrics = quoteItems.length
    ? makeQuoteMetrics(itemName, quoteItems)
    : parsed
    ? {
        ...parsed.metrics,
        fileName: itemName || parsed.metrics.fileName,
        printTimeMinutes: pricing.manualMinutes,
        filamentGrams: pricing.filamentGrams,
      }
    : makeManualMetrics(itemName, pricing);

  async function handleFiles(files: File[]) {
    if (!files.length) {
      return;
    }
    setIsParsing(true);
    try {
      const results = await Promise.all(files.map((file) => parsePrintFile(file)));
      const newItems = results.map((result, index) => makeQuoteItem(result, files[index].name, pricing));
      setManualQuoteUnitPrice(undefined);
      setQuoteItems((previous) => [...previous, ...newItems]);
      setParsed(results[0] ?? null);
      setItemName((previous) => {
        if (previous !== "Stampa personalizzata") {
          return previous;
        }
        return files.length === 1 && !quoteItems.length ? files[0].name : "Preventivo multiprodotto";
      });
      if (newItems.length === 1 && !quoteItems.length) {
        const item = newItems[0];
        setPricing((previous) => ({
          ...suggestPricingFromMetrics(item.metrics, previous),
          quantity: item.quantity,
          manualMinutes: item.manualMinutes,
          filamentGrams: item.filamentGrams,
        }));
      }
    } finally {
      setIsParsing(false);
      setDragActive(false);
    }
  }

  async function handleFile(file: File) {
    await handleFiles([file]);
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length) {
      void handleFiles(files);
    }
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      void handleFiles(files);
    }
  }

  async function handleProductFile(file: File) {
    setIsParsingProduct(true);
    try {
      const result = await parsePrintFile(file);
      const suggested = suggestPricingFromMetrics(result.metrics, {
        ...DEFAULT_PRICING,
        quantity: productDraft.defaultQuantity,
        color: productDraft.color,
        finish: productDraft.finish,
      });
      setProductSource(result);
      setProductDraft((previous) => ({
        ...previous,
        name: previous.name.trim() ? previous.name : stripFileExtension(file.name),
        defaultMinutes: suggested.manualMinutes,
        defaultGrams: suggested.filamentGrams,
      }));
    } finally {
      setIsParsingProduct(false);
      setProductDragActive(false);
    }
  }

  function handleProductFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void handleProductFile(file);
    }
    event.target.value = "";
  }

  function handleProductDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void handleProductFile(file);
    }
  }

  function patchPricing(update: Partial<PricingInputs>) {
    setPricing((previous) => ({
      ...previous,
      ...update,
      materialKey: "pla",
      machineRate: PRINTER_PROFILE.machineRate,
      powerKw: update.powerKw ?? previous.powerKw ?? PRINTER_PROFILE.defaultAveragePowerKw,
      energyCostKwh: PRINTER_PROFILE.energyCostKwh,
      marginPercent: 125,
    }));
  }

  function patchQuoteOptions(update: Partial<Pick<PricingInputs, "color" | "finish">>) {
    patchPricing(update);
    setQuoteItems((previous) => previous.map((item) => ({ ...item, ...update })));
  }

  function updateQuoteItem(itemId: string, update: Partial<Pick<QuoteItem, "name" | "quantity" | "manualMinutes" | "filamentGrams">>) {
    setQuoteItems((previous) =>
      previous.map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        const next = {
          ...item,
          ...update,
          quantity: update.quantity !== undefined ? Math.max(1, Math.round(update.quantity)) : item.quantity,
          manualMinutes: update.manualMinutes !== undefined ? Math.max(1, update.manualMinutes) : item.manualMinutes,
          filamentGrams: update.filamentGrams !== undefined ? Math.max(1, update.filamentGrams) : item.filamentGrams,
        };
        return {
          ...next,
          metrics: {
            ...next.metrics,
            fileName: next.name || next.fileName,
            printTimeMinutes: next.manualMinutes,
            filamentGrams: next.filamentGrams,
          },
        };
      }),
    );
  }

  function updateQuoteItemManualUnitPrice(itemId: string, manualUnitPrice: number | undefined) {
    setQuoteItems((previous) =>
      previous.map((item) =>
        item.id === itemId
          ? {
              ...item,
              manualUnitPrice: normalizeManualUnitPrice(manualUnitPrice),
              manualPrice: undefined,
            }
          : item,
      ),
    );
  }

  function deleteQuoteItem(itemId: string) {
    const remainingItems = quoteItems.filter((item) => item.id !== itemId);
    setQuoteItems(remainingItems);
    if (!remainingItems.length) {
      setParsed(null);
      setItemName("Stampa personalizzata");
      setManualQuoteUnitPrice(undefined);
    }
  }

  function clearQuoteItems() {
    setQuoteItems([]);
    setParsed(null);
    setItemName("Stampa personalizzata");
    setManualQuoteUnitPrice(undefined);
    patchPricing({
      quantity: DEFAULT_PRICING.quantity,
      manualMinutes: DEFAULT_PRICING.manualMinutes,
      filamentGrams: DEFAULT_PRICING.filamentGrams,
    });
  }

  function resetQuoteDraft() {
    setEditingOrderId(undefined);
    setDraftQuoteNumber(makeQuoteNumber());
    setParsed(null);
    setQuoteItems([]);
    setItemName("Stampa personalizzata");
    setPricing(DEFAULT_PRICING);
    setShippingMethod(DEFAULT_SHIPPING_METHOD);
    setManualQuoteUnitPrice(undefined);
    setCustomer(EMPTY_CUSTOMER);
    setCustomerNumber("");
    setNotes(DEFAULT_NOTES);
    setView("nuovo");
  }

  function saveCurrentOrder(status?: OrderStatus) {
    const now = new Date();
    const existingOrder = editingOrderId ? orders.find((order) => order.id === editingOrderId) : undefined;
    const order: Order = {
      id: existingOrder?.id ?? makeOrderId(),
      quoteNumber: existingOrder?.quoteNumber ?? draftQuoteNumber,
      createdAt: existingOrder?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      status: status ?? existingOrder?.status ?? "Bozza",
      customer,
      customerNumber,
      fileName: itemName || quoteMetrics.fileName,
      materialKey: "pla",
      quantity: quoteItems.length ? quoteTotals.quantity : pricing.quantity,
      color: pricing.color,
      finish: pricing.finish,
      averagePowerKw: pricing.powerKw,
      energyCostKwh: pricing.energyCostKwh,
      machineRate: pricing.machineRate,
      marginPercent: pricing.marginPercent,
      includeVat: pricing.includeVat,
      vatPercent: pricing.vatPercent,
      shippingMethod,
      shippingCost: shippingOption.cost,
      manualUnitPrice: quoteItems.length ? undefined : manualQuoteUnitPrice,
      manualPrice: undefined,
      netPrice: breakdown.netPrice,
      grossPrice: breakdown.grossPrice,
      metrics: quoteMetrics,
      items: quoteItems.length ? quoteItems : undefined,
      notes,
    };
    setOrders((previous) => (existingOrder ? previous.map((item) => (item.id === existingOrder.id ? order : item)) : [order, ...previous]));
    setEditingOrderId(undefined);
    setDraftQuoteNumber(makeQuoteNumber());
    setView("storico");
  }

  function updateOrderStatus(orderId: string, status: OrderStatus) {
    setOrders((previous) => previous.map((order) => (order.id === orderId ? { ...order, status } : order)));
  }

  function deleteOrder(orderId: string) {
    setOrders((previous) => previous.filter((order) => order.id !== orderId));
    if (editingOrderId === orderId) {
      resetQuoteDraft();
    }
  }

  function loadOrderForEditing(order: Order) {
    const restoredPricing = makePricingFromOrder(order);
    const restoredItems = restoreOrderItems(order);
    setEditingOrderId(order.id);
    setDraftQuoteNumber(order.quoteNumber);
    setCustomer(order.customer);
    setCustomerNumber(order.customerNumber);
    setItemName(order.fileName || order.metrics.fileName || "Preventivo");
    setNotes(order.notes || DEFAULT_NOTES);
    setPricing(restoredPricing);
    setShippingMethod(order.shippingMethod ?? DEFAULT_SHIPPING_METHOD);
    setQuoteItems(restoredItems);
    setParsed({
      metrics: order.metrics,
      preview: { kind: "empty", message: "Preventivo salvato nello storico." },
    });
    setManualQuoteUnitPrice(
      restoredItems.length
        ? undefined
        : normalizeManualUnitPrice(
            order.manualUnitPrice ?? (order.manualPrice ? order.manualPrice / Math.max(1, order.quantity) : undefined) ?? getSavedOrderUnitPrice(order),
          ),
    );
    setView("nuovo");
  }

  async function generateQuote() {
    const { openQuote } = await import("./lib/quote");
    await openQuote({
      quoteNumber: activeQuoteNumber,
      customer,
      customerNumber,
      metrics: quoteMetrics,
      pricing,
      baseBreakdown: pricedQuote.baseBreakdown,
      breakdown,
      shippingMethod,
      items: pricedQuote.rows,
      notes,
    });
  }

  async function generateOrderQuote(order: Order) {
    const { openOrderQuote } = await import("./lib/quote");
    await openOrderQuote(order);
  }

  function saveFrequentProduct() {
    const trimmedName = productDraft.name.trim();
    if (!trimmedName || !productSource) {
      return;
    }
    const product: FrequentProduct = {
      id: makeOrderId(),
      ...productDraft,
      name: trimmedName,
      sku: productDraft.sku.trim(),
      sourceFileName: productSource.metrics.fileName,
      sourceKind: productSource.metrics.kind,
      sourceFileSize: productSource.metrics.fileSize,
      boundingBox: productSource.metrics.boundingBox,
      layerCount: productSource.metrics.layerCount,
      volumeCm3: productSource.metrics.volumeCm3,
      warnings: productSource.metrics.warnings,
      notes: productDraft.notes.trim(),
      defaultQuantity: Math.max(1, productDraft.defaultQuantity),
      defaultMinutes: Math.max(1, productDraft.defaultMinutes),
      defaultGrams: Math.max(1, productDraft.defaultGrams),
    };
    setProducts((previous) => [product, ...previous]);
    setProductDraft(EMPTY_PRODUCT);
    setProductSource(null);
  }

  function deleteProduct(productId: string) {
    setProducts((previous) => previous.filter((product) => product.id !== productId));
    setSelectedProductIds((previous) => previous.filter((id) => id !== productId));
  }

  function updateProductManualUnitPrice(productId: string, manualUnitPrice: number | undefined) {
    setProducts((previous) =>
      previous.map((product) =>
        product.id === productId
          ? {
              ...product,
              manualUnitPrice: normalizeManualUnitPrice(manualUnitPrice),
              manualPrice: undefined,
            }
          : product,
      ),
    );
  }

  function applyProduct(product: FrequentProduct) {
    applyProducts([product], {
      copySingleProductNotes: true,
      defaultQuoteName: "Preventivo multiprodotto",
    });
  }

  function applySelectedProducts() {
    applyProducts(selectedProducts, {
      defaultQuoteName: selectedProducts.length === 1 ? selectedProducts[0].name : `Preventivo ${selectedProducts.length} prodotti frequenti`,
    });
    setSelectedProductIds([]);
  }

  function applyAllProducts() {
    applyProducts(filteredProducts, {
      defaultQuoteName: filteredProducts.length === 1 ? filteredProducts[0].name : `Preventivo ${filteredProducts.length} prodotti frequenti`,
    });
    setSelectedProductIds([]);
  }

  function applyProducts(
    productsToApply: FrequentProduct[],
    options: { copySingleProductNotes?: boolean; defaultQuoteName?: string } = {},
  ) {
    if (!productsToApply.length) {
      return;
    }
    const newItems = productsToApply.map(makeProductQuoteItem);
    const firstProduct = productsToApply[0];
    const sameColor = productsToApply.every((product) => product.color === firstProduct.color);
    const sameFinish = productsToApply.every((product) => product.finish === firstProduct.finish);
    setManualQuoteUnitPrice(undefined);
    setQuoteItems((previous) => [...previous, ...newItems]);
    setParsed({
      metrics: newItems[0].metrics,
      preview: { kind: "empty", message: "Prodotti richiamati dal catalogo." },
    });
    setItemName((previous) => {
      if (previous !== "Stampa personalizzata") {
        return previous;
      }
      return options.defaultQuoteName ?? "Preventivo multiprodotto";
    });
    patchPricing({
      ...(sameColor ? { color: firstProduct.color } : {}),
      ...(sameFinish ? { finish: firstProduct.finish } : {}),
    });
    if (options.copySingleProductNotes && firstProduct.notes) {
      setNotes(firstProduct.notes);
    }
    setView("nuovo");
  }

  function toggleProductSelection(productId: string, checked: boolean) {
    setSelectedProductIds((previous) =>
      checked ? Array.from(new Set([...previous, productId])) : previous.filter((id) => id !== productId),
    );
  }

  function selectFilteredProducts() {
    setSelectedProductIds((previous) => Array.from(new Set([...previous, ...filteredProducts.map((product) => product.id)])));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <img className="brand-wordmark" src={BRAND_WORDMARK_SRC} alt="Artigiani del3d" />
          <div className="brand-copy">
            <p className="eyebrow">Gestionale preventivi</p>
            <h1>Ordini stampa 3D</h1>
            <span>Calcolo rapido, catalogo prodotti e PDF coordinati al brand.</span>
          </div>
        </div>
        <div className="topbar-metrics">
          <MetricPill icon={<Archive size={17} />} label="Ordini" value={orders.length.toString()} />
          <MetricPill icon={<ReceiptText size={17} />} label="Numero" value={activeQuoteNumber} />
          <MetricPill icon={<Calculator size={17} />} label="Totale" value={formatCurrency(breakdown.grossPrice)} />
        </div>
      </header>

      <nav className="main-tabs" aria-label="Sezioni gestionale">
        <button className={view === "nuovo" ? "is-selected" : ""} onClick={() => setView("nuovo")}>
          <ReceiptText size={18} />
          Nuovo ordine
        </button>
        <button className={view === "storico" ? "is-selected" : ""} onClick={() => setView("storico")}>
          <History size={18} />
          Storico
        </button>
        <button className={view === "prodotti" ? "is-selected" : ""} onClick={() => setView("prodotti")}>
          <Package size={18} />
          Prodotti frequenti
        </button>
      </nav>

      {editingOrder ? (
        <section className="edit-banner">
          <div>
            <strong>Modifica preventivo {editingOrder.quoteNumber}</strong>
            <span>
              Stai lavorando sul preventivo salvato per {editingOrder.customer.name || "cliente senza nome"}. Il PDF rigenerato usera lo stesso numero.
            </span>
          </div>
          <button className="secondary-button" onClick={resetQuoteDraft}>
            <XCircle size={18} />
            Nuovo preventivo
          </button>
        </section>
      ) : null}

      {view === "nuovo" && (
        <section className="quote-builder">
          <div className="quote-editor">
            <section className="panel quote-products-panel">
              <div className="quote-section-header">
                <div>
                  <PanelTitle icon={<FileArchive size={18} />} title="Prodotti del preventivo" />
                  <p className="muted">Carica piu file insieme oppure aggiungi prodotti frequenti.</p>
                </div>
                {quoteItems.length ? (
                  <button className="danger-button" onClick={clearQuoteItems}>
                    <Trash2 size={18} />
                    Elimina tutto
                  </button>
                ) : null}
              </div>

              <div className="quote-top-controls">
                <TextField label="Nome preventivo" value={itemName} onChange={setItemName} />
                <label
                  className={`quote-upload-button ${dragActive ? "is-active" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                >
                  <input accept=".3mf,.gcode,.gco,.gc" multiple type="file" onChange={handleFileInput} />
                  <Upload size={18} />
                  <span>{isParsing ? "Analisi in corso..." : "Aggiungi G-code / 3MF"}</span>
                </label>
              </div>

              {quoteItems.length ? (
                <>
                  <div className="quote-overview">
                    <InfoRow label="Prodotti" value={quoteTotals.files.toString()} />
                    <InfoRow label="Pezzi" value={quoteTotals.quantity.toString()} />
                    <InfoRow label="Tempo totale" value={`${formatNumber(quoteTotals.minutes)} min`} />
                    <InfoRow label="Filamento" value={`${formatNumber(quoteTotals.grams)} g`} />
                  </div>
                  <div className="quote-lines">
                    {pricedQuote.rows.map((row) => (
                      <article className="quote-line" key={row.item.id}>
                        <div className="quote-line-product">
                          <TextField label="Prodotto" value={row.item.name} onChange={(name) => updateQuoteItem(row.item.id, { name })} />
                          <small>
                            {row.item.fileName} · {row.item.kind.toUpperCase()}
                          </small>
                        </div>
                        <NumberField
                          label="Quantita"
                          min={1}
                          step={1}
                          value={row.item.quantity}
                          onChange={(quantity) => updateQuoteItem(row.item.id, { quantity })}
                        />
                        <NumberField
                          label="Tempo min"
                          min={1}
                          step={5}
                          value={row.item.manualMinutes}
                          onChange={(manualMinutes) => updateQuoteItem(row.item.id, { manualMinutes })}
                        />
                        <NumberField
                          label="Filamento g"
                          min={1}
                          step={1}
                          value={row.item.filamentGrams}
                          onChange={(filamentGrams) => updateQuoteItem(row.item.id, { filamentGrams })}
                        />
                        <CurrencyField
                          label="Prezzo unitario manuale"
                          placeholder={`Auto ${formatCurrency(row.automaticBreakdown.unitPrice)}`}
                          value={row.manualUnitPrice}
                          onChange={(manualUnitPrice) => updateQuoteItemManualUnitPrice(row.item.id, manualUnitPrice)}
                        />
                        <div className="quote-line-total">
                          <span>Totale riga</span>
                          <strong>{formatCurrency(row.breakdown.grossPrice)}</strong>
                          <small>
                            {row.manualUnitPrice
                              ? `${formatCurrency(row.manualUnitPrice)} cad. manuale`
                              : `${formatCurrency(row.automaticBreakdown.unitPrice)} cad. automatico`}
                          </small>
                        </div>
                        <button className="icon-button danger" title="Elimina prodotto" onClick={() => deleteQuoteItem(row.item.id)}>
                          <Trash2 size={17} />
                        </button>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="manual-quote-editor">
                  <p className="muted">Preventivo manuale: inserisci i dati oppure carica uno o piu file.</p>
                  <div className="manual-quote-grid">
                    <NumberField
                      label="Quantita"
                      min={1}
                      step={1}
                      value={pricing.quantity}
                      onChange={(quantity) => patchPricing({ quantity: Math.max(1, Math.round(quantity)) })}
                    />
                    <NumberField
                      label="Tempo stampa min"
                      min={1}
                      step={5}
                      value={pricing.manualMinutes}
                      onChange={(manualMinutes) => patchPricing({ manualMinutes })}
                    />
                    <NumberField
                      label="Filamento g"
                      min={1}
                      step={1}
                      value={pricing.filamentGrams}
                      onChange={(filamentGrams) => patchPricing({ filamentGrams })}
                    />
                    <CurrencyField
                      label="Prezzo unitario manuale"
                      placeholder={`Auto ${formatCurrency(pricedQuote.automaticBreakdown.unitPrice)}`}
                      value={manualQuoteUnitPrice}
                      onChange={(value) => setManualQuoteUnitPrice(normalizeManualUnitPrice(value))}
                    />
                    <div className="quote-line-total">
                      <span>Totale</span>
                      <strong>{formatCurrency(breakdown.grossPrice)}</strong>
                      <small>{formatCurrency(breakdown.unitPrice)} cad.</small>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {quoteWarnings.length ? (
              <section className="panel warning-panel">
                <PanelTitle icon={<AlertTriangle size={18} />} title="Da controllare" />
                <ul className="warning-list">
                  {quoteWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="quote-lower-grid">
              <section className="panel locked-panel">
                <PanelTitle icon={<Lock size={18} />} title="Parametri fissi" />
                <div className="fixed-facts">
                  <InfoRow label="Stampante" value={PRINTER_PROFILE.name} />
                  <InfoRow label="Potenza nominale" value={`${formatNumber(PRINTER_PROFILE.ratedPowerKw, 2)} kW`} />
                  <InfoRow
                    label="Consumo default"
                    value={`${formatNumber(PRINTER_PROFILE.averagePowerFactor * 100)}% = ${formatNumber(PRINTER_PROFILE.defaultAveragePowerKw, 2)} kW`}
                  />
                  <InfoRow label="Materiale" value={`${selectedMaterial.name} ${formatCurrency(selectedMaterial.costPerKg)}/kg`} />
                  <InfoRow label="Energia" value={`${formatCurrency(PRINTER_PROFILE.energyCostKwh)}/kWh`} />
                  <InfoRow label="Costo macchina" value={`${formatCurrency(PRINTER_PROFILE.machineRate)}/h`} />
                  <InfoRow label="Guadagno" value="125% sulle spese vive" />
                </div>
              </section>

              <section className="panel">
                <PanelTitle icon={<UserRound size={18} />} title="Cliente" />
                <div className="form-grid">
                  <TextField label="Nome cliente" value={customer.name} onChange={(name) => setCustomer((previous) => ({ ...previous, name }))} />
                  <TextField label="Numero cliente" value={customerNumber} onChange={setCustomerNumber} />
                  <TextField label="Telefono" value={customer.phone} onChange={(phone) => setCustomer((previous) => ({ ...previous, phone }))} />
                  <TextField label="Email" value={customer.email} onChange={(email) => setCustomer((previous) => ({ ...previous, email }))} />
                  <label className="wide-field">
                    Note
                    <textarea value={notes} rows={3} onChange={(event) => setNotes(event.target.value)} />
                  </label>
                </div>
              </section>
            </div>
          </div>

          <aside className="quote-sidebar">
            <section className="panel total-panel">
              <div className="total-row">
                <span>Prezzo finale</span>
                <strong>{formatCurrency(breakdown.grossPrice)}</strong>
              </div>
              <div className="breakdown">
                {quoteItems.length ? (
                  <>
                    <InfoRow label="Prodotti" value={`${quoteTotals.files} file / ${quoteTotals.quantity} pz`} />
                    {pricedQuote.rows.map((row) => (
                      <InfoRow
                        key={row.item.id}
                        label={`${row.item.quantity} x ${row.item.name}${row.manualUnitPrice ? " (manuale)" : ""}`}
                        value={formatCurrency(row.breakdown.grossPrice)}
                      />
                    ))}
                  </>
                ) : null}
                <InfoRow label="Materiale PLA" value={formatCurrency(breakdown.materialCost)} />
                <InfoRow label={`Energia ${formatNumber(pricing.powerKw, 2)} kW`} value={formatCurrency(breakdown.energyCost)} />
                <InfoRow label="Macchina" value={formatCurrency(breakdown.machineCost)} />
                <InfoRow label="Spese vive" value={formatCurrency(breakdown.subtotalCost)} />
                <InfoRow label="Guadagno 125%" value={formatCurrency(breakdown.marginAmount)} />
                {breakdown.colorSurcharge > 0 && <InfoRow label="Colore" value={formatCurrency(breakdown.colorSurcharge)} />}
                {breakdown.finishSurcharge > 0 && <InfoRow label="Effetto pietra" value={formatCurrency(breakdown.finishSurcharge)} />}
                <InfoRow label={shippingOption.label} value={formatCurrency(shippingOption.cost)} />
                {!quoteItems.length && pricing.quantity > 1 && <InfoRow label="Prezzo unitario" value={formatCurrency(breakdown.unitPrice)} />}
              </div>
            </section>

            <section className="panel quote-options-panel">
              <PanelTitle icon={<Calculator size={18} />} title="Opzioni preventivo" />
              <div className="quote-options-grid">
                <NumberField
                  label="Potenza media misurata kW"
                  min={0.01}
                  step={0.01}
                  value={pricing.powerKw}
                  onChange={(powerKw) => patchPricing({ powerKw })}
                />
                <ToggleOption
                  checked={pricing.color === "Colore"}
                  description="Bianco e nero restano prezzo base"
                  label={`Altro colore + ${formatCurrency(SURCHARGES.color)}`}
                  onChange={(checked) => patchQuoteOptions({ color: checked ? "Colore" : "Bianco" })}
                />
                <ToggleOption
                  checked={pricing.finish === "Effetto pietra"}
                  description="Aggiunge il supplemento finitura"
                  label={`Effetto pietra + ${formatCurrency(SURCHARGES.stoneEffect)}`}
                  onChange={(checked) => patchQuoteOptions({ finish: checked ? "Effetto pietra" : "Standard" })}
                />
                <label className="toggle-row compact-toggle">
                  <input
                    checked={pricing.includeVat}
                    type="checkbox"
                    onChange={(event) => patchPricing({ includeVat: event.target.checked })}
                  />
                  Applica IVA {pricing.vatPercent}%
                </label>
                <div className="shipping-field">
                  <span>Spedizione</span>
                  <div className="shipping-segmented" role="group" aria-label="Modalita di spedizione">
                    {(Object.keys(SHIPPING_OPTIONS) as ShippingMethod[]).map((method) => {
                      const option = getShippingOption(method);
                      const ShippingIcon = method === "inpost" ? MapPin : Truck;
                      return (
                        <button
                          aria-pressed={shippingMethod === method}
                          className={shippingMethod === method ? "is-selected" : ""}
                          key={method}
                          type="button"
                          onClick={() => setShippingMethod(method)}
                        >
                          <ShippingIcon size={17} />
                          <span>
                            <strong>{option.shortLabel}</strong>
                            <small>{formatCurrency(option.cost)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <section className="panel quick-products">
              <PanelTitle icon={<Package size={18} />} title="Prodotti frequenti" />
              {products.length ? (
                <div className="quick-product-list">
                  {products.slice(0, 5).map((product) => (
                    <button key={product.id} onClick={() => applyProduct(product)}>
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {formatNumber(product.defaultMinutes)} min · {formatNumber(product.defaultGrams)} g
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">Aggiungi prodotti nella terza schermata per richiamarli qui.</p>
              )}
            </section>

            <section className="panel action-panel">
              <button className="primary-button" onClick={() => void generateQuote()}>
                <ReceiptText size={18} />
                {editingOrder ? "Rigenera PDF" : "Crea PDF"}
              </button>
              <button className="secondary-button" onClick={() => saveCurrentOrder()}>
                <Save size={18} />
                {editingOrder ? "Aggiorna preventivo" : "Salva nello storico"}
              </button>
              {editingOrder ? (
                <button className="secondary-button" onClick={resetQuoteDraft}>
                  <XCircle size={18} />
                  Annulla modifica
                </button>
              ) : null}
            </section>
          </aside>
        </section>
      )}

      {view === "storico" && (
        <section className="screen-section">
          <div className="orders-header">
            <div>
              <p className="eyebrow">Archivio</p>
              <h2>Storico ordini</h2>
            </div>
            <div className="orders-tools">
              <label className="search-field">
                Cerca
                <input
                  placeholder="Cliente, numero o prodotto"
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                />
              </label>
              <div className="status-tabs" role="tablist" aria-label="Filtra ordini">
                {(["Tutti", ...STATUSES] as const).map((status) => (
                  <button
                    key={status}
                    className={activeStatus === status ? "is-selected" : ""}
                    onClick={() => setActiveStatus(status)}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="orders-table">
            {filteredOrders.length ? (
              filteredOrders.map((order) => (
                <article className="order-row" key={order.id}>
                  <div>
                    <strong>{order.quoteNumber}</strong>
                    <span>{new Date(order.createdAt).toLocaleDateString("it-IT")}</span>
                  </div>
                  <div>
                    <strong>{order.customer.name || "Cliente senza nome"}</strong>
                    <span>Cliente n. {order.customerNumber || order.customer.phone || "-"}</span>
                  </div>
                  <div>
                    <strong>{order.fileName}</strong>
                    <span>
                      {order.items?.length
                        ? `${order.items.length} prodotti / ${order.quantity} pz · opzioni per prodotto`
                        : `${order.quantity} pz · ${order.color || "Bianco"} · ${order.finish || "Standard"}`}
                    </span>
                  </div>
                  <div>
                    <strong>{formatCurrency(order.grossPrice)}</strong>
                    <span>
                      {formatNumber(order.metrics.printTimeMinutes ?? 0)} min · {order.shippingMethod ? getShippingOption(order.shippingMethod).shortLabel : "Spedizione non salvata"}
                    </span>
                  </div>
                  <select value={order.status} onChange={(event) => updateOrderStatus(order.id, event.target.value as OrderStatus)}>
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <div className="row-actions">
                    <button title="Modifica preventivo" onClick={() => loadOrderForEditing(order)}>
                      <Edit3 size={17} />
                    </button>
                    <button title="Scarica preventivo PDF" onClick={() => void generateOrderQuote(order)}>
                      <FileText size={17} />
                    </button>
                    <button title="Elimina ordine" onClick={() => deleteOrder(order.id)}>
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-orders">
                <Archive size={24} />
                <span>Nessun ordine salvato in questo filtro.</span>
              </div>
            )}
          </div>
        </section>
      )}

      {view === "prodotti" && (
        <section className="products-layout">
          <section className="panel product-builder">
            <PanelTitle icon={<PlusCircle size={18} />} title="Nuovo prodotto da file" />
            <div className="product-builder-grid">
              <label
                className={`upload-zone product-upload ${productDragActive ? "is-active" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setProductDragActive(true);
                }}
                onDragLeave={() => setProductDragActive(false)}
                onDrop={handleProductDrop}
              >
                <input accept=".3mf,.gcode,.gco,.gc" type="file" onChange={handleProductFileInput} />
                <Upload size={24} />
                <span>{isParsingProduct ? "Calcolo prodotto..." : "Carica file prodotto"}</span>
                <small>Il prodotto frequente viene salvato solo dopo un file G-code o 3MF</small>
              </label>

              <div className="product-file-summary">
                {productSource ? (
                  <>
                    <InfoRow label="File" value={productSource.metrics.fileName} />
                    <InfoRow label="Tipo" value={productSource.metrics.kind.toUpperCase()} />
                    <InfoRow label="Tempo" value={`${formatNumber(productDraft.defaultMinutes)} min`} />
                    <InfoRow label="Filamento" value={`${formatNumber(productDraft.defaultGrams)} g`} />
                    {productSource.metrics.boundingBox && (
                      <InfoRow
                        label="Ingombro"
                        value={`${formatNumber(productSource.metrics.boundingBox.x)} x ${formatNumber(productSource.metrics.boundingBox.y)} x ${formatNumber(productSource.metrics.boundingBox.z)} mm`}
                      />
                    )}
                    {productSource.metrics.layerCount && <InfoRow label="Layer" value={productSource.metrics.layerCount.toString()} />}
                  </>
                ) : (
                  <div className="file-placeholder">
                    <FileArchive size={24} />
                    <span>Nessun file prodotto caricato.</span>
                  </div>
                )}
              </div>
            </div>

            {productSource?.metrics.warnings.length ? (
              <ul className="warning-list product-warnings">
                {productSource.metrics.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <div className="form-grid product-details">
              <TextField label="Nome prodotto" value={productDraft.name} onChange={(name) => setProductDraft((previous) => ({ ...previous, name }))} />
              <TextField label="Codice / SKU" value={productDraft.sku} onChange={(sku) => setProductDraft((previous) => ({ ...previous, sku }))} />
              <NumberField
                label="Quantita default"
                min={1}
                step={1}
                value={productDraft.defaultQuantity}
                onChange={(defaultQuantity) =>
                  setProductDraft((previous) => ({
                    ...previous,
                    defaultQuantity: Math.max(1, Math.round(defaultQuantity)),
                  }))
                }
              />
              <CurrencyField
                label="Prezzo unitario manuale"
                placeholder="Vuoto = automatico"
                value={normalizeManualUnitPrice(
                  productDraft.manualUnitPrice
                    ?? (productDraft.manualPrice
                      ? productDraft.manualPrice / Math.max(1, productDraft.defaultQuantity)
                      : undefined),
                )}
                onChange={(manualUnitPrice) =>
                  setProductDraft((previous) => ({
                    ...previous,
                    manualUnitPrice: normalizeManualUnitPrice(manualUnitPrice),
                    manualPrice: undefined,
                  }))
                }
              />
              <ToggleOption
                checked={productDraft.color === "Colore"}
                description="Bianco e nero restano prezzo base"
                label={`Altro colore + ${formatCurrency(SURCHARGES.color)}`}
                onChange={(checked) => setProductDraft((previous) => ({ ...previous, color: checked ? "Colore" : "Bianco" }))}
              />
              <ToggleOption
                checked={productDraft.finish === "Effetto pietra"}
                description="Aggiunge il supplemento finitura"
                label={`Effetto pietra + ${formatCurrency(SURCHARGES.stoneEffect)}`}
                onChange={(checked) => setProductDraft((previous) => ({ ...previous, finish: checked ? "Effetto pietra" : "Standard" }))}
              />
              <label className="wide-field">
                Note prodotto
                <textarea value={productDraft.notes} rows={3} onChange={(event) => setProductDraft((previous) => ({ ...previous, notes: event.target.value }))} />
              </label>
            </div>
            <div className="button-row">
              <button className="primary-button" disabled={!productDraft.name.trim() || !productSource} onClick={saveFrequentProduct}>
                <Save size={18} />
                Salva prodotto
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="catalog-header">
              <PanelTitle icon={<Package size={18} />} title="Catalogo rapido" />
              {products.length ? (
                <span>
                  {filteredProducts.length} risultati
                  {selectedProducts.length ? ` · ${selectedProducts.length} selezionati` : ""}
                </span>
              ) : null}
            </div>
            <div className="catalog-toolbar">
              <label className="catalog-search-field">
                <span>
                  <Search size={16} />
                  Cerca prodotto
                </span>
                <input
                  disabled={!products.length}
                  placeholder={products.length ? "Nome, SKU, file o note" : "Salva prima un prodotto frequente"}
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                />
              </label>
              {products.length ? (
                <div className="catalog-actions">
                  <button className="secondary-button" disabled={!filteredProducts.length} onClick={selectFilteredProducts}>
                    {normalizedProductSearch ? "Seleziona risultati" : "Seleziona tutti"}
                  </button>
                  <button className="secondary-button" disabled={!selectedProducts.length} onClick={() => setSelectedProductIds([])}>
                    Deseleziona
                  </button>
                  <button className="primary-button" disabled={!selectedProducts.length} onClick={applySelectedProducts}>
                    <ReceiptText size={18} />
                    Usa selezionati
                  </button>
                  <button className="secondary-button" disabled={!filteredProducts.length} onClick={applyAllProducts}>
                    <Package size={18} />
                    {normalizedProductSearch ? "Usa risultati" : "Usa tutti"}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="product-catalog">
              {products.length ? (
                filteredProducts.length ? (
                filteredProducts.map((product) => (
                  <article className={`product-card ${selectedProductIds.includes(product.id) ? "is-selected" : ""}`} key={product.id}>
                    <div className="product-card-head">
                      <div>
                        <strong>{product.name}</strong>
                        <span>{product.sku || product.sourceFileName || "Senza codice"}</span>
                      </div>
                      <label className="product-select">
                        <input
                          checked={selectedProductIds.includes(product.id)}
                          type="checkbox"
                          onChange={(event) => toggleProductSelection(product.id, event.target.checked)}
                        />
                        <span>Seleziona</span>
                      </label>
                    </div>
                    <div className="product-meta">
                      <span>
                        <Clock3 size={15} />
                        {formatNumber(product.defaultMinutes)} min
                      </span>
                      <span>
                        <Weight size={15} />
                        {formatNumber(product.defaultGrams)} g
                      </span>
                      <span>
                        <Palette size={15} />
                        {product.color}
                      </span>
                      <span>
                        <Sparkles size={15} />
                        {product.finish}
                      </span>
                      <span>
                        <Calculator size={15} />
                        {formatCurrency(calculateProductPrice(product))}
                      </span>
                    </div>
                    <div className="product-source">
                      <InfoRow label="File" value={product.sourceFileName ?? "Prodotto precedente senza file"} />
                      {product.boundingBox && (
                        <InfoRow
                          label="Ingombro"
                          value={`${formatNumber(product.boundingBox.x)} x ${formatNumber(product.boundingBox.y)} x ${formatNumber(product.boundingBox.z)} mm`}
                        />
                      )}
                      <CurrencyField
                        label="Prezzo unitario manuale"
                        placeholder={`Auto ${formatCurrency(calculateAutomaticProductPrice(product).unitPrice)}`}
                        value={getFrequentProductManualUnitPrice(product)}
                        onChange={(manualUnitPrice) => updateProductManualUnitPrice(product.id, manualUnitPrice)}
                      />
                    </div>
                    {product.notes && <p>{product.notes}</p>}
                    <div className="button-row">
                      <button className="secondary-button" onClick={() => applyProduct(product)}>
                        <ReceiptText size={18} />
                        Usa
                      </button>
                      <button className="icon-button danger" title="Elimina prodotto" onClick={() => deleteProduct(product.id)}>
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                ))
                ) : (
                  <div className="empty-orders catalog-empty">
                    <Search size={24} />
                    <span>Nessun prodotto trovato con questa ricerca.</span>
                  </div>
                )
              ) : (
                <div className="empty-orders">
                  <Package size={24} />
                  <span>Nessun prodotto frequente inserito.</span>
                </div>
              )}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function MetricPill({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric-pill">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ToggleOption({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="switch-field">
      <input checked={checked} role="switch" type="checkbox" onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      <span className="switch-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function NumberField({
  className,
  label,
  value,
  min,
  step,
  onChange,
}: {
  className?: string;
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    const parsed = Number(draft);
    if (draft.trim() && parsed !== value) {
      setDraft(String(value));
    }
  }, [value]);

  return (
    <label className={className}>
      {label}
      <input
        min={min}
        step={step}
        type="number"
        value={draft}
        onBlur={() => {
          const parsed = Number(draft);
          if (!draft.trim() || !Number.isFinite(parsed)) {
            setDraft(String(value));
            return;
          }
          const normalized = Math.max(min, parsed);
          setDraft(String(normalized));
          onChange(normalized);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (!next.trim()) {
            return;
          }
          const parsed = Number(next);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
          }
        }}
      />
    </label>
  );
}

function CurrencyField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  onChange: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(() => formatCurrencyInput(value));

  useEffect(() => {
    if (parseCurrencyInput(draft) !== value) {
      setDraft(formatCurrencyInput(value));
    }
  }, [value]);

  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        placeholder={placeholder}
        type="text"
        value={draft}
        onBlur={() => {
          const normalized = normalizeManualUnitPrice(parseCurrencyInput(draft));
          setDraft(formatCurrencyInput(normalized));
          onChange(normalized);
        }}
        onChange={(event) => {
          const next = sanitizeCurrencyInput(event.target.value);
          setDraft(next);
          onChange(normalizeManualUnitPrice(parseCurrencyInput(next)));
        }}
      />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function makeManualMetrics(itemName: string, pricing: PricingInputs): PrintMetrics {
  return {
    fileName: itemName || "Ordine manuale",
    fileSize: 0,
    kind: "unknown",
    printTimeMinutes: pricing.manualMinutes,
    filamentGrams: pricing.filamentGrams,
    warnings: [],
  };
}

function makeQuoteMetrics(itemName: string, items: QuoteItem[]): PrintMetrics {
  const firstKind = items[0]?.kind ?? "unknown";
  const sameKind = items.every((item) => item.kind === firstKind);
  return {
    fileName: itemName.trim() || (items.length === 1 ? items[0].name : `${items.length} prodotti`),
    fileSize: items.reduce((total, item) => total + item.metrics.fileSize, 0),
    kind: sameKind ? firstKind : "unknown",
    printTimeMinutes: items.reduce((total, item) => total + item.manualMinutes * item.quantity, 0),
    filamentGrams: items.reduce((total, item) => total + item.filamentGrams * item.quantity, 0),
    warnings: Array.from(new Set(items.flatMap((item) => item.metrics.warnings))),
  };
}

function makeQuoteItem(parsedFile: ParsedFile, fileName: string, pricing: PricingInputs): QuoteItem {
  const suggested = suggestPricingFromMetrics(parsedFile.metrics, pricing);
  return {
    id: makeOrderId(),
    name: stripFileExtension(fileName),
    fileName: parsedFile.metrics.fileName,
    kind: parsedFile.metrics.kind,
    quantity: 1,
    manualMinutes: suggested.manualMinutes,
    filamentGrams: suggested.filamentGrams,
    metrics: {
      ...parsedFile.metrics,
      printTimeMinutes: suggested.manualMinutes,
      filamentGrams: suggested.filamentGrams,
    },
  };
}

function makeProductQuoteItem(product: FrequentProduct): QuoteItem {
  return {
    id: makeOrderId(),
    name: product.name,
    fileName: product.sourceFileName ?? product.name,
    kind: product.sourceKind ?? "unknown",
    quantity: product.defaultQuantity,
    manualMinutes: product.defaultMinutes,
    filamentGrams: product.defaultGrams,
    manualUnitPrice: getFrequentProductManualUnitPrice(product),
    color: product.color,
    finish: product.finish,
    metrics: {
      fileName: product.sourceFileName ?? product.name,
      fileSize: product.sourceFileSize ?? 0,
      kind: product.sourceKind ?? "unknown",
      printTimeMinutes: product.defaultMinutes,
      filamentGrams: product.defaultGrams,
      boundingBox: product.boundingBox,
      layerCount: product.layerCount,
      volumeCm3: product.volumeCm3,
      warnings: product.warnings ?? [],
    },
  };
}

function combinePriceBreakdowns(breakdowns: PriceBreakdown[]): PriceBreakdown {
  const total = breakdowns.reduce<PriceBreakdown>(
    (sum, breakdown) => ({
      materialCost: sum.materialCost + breakdown.materialCost,
      energyCost: sum.energyCost + breakdown.energyCost,
      machineCost: sum.machineCost + breakdown.machineCost,
      laborCost: sum.laborCost + breakdown.laborCost,
      setupFee: sum.setupFee + breakdown.setupFee,
      riskBuffer: sum.riskBuffer + breakdown.riskBuffer,
      subtotalCost: sum.subtotalCost + breakdown.subtotalCost,
      marginAmount: sum.marginAmount + breakdown.marginAmount,
      netPrice: sum.netPrice + breakdown.netPrice,
      vatAmount: sum.vatAmount + breakdown.vatAmount,
      grossPrice: sum.grossPrice + breakdown.grossPrice,
      unitPrice: 0,
      colorSurcharge: sum.colorSurcharge + breakdown.colorSurcharge,
      finishSurcharge: sum.finishSurcharge + breakdown.finishSurcharge,
    }),
    {
      materialCost: 0,
      energyCost: 0,
      machineCost: 0,
      laborCost: 0,
      setupFee: 0,
      riskBuffer: 0,
      subtotalCost: 0,
      marginAmount: 0,
      netPrice: 0,
      vatAmount: 0,
      grossPrice: 0,
      unitPrice: 0,
      colorSurcharge: 0,
      finishSurcharge: 0,
    },
  );
  return {
    ...total,
    unitPrice: total.grossPrice / Math.max(1, breakdowns.length),
  };
}

function getQuoteItemManualUnitPrice(item: QuoteItem): number | undefined {
  return normalizeManualUnitPrice(
    item.manualUnitPrice ?? (item.manualPrice ? item.manualPrice / Math.max(1, item.quantity) : undefined),
  );
}

function getFrequentProductManualUnitPrice(product: FrequentProduct): number | undefined {
  return normalizeManualUnitPrice(
    product.manualUnitPrice
      ?? (product.manualPrice ? product.manualPrice / Math.max(1, product.defaultQuantity) : undefined),
  );
}

function sanitizeCurrencyInput(value: string): string {
  const cleaned = value.replaceAll(".", ",").replace(/[^0-9,]/g, "");
  const [whole = "", ...decimalParts] = cleaned.split(",");
  const decimals = decimalParts.join("").slice(0, 2);
  if (!cleaned.includes(",")) {
    return whole;
  }
  return `${whole || "0"},${decimals}`;
}

function parseCurrencyInput(value: string): number | undefined {
  const normalized = value.trim().replace(",", ".");
  if (!normalized || normalized === ".") {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatCurrencyInput(value: number | undefined): string {
  if (!value) {
    return "";
  }
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function calculateProductPrice(product: FrequentProduct): number {
  const automaticBreakdown = calculateAutomaticProductPrice(product);
  return applyManualUnitPriceToBreakdown(
    automaticBreakdown,
    getFrequentProductManualUnitPrice(product),
    product.defaultQuantity,
    DEFAULT_PRICING,
  ).grossPrice;
}

function calculateAutomaticProductPrice(product: FrequentProduct): PriceBreakdown {
  return calculatePrice({
    ...DEFAULT_PRICING,
    quantity: product.defaultQuantity,
    manualMinutes: product.defaultMinutes,
    filamentGrams: product.defaultGrams,
    color: product.color,
    finish: product.finish,
  });
}

function makePricingFromOrder(order: Order): PricingInputs {
  return {
    ...DEFAULT_PRICING,
    materialKey: "pla",
    quantity: Math.max(1, order.quantity),
    manualMinutes: Math.max(1, Math.round(order.metrics.printTimeMinutes ?? DEFAULT_PRICING.manualMinutes)),
    filamentGrams: Math.max(1, order.metrics.filamentGrams ?? DEFAULT_PRICING.filamentGrams),
    machineRate: PRINTER_PROFILE.machineRate,
    powerKw: order.averagePowerKw ?? PRINTER_PROFILE.defaultAveragePowerKw,
    energyCostKwh: PRINTER_PROFILE.energyCostKwh,
    marginPercent: 125,
    includeVat: Boolean(order.includeVat),
    vatPercent: order.vatPercent ?? DEFAULT_PRICING.vatPercent,
    color: order.color || "Bianco",
    finish: order.finish || "Standard",
  };
}

function restoreOrderItems(order: Order): QuoteItem[] {
  return (order.items ?? []).map((item) => ({
    ...item,
    id: item.id || makeOrderId(),
    name: item.name || item.fileName || "Prodotto",
    fileName: item.fileName || item.name || "Prodotto",
    kind: item.kind ?? item.metrics?.kind ?? "unknown",
    quantity: Math.max(1, item.quantity || 1),
    manualMinutes: Math.max(1, item.manualMinutes || item.metrics?.printTimeMinutes || DEFAULT_PRICING.manualMinutes),
    filamentGrams: Math.max(1, item.filamentGrams || item.metrics?.filamentGrams || DEFAULT_PRICING.filamentGrams),
    color: item.color ?? order.color ?? "Bianco",
    finish: item.finish ?? order.finish ?? "Standard",
    metrics: {
      ...item.metrics,
      fileName: item.metrics?.fileName || item.fileName || item.name || "Prodotto",
      fileSize: item.metrics?.fileSize ?? 0,
      kind: item.metrics?.kind ?? item.kind ?? "unknown",
      printTimeMinutes: item.manualMinutes || item.metrics?.printTimeMinutes || DEFAULT_PRICING.manualMinutes,
      filamentGrams: item.filamentGrams || item.metrics?.filamentGrams || DEFAULT_PRICING.filamentGrams,
      warnings: item.metrics?.warnings ?? [],
    },
  }));
}

function getSavedOrderUnitPrice(order: Order): number | undefined {
  if (order.items?.length) {
    return undefined;
  }
  const shippingCost = order.shippingCost ?? (order.shippingMethod ? getShippingOption(order.shippingMethod).cost : 0);
  const productGrossPrice = Math.max(0, order.grossPrice - shippingCost);
  return productGrossPrice / Math.max(1, order.quantity);
}

export default App;

const DEMO_GCODE = `; generated by Gestionale stampa 3D demo
; printer_model = Anycubic Kobra X
; filament_type = PLA
;TIME:5400
;Filament used [g] = 20.5
;Filament used [m] = 6.8
G90
M82
G92 E0
G1 X0 Y0 Z0.2 F3000
G1 X70 Y0 E1.2 F1500
G1 X70 Y42 E2.3
G1 X0 Y42 E3.4
G1 X0 Y0 E4.5
G1 Z0.4 F1200
G1 X2 Y2 E10.1
G1 X68 Y2 E11.1
G1 X68 Y40 E12.2
G1 X2 Y40 E13.3
G1 X2 Y2 E14.4
G1 Z0.6 F1200
G1 X4 Y4 E18.3
G1 X66 Y4 E19.3
G1 X66 Y38 E20.3
G1 X4 Y38 E21.3
G1 X4 Y4 E22.3
`;
