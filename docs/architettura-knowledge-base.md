# Architettura della knowledge base — WikiJS

**Versione**: 0.1 (specifica di design, non validata)
**Data**: 24/09/2026
**Ambito**: implementazione in JavaScript **lato client** di una knowledge base wiki compilata (pattern LLM Wiki, da `karpathy/`), dati interamente in **IndexedDB**, accesso ai modelli tramite adapter fornito dall'applicazione ospite (librerie già testate dal committente).
**Documenti correlati**:
- `generazione-estensione-knowledge-base.md` — workflow `kb-init`, `kb-build`/`kb-update`
- `workflow-query.md` — pipeline di interrogazione

**Stato epistemico**: nessuna cifra di prestazione è misurata. Dove compare una stima è marcata `[STIMA]`.

---

## 1. Scopo

WikiJS è una libreria/app client-side che:

1. **ingerisce** documenti testuali (caricati dall'utente) trasformandoli in una **wiki markdown interlinkata** persistente;
2. **interroga** la wiki con domande in linguaggio naturale, componendo risposte con citazioni alle pagine;
3. **mantiene** la wiki nel tempo: nuovi documenti si aggiungono senza rifare il lavoro, le pagine si aggiornano, le contraddizioni si evidenziano.

Non usa embeddings, non usa un server, non richiede filesystem: **tutti i dati vivono in IndexedDB**.

### 1.1 Requisiti

| ID | Requisito |
|---|---|
| RF1 | `kb-init` crea la struttura della knowledge base in modo idempotente. |
| RF2 | `kb-build` costruisce la wiki dalle sorgenti; su KB esistente aggiorna in modo incrementale (hash). |
| RF3 | `kb-query` risponde con citazioni `[[pagina]]` e dichiara quando l'informazione non è nella wiki. |
| RF4 | Tutti i dati (sorgenti, pagine, indice, log, risposte, job) sono in IndexedDB. |
| RF5 | Accesso LLM tramite un adapter iniettato; modelli **diversi per funzioni diverse** (routing per `purpose`). |
| RF6 | Nessuna scrittura distruttiva: le risposte non sovrascrivono file esistenti; le contraddizioni si evidenziano, non si cancellano. |
| RF7 | Ripartenza dopo interruzione: un job interrotto riprende dal punto di staging. |
| RF8 | Tutto in italiano; slug e identificatori generati in modo deterministico (mai dall'LLM). |
| RF9 | Ogni pagina dichiara le sorgenti usate e un elenco di **citazioni verbatim verificate** (controllo con ricerca di sottostringa, nessun offset). |
| RF10 | Esportazione/importazione della KB e compatibilità con la struttura cartelle del progetto `karpathy/` (`raw/`, `wiki/`, `output/`). |

### 1.2 Non-obiettivi

- niente embeddings, niente ricerca vettoriale;
- niente server, niente API proprie, niente multiutente;
- niente citazioni a span/offset esatto (limite dichiarato del pattern wiki; mitigato dalle citazioni verbatim verificate);
- niente gestione PDF/immagini nella v0 (solo testo);
- niente inferenza logica formale sulle pagine.

---

## 2. Concetti e modello logico

| Concetto | Descrizione |
|---|---|
| **KB** | Una knowledge base. Corrisponde a **un database IndexedDB** dedicato, nome `wikijs:<kbId>`. |
| **Source** | Documento sorgente caricato dall'utente. Hash SHA-256 per l'incrementalità. Immutabile: una modifica crea una nuova versione del source (stesso `sourceId`, hash diverso). |
| **Page** | Pagina wiki: `slug` (PK), titolo, summary, corpo markdown con `[[link]]`, sorgenti, citazioni, stato. |
| **Catalog** | Indice materializzato `slug → {title, summary, category, updatedAt}`, proiezione delle pagine. È il "file index.md" del pattern karpathy, in forma di store. |
| **Log** | Registro append-only di init/build/update/query/lint/errori. |
| **Output** | Risposta di una query, salvata e mai sovrascritta. |
| **Job** | Esecuzione lunga (build/query) con stato, budget, progresso, ripresa. |
| **Staging** | Risultati parziali di un job (per chunk), cancellati a job completato. |

### 2.1 Identificatori

- `kbId`: `^[a-z0-9][a-z0-9_-]*$`, scelto dall'utente in `kb-init`.
- `sourceId`: slug del nome file + suffisso numerico in caso di collisione (es. `lc-txt`, `lc-txt-2`).
- `slug` di pagina: generato **deterministicamente** da titolo o entità: minuscolo, kebab-case, senza accenti, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 64 caratteri.
- `pageId = slug` (unico per KB). La rinominazione è vietata: una pagina nuova con titolo diverso è una pagina nuova; gli alias si gestiscono con `[[slug|testo]]`.
- `outputId`: `AAAAMMGGTHHMMSS-<slug-domanda>` (UTC).
- `jobId`: `job-<timestamp>-<progressivo>`.

### 2.2 Forma canonica e hash

- `normalizeForCompare(text)`: NFC, case-fold, apostrofi tipografici → `'`, virgolette → `"`, trattini lunghi → `-`, spazi multipli collassati. **Solo per i confronti**, mai per la memorizzazione.
- `sha256(text)`: via `crypto.subtle.digest` (UTF-8).

---

## 3. Schema IndexedDB

Un database per KB: `wikijs:<kbId>`, versione corrente `SCHEMA_VERSION = 1`.
La specifica definisce lo **schema logico**; l'accesso è demandato alla libreria IndexedDB già testata dal committente (sono richieste: transazioni multiple store, indici, `multiEntry`, migrazioni).

### 3.1 Store `meta` (key-value)

| Chiave | Valore |
|---|---|
| `schemaVersion` | numero |
| `kbId`, `name`, `createdAt`, `updatedAt` | identità della KB |
| `params` | parametri operativi (§4.1) |
| `llmRouting` | routing per funzione (§4.2) |
| `counters` | contatori (`buildSeq`, `querySeq`, `lintSeq`) |

### 3.2 Store `sources`

PK `sourceId`.

```js
{
  sourceId: "lc-txt",
  name: "lc.txt",
  mime: "text/plain",
  sizeBytes: 71370,
  sha256: "9201…a166",
  text: "…",                       // contenuto integrale (UTF-8)
  addedAt: 1758730000000,
  ingestedAt: null,
  status: "new",                   // new | ingested | changed | error | quarantined
  error: null,
  pagesCount: 0
}
```

Indici: `by_sha256`, `by_status`.

### 3.3 Store `pages`

PK `slug`.

```js
{
  slug: "gabriele-tenebra",
  title: "Gabriele Tenebra",
  summary: "…una o due frasi…",
  body: "…markdown con [[wiki-links]]…",
  category: "personaggi",          // opzionale, generata in build
  sources: ["lc-txt"],
  links: ["rosa-allorni", "isola-grande"],
  backlinks: ["lc", "cena-di-fine-millennio"],
  quotes: [
    { text: "…verbatim…", sourceId: "lc-txt", verified: true }
  ],
  status: "active",                // draft | active | quarantined
  origin: "source",                // source | query | manual
  version: 3,
  createdAt: 1758730000000,
  updatedAt: 1758730100000
}
```

Indici: `by_updatedAt`, `by_status`, `by_origin`, `by_sources` (multiEntry), `by_links` (multiEntry).

### 3.4 Store `catalog`

PK `slug`; una riga per pagina (derivata e mantenuta in transazione con `pages`).

```js
{ slug: "gabriele-tenebra", title: "Gabriele Tenebra", summary: "…", category: "personaggi", updatedAt: 1758730100000 }
```

**Invariante C1**: `catalog ≡ proiezione(pages)` — verificata da `kbStatus` e dai test.

### 3.5 Store `logs`

PK `logId` autoincrement.

```js
{ logId: 42, ts: 1758730200000, type: "build", refs: { sourceId: "lc-txt", jobId: "job-…" },
  summary: "ingestito lc.txt: 14 pagine create, 3 aggiornate", details: { /* conteggi, errori */ } }
```

Indici: `by_ts`, `by_type`.

### 3.6 Store `outputs`

PK `outputId`.

```js
{ outputId: "20260924T184400-chi-sono-i-protagonisti",
  ts: 1758730400000, question: "Chi sono i protagonisti?",
  answer: "…[[gabriele-tenebra]]…",
  citations: [{ slug: "gabriele-tenebra", quote: "…", verified: true }],
  pagesUsed: ["gabriele-tenebra", "rosa-allorni"],
  mode: "llm",                      // llm | llm-min | offline
  meta: { calls: 2, pagesConsidered: 14, pagesLoaded: 5 } }
```

### 3.7 Store `jobs`

PK `jobId`.

```js
{ jobId: "job-1758730000000-1", type: "build", status: "running",  // running | done | error | cancelled
  startedAt: 1758730000000, updatedAt: 1758730010000,
  progress: { phase: "extract", done: 3, total: 12 },
  budget: { maxCalls: 200, maxDurationMs: 3600000 },
  cursor: { sourceId: "lc-txt", chunkIndex: 3 },
  error: null }
```

### 3.8 Store `staging`

PK `stagingId = <jobId>:<sourceId>:<chunkIndex>:<kind>`; `kind ∈ extract|merge`.

```js
{ stagingId: "job-…:lc-txt:3:extract", jobId: "job-…",
  payload: { /* output validato del chunk */ }, ts: 1758730005000 }
```

Cancellato al completamento del job (in transazione con l'aggiornamento di `jobs`).

### 3.9 Transazioni e coerenza

- **Commit di pagina**: `pages` + `catalog` + `logs` in **una sola transazione**.
- **Commit di job**: `jobs` + `staging` + `sources` + `logs` in una transazione.
- Le risposte: `outputs` + `logs` in una transazione.
- Un solo writer per KB: `navigator.locks.request('wikijs:<kbId>', …)` (se disponibile) o flag in `meta`.

---

## 4. Configurazione

### 4.1 Parametri operativi (`meta.params`)

```js
{
  chunkChars: 12000,            // dimensione chunk di ingestione (caratteri)
  chunkOverlapChars: 1500,      // coda d'ormeggio
  maxPagesPerChunk: 6,          // pagine proposte per chunk (vincolo di prompt)
  maxPagesPerDoc: 40,           // tetto di pagine per documento
  pageBodyMaxChars: 12000,      // tetto del corpo di pagina
  quotesPerPage: 5,             // citazioni verbatim richieste per pagina
  catalogTokenBudget: 8000,     // oltre: indice a due livelli (categoria → pagine)
  queryPageBudget: 7,           // pagine massime caricate per risposta
  queryContextChars: 20000,     // contesto massimo per la risposta
  language: "it",
  contradictionPolicy: "append" // append | section
}
```

Con `kbBuild({ modelWindowTokens })` i tre valori di chunking sono derivati
dalla finestra del modello (8.000-40.000 caratteri, `maxPagesPerChunk` 4-10,
`extract.maxTokens` fino a 16.000); restano questi i default senza finestra
o con override esplicito in `meta.params`.

### 4.2 Routing LLM per funzione (`meta.llmRouting`)

L'adapter è iniettato dall'app ospite (fuori ambito). WikiJS definisce solo i `purpose` e i parametri consigliati per ciascuno.

```js
{
  extract: { model: "forte",   temperature: 0.1, maxTokens: 4000 }, // ingestione: qualità
  merge:   { model: "forte",   temperature: 0.1, maxTokens: 4000 }, // fusione pagine
  select:  { model: "rapido",  temperature: 0,   maxTokens: 800  }, // scelta pagine in query
  answer:  { model: "forte",   temperature: 0.2, maxTokens: 2000 }, // composizione risposta
  lint:    { model: "medio",   temperature: 0,   maxTokens: 1500 }  // manutenzione (opzionale)
}
```

L'adapter espone:

```ts
interface LlmAdapter {
  complete(req: {
    purpose: "extract"|"merge"|"select"|"answer"|"lint";
    model?: string; temperature?: number; maxTokens?: number;
    messages: {role:"system"|"user"|"assistant", content:string}[];
    jsonSchema?: object;
    signal?: AbortSignal;
  }): Promise<{ text: string; usage?: {inputTokens?: number; outputTokens?: number} }>
}
```

### 4.3 Budget per job (`meta.params.budget` o per invocazione)

```js
{ maxCalls: 200, maxInputTokens: 500000, maxOutputTokens: 200000, maxDurationMs: 3600000 }
```

Ogni fase controlla il budget prima di una chiamata; superato il budget il job si ferma in stato `error` con motivo `budget_exhausted` ed è riprendibile.

---

## 5. API pubblica

```ts
// Ciclo di vita
kbInit(opts: { kbId: string; name?: string; params?: Partial<Params>; llmRouting?: Routing })
  : Promise<{ kbId: string; created: boolean; schemaVersion: number }>

kbBuild(opts: {
  kbId: string;
  sourceIds?: string[];               // default: tutti i sources non ingested/changed
  mode?: "auto" | "full" | "update";  // default: "auto"
  budget?: Partial<Budget>;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}): Promise<BuildReport>

kbUpdate(opts) // alias documentato: kbBuild({...opts, mode: "update"})

kbQuery(opts: {
  kbId: string;
  question: string;
  mode?: "llm" | "llm-min" | "offline";  // default: "llm"
  budget?: Partial<Budget>;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}): Promise<QueryResult>

// Ausiliarie
kbStatus({ kbId }): Promise<StatusReport>            // conteggi, invarianti, job aperti
kbExport({ kbId, includeLogs?: boolean }): Promise<ExportBundle>
kbImport({ bundle: ExportBundle, mode: "merge" | "replace" }): Promise<void>
kbLint({ kbId, slug?: string }): Promise<LintReport> // opzionale, v1

// Tipi
type QueryResult = {
  outputId: string;
  answer: string;
  citations: { slug: string; quote?: string; verified: boolean }[];
  pagesUsed: string[];
  mode: string;
  missing: boolean;
  meta: { calls: number; pagesConsidered: number; pagesLoaded: number };
};
```

Ogni funzione è invocabile da UI o da console; le versioni "comando" (`kb-init`, `kb-build`, `kb-update`, `kb-query`) sono wrapper 1:1 di queste API.

---

## 6. Invarianti

| # | Invariante | Verifica |
|---|---|---|
| I1 | Un solo DB per KB; nome `wikijs:<kbId>`. | `kbStatus` |
| I2 | `catalog ≡ proiezione(pages)`. | test + `kbStatus` |
| I3 | Ogni pagina `origin:"source"` ha almeno un `sourceId` esistente in `sources`. | `kbStatus` |
| I4 | `quotes[].verified` riflette l'esito dell'ultima verifica di sottostringa sul sorgente. | funzione di verifica |
| I5 | Slug conforme al pattern e unico per KB. | validazione in scrittura |
| I6 | `outputs` e `logs` sono append-only: nessuna sovrascrittura. | test |
| I7 | A fine job, `staging` per quel job è vuoto. | `kbStatus` |
| I8 | Nessuna pagina in `pages` con `status:"quarantined"` è usata in query. | `kbQuery` |
| I9 | I link di una pagina puntano a slug che esistono oppure sono marcati `red-link` (link a pagina non ancora creata). | `kbStatus` |
| I10 | La riformulazione/estrazione differita non altera sorgenti né pagine esistenti se il budget si esaurisce. | test su abort |

---

## 7. Errori, quarantena, ripresa

- **Errore LLM su un chunk**: 1 retry con messaggio di correzione; secondo fallimento → chunk in quarantena (`staging.kind = "extract"` con `payload.error`), il job prosegue e il report finale elenca i chunk falliti. La sorgente resta `status:"error"` finché non viene riprocessata.
- **JSON non valido**: la validazione è bloccante; il retry include l'errore di schema.
- **Pagina in quarantena**: non entra in `catalog` attivo; `kbQuery` non la usa; `kbLint` può riabilitarla.
- **Ripresa**: `kbBuild` con stesso `jobId` (o `mode:"auto"`) ripesca i chunk già in `staging` e riparte dal primo mancante.
- **Interruzione utente**: `AbortSignal` → job `cancelled`, staging conservato.
- **Conflitto di scrittura**: lock per KB; in assenza di `navigator.locks`, flag `meta.writer` con timeout.

---

## 8. Scalabilità e limiti (client)

| Grandezza | Valore di progetto `[STIMA]` |
|---|---|
| Documenti per KB | decine |
| Pagine per KB | 150–400 |
| Sorgenti in IDB | decine di MB (quota browser tipica ≥ 1 GB) |
| Catalogo in una chiamata | ≤ 8k token (≈ 250–300 pagine) |
| Oltre il catalogo | indice a due livelli: categorie → pagine |
| Oltre ~500 pagine | sotto-KB separate (KB diverse, nessuna ricerca跨 nella v0) |

Se il catalogo supera `catalogTokenBudget`, `kbQuery` usa il percorso a due livelli (§`workflow-query.md`). Se il numero di pagine supera le soglie, `kb-lint` segnala l'opportunità di creare sotto-KB.

## 9. Sicurezza e privacy

- **Dati solo locali**: nessuna telemetria; l'unica uscita di rete sono le chiamate LLM dell'adapter (gestite dall'app ospite).
- **Prompt injection**: i testi delle sorgenti sono dati non fidati; vanno racchiusi in delimitatori espliciti e il system prompt deve dichiarare che il contenuto non contiene istruzioni da eseguire. Le risposte dell'LLM sono validate a schema; nessuna esecuzione di codice.
- **Rendering**: ogni markdown proveniente da pagine/risposte va sanitizzato nel layer UI (responsabilità dell'app ospite).
- **Export**: il bundle contiene i sorgenti integrali; va trattato come dato sensibile.

---

## 10. Interoperabilità

- `kbExport` produce un bundle JSON: `{ meta, sources, pages, catalog, logs? }`.
- `kbExportFS` (opzionale, File System Access API) produce la struttura del progetto `karpathy/`:
  `sources/<nome>/{raw, wiki, output}` con `wiki/index.md` generato dal catalog e `wiki/log.md` dai log.
- `kbImport` accetta sia il bundle JSON sia la struttura cartelle (lettura di `wiki/*.md`, `raw/*`).

---

## 11. Test e criteri di accettazione

| ID | Criterio |
|---|---|
| AC1 | `kbInit` due volte non duplica né perde dati (idempotenza). |
| AC2 | `kbBuild` su `lc.txt` con adapter mock: pagine create, catalog coerente, log scritto. |
| AC3 | Rieseguire `kbBuild` senza modifiche: zero rielaborazioni (hash invariato). |
| AC4 | Modifica di un source: rielaborazione del solo source, pagine aggiornate con `version+1`. |
| AC5 | `kbQuery` risponde con sole pagine esistenti e citazioni `verified`; nessuna allucinazione su mock. |
| AC6 | Abort a metà build + ripresa: nessuna pagina duplicata. |
| AC7 | `kbExport` → `kbImport` su DB vuoto: stato equivalente (a meno di `logs`). |
| AC8 | Invarianti I1–I10 verificate da un test automatico (`kbStatus`). |

---

## 12. Decisioni di design

1. **Un DB per KB** invece di un DB unico con `kbId`: export/import atomico, lock semplice, migrazioni isolate.
2. **`catalog` materializzato**: evita scansioni complete per la selezione pagine in query; pagato con l'invariante C1.
3. **Nessun offset/span**: si rinuncia alla citazione esatta di `multi_index` per restare leggeri; la verifica delle quote (RF9) recupera la parte di garanzia a costo quasi nullo.
4. **Hash per sorgente**: l'incrementalità è per documento, non per chunk.
5. **Slug deterministici**: l'LLM non assegna mai identificatori (eredità dell'invariante I2 di `multi_index`).
6. **LLM per funzione**: la selezione pagine usa un modello rapido, l'estrazione e la risposta un modello forte (§4.2).
7. **Contraddizioni conservate**: append, mai cancellazione (eredità di karpathy).
8. **`kb-update` è un alias**, non un motore separato: stessa pipeline di `kb-build` con `mode:"update"` (motivazione in `generazione-estensione-knowledge-base.md` §1).

---

## 13. Glossario

- **KB**: knowledge base, un database IndexedDB.
- **Source**: documento caricato.
- **Page**: pagina wiki.
- **Catalog**: indice delle pagine (equivalente di `index.md`).
- **Chunk**: blocco di ingestione di una sorgente.
- **Quote**: citazione verbatim verificata.
- **Job/Staging**: unità di lavoro riprendibile e suoi risultati parziali.
- **Red-link**: link a una pagina non ancora creata.
