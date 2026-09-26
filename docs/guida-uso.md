# Guida d'uso — WikiJS (`static/`)

Versione 0.1.0. Dettagli di design in `docs/`: `architettura-knowledge-base.md`,
`generazione-estensione-knowledge-base.md`, `workflow-query.md`.

L'interfaccia (barra, menu laterale, finestre, stile LESS) è la stessa
dell'applicazione precedente: cambiano solo il motore di knowledge base (WikiJS)
e il workflow di query. I comandi con gli stessi nomi fanno l'operazione
equivalente sulla KB WikiJS.

## Avvio

Servire la cartella con un qualsiasi server statico (es. `python3 -m http.server 8123`
dalla root del repo) e aprire `http://localhost:8123/static/index.html`.
Nessuna build: i moduli ES e `less.js` girano direttamente nel browser; l'apertura
con `file://` è bloccata dai browser per i moduli ES e per il caricamento dei `.less`.
Le API sono anche in console: `kbInit`, `kbAddSource`, `kbBuild`, `kbUpdate`,
`kbQuery`, `kbStatus`, `kbExport`, `kbImport`, `kbLint`, `kbGetId`.

La KB attiva è registrata nello stato applicativo in IndexedDB/Dexie
(`active_kb` nel database `wikijs_app_<userId>`, default `demo`); per lavorare
su più KB si usa la coppia Archivia/Ripristina (bundle JSON). L'LLM si configura
dal pulsante **LLM** nella barra in alto (albero provider/modelli) o dalla
sezione **LLM** del menu.

I client (`gemini`, `mistral`, `groq`, `openrouter`, `huggingface` in
`static/js/llmclient/`) e il catalogo modelli (`static/data/models/*.txt`)
sono quelli dell'applicazione precedente, senza modifiche. Le chiavi di
default (`static/data/api_x.json`, offuscate) vengono seminate al primo avvio
in `wikijs_app_<userId>` (store `settings`, chiave attiva per provider); ogni
provider ammette più chiavi (aggiungi/attiva/elimina da "Gestisci API Key",
solo i nomi in chiaro). La selezione provider/modello resta in
`wikijs_app_<userId>` (chiave `llm_provider`). "Aggiorna LLM" scopre i modelli
remoti (`static/js/llmlist/`), li vota con probe e li persiste in
`wikijs_llm_<userId>` (store `discovered-models`/`selected-models`);
`cerebras`/`siliconflow` sono esclusi (client orfani fuori registry, senza
catalogo). Le chiamate ritentano 3 volte su `408,500,502,503,504`; sul `429`
applicano un backoff crescente con spaziatura adattiva e, se persiste,
interrompono il job (`rate_limited`) invece di moltiplicare le richieste.
Onorano `signal` e propagano l'`usage` reale. L'esito di ogni richiesta
LLM (provider/modello, durata, token) è riportato in `UaLog`, insieme
all'avvio di ogni documento; in alternativa l'adapter
va iniettato dall'ospite (`window.WikiJsLlm.complete` oppure `setAdapter` da
console); senza LLM restano attivi `offline` e selezione locale.

## Menu laterale

## Knowledge Base
| Crea || Estrae le pagine dalle sorgenti nuove o modificate, mai da quelle già completate. |
| Cancella | Elimina il database della KB attiva. |
| Archivia | Salva la KB corrente in un archivio locale con un nome scelto. |
| Gestisci | — | Elenca, attiva, esporta o elimina le KB archiviate. |
| Ripristina |  Importa una KB da file JSON. |
| Documenti Processati | Processati (`ingested`) e disponibili da processare (`new`/`changed`/`error`) in due gruppi. |
| Gestione Documenti | Visualizza ed elimina le sorgenti. |
| Riepilogo Dati  | Conteggi KB, conversazione, archivi e configurazione. |
## Conversazione
| Visualizza Conversazione  | Storico della chat in formato testo. |
| Cancella Conversazione | Cancella l'intero storico della chat e la vista; le query successive restano indipendenti. |
| Archivia |  Salva la chat corrente (solo storico) in un archivio locale. |
| Gestisci— | Elenca, attiva, esporta o elimina le chat archiviate. |
| Ripristina  | Importa una chat da file JSON. |
## LLM
| Test LLM | Prova il prompt scritto nei modelli selezionati del provider scelto. |
| Reset LLM  | Ripristina la selezione dai file `.txt` locali. |
| Aggiorna LLM  | Scopre, testa e vota i modelli dei provider con chiave attiva. |
| Seleziona LLM  | Spunta i modelli validati  |
## Api Key
| API Keys Default | Ricarica le chiavi di default con conferma. |
| Gestisci API Key | CRUD chiavi per provider. |

## Reset  Cancella tutti i database `wikijs:*` e lo stato locale, poi ricarica.

## Barra superiore

HELP apre questo manuale; Upload carica file `.txt`/`.md` come sorgenti;
LLM apre l'albero provider/modelli; Log mostra il registro eventi; il badge KB
mostra la KB attiva e il badge LLM mostra `provider/modello` (o `LLM: ospite`).

## Pulsanti di controllo

| Pulsante | Effetto |
|---|---|
| Cancella Input (cestino) | Svuota la casella di domanda. |
| Copia Output | Copia il testo dell'output negli appunti. |
| Invia (verde) | Esegue una query indipendente sulla Knowledge Base: `kbQuery({ kbId, question, mode: "llm" })`, risposta con citazioni `[[slug]]`, fonti verificate e riga di provenienza. |
| Invio | Come il pulsante Invia (`Shift+Invio` va a capo). |

## Parametri principali (`meta.params`)

`chunkChars` 12000, `chunkOverlapChars` 1500, `maxPagesPerChunk` 6,
`maxPagesPerDoc` 40, `pageBodyMaxChars` 12000, `quotesPerPage` 5,
`catalogTokenBudget` 8000, `queryPageBudget` 7, `queryContextChars` 20000.
Sovrascrivibili in `kbInit({ kbId, params })`.

In build i parametri di chunking sono derivati dalla finestra del modello
(`kbBuild({ modelWindowTokens })`): chunk da 8.000 a 40.000 caratteri,
overlap 1/8, `maxPagesPerChunk` 4-10, `extract.maxTokens` fino a 16.000.
Un valore esplicito in `meta.params` (diverso dal default) non viene
sovrascritto; in UaLog compare la suddivisione effettiva.

## Limiti dichiarati

- Citazioni solo verbatim e verificate per sottostringa: una parafrasi corretta
  risulta non verificata e non viene mostrata nelle risposte.
- Nessuna allucinazione: se l'informazione non è nella wiki, la risposta lo dichiara.
- Slug deterministici mai dall'LLM; rinominazione vietata (pagina nuova + `[[slug|testo]]`).
- Contraddizioni in append, mai cancellazioni; pagine in quarantena escluse dalle query.
- Oltre `catalogTokenBudget` la query usa il percorso a due livelli (3 chiamate, dichiarate).
- "Cancella Conversazione" agisce sulla vista (stato UI in
  `wikijs_app_<userId>`): `outputs` e `logs` restano append-only nel database,
  come richiesto dall'invariante I6.
- Eventi d'uso: inviati con nome applicazione `wikijs` all'endpoint
  `https://wwwanalyzer-backend.workerua.workers.dev` (percorso `/api/analytics`);
  l'invio è disattivato in ambiente locale.
- Ogni comando documentato qui è verificato dalla matrice AC1–AC8 (adapter mock).
