/**
 * help.js - Testi di aiuto dei comandi.
 *
 * HTML per la finestra di aiuto con l'elenco dei comandi.
 *
 * @module  services/help
 * @version 1.1.0
 * @date    2026-09-26
 */
"use strict";

/**
 * HTML per la finestra di aiuto dei comandi (Help).
 * Descrive l'architettura, la logica di funzionamento e l'interfaccia.
 */
export const help0_html = `
<div class="text">
    <p class="center help-title">Elenco Comandi WikiJS</p>

    <p class="center help-subtitle">
        Passa il mouse su ogni comando per un aiuto contestuale.
    </p>

    <div>
        <strong class="help-section-title">Barra Superiore (Header)</strong>
        <div class="help-grid">
            <strong>Icona Menu</strong> <span>Apre il menu laterale con tutte le sezioni (Documenti, KB, Conversazione, Gestione Dati, LLM, API Key).</span>
            <strong>HELP</strong> <span>Apre questa finestra con l'elenco completo dei comandi.</span>
            <strong>Upload</strong> <span>Carica file PDF, DOCX o TXT nella Knowledge Base.</span>
            <strong>LLM</strong> <span>Sceglie il provider AI (Gemini, Mistral, OpenRouter, ecc.) e il modello.</span>
            <strong>Log</strong> <span>Mostra il registro tecnico con ricerca ed errori.</span>
            <strong>Tema</strong> <span>Alterna tra tema scuro e tema chiaro.</span>
        </div>
    </div>

    <hr>

    <div>
        <strong class="help-section-title">Pulsanti di Controllo</strong>
        <div class="help-grid">
            <strong>Cancella</strong> <span>Elimina il testo nella casella di input.</span>
            <strong>Copia</strong> <span>Trasferisce la risposta negli appunti.</span>
            <strong>Invia</strong> <span>Avvia la query sulla KB con risposta e fonti verificate.</span>
        </div>
    </div>

    <hr>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Documenti</strong>
        <div class="help-grid">
            <strong>Elenco Documenti</strong> <span>Mostra i file caricati con anteprima ed eliminazione.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Knowledge Base</strong>
        <div class="help-grid">
            <strong>Crea</strong> <span>Genera l'indice di ricerca Lunr BM25 dai documenti caricati.</span>
            <strong>Cancella</strong> <span>Elimina la Knowledge Base attiva e i suoi indici.</span>
            <strong>Archivia</strong> <span>Salva la KB corrente con un nome personalizzato per usi futuri.</span>
            <strong>Gestisci</strong> <span>Elenca, attiva, esporta o elimina le KB archiviate.</span>
            <strong>Ripristina</strong> <span>Attiva una KB da un file di backup salvato.</span>
            <strong>Documenti Processati</strong> <span>Mostra processati e disponibili da processare in due gruppi.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Conversazione</strong>
        <div class="help-grid">
            <strong>Visualizza</strong> <span>Mostra lo storico della chat in formato testo.</span>
            <strong>Cancella</strong> <span>Elimina lo storico della chat e la vista corrente.</span>
            <strong>Archivia</strong> <span>Salva la chat corrente con un nome personalizzato.</span>
            <strong>Gestisci</strong> <span>Elenca, attiva, esporta o elimina le chat salvate.</span>
            <strong>Ripristina</strong> <span>Attiva una conversazione da un file di backup.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Gestione Dati</strong>
        <div class="help-grid">
            <strong>Riepilogo Dati</strong> <span>Mostra KB, conversazione e archivi raggruppati per tipo.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; API Key</strong>
        <div class="help-grid">
            <strong>API Keys Default</strong> <span>Ripristina le chiavi API predefinite.</span>
            <strong>Gestisci API Key</strong> <span>Aggiungi, attiva o elimina le chiavi personali.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; LLM</strong>
        <div class="help-grid">
            <strong>Reset LLM</strong> <span>Ripristina la selezione ai modelli di default dai file locali.</span>
            <strong>Aggiorna LLM</strong> <span>Scopre i modelli dai provider con le tue chiavi, li testa con voto e apre la selezione.</span>
            <strong>Test LLM</strong> <span>Prova il prompt sui modelli selezionati del provider scelto, con riepilogo finale.</span>
            <strong>Seleziona LLM</strong> <span>Mostra i modelli verificati per aggiornare l'albero.</span>
            <strong>STOP</strong> <span>Interrompe build e query in corso.</span>
        </div>
    </div>

    <div>
        <strong class="help-section-title">Menu Laterale &mdash; Sistema</strong>
        <div class="help-grid-last">
            <strong>Reset</strong> <span>Cancella ogni dato: KB, conversazioni, documenti e chiavi.</span>
            <strong>Logout</strong> <span>Esci dall'applicazione e torna alla schermata di login.</span>
        </div>
    </div>
</div>
`;
