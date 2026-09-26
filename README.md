# WikiJS

Applicazione web **100% client-side** per costruire una knowledge base interrogabile
dai propri documenti: carichi file **PDF, TXT o DOCX**, la KB viene compilata in
**pagine wiki** con citazioni verificate e l'LLM risponde **solo con ciò che è
nella wiki**. Nessuna build, nessun backend applicativo, nessun account:
moduli ES nel browser, dati in IndexedDB.

> Nessuna allucinazione: se l'informazione non è nella wiki, la risposta lo dichiara,
> con **Fonti verificate** e riga di provenienza (`[[slug]]`).

## Avvio

Serve un server statico (con `file://` i moduli ES non vengono caricati).
Dalla root del repository:

```bash
python3 -m http.server 8123
# aprire http://localhost:8123/static/wikijs.html   (presentazione)
# oppure http://localhost:8123/static/index.html    (app)
```

In ambiente locale il login Google è bypassato (`user_local`) e la telemetria è disattivata.

## Uso in breve

1. **Upload** di uno o più documenti (PDF, TXT, DOCX).
2. **Crea** dal menu Knowledge Base: compila solo le sorgenti nuove o modificate
   (chunk 8000–40000 caratteri, una chiamata LLM validata per chunk, job riprendibili).
3. **Domanda** nel campo input: risposta con citazioni `[[slug]]` verificate per sottostringa.

Provider LLM: Gemini, Mistral, Groq, OpenRouter, HuggingFace. Chiavi di prova
precaricate; chiavi personali solo sul dispositivo. Modalità query `llm`,
`llm-min` e `offline` (zero chiamate).

## Struttura

| Percorso | Ruolo |
|---|---|
| `static/wikijs.html` | Pagina di presentazione con comandi di avvio |
| `static/index.html` | Applicazione |
| `static/readme.html` | README tecnico (architettura, storage, API console) |
| `static/login.html` | Login Google (solo produzione) |
| `static/js/kb/` | Motore KB (lifecycle, build, query, job, citazioni) |
| `static/js/llmclient/`, `static/js/llmlist/` | Client e catalogo modelli LLM |
| `docs/` | Specifiche di design e guida operativa |
| `test/kb-workflow/` | Test di workflow (`npm test`) |

## Documentazione

- `docs/guida-uso.md` — guida operativa (menu, barra, parametri)
- `docs/architettura-knowledge-base.md` — schema IndexedDB, API, invarianti I1–I10
- `docs/compilazione-knowledge-base.md` — chunking, estrazione, merge, job
- `docs/workflow-query.md` — selezione pagine, risposta, citazioni

## Dati e privacy

- `wikijs:<kbId>` — un database IndexedDB per KB (pagine, sorgenti, catalogo, log)
- `wikijs_app_<userId>` — stato app (conversazione, KB attiva `demo`, chiavi, tema)
- `wikijs_llm_<userId>` — modelli scoperti/selezionati

Tutto resta nel browser. Versione attuale: **0.1.1**.
