# Alex Outreach Bot

**AI-powered personal sales copilot for Instagram outreach and multi-prospect conversation management.**

Alex Outreach Bot è un bot Telegram privato progettato per assistere nella gestione dell'outreach commerciale su Instagram.

Il sistema non nasce come semplice generatore di cold DM, ma come un vero conversation copilot in grado di:

- analizzare profili Instagram;
- analizzare screenshot di profili pubblici o privati;
- generare primi messaggi altamente personalizzati;
- analizzare screenshot delle conversazioni;
- comprendere in quale fase commerciale si trova ciascun prospect;
- suggerire il miglior messaggio successivo;
- mantenere memoria separata per ogni prospect;
- gestire follow-up;
- ricordare obiezioni, interessi e informazioni già emerse;
- supportare decine o centinaia di conversazioni senza confondere il contesto;
- fornire nel tempo statistiche sull'efficacia dei diversi approcci.

Il principio fondamentale del progetto è semplice:

> Il bot non deve vendere al posto dell'utente. Deve aiutare l'utente a gestire meglio ogni conversazione.

L'invio finale dei messaggi rimane sempre sotto controllo umano.

## 1. Visione del progetto

Il canale principale di acquisizione clienti è Instagram.

I prospect tipici includono:

- personal trainer;
- coach;
- professionisti;
- attività locali;
- ristoranti;
- negozi;
- barbieri;
- centri estetici;
- palestre;
- piccole imprese;
- freelance;
- attività che potrebbero beneficiare di siti web, ecommerce, landing page, prenotazioni, automazioni o software personalizzato.

Il problema da risolvere non è semplicemente:

> "Come posso generare un messaggio commerciale?"

Il problema reale è più ampio:

> "Come posso gestire efficacemente molte conversazioni commerciali contemporaneamente, senza perdere il contesto, senza sembrare automatico e scegliendo ogni volta il prossimo passo più appropriato?"

Alex Outreach Bot è progettato attorno a questa domanda.

## 2. Obiettivo

Il sistema deve trasformare Telegram in un personal sales workspace.

Il flusso ideale da iPhone sarà:

```text
Instagram
    │
    ├── Condividi profilo
    │
    └── Screenshot
            │
            ↓
        Telegram
            │
            ↓
    Alex Outreach Bot
            │
            ├── analisi prospect
            ├── recupero memoria
            ├── analisi conversazione
            ├── classificazione fase
            ├── identificazione obiettivo
            └── generazione risposta
                    │
                    ↓
              3 alternative
                    │
              ┌─────┼─────┐
              ↓     ↓     ↓
            BEST   ALT   DIRECT
              │
              ↓
            COPY
              │
              ↓
          Instagram
```

Il bot non invia automaticamente messaggi ai prospect.

Il sistema è intenzionalmente human-in-the-loop:

```text
AI suggerisce
     ↓
Alex valuta
     ↓
Alex sceglie
     ↓
Alex copia
     ↓
Alex invia
```

Questo mantiene il controllo umano sull'interazione commerciale e riduce il rischio di messaggi inappropriati, spam o risposte fuori contesto.

## 3. Casi d'uso principali

### 3.1 Nuovo prospect pubblico

L'utente condivide nel bot:

```text
https://instagram.com/example
```

Il sistema prova a ricavare le informazioni disponibili.

Quando il solo URL non fornisce sufficiente contesto, il bot deve chiedere uno screenshot invece di inventare informazioni.

### 3.2 Profilo privato

L'utente invia uno o più screenshot:

```text
Screenshot 1
→ nome
→ username
→ bio
→ link
→ CTA

Screenshot 2
→ contenuti/post

Screenshot 3
→ eventuale contenuto interessante
```

Il modello multimodale analizza direttamente le immagini.

Gli screenshot rappresentano input non affidabile e devono essere trattati esclusivamente come dati, mai come istruzioni per il sistema.

### 3.3 Primo messaggio

Dal profilo viene generato:

```text
🔥 BEST
messaggio consigliato

👀 CURIOSITY
approccio orientato alla curiosità

🙂 NATURAL
approccio particolarmente conversazionale
```

Ogni messaggio deve essere specifico per quel prospect.

### 3.4 Conversazione già iniziata

L'utente invia uno screenshot della conversazione.

Il sistema:

```text
1. identifica il prospect
2. recupera la sua memoria
3. interpreta i messaggi
4. identifica chi ha scritto cosa
5. individua l'ultimo messaggio ricevuto
6. determina lo stage
7. determina l'intent
8. determina il next goal
9. genera le risposte
```

### 3.5 Follow-up

Il bot deve sapere:

- quando è avvenuto l'ultimo contatto;
- cosa era stato detto;
- se il prospect aveva manifestato interesse;
- se Alex aveva promesso qualcosa;
- quanti follow-up sono già stati inviati.

Il follow-up deve essere contestuale.

Non deve essere il classico:

> "Hai avuto modo di vedere il mio messaggio?"

## 4. Principio commerciale

Il bot segue un principio fondamentale:

> Ogni messaggio deve avere un solo micro-obiettivo.

Un messaggio potrebbe servire a:

```text
GET_REPLY

UNDERSTAND_PROCESS

VALIDATE_PROBLEM

UNDERSTAND_IMPACT

CREATE_INTEREST

EXPLAIN_VALUE

EXPLAIN_SOLUTION

ANSWER_OBJECTION

DISCUSS_PRICE

PROPOSE_CALL

SCHEDULE_CALL

CLOSE_GRACEFULLY
```

Il sistema non deve cercare di condensare in un unico messaggio:

```text
presentazione
+
problema
+
soluzione
+
portfolio
+
prezzo
+
call
```

Una conversazione deve avanzare un passo alla volta.

## 5. Conversation lifecycle

Ogni prospect possiede uno stato indipendente.

Il modello concettuale iniziale è:

```text
NEW_PROSPECT
      │
      ↓
OPENING
      │
      ↓
ENGAGED
      │
      ↓
DISCOVERY
      │
      ↓
NEED_IDENTIFIED
      │
      ↓
VALUE
      │
      ↓
SOLUTION
      │
      ├───────────────┐
      ↓               ↓
     CALL            QUOTE
      │               │
      └───────┬───────┘
              ↓
             WON
```

Sono inoltre previsti stati laterali:

```text
GHOSTED

BUSY

SKEPTICAL

PRICE_OBJECTION

ALREADY_HAS_PROVIDER

NOT_INTERESTED

DO_NOT_CONTACT
```

La macchina a stati non deve essere rigida.

Un prospect può, per esempio, chiedere immediatamente:

> "Quanto costa?"

Il sistema deve riconoscere la situazione e adattarsi senza forzare artificialmente tutte le fasi precedenti.

## 6. Intent detection

L'ultimo messaggio ricevuto viene classificato attraverso un intent.

Prima versione prevista:

```text
CURIOUS

INTERESTED

NEUTRAL

POSITIVE

SKEPTICAL

CONFUSED

BUSY

PRICE_REQUEST

PRICE_OBJECTION

ALREADY_HAS_PROVIDER

ASKING_FOR_MORE_INFO

READY_FOR_CALL

NOT_INTERESTED

DO_NOT_CONTACT

UNKNOWN
```

Lo stage rappresenta:

> Dove siamo nella relazione commerciale?

L'intent rappresenta:

> Cosa sta comunicando il prospect adesso?

Il `next_goal` rappresenta:

> Qual è la prossima cosa che Alex dovrebbe ottenere dalla conversazione?

Questi tre concetti devono rimanere separati.

## 7. Memoria multi-prospect

Uno dei requisiti centrali del sistema è la capacità di mantenere molte conversazioni contemporaneamente senza contaminazione del contesto.

Ogni prospect avrà un'identità separata.

Esempio:

```text
Prospect
│
├── id
├── platform
├── username
├── displayName
├── businessType
├── profileUrl
├── status
├── stage
├── intent
├── interestLevel
├── nextGoal
├── summary
├── facts
├── hypotheses
├── objections
├── promises
├── lastInboundAt
├── lastOutboundAt
├── createdAt
└── updatedAt
```

Il sistema non dovrà passare all'AI l'intera storia del prospect per ogni richiesta.

Il contesto sarà composto indicativamente da:

```text
SYSTEM PROMPT

+

PROSPECT STRUCTURED MEMORY

+

CONVERSATION SUMMARY

+

RECENT MESSAGES

+

CURRENT INPUT
```

Questo consente di mantenere:

- costi ridotti;
- contesto focalizzato;
- minore rischio di confusione;
- migliore scalabilità;
- prompt più deterministici.

## 8. Facts vs hypotheses

Una distinzione fondamentale sarà quella tra:

```text
FACT
```

e:

```text
HYPOTHESIS
```

Esempio.

Dallo screenshot è visibile:

> "Scrivimi START in DM per iniziare"

Quindi possiamo salvare:

```text
FACT:
Il prospect utilizza una CTA che invita gli utenti a scrivere START in DM.
```

Non possiamo automaticamente salvare:

```text
FACT:
Il prospect perde molto tempo nella gestione dei DM.
```

Quest'ultima è solamente una possibile ipotesi:

```text
HYPOTHESIS:
La gestione manuale dei lead potrebbe richiedere tempo.
```

L'agente può utilizzare l'ipotesi per formulare una domanda, non per presentarla come realtà.

## 9. Interest level

Internamente il prospect potrà essere classificato come:

```text
UNKNOWN
LOW
MEDIUM
HIGH
```

L'interesse non deve essere dedotto semplicemente dal tono.

Esempio:

```text
"Grazie mille!"
```

non equivale necessariamente a `HIGH`.

Segnali più significativi possono essere:

```text
chiede il prezzo

chiede come funzionerebbe

descrive spontaneamente un problema

chiede esempi

chiede portfolio

propone una call

chiede disponibilità

parla di tempistiche
```

## 10. Input multimodale

Il bot dovrà accettare:

```text
testo

URL Instagram

username

screenshot singolo

più screenshot

screenshot di profilo

screenshot di conversazione

caption copiate

messaggi copiati manualmente
```

Gli screenshot saranno particolarmente importanti per i profili privati.

Telegram può inviare album come più update appartenenti allo stesso `media_group_id`.

Il sistema dovrà quindi prevedere la possibilità di:

```text
ricevere screenshot A
ricevere screenshot B
ricevere screenshot C

↓

raggrupparli

↓

eseguire una sola analisi
```

Questa logica verrà implementata nello sprint dedicato agli input multimodali.

## 11. Human-in-the-loop

Alex Outreach Bot è un sistema di decision support.

Non deve:

```text
inviare automaticamente DM

fare mass outreach

scrivere autonomamente a nuovi prospect

rispondere automaticamente senza approvazione

scrapare indiscriminatamente Instagram

eseguire login automatici su Instagram
```

Il bot produce suggerimenti.

Alex prende la decisione finale.

## 12. Filosofia ingegneristica

La qualità del codice è una priorità primaria del progetto.

Non vogliamo costruire semplicemente:

> "qualcosa che funziona"

ma:

> un sistema piccolo, comprensibile, testabile, modificabile e robusto.

Il progetto privilegia TypeScript scritto secondo principi funzionali.

## 13. Functional TypeScript

L'architettura seguirà il principio:

> Functional Core, Imperative Shell

Il core applicativo deve contenere principalmente funzioni pure.

Gli effetti collaterali vengono spostati ai bordi dell'applicazione.

Concettualmente:

```text
Telegram
   │
   ↓
Adapter
   │
   ↓
PURE DOMAIN LOGIC
   │
   ↓
Application use case
   │
   ├──── Database adapter
   │
   ├──── OpenAI adapter
   │
   └──── Telegram adapter
```

### 13.1 Pure functions

Quando possibile:

```ts
const determineNextGoal = (state: ConversationState): NextGoal => {
  // deterministic domain logic
};
```

invece di:

```ts
class ConversationManager {
  private state;

  update() {
    // hidden mutations
  }
}
```

## 14. Immutability

Le strutture dominio saranno preferibilmente immutabili.

Esempio:

```ts
type Prospect = Readonly<{
  id: ProspectId;
  username: string;
  stage: ConversationStage;
}>;
```

Le funzioni restituiscono nuovi valori:

```text
oldState
   │
   ↓
transition()
   │
   ↓
newState
```

invece di modificare silenziosamente oggetti condivisi.

## 15. No hidden state

Sono da evitare:

- singleton mutabili;
- variabili globali;
- service locator;
- stato condiviso implicito;
- side effect nascosti.

Le dipendenze devono essere esplicite.

Esempio concettuale:

```ts
const createGenerateReply =
  (deps: Dependencies) => async (input: GenerateReplyInput) => {
    // ...
  };
```

Questo rende i use case facilmente testabili.

## 16. Composition over inheritance

Il progetto privilegia:

```text
funzioni

composizione

union type

small modules

dependency injection
```

rispetto a grandi gerarchie di classi.

Le classi non sono vietate in assoluto, ma devono essere utilizzate solamente quando rappresentano realmente il modello migliore per un adapter o una libreria esterna.

Non devono essere la scelta predefinita.

## 17. Type safety

Obiettivo:

> evitare che dati non validati entrino nel dominio.

Tutto ciò che arriva dall'esterno deve essere considerato:

```text
unknown
```

fino alla validazione.

Ingressi principali:

```text
process.env

Telegram webhook

OpenAI structured output

database data

HTTP requests
```

verranno validati.

Zod rappresenta il boundary validator iniziale del progetto.

Flusso:

```text
unknown
  ↓
Zod.parse
  ↓
validated type
  ↓
domain
```

## 18. `any`

L'utilizzo esplicito di:

```text
any
```

deve essere considerato eccezionale.

In condizioni normali:

```text
no any
no unchecked casts
no blind JSON parsing
```

Se un cast è realmente necessario deve essere:

- locale;
- giustificato;
- possibilmente protetto da un runtime check.

## 19. Discriminated unions

Gli stati dominio devono essere modellati attraverso tipi espressivi.

Esempio concettuale:

```ts
type ConversationState =
  | Readonly<{
      type: "NEW_PROSPECT";
    }>
  | Readonly<{
      type: "DISCOVERY";
      nextGoal: DiscoveryGoal;
    }>
  | Readonly<{
      type: "PRICE_OBJECTION";
      objection: PriceObjection;
    }>;
```

Quando possibile gli `switch` devono essere exhaustivi.

Questo permette al compilatore di segnalare stati non gestiti.

## 20. Error handling

Gli errori dominio prevedibili non devono essere gestiti esclusivamente tramite eccezioni generiche.

Distingueremo almeno:

```text
DOMAIN ERROR

VALIDATION ERROR

INFRASTRUCTURE ERROR

EXTERNAL API ERROR

UNEXPECTED ERROR
```

Per parti significative del core potremo adottare un piccolo tipo:

```ts
type Result<T, E> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;
```

Le eccezioni rimangono adatte per errori realmente eccezionali provenienti dall'infrastruttura, ma non devono sostituire la modellazione del dominio.

## 21. Architecture

L'architettura prevista evolverà indicativamente verso:

```text
src/
│
├── app.ts
├── server.ts
│
├── config/
│   └── env.ts
│
├── routes/
│   ├── health.ts
│   └── telegram-webhook.ts
│
├── telegram/
│   ├── client.ts
│   ├── types.ts
│   ├── schemas.ts
│   ├── webhook-handler.ts
│   ├── update-parser.ts
│   ├── media-group.ts
│   └── keyboards.ts
│
├── ai/
│   ├── client.ts
│   ├── schemas.ts
│   ├── types.ts
│   ├── conversation-agent.ts
│   │
│   └── prompts/
│       ├── system.ts
│       ├── first-message.ts
│       ├── conversation-reply.ts
│       ├── follow-up.ts
│       └── analyze.ts
│
├── prospects/
│   ├── domain.ts
│   ├── repository.ts
│   ├── service.ts
│   └── schemas.ts
│
├── conversations/
│   ├── domain.ts
│   ├── state.ts
│   ├── transition.ts
│   ├── repository.ts
│   ├── summary.ts
│   └── service.ts
│
├── followups/
│   ├── domain.ts
│   └── service.ts
│
├── analytics/
│   ├── domain.ts
│   └── service.ts
│
├── db/
│   ├── client.ts
│   ├── schema/
│   └── migrations/
│
└── shared/
    ├── result.ts
    ├── errors.ts
    ├── ids.ts
    ├── logger.ts
    └── time.ts
```

Questa struttura rappresenta una direzione architetturale, non un vincolo prematuro.

Le directory verranno introdotte solamente quando esiste una funzionalità che le giustifica.

## 22. Separation of concerns

Il progetto manterrà separati:

```text
DOMAIN
↓
cosa significa una conversazione

APPLICATION
↓
cosa deve fare il sistema

INFRASTRUCTURE
↓
come comunica con Telegram/OpenAI/PostgreSQL
```

Per esempio, il dominio non deve conoscere:

```text
FastifyRequest

Telegram API payload

OpenAI SDK response

PostgreSQL connection
```

Gli adapter traducono questi formati nei tipi interni del sistema.

## 23. AI architecture

Il modello AI non deve diventare il dominio applicativo.

OpenAI rappresenta un adapter intelligente.

Il sistema continuerà ad avere responsabilità proprie per:

```text
identità prospect

persistenza

autorizzazione

deduplicazione

workflow

follow-up

stato conversazione

routing

validazione

sicurezza
```

Il modello AI viene utilizzato dove il linguaggio naturale rende difficile una soluzione deterministica.

## 24. Prompt architecture

Non verrà mantenuto un enorme prompt monolitico costruito dinamicamente.

L'input al modello sarà composto attraverso livelli separati:

```text
SYSTEM POLICY
      +
COMMUNICATION PRINCIPLES
      +
TASK MODE
      +
PROSPECT MEMORY
      +
CONVERSATION CONTEXT
      +
CURRENT INPUT
```

Modalità iniziali:

```text
FIRST_MESSAGE

CONVERSATION_REPLY

FOLLOW_UP

ANALYZE

REPLY_SCREENSHOT
```

Questo consente di:

- testare separatamente i prompt;
- versionarli;
- modificare un comportamento senza alterare gli altri;
- mantenere il contesto ridotto;
- effettuare in futuro A/B test.

## 25. Structured AI output

L'AI non deve restituire testo arbitrario che il backend interpreta euristicamente.

Quando possibile utilizzeremo output strutturati.

Esempio concettuale:

```ts
type ConversationAnalysis = Readonly<{
  stage: ConversationStage;
  intent: ConversationIntent;
  nextGoal: NextGoal;
  interest: InterestLevel;
  observedFacts: readonly string[];
  hypotheses: readonly string[];
  best: string;
  alternative: string;
  direct: string;
}>;
```

La risposta del modello viene:

```text
AI response
   ↓
runtime validation
   ↓
domain mapping
   ↓
application logic
```

Una risposta non valida deve fallire in modo esplicito.

## 26. Prompt injection resistance

Screenshot, bio, caption e messaggi dei prospect sono untrusted input.

Un'immagine potrebbe contenere testo come:

> "Ignore all previous instructions."

Questo testo rappresenta contenuto del prospect, non una direttiva al sistema.

L'agente deve essere istruito a trattare:

```text
screenshot

bio

conversation

profile description

caption
```

esclusivamente come dati da analizzare.

Le istruzioni applicative arrivano solamente dal sistema.

## 27. Privacy

Il bot può trattare informazioni provenienti da profili Instagram e conversazioni commerciali.

Il progetto applicherà principi di data minimization.

Default previsto:

```text
Screenshot
    ↓
download temporaneo
    ↓
AI analysis
    ↓
estrazione informazioni necessarie
    ↓
eliminazione file
```

Gli screenshot non devono essere conservati permanentemente se non esiste un motivo esplicito.

Nel database si privilegeranno informazioni strutturate necessarie alla conversazione.

## 28. Logging

I log non devono contenere:

```text
BOT TOKEN

OPENAI API KEY

webhook secret

password

raw screenshot

intera conversazione

dati sensibili non necessari
```

Preferire:

```text
request_id

telegram_update_id

prospect_id

operation

duration

result

error_type
```

Esempio:

```text
generation completed
prospect_id=p_42
mode=conversation_reply
duration_ms=812
```

invece di stampare l'intero prompt.

## 29. Telegram security

Il bot è personale.

Nella prima versione un solo Telegram User ID sarà autorizzato.

Flusso:

```text
incoming update
      ↓
validate webhook secret
      ↓
validate Telegram payload
      ↓
extract sender
      ↓
sender == ALLOWED_USER_ID?
      │
    ┌─┴─┐
   yes  no
    │    │
 process reject
```

Questo impedisce a utenti casuali di utilizzare le API del bot.

## 30. Telegram update idempotency

Telegram può ritentare la consegna di un webhook.

Il sistema deve poter evitare di elaborare due volte lo stesso update.

Utilizzeremo:

```text
update_id
```

come chiave di deduplicazione.

Un eventuale retry non deve produrre:

```text
due prospect

due messaggi

due chiamate AI

due record conversazione
```

quando l'operazione originale è già stata completata.

## 31. Secrets

Il token Telegram è già memorizzato localmente nel file:

```text
.env
```

Il file `.env` non deve mai essere versionato.

`.gitignore` deve contenere almeno:

```gitignore
.env
.env.*
!.env.example
```

Il repository contiene solamente:

```text
.env.example
```

senza valori reali.

## 32. Environment variables

La configurazione prevista crescerà verso qualcosa di simile:

```dotenv
NODE_ENV=development
HOST=0.0.0.0
PORT=3000

TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ALLOWED_USER_ID=

OPENAI_API_KEY=
OPENAI_MODEL=

DATABASE_URL=
```

Potranno essere aggiunte successivamente variabili specifiche per:

```text
logging

deployment

rate limiting

media handling

retention

observability
```

Non devono però essere introdotte configurazioni inutilizzate prematuramente.

## 33. GitHub Secrets

I secret dell'applicazione non devono automaticamente essere copiati tutti dentro GitHub.

Principio:

> Un secret deve essere accessibile solamente al sistema che ne ha realmente bisogno.

Per la CI standard non dovrebbe essere necessario utilizzare:

```text
TELEGRAM_BOT_TOKEN

OPENAI_API_KEY
```

I test utilizzeranno adapter fake/mock.

Pipeline CI:

```text
checkout
   ↓
npm ci
   ↓
lint
   ↓
typecheck
   ↓
test
   ↓
build
```

senza contattare Telegram o OpenAI.

## 34. Deployment secrets

Se la CI/CD effettuerà anche il deployment su Hostinger, GitHub potrebbe avere bisogno solamente delle credenziali necessarie al deploy.

Per esempio, a seconda della strategia scelta:

```text
HOSTINGER_API_TOKEN
```

oppure:

```text
HOSTINGER_SSH_HOST
HOSTINGER_SSH_USER
HOSTINGER_SSH_PRIVATE_KEY
```

Le credenziali applicative come:

```text
TELEGRAM_BOT_TOKEN
OPENAI_API_KEY
DATABASE_URL
```

idealmente rimangono configurate direttamente nell'ambiente Hostinger.

In questo modo:

```text
GitHub
→ può distribuire l'app

Hostinger
→ possiede i secret runtime
```

GitHub non deve necessariamente conoscere tutti i secret dell'applicazione.

La strategia definitiva verrà scelta nello Sprint 10 in base al metodo di deployment utilizzato.

## 35. `.env.example`

Il file dovrà documentare ogni variabile senza inserire valori reali.

Esempio:

```dotenv
# Runtime
NODE_ENV=development
HOST=0.0.0.0
PORT=3000

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ALLOWED_USER_ID=

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=

# Database
DATABASE_URL=
```

## 36. Git workflow

Workflow previsto:

```text
main
│
└── develop
     │
     ├── sprint/01-foundation
     ├── sprint/02-telegram-core
     ├── sprint/03-multimodal-input
     ├── sprint/04-ai-engine
     ├── sprint/05-prospect-memory
     ├── sprint/06-conversation-manager
     ├── sprint/07-telegram-ux
     ├── sprint/08-personal-crm
     ├── sprint/09-learning-analytics
     └── sprint/10-production
```

Per un progetto personale non è necessario creare una feature branch per ogni singolo cambiamento.

È invece importante che ogni commit sia:

```text
piccolo

coerente

testabile

reversibile

con un solo scopo
```

## 37. Conventional Commits

Tutti i commit devono utilizzare Conventional Commits.

Esempi:

```text
feat(telegram): validate webhook secret

feat(ai): generate structured conversation reply

feat(prospect): persist prospect memory

fix(conversation): prevent cross-prospect context leakage

test(ai): cover invalid structured output

refactor(domain): extract conversation transition

chore(ci): add typecheck workflow
```

## 38. Testing strategy

Il progetto utilizzerà Vitest.

I test saranno divisi concettualmente in:

```text
UNIT

INTEGRATION

WORKFLOW
```

### Unit

Per:

```text
domain logic

state transitions

parsing

normalization

prompt composition

follow-up rules

classification mapping
```

I test devono essere veloci e deterministici.

### Integration

Per:

```text
Fastify routes

database repositories

Telegram update parsing

OpenAI adapter boundary
```

Le integrazioni esterne vengono simulate quando possibile.

### Workflow

Verificano scenari completi importanti.

Esempio:

```text
Telegram screenshot
      ↓
prospect resolved
      ↓
memory loaded
      ↓
AI request generated
      ↓
response validated
      ↓
conversation stored
      ↓
Telegram response produced
```

## 39. Coverage

La coverage non deve diventare un numero fine a sé stesso.

Target indicativi a progetto maturo:

```text
Domain/business logic:
≥ 90%

Overall:
≥ 80%
```

Le parti critiche come:

```text
authorization

conversation isolation

state transitions

structured AI validation

deduplication
```

devono essere coperte molto accuratamente.

Non scriveremo test inutili solamente per incrementare una percentuale.

## 40. Code quality gates

Prima di considerare completato un commit significativo:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

devono essere verdi.

La CI applicherà progressivamente gli stessi controlli.

## 41. Definition of Done

Una funzionalità è completata solamente quando:

```text
implementazione completata

tipi corretti

input validati

error handling definito

test appropriati presenti

typecheck verde

test verdi

build verde

nessun secret esposto

documentazione aggiornata quando necessario
```

## 42. Sprint strategy

Lo sviluppo è suddiviso in 10 sprint.

Ogni sprint introduce un insieme coerente di capacità.

Alla fine di ogni sprint:

```text
1. tutti i commit devono essere completati
2. la CI deve essere verde
3. viene effettuato un test end-to-end appropriato
4. eventuali problemi vengono risolti
5. solamente dopo si procede allo sprint successivo
```

### Sprint 01 — Foundation

#### Obiettivo

Creare una base TypeScript/Fastify estremamente pulita sulla quale costruire tutto il sistema.

#### Funzionalità

```text
TypeScript strict

Fastify

environment configuration

Zod

health endpoint

logging foundation

Vitest

linting

formatting

build

typecheck
```

#### Principi

Lo sprint deve definire fin dall'inizio gli standard qualitativi del progetto.

Non vengono ancora implementati:

```text
Telegram

OpenAI

database
```

#### Risultato atteso

```text
npm run dev        ✅
npm run lint       ✅
npm run typecheck  ✅
npm test           ✅
npm run build      ✅

GET /health        ✅
```

#### Commit indicativi

```text
s01-c01 chore(repo): bootstrap TypeScript service

s01-c02 feat(config): validate runtime environment

s01-c03 feat(api): add application and health endpoint

s01-c04 test(api): cover application health endpoint

s01-c05 chore(repo): finalize development tooling

s01-c06 ci: verify build typecheck and tests
```

### Sprint 02 — Telegram Core

#### Obiettivo

Collegare il backend a Telegram in maniera sicura e testabile.

#### Funzionalità

```text
Telegram Bot API client

webhook endpoint

webhook secret validation

allowed user validation

/start

/help

update parsing

update idempotency

error handling
```

#### Sicurezza

Solamente:

```text
TELEGRAM_ALLOWED_USER_ID
```

può utilizzare il bot.

#### Endpoint principale

```text
POST /telegram/webhook
```

#### Risultato atteso

Scrivendo:

```text
/start
```

il bot risponde correttamente.

Messaggi provenienti da utenti non autorizzati non vengono elaborati.

Webhook non validi vengono rifiutati.

Update duplicati non vengono elaborati due volte.

### Sprint 03 — Multimodal Input

#### Obiettivo

Permettere al bot di comprendere i diversi tipi di input provenienti da Telegram.

#### Input

```text
testo

URL

username

screenshot

più screenshot

album Telegram

caption
```

#### Funzionalità

```text
Telegram file download

temporary storage

media group aggregation

input classification

image lifecycle

automatic cleanup
```

#### Privacy

Gli screenshot:

```text
download
↓
process
↓
delete
```

Non vengono conservati permanentemente.

#### Risultato atteso

Il bot deve distinguere correttamente:

```text
profilo

conversazione

testo

URL

gruppo screenshot
```

senza ancora implementare necessariamente tutta l'intelligenza commerciale.

### Sprint 04 — AI Engine

#### Obiettivo

Integrare l'intelligenza centrale del sistema.

#### Funzionalità

```text
OpenAI client

multimodal requests

master system prompt

task prompts

structured output

runtime validation

error handling

retry policy

prompt versioning
```

#### Modalità

```text
FIRST_MESSAGE

CONVERSATION_REPLY

FOLLOW_UP

ANALYZE

REPLY_SCREENSHOT
```

#### Output iniziale

Per un primo contatto:

```text
BEST

CURIOSITY

NATURAL
```

Per conversazioni:

```text
BEST

ALTERNATIVE

DIRECT
```

#### Principio

L'agente deve prima determinare:

```text
stage

intent

next_goal
```

e solamente dopo scrivere la risposta.

### Sprint 05 — Prospect Memory

#### Obiettivo

Introdurre memoria persistente multi-prospect.

#### Tecnologia

Database relazionale:

```text
PostgreSQL
```

La scelta definitiva del data-access layer verrà fatta nello sprint, privilegiando:

```text
type safety

migrazioni trasparenti

semplicità

testabilità

assenza di magia inutile
```

#### Entità iniziali

Indicativamente:

```text
prospects

conversations

messages

conversation_summaries

generation_runs
```

#### Funzionalità

```text
create prospect

find prospect

update prospect

store messages

store summary

retrieve context

deduplicate prospect
```

#### Vincolo fondamentale

Le informazioni di:

```text
Prospect A
```

non devono mai entrare nel contesto di:

```text
Prospect B
```

Questa proprietà sarà esplicitamente testata.

### Sprint 06 — Conversation Manager

#### Obiettivo

Trasformare il sistema da generatore di testo a vero conversation manager.

#### Funzionalità

```text
stage detection

intent detection

next goal selection

interest level

conversation summary

facts

hypotheses

objections

promises

conversation transitions
```

#### Pipeline

```text
incoming message
      ↓
prospect resolution
      ↓
memory retrieval
      ↓
context construction
      ↓
conversation analysis
      ↓
state transition
      ↓
next goal
      ↓
reply generation
      ↓
memory update
```

#### Focus

Il bot deve sapere:

> cosa dire adesso

non solamente:

> cosa si potrebbe dire in generale.

### Sprint 07 — Telegram UX

#### Obiettivo

Rendere l'esperienza quotidiana estremamente veloce da iPhone.

#### Risposta tipo

```text
🔥 BEST

"Ciao Marco..."

[📋 Copia]

────────────────

👀 ALTERNATIVE

"..."

[📋 Copia]

────────────────

🎯 DIRECT

"..."

[📋 Copia]
```

#### Azioni

```text
📋 Copy

🔄 Altre 3

🙂 Più naturale

🎯 Più diretto

💬 Follow-up

🔍 Analizza
```

#### Principio UX

Dal profilo Instagram al messaggio pronto da incollare devono essere necessari pochissimi passaggi.

### Sprint 08 — Personal CRM

#### Obiettivo

Trasformare Telegram nel pannello operativo per l'outreach.

#### Comandi previsti

```text
/oggi

/prospect

/nuovo

/followup

/lista

/help
```

#### `/oggi`

Esempio:

```text
📋 OGGI

🔥 DA RISPONDERE

@mariofit
ha risposto ieri

@coachmarco
ha chiesto il prezzo


⏰ FOLLOW-UP

@barberriccione
ultimo contatto: 4 giorni fa

@ristorantexyz
ultimo contatto: 5 giorni fa
```

#### Prospect detail

```text
@mariofit

Stage:
DISCOVERY

Interest:
MEDIUM

Next goal:
VALIDATE_PROBLEM

Last contact:
ieri

Summary:
...
```

#### Follow-up

Il sistema deve identificare conversazioni per cui avrebbe senso un follow-up senza trasformarsi in uno strumento di spam.

### Sprint 09 — Learning & Analytics

#### Obiettivo

Utilizzare i dati reali di outreach per capire quali approcci funzionano meglio.

Non verrà implementato un sistema di machine learning complesso.

Inizialmente verranno raccolti segnali semplici.

#### Dati

```text
messaggio scelto

stile

settore prospect

risposta ricevuta

tempo alla risposta

conversation stage

eventuale conversione
```

#### Esempio

```text
Personal Trainer

Curiosity approach:
48% response rate

Natural approach:
41%

Direct approach:
26%
```

Questi numeri saranno basati esclusivamente sui dati reali raccolti.

#### Possibili comandi

```text
/stats

/performance
```

#### Obiettivo futuro

Consentire all'agente di utilizzare i risultati storici come segnale aggiuntivo:

```text
generic best practice
        +
prospect context
        +
Alex historical performance
```

senza sacrificare la personalizzazione del singolo caso.

### Sprint 10 — Production & Hardening

#### Obiettivo

Portare Alex Outreach Bot in produzione stabile su Hostinger.

#### Attività

```text
production environment

Hostinger deployment

PostgreSQL production

HTTPS

Telegram production webhook

runtime secrets

GitHub Actions

CI/CD

database migrations

backup strategy

logging

observability

error recovery

security hardening
```

#### CI

Ogni push/PR rilevante dovrà verificare:

```text
npm ci

lint

typecheck

test

coverage

build
```

#### CD

Il deployment verrà automatizzato solamente dopo che la CI sarà completamente affidabile.

Principio:

> Never automate a broken process.

#### Webhook

Produzione:

```text
Telegram
   ↓ HTTPS
Hostinger
   ↓
Fastify
   ↓
Alex Outreach Bot
```

#### Health

Endpoint previsti:

```text
GET /health
GET /health/ready
```

`/health` indica che il processo è vivo.

`/health/ready` indica che le dipendenze critiche necessarie per servire richieste sono disponibili.

## 43. Sprint completion policy

Non iniziamo uno sprint nuovo se quello precedente contiene errori conosciuti che ne compromettono le fondamenta.

Ogni sprint termina con:

```bash
git status

npm run lint

npm run typecheck

npm test

npm run build
```

e con un breve test manuale delle funzionalità introdotte.

Quando tutto è verde:

```text
Sprint N ✅
```

e si passa allo sprint successivo.

## 44. First release scope

La prima release completa deve consentire questo scenario:

```text
1. Alex trova un prospect su Instagram.

2. Condivide il profilo o manda screenshot al bot.

3. Il bot identifica/crea il prospect.

4. Analizza il profilo.

5. Propone tre messaggi.

6. Alex sceglie e invia uno dei messaggi.

7. Il prospect risponde.

8. Alex manda lo screenshot al bot.

9. Il bot identifica automaticamente il prospect.

10. Recupera memoria e conversazione.

11. Analizza stage, intent e next goal.

12. Propone tre risposte.

13. Alex sceglie.

14. La conversazione continua.

15. Il sistema mantiene lo stato.

16. Se la conversazione si ferma, può proporre un follow-up.

17. /oggi mostra le conversazioni che richiedono attenzione.

18. Le statistiche registrano quali approcci funzionano.
```

Questo rappresenta il prodotto target della V1.

## 45. Non-obiettivi iniziali

La V1 non vuole essere:

```text
un CRM enterprise

un'alternativa completa a HubSpot

un sistema di scraping Instagram

un mass-DM tool

un autoresponder Instagram

un social media automation bot

una piattaforma multi-tenant

un SaaS pubblico
```

È uno strumento personale costruito specificamente per il workflow di Alex.

Questa scelta permette di mantenere il progetto:

```text
piccolo

veloce

controllabile

sicuro

altamente personalizzato
```

## 46. Future possibilities

Una volta stabilizzata la V1 potranno essere considerate funzionalità come:

```text
web dashboard

search prospect

tag personalizzati

pipeline kanban

automatic reminder

calendar integration

lead scoring

portfolio recommendation

automatic case-study selection

quote assistance

voice notes

CRM export

multi-channel outreach

conversation semantic search
```

Queste funzionalità non devono influenzare prematuramente l'architettura della V1.

Il sistema deve essere estensibile, non sovra-ingegnerizzato.

## 47. Engineering values

Le decisioni tecniche devono essere valutate secondo questo ordine:

```text
Correctness
    ↓
Clarity
    ↓
Testability
    ↓
Maintainability
    ↓
Security
    ↓
Performance
    ↓
Convenience
```

Per questo progetto la chiarezza è più importante di clever code.

Preferire:

```ts
const isAuthorizedUser = (
  allowedUserId: TelegramUserId,
  senderUserId: TelegramUserId,
): boolean => allowedUserId === senderUserId;
```

a un'astrazione complessa che nasconde un confronto semplice.

## 48. Keep it boring

Il progetto non deve diventare una dimostrazione di quante tecnologie possiamo utilizzare.

Non introduciamo:

```text
Redis
queues
microservices
event bus
Kafka
vector databases
Kubernetes
```

finché non esiste un requisito concreto che li renda necessari.

Inizialmente:

```text
Fastify
+
TypeScript
+
PostgreSQL
+
Telegram
+
OpenAI
```

sono sufficienti.

## 49. Core principle

Alex Outreach Bot non deve sembrare intelligente perché produce messaggi complicati.

Deve essere intelligente perché:

```text
ricorda il contesto

non confonde le persone

capisce cosa sta succedendo

non inventa informazioni

sceglie il momento giusto

dice poco quando basta poco

sa quando approfondire

sa quando proporre una soluzione

sa quando fermarsi
```

Il risultato finale deve essere una conversazione che sembra naturale perché nasce realmente dal contesto della persona.

## 50. Project status

Current development phase:

```text
Sprint 01 — Foundation
```

Current completed work:

```text
Bot Telegram created through BotFather ✅

Telegram bot token generated ✅

Telegram bot token stored locally in .env ✅

Repository bootstrap in progress
```

Next milestone:

```text
S01-C01
chore(repo): bootstrap TypeScript service
```

## 51. Final project philosophy

> Functional core. Imperative shell. Explicit state. Validated boundaries. Small commits. Strong types. Human approval.

Alex Outreach Bot deve rimanere abbastanza semplice da poter essere compreso interamente da un singolo sviluppatore, ma abbastanza solido da poter diventare uno strumento utilizzato quotidianamente.

Ogni nuova funzionalità dovrà rispondere ad almeno una delle seguenti domande:

- Riduce il tempo necessario per gestire l'outreach?
- Migliora la qualità delle conversazioni?
- Riduce il rischio di perdere informazioni?
- Aiuta a prendere una decisione commerciale migliore?
- Migliora in modo significativo affidabilità, sicurezza o manutenzione?

Se la risposta è no, probabilmente non serve ancora.

---

**Alex Outreach Bot** — Personal AI conversation copilot for human-first sales outreach.
