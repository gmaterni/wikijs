# Knowledge Base WikiJS — Specifiche di implementazione JavaScript

Documento di specifica per **sostituire il motore Knowledge Base di ragindex**
con il motore WikiJS, mantenendo **inalterati** il resto dell'applicazione
(interfaccia, stack LLM, chiavi API, uploader, stile LESS, login).

Riferimenti: `docs/architettura-knowledge-base.md` (invarianti I1–I10),
`docs/generazione-estensione-knowledge-base.md` (build),
`docs/workflow-query.md` (query). Codice pronto in `kb_tmp/`.

---

## 1. Scopo e criteri

| Criterio | Requisito |
|---|---|
| **Non invasività** | Nessuna modifica ai moduli ragindex di UI, LLM, chiavi, uploader, LESS, login; il contatto con la UI è limitato a **7 funzioni note** di `app_ui.js` (§7) |
| **Interfaccia identica** | I moduli sostituti (`rag_engine.js`, `docs_mgr.js`) espongono **le stesse funzioni** con le stesse firme usate dalla UI |
| **Motore sostituito** | La KB non usa più lunr/BM25 né il Web Worker: usa IndexedDB per KB, chunking deterministico, estrazione LLM, catalogo e citazioni verificate |
| **Riuso LLM** | `llmclient/`, `llm_provider.js`, `llm_updater.js`, `commands/*-llm.js`, chiavi e selezione modello restano ragindex verbatim |
| **Testabilità** | `window.kbInit/kbAddSource/kbBuild/kbQuery/…` in console; adapter mock via `setAdapter` per la matrice AC |

---

## 2. Regole di non invasività

**Non si toccano** (importano/attesi come sono):

- `js/llmclient/**`, `js/llmlist/**`, `js/llm_provider.js`, `js/llm_updater.js`, `js/commands/*.js`
- `js/services/**` (unica eccezione: 1 riga in `backup_mgr.js`, §7-P8)
- `js/uploader.js`, `js/app_mgr.js`, `js/services/idb_mgr.js`
- `js/services/key_*.js`, `key_ui.js`, `llm/llm-selection.js`, `index.html` (salvo P11)
- `less/**`, `css/**`, `login.html`, `data/**`

**Si sostituiscono** (stesso nome file, stessa API):

| File ragindex | Nuovo contenuto |
|---|---|
| `js/rag_engine.js` | ponte `kb/*` (creazione e interrogazione) |
| `js/docs_mgr.js` | sorgenti KB dietro l'API documenti di ragindex |

**Si aggiungono — pacchetto `kb/`** (piatto, autosufficiente, solo import `./`):

| File | Ruolo |
|---|---|
| `js/kb/index.js` | unico punto di ingresso (re-export) |
| `js/kb/adapter.js` | confine LLM iniettabile (`setAdapter/getAdapter/complete`) |
| `js/kb/api.js` … `js/kb/validate.js` | motore (creazione, build, query, manutenzione, storage) |
| `js/kb/sources.js` | elenco/lettura/cancellazione sorgenti |
| `js/kb/mock.js` | test double dell'adapter (matrice AC) |

**Si aggiungono — colla host** (stesso livello di `kb/`, import solo verso il basso):

| File | Ruolo |
|---|---|
| `js/kb_ui_state.js` | `kbId` attivo + marcatori UI |
| `js/llm_provider_adapter.js` | adapter `complete()` sopra `LlmProvider` (ragindex) |

**Regola strutturale:** nessun file nuovo importa con `../`; il pacchetto
`kb/` non conosce provider, chiavi, modelli né servizi dell'app.

**Si eliminano** (non più referenziati):

`js/rag_worker.js`, `js/llm_prompts.js`, `js/services/data_repository.js`,
`js/services/build_state_mgr.js`, `js/services/worker_path.js`,
`js/services/vendor/lunr*.js`, `js/services/vendor/compromise.js`,
`js/llm/adapter.js` (spostato in `js/kb/adapter.js`),
`js/llm/mock.js` (spostato in `js/kb/mock.js`).

---

## 3. Mappa dei moduli e dipendenze

```
                 UI ragindex (app_ui.js, app_mgr.js, uploader.js)
                        │ stessa API di prima
        ┌───────────────┼────────────────────┐
        ▼               ▼                    ▼
   docs_mgr.js     rag_engine.js      (idbMgr/UaDb invariati)
        │               │
        ▼               ▼
  kb/sources.js     kb/index.js ── kbBuild / kbQuery / kbStatus / kbExport / kbImport
        │               │
        └──────┬────────┘
               ▼
          kb/ (db, chunk, jobs, ids, quotes, validate, params, lifecycle, maintenance)
               │
               ▼
        kb/adapter.js ◄── setAdapter (ospite | llm_provider_adapter.js)
```

Dipendenze interne al motore: `index → {api, adapter, mock, sources, params}`;
`api → {lifecycle, build, query, maintenance}`;
`build/query → {db, jobs, ids, chunk, quotes, validate, params}`;
`build/query → ./adapter.js` (confine LLM, iniettato).

---

## 4. Contratti API

### 4.1 Motore — `js/kb/index.js` (re-export di `api.js` e utility)

| Funzione | Opzioni | Ritorno | Errori |
|---|---|---|---|
| `kbInit` | `{ kbId, params? }` | `{ kbId, created, schemaVersion }` | `null` se `kbId` non valido |
| `addSource` | `{ kbId, name, mime?, text }` | record sorgente + `changed:boolean` | `null` su argomenti non validi |
| `kbBuild` | `{ kbId, sourceIds?, mode?:"auto"\|"full"\|"update", budget?, onProgress?, signal?, resumeJobId?, adapter? }` | `{ jobId, mode, durationMs, sources[], totals{sources,pagesCreated,pagesUpdated,calls,inputTokens,outputTokens}, notes[] }` | `null` se niente da fare o `kbId` invalido |
| `kbQuery` | `{ kbId, question, mode?:"llm"\|"llm-min"\|"offline", budget?, onProgress?, signal?, adapter? }` | `{ outputId, answer, citations[{slug,quote,verified}], pagesUsed[], mode, missing, meta{calls,pagesConsidered,pagesLoaded} }` | `null` su errore; `offline/llm-min` senza adapter |
| `kbStatus` | `{ kbId }` | `{ kbId, schemaVersion, counts{…}, openJobs, invariants[{id,ok,details}], redLinks[] }` | `null` su DB illeggibile |
| `kbExport` | `{ kbId, includeLogs? }` | `{ meta, sources, pages, catalog, logs? }` | `null` su errore |
| `kbImport` | `{ kbId, bundle, mode:"merge"\|"replace" }` | `boolean` | `false` su bundle invalido |
| `kbLint` | `{ kbId }` | `{ kbId, issues[], lintSeq }` | `null` su errore |

`mode` di build: `auto` = solo sorgenti `new/changed/error`; `full` = tutte;
`update` = come `auto`, `null` se non c'è nulla da aggiornare.

**Adapter LLM** (`js/kb/adapter.js`, iniettabile):

```js
complete({ purpose, messages, temperature?, maxTokens?, model?, signal? })
  → Promise<{ text: string, usage: { inputTokens?, outputTokens? } } | null>
// purpose ∈ extract | merge | select | answer | lint
// model è un nome logico (forte|rapido|medio): il bridge usa SEMPRE il modello attivo
```

Priorità: `window.WikiJsLlm.complete` (ospite) → `llm_provider_adapter` → nessun adapter
(la query degrada a `offline`, la build fallisce in modo dichiarato).

### 4.2 Adattatori UI

| Modulo | Funzione | Contratto |
|---|---|---|
| `kb_ui_state.js` | `getKbId()` | `Promise<string>` (default `demo`) |
| | `setKbId(kbId)` | `Promise<boolean>`; valida `^[a-z0-9][a-z0-9_-]*$` |
| | `syncKbMarkers(kbId, { counts, doclist })` | scrive `ph0_chunks`, `ph1_index`, `kb_doclist`, `kb_childchunks`, `active_kb` |
| | `clearKbMarkers()` | elimina i marcatori e `active_kb` |
| | `deleteKbDatabase(kbId)` | `Promise<boolean>`; elimina `wikijs:<kbId>` |
| `kb/sources.js` | `listSources(kbId)` | `Promise<Array>` sorgenti ordinate per nome |
| | `readSource(kbId, sourceId)` | `Promise<string\|null>` |
| | `isPending(source)` | `boolean` (`status ∈ new,changed,error`) |
| | `deleteSource(kbId, sourceId)` | `Promise<{removedPages,updatedPages}\|null>` in una transazione |
| `docs_mgr.js` | `init/add/read/names/name/doc/delete/exists` | **API ragindex identica**; `add(name, testo)` → `addSource`; `delete` → `deleteSource` |
| `rag_engine.js` | `init(client, model, promptSize)` | no-op diagnostico (compatibilità) |
| | `setStopHandler(handler)` | registra la cancellazione dei client LLM (composition root) |
| | `stop()` | abort della query/build in corso + `handler()` |
| | `getOptimizedContext(query, kbData, thread)` | esegue `kbQuery`, ritorna il **contesto testuale** (per `ph2_context`) |
| | `generateResponse(context, thread)` | ritorna markdown: risposta + `**Fonti verificate**` + provenienza |
| `llm_provider_adapter.js` | `activateProviderAdapter()` | registra host o provider; `boolean` |
| | `getProviderAdapter()` | `{ complete }` |
| | `stopActiveClients()` | `cancelRequest()` su tutti i client attivi |

---

## 5. Storage

### 5.1 Motore — IndexedDB nativo `wikijs:<kbId>` (versione 1)

| Store | keyPath | Contenuto |
|---|---|---|
| `meta` | `key` | `params`, `llmRouting`, `writer`, `counters` |
| `sources` | `sourceId` | `{ name, mime, sizeBytes, sha256, text, status, ingestedAt, pagesCount }` |
| `pages` | `slug` | `{ slug, title, summary, body, sources[], links[], quotes[{text,sourceId,verified}], status, origin, version, createdAt, updatedAt }` |
| `catalog` | `slug` | proiezione `{ slug, title, summary, category, updatedAt }` |
| `logs` | `logId` (auto) | append-only `{ ts, type, refs, summary, details }` |
| `outputs` | `outputId` | append-only risposta `{ question, answer, citations, pagesUsed, mode, meta }` |
| `jobs` | `jobId` | stato job riprendibile |
| `staging` | `stagingId` | risultati parziali per ripresa |

### 5.2 Applicazione — Dexie `wikijs_app_<userId>` (invariata rispetto a ragindex)

| Store | Chiavi usate dal motore/UI |
|---|---|
| `kvStore` | `thread`, `ph2_context`, `ph0_chunks`, `ph1_index`, `kb_doclist`, `kb_childchunks`, `rag_kb_<nome>`, `rag_convo_<nome>` |
| `settings` | `active_kb`, `theme`, `provider`, `api_keys` |

### 5.3 Marcatori UI (compatibilità con i controlli di `app_ui.js`)

| Chiave | Valore scritto | Letto da |
|---|---|---|
| `ph0_chunks` | `{ builder:"wikijs", kbId, pages, sources, builtAt }` | `updateActiveKbDisplay`, `_actionSaveKnowledgeBaseAsync` |
| `ph1_index` | `"wikijs:<kbId>"` | `TextInput.startConversationAsync` |
| `kb_doclist` | nomi sorgenti elaborate | `createKnowledgeAsync`, Documenti Processati |
| `kb_childchunks` | `{}` (segnaposto) | `_actionSaveKnowledgeBaseAsync` |
| `active_kb` | `kbId` corrente | `updateActiveKbDisplay` |

**Regola:** i marcatori si scrivono solo dopo build/import riusciti
(`syncKbMarkers`) e si cancellano con `clearKbMarkers` su delete/reset.

---

## 6. Flussi operativi

### 6.1 Caricamento documenti (uploader ragindex, invariato)

```
file → cleanDoc (text_cleaner.js) → DocsMgr.add(name, testo)
     → addSource({ kbId, name, text }) → sources (status new|changed)
```

Il pulsante Upload, la drop-zone, i formati (TXT/PDF/DOCX/ODT) e le finestre
restano quelli di ragindex: cambia solo la destinazione (sorgenti KB).

### 6.2 Compilazione («Crea»)

```
TextInput.createKnowledgeAsync
  ├─ DocsMgr.names()/doc(i)                → sorgenti correnti
  ├─ se kb_doclist vuoto → conferma → kbBuild(mode:"full")
  ├─ altrimenti solo nuove → conferma → kbBuild(mode:"auto")
  ├─ kbStatus → syncKbMarkers(kbId, {counts, doclist})
  └─ updateActiveKbDisplay()               → badge «KB: <kbId>»
```

Semantica (da `generazione-estensione-knowledge-base.md`): chunk
`12000` caratteri con overlap `1500` come sezione «CONTESTO PRECEDENTE (non
riestrarre)»; split a paragrafi/frasi, mai a metà parola; estrazione con
schema bloccante + 1 retry; merge per aggiunta; citazioni verificate per
sottostringa; job riprendibili con `staging`.

### 6.3 Interrogazione (Avvia / Continua / Invio)

```
thread = idbMgr.read("thread") || []
ragEngine.getOptimizedContext(query, kbData, thread)
  → kbQuery({ kbId, question, mode:"llm" })
  → { answer, citations[verified], pagesUsed, mode, meta }
  → contesto testuale salvato in ph2_context
ragEngine.generateResponse(context, thread)
  → markdown: answer + **Fonti verificate** + *Modalità · Pagine · Chiamate*
  → thread.push(user, assistant) → idbMgr.create("thread") → showHtmlThread()
```

- «Visualizza Contesto» legge `ph2_context` (testo già leggibile).
- Citazioni non verificate mai mostrate: filtro a monte in `kbQuery`.
- Modi: `llm` (≤2 chiamate), `llm-min` (1), `offline` (0).

### 6.4 STOP

```
spinner (app_ui) → AppMgr.getClientLLM().cancelRequest()   ← fetch in corso
                → ragEngine.stop()                          ← AbortController kbQuery/kbBuild
                                                            + stopActiveClients()
```

La UI ignora `error.code === 499` (interruzione volontaria), come già fa per ragindex.

### 6.5 Archivia / Carica / Cancella / Reset

| Azione | Implementazione |
|---|---|
| **Archivia** | `kbExport({includeLogs:true})` → record `{ chunks: riepilogo, serializedIndex, doclist, childchunks, kbBundle, kbId }` in `rag_kb_<nome>` |
| **Gestisci** | `idbMgr.selectKeys("rag_kb_")`, Attiva/Backup/Elimina (UI ragindex invariata) |
| **Carica** | file JSON → `kbImport({kbId, bundle, mode:"replace"})` → `syncKbMarkers` |
| **Cancella** | `deleteKbDatabase(kbId)` → `clearKbMarkers()` → badge |
| **Reset** | `idbMgr.clearAll()` + `deleteDatabase` di tutti i `wikijs:*` + `localStorage.clear()` |

Le conversazioni restano negli archivi `rag_convo_<nome>` gestiti da
`idbMgr`/`BackupMgr` (ragindex invariato).

---

## 7. Patch minime a ragindex (elenco chiuso)

Tutte in `js/app_ui.js` salvo dove indicato. Sono l'**unico** punto di contatto.

| # | Funzione | Modifica |
|---|---|---|
| P1 | `TextInput.createKnowledgeAsync` | corpo riscritto su `kbBuild` + `syncKbMarkers`; rimossa `_rebuildLunrIndex` (lunr non più caricato) |
| P2 | `_actionSaveKnowledgeBaseAsync` | usa `kbExport` e salva `kbBundle` nel record `rag_kb_*` |
| P3 | `_actionLoadKnowledgeBaseAsync` | `kbImport(mode:"replace")` + `syncKbMarkers` |
| P4 | `_actionDeleteKnowledgeBaseAsync` | `deleteKbDatabase` + `clearKbMarkers` |
| P5 | `TextOutput.clearHistoryAndContextAsync` | come P4 (cancella anche il DB KB) |
| P6 | `Commands.resetAll` | elimina anche i database `wikijs:*` |
| P7 | `TextInput.startConversationAsync` | messaggio «Eseguire l'Azione 1 prima.» → «Compilare prima la Knowledge Base» |
| P8 | `services/backup_mgr.js` | `importKbAsync` accetta anche `bundle`/`kbBundle`; nome file `wikijs_*` |
| P9 | `js/app.js` | dopo `AppMgr.initApp()`: `activateProviderAdapter()` + `ragEngine.setStopHandler(stopActiveClients)`; espone `window.kb*` |
| P10 | `services/db_instance.js`, `js/llm/llm-db.js` | rinomina DB in `wikijs_app_<userId>` / `wikijs_llm_<userId>` (isolamento) |
| P11 | `index.html` | rimuovere gli `<script>` di `lunr*`/`compromise`; titolo WikiJS |

Tutto il resto di `app_ui.js` (badge KB, Conversazione, Gestione Dati, LLM,
API Key, reset conversazione, elenco documenti) **non si tocca**.

---

## 8. Invarianti e test di accettazione

Il motore mantiene I1–I10 (`kbStatus().invariants`):

| ID | Verifica |
|---|---|
| I1 | un DB per KB, nome `wikijs:<kbId>` |
| I2 | `catalog ≡ proiezione(pages)` |
| I3 | ogni pagina `origin:source` ha sorgenti esistenti |
| I4 | `pages` e `catalog` committati nella stessa transazione |
| I5 | `outputs`/`logs` append-only (nessuna sovrascrittura) |
| I6 | risposta = `outputs` + `logs` |
| I7 | staging vuoto a job `done`; conservato su `error`/`cancelled` |
| I8 | `status:"quarantined"` escluso da catalogo e query |
| I9 | link a slug esistenti o marcati red-link |
| I10 | un solo writer per KB |

**Test minimi**

1. Build da testo minimo con adapter mock: pagine create, catalogo coerente, log.
2. Rebuild senza modifiche: zero rielaborazioni.
3. Modifica sorgente: solo quella rielaborata, `version+1`.
4. Query mock: risposta solo da pagine esistenti, citazioni `verified:true`.
5. Abort a metà build + ripresa: nessuna pagina duplicata (staging).
6. Export → import su DB vuoto: stato equivalente (a meno di `logs`).
7. Eliminazione sorgente elaborata: pagine dipendenti rimosse, invarianti ok.
8. `setAdapter(mock)` prioritario su `llm_provider_adapter`.

---

## 9. Limiti e rischi

- **Cancella Contesto/Conversazione** restano stato UI: `outputs`/`logs` sono
  append-only (I6) e non si cancellano.
- Un solo `kbId` attivo per volta: la multi-KB si gestisce con Archivia/Carica
  (bundle JSON), non con più DB attivi contemporaneamente.
- La build richiede un adapter LLM funzionante; senza chiave valida fallisce
  in modo dichiarato e non scrive marcatori.
- Costi API: la build chiama il provider per ogni chunk; usare modelli
  economici per il primo collaudo.
- `serializedIndex`/`childchunks` nel record d'archivio sono **segnaposto**
  (compatibilità dei controlli UI): il dato vero è `kbBundle`.
- Le patch P1–P11 sono il confine contrattuale: ogni modifica ulteriore alla UI
  va trattata come nuova specifica.
- **Struttura del codice**: il pacchetto `kb/` è piatto e autosufficiente
  (solo import `./`, ingresso unico `kb/index.js`, nessuna conoscenza di
  provider/chiavi/modelli); la colla host vive allo stesso livello di `kb/`
  e importa solo verso il basso (`./kb/…`, `./services/…`). Nessun file nuovo
  usa `../`.
