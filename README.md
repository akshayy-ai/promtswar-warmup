# Learning Companion

An intelligent, adaptive learning assistant powered by **Google Gemini** that personalises content and pacing to each learner's level and background.

## Chosen Vertical

**Education & Learning** — an AI tutor that helps users understand any topic from scratch, adapting in real time to their comprehension.

## How It Works

1. **Setup** — The user enters a topic, their background, and a learning goal (plus their Gemini API key).
2. **Assessment** — The AI opens with 1–2 diagnostic questions to gauge the learner's current knowledge level (beginner / intermediate / advanced).
3. **Adaptive teaching** — Every response is calibrated to the current level. The AI uses plain language and analogies for beginners, technical depth for advanced learners.
4. **Comprehension checks** — After each explanation the AI asks a focused question to verify understanding before moving forward.
5. **Dynamic adjustment** — If the learner struggles, the AI simplifies and tries a different analogy. If they excel, it introduces the next concept with added nuance.
6. **Quick actions** — Buttons let the learner instantly request: simpler explanation, deeper dive, concrete example, a quiz, a session summary, or to advance to the next topic.
7. **Progress sidebar** — Shows the inferred level, understanding score (0–100), and a checklist of mastered concepts — all updated live from AI-embedded metadata.

## Approach & Logic

### Adaptive Prompting
Each API call includes a `system_instruction` with a **Learner Profile** that is rebuilt from the current session state on every turn. The model is instructed to:
- Assess first, teach second
- Match vocabulary and complexity to the current level
- End every response with one question or prompt
- Embed a `<!--META ...-->` block containing updated `level`, `understanding`, `concepts_mastered`, and `concepts_struggling` values

The front end parses this metadata block, updates the in-memory profile, and re-renders the sidebar — creating a feedback loop between the AI's assessment and the UI.

### Conversation Memory
The full conversation history (Gemini `contents` array) is maintained in memory and sent with every request, so the model has complete context of what has been taught and assessed.

### Google Services Used
| Service | How |
|---|---|
| **Gemini 2.0 Flash** (`generativelanguage.googleapis.com`) | Core AI — assessment, adaptive explanations, quiz generation |
| **Google Fonts** (`fonts.googleapis.com`) | Inter (UI) + JetBrains Mono (code blocks) |

## Assumptions

- The user supplies their own Gemini API key (entered at session start, never stored or logged).
- The app runs entirely in the browser — no backend, no data collection.
- Session state (conversation history, profile) lives in memory only; a page refresh starts a new session.
- Gemini 2.0 Flash is sufficient for real-time conversational learning; Gemini 1.5 Pro may be substituted for longer, more complex sessions.

## Live Demo

**https://learning-companion-625548914881.us-central1.run.app**

Deployed on Google Cloud Run via Cloud Build + Artifact Registry.

## Running Locally

Open `index.html` in any modern browser — no build step, no dependencies to install.

```
warm-up-challenge/
├── index.html   # UI shell + accessibility markup
├── style.css    # Design system, responsive layout
├── app.js       # Gemini API client, adaptive logic, markdown renderer
├── Dockerfile   # nginx:alpine container for Cloud Run
├── nginx.conf   # serves on port 8080 (Cloud Run default)
├── test.html    # browser-based test suite (open to run)
└── README.md
```

## Testing

Open `test.html` in any browser to run the full test suite — no build step needed. Tests cover:
- `escapeHtml` — XSS prevention
- `parseMarkdown` — markdown rendering correctness
- `parseMeta` — AI metadata extraction
- `stripMeta` — response cleaning
- Security — script injection neutralisation
- Score bounds — understanding value validation

## Accessibility

- All interactive elements have `aria-label` attributes.
- Live regions (`aria-live`) announce AI responses to screen readers.
- The progress bar uses `role="progressbar"` with `aria-valuenow`.
- Keyboard-only navigation is fully supported (`Enter` to send, `Tab` through actions).
- Colour contrast meets WCAG AA across all text/background pairs.
