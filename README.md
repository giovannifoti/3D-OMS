# 3D-OMS

![Artigiani del3d](public/brand/logo-artigianidel3d-light.png)

**3D-OMS** è una piattaforma web per gestire preventivi e ordini di stampa 3D in modo rapido, ordinato e professionale.
Nasce per semplificare il lavoro quotidiano di un laboratorio: carichi un file di stampa, controlli i dati principali, aggiungi cliente, spedizione e sconto, poi generi un PDF pronto da inviare.

Il progetto è sviluppato per **Artigiani del3d** e mette insieme una parte tecnica accurata, una UI pulita e un flusso pensato per chi deve fare preventivi veri, non solo simulazioni.

## Cosa fa

- Importa file `.gcode`, `.gco`, `.gc` e `.3mf`.
- Legge tempo di stampa, consumo filamento, materiale, layer e ingombro quando disponibili.
- Gestisce stampe multicolore sommando i consumi dei filamenti rilevati.
- Calcola il prezzo con parametri fissi per stampante, materiale, energia, costo macchina e margine.
- Supporta supplementi per colori speciali ed effetto pietra.
- Permette preventivi multiprodotto con quantità e prezzo manuale per singola riga.
- Applica sconti percentuali o a importo.
- Gestisce spedizione InPost, consegna a domicilio o consegna in zona gratuita.
- Salva uno storico ordini modificabile.
- Crea un catalogo di prodotti frequenti riutilizzabili nei nuovi preventivi.
- Genera PDF coordinati con l'identità visiva Artigiani del3d.

## Perché è interessante

Molti strumenti di preventivazione per stampa 3D sono generici, rigidi o troppo pieni di passaggi. 3D-OMS nasce invece da un caso d'uso reale: ridurre il tempo necessario per trasformare un file di stampa in un preventivo chiaro.

Il valore del progetto è nel flusso completo:

1. analisi del file;
2. stima economica;
3. gestione cliente e storico;
4. recupero dei prodotti frequenti;
5. generazione del PDF.

È un piccolo gestionale verticale, costruito intorno alle esigenze pratiche di chi stampa, vende e deve comunicare bene con il cliente.

## Privacy e dati sensibili

Il repository è pensato per essere pubblico.

- I dati di pagamento reali non sono salvati nel codice.
- I dati cliente e gli ordini restano nel `localStorage` del browser.
- File di stampa, PDF generati, file `.env` e cartelle private sono esclusi dal versionamento.
- I dati bancari usati nei PDF possono essere configurati dall'interfaccia dell'app e restano locali sul browser.

Questa scelta mantiene il progetto presentabile su GitHub senza esporre informazioni personali, bancarie o dati dei clienti.

## Stack tecnico

- React
- TypeScript
- Vite
- JSZip per leggere archivi `.3mf`
- jsPDF e jspdf-autotable per la generazione dei preventivi PDF
- lucide-react per le icone dell'interfaccia

## Avvio locale

```bash
npm install
npm run dev
```

Poi apri:

```text
http://127.0.0.1:5173/
```

Per creare una build di produzione:

```bash
npm run build
```

## Contatti

Sono aperto a collaborazioni, progetti su misura e opportunità legate a stampa 3D, automazione di processi e strumenti web verticali.

Per informazioni o proposte, contattami tramite il profilo GitHub collegato a questo repository oppure apri una issue.
