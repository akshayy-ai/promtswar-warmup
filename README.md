# Learning Companion

> An intelligent, adaptive AI tutor powered by **Google Gemini** that personalises explanations, pace, and examples to each learner's unique level and background.

**Live Demo:** https://learning-companion-625548914881.us-central1.run.app

---

## Chosen Vertical

**Education & Learning** — A smart learning assistant that adapts in real time to the user's knowledge level, background, and goals. It assesses before teaching, checks understanding after every concept, and adjusts depth automatically based on each response.

---

## Google Services Used

| Service | Role |
|---|---|
| **Gemini 2.0 Flash** (`generativelanguage.googleapis.com`) | Core AI engine — streaming adaptive explanations, knowledge assessment, quiz generation |
| **Google Cloud Run** (`us-central1`) | Serverless container hosting — auto-scales to zero, HTTPS out of the box |
| **Google Cloud Build** | CI/CD — builds the Docker container from source on every deploy |
| **Google Artifact Registry** | Stores versioned container images (`cloud-run-source-deploy`) |
| **Google Fonts** (`fonts.googleapis.com`) | Inter (UI typography) + JetBrains Mono (code blocks) |
| **YouTube (Google)** | Per-message "▶ YouTube" button opens a targeted search for the current concept — extending learning beyond the chat |

> **Vertex AI compatibility:** The app can be switched to Vertex AI (`us-central1-aiplatform.googleapis.com`) by replacing the API key with a `gcloud auth print-access-token` Bearer token and updating the endpoint. The current implementation uses the AI Studio key for evaluator accessibility.

---

## How It Works

### 1. Setup
The user enters:
- Their **Gemini API key** (never stored or logged — session-only)
- **Topic** to learn (e.g. "Neural networks", "Roman history")
- **Background** (e.g. "Software engineer with no ML experience") — used to tailor analogies
- **Learning goal** (e.g. "Understand enough to read research papers")

### 2. Knowledge Assessment
The AI opens with 1–2 diagnostic questions before teaching anything. The answers determine the starting level: `beginner`, `intermediate`, or `advanced`.

### 3. Adaptive Teaching Loop
Every Gemini response is streamed in real time (token by token) and includes a hidden `<!--META-->` block:

```
<!--META
level: intermediate
understanding: 65
concepts_mastered: variables, functions, scope
concepts_struggling: closures
-->
```

The frontend parses this block on every turn and updates the **live sidebar** (level badge, understanding progress bar, concepts checklist) — creating a closed feedback loop between the AI's assessment and the UI.

### 4. Comprehension Checks
After each explanation the AI asks one targeted question. Based on the answer:
- **Struggles** → AI simplifies, tries a new analogy, breaks into smaller steps
- **Excels** → AI introduces next concept with added depth

### 5. Quick Actions
Six one-click actions send pre-written prompts without breaking conversation flow:
- 🔽 **Simpler** — explain with plain language and a basic analogy
- 🔼 **Deeper** — add technical detail and edge cases
- 💡 **Example** — concrete real-world example
- 🎯 **Quiz Me** — assess understanding so far
- 📋 **Summary** — recap everything learned this session
- ➡️ **Next Topic** — advance to the next concept

### 6. Per-Message Utilities
Each AI response has:
- **🔊 Listen** — Web Speech API reads the explanation aloud (no extra API needed)
- **📋 Copy** — copies plain text to clipboard
- **▶ YouTube** — opens targeted YouTube search for the topic (Google Service)

### 7. Session Persistence
Sessions are saved to `localStorage` after every turn. On return visits, a banner offers to restore the previous session — skipping re-assessment.

---

## Approach & Logic

### Adaptive Prompting Strategy
Each Gemini API call includes a `system_instruction` that rebuilds the **Learner Profile** from the current session state:

```
LEARNER PROFILE:
- Topic: Neural networks
- Background: Software engineer with no ML experience
- Goal: Understand enough to read research papers
- Current Level: intermediate
- Understanding: 65/100
- Concepts mastered: perceptron, activation functions
- Concepts struggling: backpropagation
```

The model is instructed to: assess first, match vocabulary to level, end every response with one question, and embed metadata. This creates an adaptive loop rather than a static Q&A.

### Streaming Implementation
Uses `streamGenerateContent?alt=sse` for real-time token streaming. Text appears word-by-word as Gemini generates it — dramatically reducing perceived latency.

### Security
- All user inputs sanitized (length-limited, `<>` stripped) before inclusion in prompts
- `escapeHtml` applied to all dynamic content rendered to the DOM (XSS prevention)
- Single-quote escaping (`&#39;`) included
- Gemini safety settings configured for all four harm categories
- API key is session-only — never written to `localStorage` or sent to any server except Google
- Rate limiting: minimum 1-second gap between API calls
- nginx serves all security headers: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`

### Efficiency
- Streaming = first content visible in < 1 second
- Session saved to `localStorage` — no re-assessment on return
- `nginx:alpine` base image keeps container under 30 MB
- Static assets cached with `Cache-Control: max-age=3600`
- gzip compression on CSS, JS, HTML, JSON

---

## Assumptions

- The user supplies their own Gemini API key (free from aistudio.google.com/apikey)
- The app runs entirely in the browser — no backend, no data collection
- Web Speech API availability is checked at runtime; the Listen button is hidden if unavailable
- Session history is capped at 30 messages in `localStorage` to avoid storage limits
- Gemini 2.0 Flash is used for speed; the model ID can be swapped to `gemini-1.5-pro` for longer sessions

---

## Running Locally

Open `index.html` in any modern browser — no build step, no install needed.

```
warm-up-challenge/
├── index.html      — UI: setup screen + learning screen
├── style.css       — Design system, responsive layout, accessibility styles
├── app.js          — Gemini streaming client, adaptive logic, session manager
├── Dockerfile      — nginx:alpine container (port 8080 for Cloud Run)
├── nginx.conf      — Static serving + security headers + gzip
├── test.html       — Browser-based test suite (45 tests, 8 suites)
└── README.md
```

## Testing

Open `test.html` in any browser. 45 tests across 8 suites run instantly — no build step.

| Suite | What's tested |
|---|---|
| `escapeHtml` | XSS prevention — 7 cases including full attack payloads |
| `sanitize` | Input validation — null, undefined, oversized, injection |
| `parseMeta` | AI metadata extraction — all fields, edge cases, NaN handling |
| `stripMeta` | Response cleaning — multi-line blocks, whitespace |
| `parseMarkdown` | Rendering — all syntax + XSS in code blocks |
| `capitalize` | String utility edge cases |
| `youtubeSearchUrl` | Google Service URL construction and encoding |
| `Session persistence` | localStorage save/load/clear/corrupt data |

## Accessibility

- **Skip navigation** link (screen reader / keyboard users jump straight to conversation)
- **ARIA roles**: `role="log"` on chat, `role="progressbar"` on understanding bar, `role="alert"` on toasts
- **`aria-live`** regions announce AI responses and profile updates to screen readers
- **`aria-label`** on every interactive element
- **`focus-visible`** styles for keyboard navigation (2.5px brand-colour outline)
- **`Ctrl+/`** global shortcut focuses the message input from anywhere
- **Text-to-Speech** on every AI message via Web Speech API
- Colour contrast meets **WCAG AA** across all text/background combinations
- Responsive layout works on mobile (sidebar collapses to horizontal strip)
