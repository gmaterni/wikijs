# kb_tmp — Motore Knowledge Base WikiJS

Codice JavaScript pronto per essere copiato in `static/js/` e sostituire il
motore Knowledge Base di ragindex (`rag_engine.js`, `docs_mgr.js`,
`rag_worker.js`, `llm_prompts.js`) senza toccare interfaccia, stack LLM,
chiavi API, uploader, LESS e login.

Specifiche complete: `docs/kb-wikijs-implementazione.md`.

## Struttura

```
kb_tmp/
├── kb/                          PACCHETTO autonomo (piatto, nessun ../)
│   ├── index.js                 unico punto di ingresso (re-export)
│   ├── adapter.js               confine LLM iniettabile: setAdapter/getAdapter/complete
│   ├── api.js                   kbInit, addSource, kbBuild, kbQuery, kbStatus, kbExport, kbImport, kbLint
│   ├── build.js                 compilazione: chunking, estrazione, merge, job riprendibili
│   ├── query.js                 interrogazione: Q0–Q4, selezione pagine, risposta, citazioni
│   ├── lifecycle.js             creazione idempotente della KB
│   ├── maintenance.js           stato/invarianti, export/import, lint
│   ├── sources.js               elenco, lettura, cancellazione sorgenti
│   ├── mock.js                  test double dell'adapter (matrice AC)
│   ├── db.js jobs.js ids.js chunk.js quotes.js validate.js params.js
│
│   (colla host: vive allo stesso livello di kb/, importa solo verso il basso)
├── kb_ui_state.js               kbId attivo + marcatori UI (ph0_chunks, ph1_index, …)
├── docs_mgr.js                  API documenti di ragindex → sorgenti KB
├── rag_engine.js                creazione/interrogazione per app_ui (stessa API ragindex)
└── llm_provider_adapter.js      adapter complete() sopra LlmProvider (ragindex)
```

Regole rispettate:

- **Nessun import che inizia con `../`**: il pacchetto usa solo `./`; la colla
  importa `./kb/…`, `./services/…`, `./llm_provider.js`, `./llmclient/…`.
- **Il pacchetto non conosce provider, chiavi o modelli**: l'LLM entra solo
  dall'adapter iniettato (`kb/adapter.js`).
- **Un solo ingresso**: i consumatori importano `./kb/index.js`.

## Installazione

Dalla root del progetto (che ha già `static/` copiato da ragindex):

```bash
cp -r kb_tmp/kb static/js/kb
cp kb_tmp/kb_ui_state.js kb_tmp/docs_mgr.js kb_tmp/rag_engine.js \
   kb_tmp/llm_provider_adapter.js static/js/
```

Poi applicare le patch minime di §7 in `docs/kb-wikijs-implementazione.md`.

## Iniezione dell'adapter (ospite o provider)

```javascript
import { setAdapter } from "./kb/index.js";
import { activateProviderAdapter } from "./llm_provider_adapter.js";

activateProviderAdapter();            // ospite (window.WikiJsLlm) o provider configurato
setAdapter(mioAdapterCustom);         // alternativa: adapter proprio con complete(req)
```

## Avvio rapido da console

```javascript
import * as kb from "./js/kb/index.js";
kb.setAdapter(kb.createMockAdapter({}));          // oppure llm_provider_adapter
await kb.kbInit({ kbId: "demo" });
await kb.addSource({ kbId: "demo", name: "doc.txt", text: "…" });
await kb.kbBuild({ kbId: "demo", mode: "auto" });
await kb.kbQuery({ kbId: "demo", question: "…" });
await kb.kbStatus({ kbId: "demo" });
```
