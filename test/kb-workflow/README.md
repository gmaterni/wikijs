# Test workflow KB + query (motore WikiJS)

Verifica del buon funzionamento del workflow di creazione della Knowledge Base
e delle query, su documenti reali estratti da `/u/AI/data` (scelta libera):

- `lucarelli_origine.txt` — origini Massoneria moderna/speculativa (1717)
- `lucarelli_riflessioni.txt` — principi come sistema di moralità
- `busa.txt` — padre Busa, linguistica computazionale

Temi distinti così le query verificano la coerenza della selezione.

## Requisiti

Node >= 20. Adapter LLM mock (`static/js/kb/mock.js`): nessuna rete,
nessuna chiave. IndexedDB simulato con `fake-indexeddb`.

## Esecuzione

```bash
cd test/kb-workflow
npm install
npm test
```

`npm test` = `node --test kb-build.test.mjs kb-query.test.mjs`.

## Cosa coprono

`kb-build.test.mjs` (delta spec `knowledge-base`):
1. `addSource` nuovo -> `new`
2. stesso nome + stesso contenuto -> invariato (`changed:false`)
3. stesso nome + contenuto diverso -> `changed`, stesso `sourceId`
4. testo vuoto -> `null` (rifiutato)
5. ricaricamento nome esistente non bloccato come duplicato
6. prima build `auto`: tutti i documenti, `totals.sources==2`, doclist = soli `ingested`
7. coerenza `kbStatus` + `listSources` (processati/disponibili)
8. aggiunta successiva: solo 1 sorgente elaborata
9. nulla da elaborare: `totals.sources==0`
10. modificato: solo quello rielaborato
11. `deleteSource`: solo tombstone (testo liberato), pagine intatte e interrogabili, I3 verificata
12. build `auto`/`full` ignora le tombstone; ricaricamento riattiva sullo stesso `sourceId`
13. export/import `replace` con doclist filtrata ai soli `ingested` (task 2.2 UI)

`kb-query.test.mjs` (workflow-query Q0):
- offline per tema -> pagine del documento giusto (A/B/C via ancore di catalog)
- fuori corpus -> `missing` con messaggio "non presente"
- termini solo nel body (non indicizzati) -> `missing`, nessuna invenzione
- domanda vuota -> `null`
- llm (mock con catalog reale) -> citazioni `[[slug]]`, chiamate <= 3, mode tracciato
- query non altera sorgenti/pagine
