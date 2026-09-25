/**
 * help.js - Testi di aiuto dei comandi.
 *
 * HTML per la finestra di aiuto con l'elenco dei comandi.
 *
 * @module  services/help
 * @version 1.0.0
 * @date    2026-09-15
 */
"use strict";

/**
 * HTML per la finestra di aiuto dei comandi (Help).
 * Descrive l'architettura, la logica di funzionamento e l'interfaccia.
 */
export const help0_html = `
<div class="text">
    <p class="center help-title">Elenco Comandi RagIndex</p>

    <p class="center help-subtitle">
        Passa il mouse su ogni comando per un aiuto contestuale.
    </p>

    <div>
        <strong class="help-section-title">Barra Superiore (Header)</strong>
        <div class="help-grid">
            <strong>Icona Menu</strong> <span>Apre il menu laterale con tutte le sezioni (KB, Chat, Dati, API Key, Logout).</span>
            <strong>HELP</strong> <span>Apre questa finestra con l'elenco completo dei comandi.</span>
            <strong>Upload</strong> <span>Carica file PDF, DOCX o TXT nella Knowledge Base.</span>
            <strong>LLM</strong> <span>Sceglie il provider AI (Gemini, Mistral, OpenRouter, ecc.) e il modello.</span>
            <strong>Log</strong> <span>Mostra la console tecnica con i messaggi di chunking, ricerca ed errori.</span>
            <strong>Tema</strong> <span>Alterna tra tema scuro e tema chiaro.</span>
        </div>
    </div>

    <hr>

    <div>
        <strong class="help-section-title">Pulsanti di Controllo</strong>
        <div class="help-grid">
            <strong>Cancella Input</strong> <span>Elimina il testo nella casella di input.</span>
            <strong>Copia Output</strong> <span>Copia la risposta dell'AI negli appunti.</span>
            <strong>Avvia (Giallo)</strong> <span>Cerca il contesto nei documenti (ricerca BM25 + giudizio semantico di pertinenza) e invia la prima domanda all'AI.</span>
            <strong>Continua (Verde)</strong> <span>Invia una nuova domanda mantenendo chat e contesto.</span>
        </div>
    </div>

    <hr>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Knowledge Base</strong>
        <div class="help-grid">
            <strong>Crea</strong> <span>Genera l'indice di ricerca Lunr BM25 dai documenti caricati.</span>
            <strong>Cancella</strong> <span>Elimina la Knowledge Base attiva e i suoi indici.</span>
            <strong>Archivia</strong> <span>Salva la KB corrente con un nome personalizzato per usi futuri.</span>
            <strong>Gestisci</strong> <span>Elenca, attiva, esporta o elimina le KB archiviate.</span>
            <strong>Carica</strong> <span>Carica una KB da un file di backup JSON.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Conversazione</strong>
        <div class="help-grid">
            <strong>Visualizza Contesto</strong> <span>Mostra il contenuto estratto usato dall'AI per rispondere.</span>
            <strong>Visualizza Conversazione</strong> <span>Mostra l'intero storico della chat in formato testo.</span>
            <strong>Cancella Contesto</strong> <span>Azzera contesto, prima domanda e tutta la conversazione.</span>
            <strong>Cancella Conversazione</strong> <span>Elimina solo i messaggi successivi alla prima domanda.</span>
            <strong>Archivia</strong> <span>Salva la cronologia della chat corrente con un nome personalizzato.</span>
            <strong>Gestisci</strong> <span>Elenca, attiva, esporta o elimina le conversazioni archiviate.</span>
            <strong>Carica</strong> <span>Carica una conversazione da un file di backup JSON.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Gestione Dati</strong>
        <div class="help-grid">
            <strong>Elenco Documenti</strong> <span>Mostra i file caricati con opzioni di visualizzazione ed eliminazione.</span>
            <strong>Riepilogo Dati</strong> <span>Mostra i dati IndexedDB raggruppati per categoria: KB attiva, conversazione, KB archiviate, conversazioni archiviate, configurazione.</span>
            <strong>Reset</strong> <span>Cancella ogni dato: KB, contesto, conversazioni, documenti e chiavi.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; API Key</strong>
        <div class="help-grid">
            <strong>API Keys Default</strong> <span>Ripristina le chiavi API predefinite.</span>
            <strong>Gestisci API Key</strong> <span>Aggiungi, attiva o elimina le tue chiavi API personali.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; LLM</strong>
        <div class="help-grid">
            <strong>Reset LLM</strong> <span>Ripristina la selezione ai modelli di default dai file locali.</span>
            <strong>Aggiorna LLM</strong> <span>Scopre i modelli dai provider con le tue chiavi, li testa con voto e apre la selezione.</span>
            <strong>Test LLM</strong> <span>Prova il prompt sui modelli selezionati del provider scelto, con riepilogo finale.</span>
            <strong>Seleziona LLM</strong> <span>Mostra solo i modelli scaricati e testati: spunta, poi Salva (sostituisce) o Aggiungi (unisce).</span>
            <strong>STOP</strong> <span>Durante elaborazioni e ricerche, clicca l'icona di attesa (STOP) per interrompere.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Sistema</strong>
        <div class="help-grid-last">
            <strong>Test Provider</strong> <span>Verifica tutti i provider e modelli configurati (apre pagina di test dedicata).</span>
            <strong>Logout</strong> <span>Esci dall'applicazione e torna alla schermata di login.</span>
        </div>
    </div>
</div>
`;
