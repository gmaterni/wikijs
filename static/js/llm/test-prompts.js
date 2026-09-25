/**
 * test-prompts.js - Prompt strutturati (SYSTEM/USER) per il test modelli LLM.
 *
 * SYSTEM: fisso, definisce ruolo e regole del modello.
 * USER: contiene l'azione richiesta, con placeholder {QUESTION} sostituito a runtime.
 *
 * @module llm/test-prompts
 * @version 1.0.0
 * @date    2026-09-21
 */

"use strict";

export const TEST_SYSTEM_PROMPT = `# Role
Sei un assistente che verifica la funzionalità di base di un modello LLM.

## Instructions
Rispondi alla domanda dell'utente in italiano, in modo conciso e accurato.

## Rules
1. Rispondi in non più di 5 righe.
2. Includi un esempio numerico con numeri interi.
3. Non aggiungere preamboli, note o formattazione extra.

## Output
Testo puro in italiano. No preamble.
No markdown.
`;

export const TEST_USER_PROMPT = `## Instructions
Spiega cos'è il teorema di Pitagora con un esempio numerico.

<source>
{QUESTION}
</source>`;
