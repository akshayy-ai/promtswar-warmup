'use strict';

// ── Gemini API config ──────────────────────────────────────────
const GEMINI_MODEL  = 'gemini-2.0-flash';
const GEMINI_URL    = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Learner profile (updated each turn) ───────────────────────
const profile = {
  topic:       '',
  background:  '',
  goal:        '',
  level:       'unknown',      // beginner | intermediate | advanced
  understanding: 0,            // 0–100
  concepts:    [],             // mastered concepts
  struggling:  [],             // concepts needing reinforcement
  turnCount:   0,
};

// Conversation history sent to Gemini
let history = [];
let apiKey  = '';
let isLoading = false;

// ── DOM refs ───────────────────────────────────────────────────
const screenSetup    = document.getElementById('screen-setup');
const screenLearning = document.getElementById('screen-learning');
const setupForm      = document.getElementById('setup-form');
const chatMessages   = document.getElementById('chat-messages');
const chatForm       = document.getElementById('chat-form');
const userInput      = document.getElementById('user-input');
const sendBtn        = document.getElementById('send-btn');
const progressFill   = document.getElementById('progress-fill');
const progressPct    = document.getElementById('progress-pct');
const sidebarLevel   = document.getElementById('sidebar-level');
const sidebarTopic   = document.getElementById('sidebar-topic');
const conceptsList   = document.getElementById('concepts-list');

// ── System prompt ──────────────────────────────────────────────
function buildSystemPrompt() {
  return `You are an adaptive Learning Companion — a patient, encouraging tutor who personalises every response to the learner's current level, background, and stated goal.

LEARNER PROFILE (update your mental model as the conversation evolves):
- Topic: ${profile.topic}
- Background: ${profile.background || 'not provided'}
- Goal: ${profile.goal || 'general understanding'}
- Current Level: ${profile.level}
- Understanding score: ${profile.understanding}/100
- Concepts mastered: ${profile.concepts.join(', ') || 'none yet'}
- Concepts to reinforce: ${profile.struggling.join(', ') || 'none identified'}

ADAPTIVE BEHAVIOUR RULES:
1. Assess first — for the opening message ask 1–2 diagnostic questions to gauge knowledge before teaching.
2. Match complexity to level: beginner = plain language + analogy; intermediate = technical terms + examples; advanced = depth + edge cases.
3. After each explanation, ask a targeted check question ("Does this make sense?" or a short quiz).
4. If the learner struggles → simplify, use a different analogy, break into smaller steps.
5. If the learner excels → introduce next concept, add nuance, explore edge cases.
6. Always connect new ideas to what the learner already knows (their background).
7. Be warm and encouraging. Never make the learner feel bad for not knowing something.

RESPONSE FORMAT RULES:
- Use markdown: headers (##), bold, bullet lists, code blocks for code.
- Keep responses focused — don't overwhelm. Teach one concept at a time.
- End every teaching response with ONE clear question or prompt to keep the learner engaged.
- After every 3–4 turns, briefly summarise progress ("So far you've understood…").

METADATA FOOTER (always append at the end of EVERY response, invisible to learner, wrapped exactly like this):
<!--META
level: <beginner|intermediate|advanced>
understanding: <0-100>
concepts_mastered: <comma-separated list or "none">
concepts_struggling: <comma-separated list or "none">
-->`;
}

// ── Parse metadata from AI response ───────────────────────────
function parseMeta(text) {
  const match = text.match(/<!--META\s*([\s\S]*?)-->/);
  if (!match) return null;
  const block = match[1];
  const get = (key) => {
    const m = block.match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : null;
  };
  return {
    level:            get('level'),
    understanding:    parseInt(get('understanding'), 10) || 0,
    concepts_mastered: get('concepts_mastered'),
    concepts_struggling: get('concepts_struggling'),
  };
}

function stripMeta(text) {
  return text.replace(/<!--META[\s\S]*?-->/g, '').trim();
}

// ── Update sidebar from metadata ───────────────────────────────
function applyMeta(meta) {
  if (!meta) return;

  if (meta.level && meta.level !== 'unknown') {
    profile.level = meta.level;
    sidebarLevel.textContent = capitalize(meta.level);
  }

  if (!isNaN(meta.understanding)) {
    profile.understanding = meta.understanding;
    progressFill.style.width = `${meta.understanding}%`;
    progressFill.parentElement.setAttribute('aria-valuenow', meta.understanding);
    progressPct.textContent = `${meta.understanding}%`;
  }

  if (meta.concepts_mastered && meta.concepts_mastered !== 'none') {
    const items = meta.concepts_mastered.split(',').map(s => s.trim()).filter(Boolean);
    profile.concepts = [...new Set([...profile.concepts, ...items])];
    renderConcepts();
  }

  if (meta.concepts_struggling && meta.concepts_struggling !== 'none') {
    profile.struggling = meta.concepts_struggling.split(',').map(s => s.trim()).filter(Boolean);
  }
}

function renderConcepts() {
  if (profile.concepts.length === 0) return;
  conceptsList.innerHTML = profile.concepts
    .map(c => `<li class="concept-item">${escapeHtml(c)}</li>`)
    .join('');
}

// ── Gemini API call ────────────────────────────────────────────
async function callGemini(userMessage) {
  // Add user turn
  history.push({ role: 'user', parts: [{ text: userMessage }] });

  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt() }] },
    contents: history,
    generationConfig: {
      temperature:    0.7,
      maxOutputTokens: 1024,
      topP:           0.95,
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const data  = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!reply) throw new Error('Empty response from Gemini.');

  // Add model turn to history
  history.push({ role: 'model', parts: [{ text: reply }] });
  profile.turnCount++;

  return reply;
}

// ── Render a chat message ──────────────────────────────────────
function appendMessage(role, rawText) {
  const clean  = stripMeta(rawText);
  const div    = document.createElement('div');
  div.className = `message ${role}`;
  div.setAttribute('aria-label', role === 'assistant' ? 'Learning companion' : 'You');

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = role === 'assistant' ? '🎓' : 'U';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = parseMarkdown(clean);

  div.appendChild(avatar);
  div.appendChild(bubble);
  chatMessages.appendChild(div);
  scrollToBottom();
  return div;
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typing-msg';
  div.setAttribute('aria-label', 'Learning companion is thinking');
  div.innerHTML = `
    <div class="message-avatar" aria-hidden="true">🎓</div>
    <div class="message-bubble">
      <div class="typing-indicator" aria-hidden="true">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function hideTyping() {
  document.getElementById('typing-msg')?.remove();
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Minimal markdown → HTML ────────────────────────────────────
function parseMarkdown(text) {
  return text
    // Code blocks
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${escapeHtml(code.trim())}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`)
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered list
    .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    // Numbered list
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hup\d]|<blockquote|<pre)(.+)$/gm, '<p>$1</p>')
    // Line breaks inside paragraphs
    .replace(/([^>])\n([^<])/g, '$1<br>$2')
    // Clean up empty tags
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<ul>(<ul>[\s\S]*?<\/ul>)<\/ul>/g, '$1');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Toast notification ─────────────────────────────────────────
function showToast(msg, duration = 4000) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'alert');
  t.setAttribute('aria-live', 'assertive');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── Send a message (user or action) ───────────────────────────
async function sendMessage(text) {
  if (isLoading || !text.trim()) return;
  isLoading = true;
  setInputState(false);

  if (text !== '__init__') appendMessage('user', text);

  showTyping();

  try {
    const reply = await callGemini(text === '__init__'
      ? `Please start our learning session. My topic is "${profile.topic}". Begin with your opening diagnostic question.`
      : text);

    hideTyping();
    appendMessage('assistant', reply);

    const meta = parseMeta(reply);
    applyMeta(meta);
  } catch (err) {
    hideTyping();
    showToast(`Error: ${err.message}`);
  } finally {
    isLoading = false;
    setInputState(true);
    userInput.focus();
  }
}

function setInputState(enabled) {
  userInput.disabled = !enabled;
  sendBtn.disabled   = !enabled || userInput.value.trim() === '';
}

// ── Setup form submit ──────────────────────────────────────────
setupForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const key  = document.getElementById('api-key').value.trim();
  const topic = document.getElementById('topic').value.trim();

  if (!key)   { showToast('Please enter your Gemini API key.'); return; }
  if (!topic) { showToast('Please enter a topic to learn.'); return; }

  apiKey             = key;
  profile.topic      = topic;
  profile.background = document.getElementById('background').value.trim();
  profile.goal       = document.getElementById('goal').value.trim();

  // Switch screens
  screenSetup.classList.remove('active');
  screenSetup.hidden = true;
  screenLearning.classList.add('active');
  screenLearning.hidden = false;

  sidebarTopic.textContent = profile.topic;
  sidebarLevel.textContent = 'Assessing…';

  // Kick off the session
  sendMessage('__init__');
});

// ── Chat form submit ───────────────────────────────────────────
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || isLoading) return;
  userInput.value = '';
  autoResize();
  sendMessage(text);
});

// ── Textarea auto-resize + Enter key ──────────────────────────
userInput.addEventListener('input', () => {
  autoResize();
  sendBtn.disabled = userInput.value.trim() === '' || isLoading;
});

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

function autoResize() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
}

// ── Quick action buttons ───────────────────────────────────────
const actionMap = {
  simpler: 'Please explain that more simply, using a basic analogy.',
  deeper:  'I understand that — can you go deeper and explain it with more technical detail?',
  example: 'Can you give me a concrete, real-world example of this?',
  quiz:    'Quiz me on what we have covered so far.',
  summary: 'Summarise everything I have learned in this session so far.',
  next:    'I am ready to move on. What is the next concept I should learn?',
};

document.querySelectorAll('.action-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    const text   = actionMap[action];
    if (text && !isLoading) {
      sendMessage(text);
    }
  });
});

// ── New session button ─────────────────────────────────────────
document.getElementById('btn-new-session').addEventListener('click', () => {
  // Reset state
  history    = [];
  profile.level         = 'unknown';
  profile.understanding = 0;
  profile.concepts      = [];
  profile.struggling    = [];
  profile.turnCount     = 0;

  chatMessages.innerHTML   = '';
  conceptsList.innerHTML   = '<li class="concept-placeholder">Nothing yet — let\'s start!</li>';
  progressFill.style.width = '0%';
  progressPct.textContent  = '0%';
  sidebarLevel.textContent = 'Assessing…';
  userInput.value          = '';
  autoResize();

  screenLearning.classList.remove('active');
  screenLearning.hidden = true;
  screenSetup.classList.add('active');
  screenSetup.hidden = false;
});
