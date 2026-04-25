'use strict';

// ── Google Analytics 4 ─────────────────────────────────────────
const GA_ID = 'G-GL9PBMHZ4G';
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', GA_ID, { anonymize_ip: true });

function trackEvent(name, params) {
  try { gtag('event', name, params || {}); } catch (_) {}
}

// ── Firebase configuration ─────────────────────────────────────
const FB_CONFIG = {
  apiKey:            'AIzaSyB0eSDEFJb2yHp7kuD4PVg-K40gor3cXlE',
  authDomain:        'promtswar-warmup-4e479.firebaseapp.com',
  projectId:         'promtswar-warmup-4e479',
  storageBucket:     'promtswar-warmup-4e479.firebasestorage.app',
  messagingSenderId: '945458857602',
  appId:             '1:945458857602:web:c37d2c4edede55b4d0969b',
  measurementId:     GA_ID,
};

let db          = null;
let auth        = null;
let currentUser = null;

// ── Gemini API ─────────────────────────────────────────────────
const GEMINI_MODEL  = 'gemini-2.5-flash';
const GEMINI_URL    = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

function buildFetchOptions() {
  return {
    url:     `${GEMINI_URL}&key=${encodeURIComponent(apiKey.trim())}`,
    headers: { 'Content-Type': 'application/json' },
  };
}

// ── Learner profile ────────────────────────────────────────────
const profile = {
  topic:         '',
  background:    '',
  goal:          '',
  level:         'unknown',
  understanding: 0,
  concepts:      [],
  struggling:    [],
  turnCount:     0,
};

let history   = [];
let apiKey    = '';
let isLoading = false;
let ttsActive = false;

// ── Rate limiting ──────────────────────────────────────────────
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 1000;

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
const sessionBanner  = document.getElementById('session-banner');

// ── Session persistence (localStorage) ────────────────────────
const SESSION_KEY = 'lc_session_v2';

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      profile:   { ...profile },
      history:   history.slice(-30),
    }));
    saveSessionToFirestore();
  } catch (_) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.profile?.topic) return false;
    return data;
  } catch (_) { return false; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  clearSessionFromFirestore();
}

function restoreSession(data) {
  Object.assign(profile, data.profile);
  history = data.history || [];
  startLearningScreen();
  renderConcepts();
  updateProgressUI();
  history.forEach(msg => {
    if (msg.role === 'user')  appendMessage('user', msg.parts[0].text, false);
    if (msg.role === 'model') appendMessage('assistant', msg.parts[0].text, false);
  });
  scrollToBottom();
}

// ── Firebase Auth & Firestore ──────────────────────────────────
function initFirebase() {
  try {
    firebase.initializeApp(FB_CONFIG);
    auth = firebase.auth();
    db   = firebase.firestore();
    document.getElementById('auth-section').hidden = false;

    // Pick up the result after Google redirect sign-in
    auth.getRedirectResult().then(result => {
      if (result && result.user) {
        trackEvent('sign_in', { method: 'google' });
      }
    }).catch(e => {
      if (e.code !== 'auth/no-auth-event') {
        showToast('Sign-in failed: ' + e.message);
      }
    });

    auth.onAuthStateChanged(user => {
      currentUser = user;
      updateAuthUI(user);
    });
  } catch (e) {
    console.warn('Firebase unavailable:', e.message);
  }
}

async function signInWithGoogle() {
  if (!auth) return;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithRedirect(provider);
  } catch (e) {
    showToast('Sign-in failed. Please try again.');
  }
}

async function signOutUser() {
  if (!auth) return;
  try { await auth.signOut(); } catch (_) {}
  currentUser = null;
  updateAuthUI(null);
  trackEvent('sign_out');
}

function updateAuthUI(user) {
  const btnIn  = document.getElementById('btn-google-signin');
  const info   = document.getElementById('auth-user-info');
  const avatar = document.getElementById('auth-avatar');
  const nameEl = document.getElementById('auth-name');
  if (!btnIn) return;
  if (user) {
    btnIn.hidden = true;
    info.hidden  = false;
    if (user.photoURL) { avatar.src = user.photoURL; avatar.hidden = false; }
    nameEl.textContent = user.displayName || user.email || 'Signed in';
    const local = loadSession();
    if (local) sessionBanner.hidden = false;
  } else {
    btnIn.hidden = false;
    info.hidden  = true;
  }
}

async function saveSessionToFirestore() {
  if (!db || !currentUser) return;
  try {
    await db.collection('sessions').doc(currentUser.uid).set({
      profile:   { ...profile },
      history:   history.slice(-30),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('Firestore save failed:', e.message);
  }
}

async function getSessionFromFirestore() {
  if (!db || !currentUser) return null;
  try {
    const doc = await db.collection('sessions').doc(currentUser.uid).get();
    if (doc.exists && doc.data()?.profile?.topic) return doc.data();
  } catch (e) {
    console.warn('Firestore load failed:', e.message);
  }
  return null;
}

async function clearSessionFromFirestore() {
  if (!db || !currentUser) return;
  try {
    await db.collection('sessions').doc(currentUser.uid).delete();
  } catch (_) {}
}

// ── System prompt ──────────────────────────────────────────────
function buildSystemPrompt() {
  return `You are an adaptive Learning Companion — a patient, encouraging tutor who personalises every response to the learner's current level, background, and stated goal.

LEARNER PROFILE (update your mental model as the conversation evolves):
- Topic: ${sanitize(profile.topic)}
- Background: ${sanitize(profile.background) || 'not provided'}
- Goal: ${sanitize(profile.goal) || 'general understanding'}
- Current Level: ${profile.level}
- Understanding score: ${profile.understanding}/100
- Concepts mastered: ${profile.concepts.join(', ') || 'none yet'}
- Concepts to reinforce: ${profile.struggling.join(', ') || 'none identified'}

ADAPTIVE BEHAVIOUR RULES:
1. Assess first — for the opening message ask 1-2 diagnostic questions before teaching.
2. Match complexity to level: beginner = plain language + analogy; intermediate = technical terms + examples; advanced = depth + edge cases.
3. After each explanation, ask ONE targeted check question.
4. If the learner struggles → simplify, use a different analogy, break into smaller steps.
5. If the learner excels → introduce next concept, add nuance, explore edge cases.
6. Always connect new ideas to what the learner already knows.
7. Be warm, encouraging, and never condescending.

RESPONSE FORMAT:
- Use markdown: ## headers, **bold**, bullet lists, \`inline code\`, code blocks.
- Teach ONE concept at a time. End every teaching response with ONE question.
- After every 3-4 turns briefly recap: "So far you've understood…".

METADATA FOOTER — always append at the end of EVERY response, exactly like this:
<!--META
level: <beginner|intermediate|advanced>
understanding: <0-100>
concepts_mastered: <comma-separated list or none>
concepts_struggling: <comma-separated list or none>
-->`;
}

// ── Input sanitization ─────────────────────────────────────────
function sanitize(str) {
  if (!str) return '';
  return String(str).slice(0, 500).replace(/[<>]/g, '');
}

// ── Gemini streaming API ───────────────────────────────────────
async function callGeminiStream(userMessage, onChunk) {
  const now = Date.now();
  if (now - lastRequestTime < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - (now - lastRequestTime)));
  }
  lastRequestTime = Date.now();

  history.push({ role: 'user', parts: [{ text: userMessage }] });

  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt() }] },
    contents: history,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024, topP: 0.95 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  const { url, headers } = buildFetchOptions();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = '';
  let buffer    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]') continue;
      try {
        const json  = JSON.parse(jsonStr);
        const chunk = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (chunk) { fullText += chunk; onChunk(chunk); }
      } catch (_) {}
    }
  }

  if (!fullText) throw new Error('Empty response from Gemini.');

  history.push({ role: 'model', parts: [{ text: fullText }] });
  profile.turnCount++;
  saveSession();
  return fullText;
}

// ── Metadata parsing ───────────────────────────────────────────
function parseMeta(text) {
  const match = text.match(/<!--META\s*([\s\S]*?)-->/);
  if (!match) return null;
  const block = match[1];
  const get = (key) => {
    const m = block.match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : null;
  };
  return {
    level:               get('level'),
    understanding:       parseInt(get('understanding'), 10) || 0,
    concepts_mastered:   get('concepts_mastered'),
    concepts_struggling: get('concepts_struggling'),
  };
}

function stripMeta(text) {
  return text.replace(/<!--META[\s\S]*?-->/g, '').trim();
}

function applyMeta(meta) {
  if (!meta) return;
  if (meta.level && meta.level !== 'unknown') {
    profile.level = meta.level;
    sidebarLevel.textContent = capitalize(meta.level);
  }
  if (!isNaN(meta.understanding)) {
    profile.understanding = Math.max(0, Math.min(100, meta.understanding));
    updateProgressUI();
  }
  if (meta.concepts_mastered && meta.concepts_mastered !== 'none') {
    const items = meta.concepts_mastered.split(',').map(s => s.trim()).filter(Boolean);
    const newConcepts = items.filter(c => !profile.concepts.includes(c));
    profile.concepts = [...new Set([...profile.concepts, ...items])];
    renderConcepts();
    newConcepts.forEach(c => trackEvent('concept_mastered', { concept: c, topic: profile.topic }));
  }
  if (meta.concepts_struggling && meta.concepts_struggling !== 'none') {
    profile.struggling = meta.concepts_struggling.split(',').map(s => s.trim()).filter(Boolean);
  }
}

function updateProgressUI() {
  progressFill.style.width = `${profile.understanding}%`;
  progressFill.parentElement.setAttribute('aria-valuenow', profile.understanding);
  progressPct.textContent = `${profile.understanding}%`;
}

function renderConcepts() {
  if (!profile.concepts.length) return;
  conceptsList.innerHTML = profile.concepts
    .map(c => `<li class="concept-item">${escapeHtml(c)}</li>`)
    .join('');
}

// ── Text-to-Speech (Web Speech API) ───────────────────────────
let currentUtterance = null;

function speak(text, btn) {
  if (!window.speechSynthesis) return;

  if (currentUtterance) {
    speechSynthesis.cancel();
    currentUtterance = null;
    ttsActive = false;
    document.querySelectorAll('.msg-action-btn.active[data-tts]').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.remove('active');
    return;
  }

  const clean = text
    .replace(/#{1,3} /g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 3000);

  const utterance  = new SpeechSynthesisUtterance(clean);
  utterance.rate   = 0.92;
  utterance.pitch  = 1;
  utterance.volume = 1;
  currentUtterance = utterance;
  ttsActive        = true;

  if (btn) btn.classList.add('active');

  utterance.onend = () => {
    currentUtterance = null;
    ttsActive = false;
    if (btn) btn.classList.remove('active');
  };

  speechSynthesis.speak(utterance);
  trackEvent('tts_listen', { topic: profile.topic });
}

// ── YouTube search ─────────────────────────────────────────────
function youtubeSearchUrl(concept) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`learn ${concept}`)}`;
}

// ── Message action buttons (TTS / Copy / YouTube) ──────────────
function createMessageActions(plainText) {
  const actions = document.createElement('div');
  actions.className = 'message-actions';

  if (window.speechSynthesis) {
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'msg-action-btn';
    ttsBtn.setAttribute('data-tts', '');
    ttsBtn.setAttribute('aria-label', 'Listen to this message');
    ttsBtn.innerHTML = '🔊 Listen';
    ttsBtn.addEventListener('click', () => speak(plainText, ttsBtn));
    actions.appendChild(ttsBtn);
  }

  if (navigator.clipboard) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.setAttribute('aria-label', 'Copy message text');
    copyBtn.innerHTML = '📋 Copy';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(plainText);
      copyBtn.innerHTML = '✓ Copied';
      setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 1500);
    });
    actions.appendChild(copyBtn);
  }

  const ytBtn = document.createElement('button');
  ytBtn.className = 'msg-action-btn';
  ytBtn.setAttribute('aria-label', `Search YouTube for ${profile.topic}`);
  ytBtn.innerHTML = '▶ YouTube';
  ytBtn.addEventListener('click', () => {
    trackEvent('youtube_search', { topic: profile.topic });
    window.open(youtubeSearchUrl(profile.topic), '_blank', 'noopener,noreferrer');
  });
  actions.appendChild(ytBtn);

  return actions;
}

// ── Render a chat message ──────────────────────────────────────
function appendMessage(role, rawText, withActions = true) {
  const clean = stripMeta(rawText);
  const div   = document.createElement('div');
  div.className = `message ${role}`;
  div.setAttribute('aria-label', role === 'assistant' ? 'Learning companion message' : 'Your message');

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = role === 'assistant' ? '🎓' : 'U';

  const content = document.createElement('div');
  content.className = 'message-content';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = parseMarkdown(clean);

  content.appendChild(bubble);
  if (role === 'assistant' && withActions) content.appendChild(createMessageActions(clean));

  div.appendChild(avatar);
  div.appendChild(content);
  chatMessages.appendChild(div);
  scrollToBottom();
  return bubble;
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typing-msg';
  div.setAttribute('aria-label', 'Learning companion is thinking');
  div.innerHTML = `
    <div class="message-avatar" aria-hidden="true">🎓</div>
    <div class="message-content">
      <div class="message-bubble">
        <div class="typing-indicator" aria-hidden="true">
          <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
        </div>
      </div>
    </div>`;
  chatMessages.appendChild(div);
  scrollToBottom();
}

function hideTyping() { document.getElementById('typing-msg')?.remove(); }
function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

// ── Send message with streaming ────────────────────────────────
async function sendMessage(text) {
  if (isLoading || !text.trim()) return;
  isLoading = true;
  setInputState(false);

  const prompt = text === '__init__'
    ? `Please start our learning session. My topic is "${sanitize(profile.topic)}". Begin with your opening diagnostic question.`
    : sanitize(text);

  if (text !== '__init__') {
    appendMessage('user', text);
    trackEvent('message_sent', { topic: profile.topic, turn: profile.turnCount });
  }

  showTyping();

  try {
    hideTyping();
    const streamDiv    = document.createElement('div');
    streamDiv.className = 'message assistant';
    streamDiv.setAttribute('aria-label', 'Learning companion message');
    streamDiv.innerHTML = `
      <div class="message-avatar" aria-hidden="true">🎓</div>
      <div class="message-content">
        <div class="message-bubble streaming-cursor" id="stream-bubble"></div>
      </div>`;
    chatMessages.appendChild(streamDiv);
    scrollToBottom();

    const bubble = document.getElementById('stream-bubble');
    let accumulated = '';

    const fullText = await callGeminiStream(prompt, (chunk) => {
      accumulated += chunk;
      bubble.innerHTML = parseMarkdown(stripMeta(accumulated));
      scrollToBottom();
    });

    bubble.classList.remove('streaming-cursor');
    bubble.id = '';
    bubble.innerHTML = parseMarkdown(stripMeta(fullText));

    const contentEl = streamDiv.querySelector('.message-content');
    contentEl.appendChild(createMessageActions(stripMeta(fullText)));

    const meta = parseMeta(fullText);
    applyMeta(meta);

  } catch (err) {
    hideTyping();
    showToast(`Error: ${err.message}`);
    if (history.length && history[history.length - 1].role === 'user') history.pop();
  } finally {
    isLoading = false;
    setInputState(true);
    userInput.focus();
  }
}

function setInputState(enabled) {
  userInput.disabled = !enabled;
  sendBtn.disabled   = !enabled || !userInput.value.trim();
}

// ── Markdown renderer ──────────────────────────────────────────
function parseMarkdown(text) {
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, _lang, code) =>
      `<pre><code>${escapeHtml(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hup\d]|<block|<pre)(.+)$/gm, '<p>$1</p>')
    .replace(/([^>])\n([^<])/g, '$1<br>$2')
    .replace(/<p>\s*<\/p>/g, '');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg, duration = 4500) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'alert');
  t.setAttribute('aria-live', 'assertive');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ── Screen transition ──────────────────────────────────────────
function startLearningScreen() {
  screenSetup.classList.remove('active');
  screenSetup.hidden = true;
  screenLearning.classList.add('active');
  screenLearning.hidden = false;
  sidebarTopic.textContent  = profile.topic;
  sidebarLevel.textContent  = profile.level === 'unknown' ? 'Assessing…' : capitalize(profile.level);
}

// ── Setup form ─────────────────────────────────────────────────
setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const key   = document.getElementById('api-key').value.trim();
  const topic = document.getElementById('topic').value.trim();
  if (!key)   { showToast('Please enter your Gemini API key.'); return; }
  if (!topic) { showToast('Please enter a topic to learn.'); return; }

  apiKey             = key;
  profile.topic      = sanitize(topic);
  profile.background = sanitize(document.getElementById('background').value.trim());
  profile.goal       = sanitize(document.getElementById('goal').value.trim());

  trackEvent('session_start', {
    topic:          profile.topic,
    has_background: !!profile.background,
    has_goal:       !!profile.goal,
    signed_in:      !!currentUser,
  });

  clearSession();
  chatMessages.innerHTML = '';
  history = [];

  startLearningScreen();
  sendMessage('__init__');
});

// ── Restore session button ─────────────────────────────────────
document.getElementById('btn-restore')?.addEventListener('click', async () => {
  const key = document.getElementById('api-key').value.trim();
  if (!key) { showToast('Please enter your Gemini API key first.'); return; }
  apiKey = key;

  const cloudData = await getSessionFromFirestore();
  if (cloudData) {
    trackEvent('session_restored', { source: 'firestore' });
    restoreSession(cloudData);
    return;
  }

  const data = loadSession();
  if (data) {
    trackEvent('session_restored', { source: 'localstorage' });
    restoreSession(data);
  }
});

// ── Chat form ──────────────────────────────────────────────────
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || isLoading) return;
  userInput.value = '';
  autoResize();
  sendMessage(text);
});

// ── Textarea ───────────────────────────────────────────────────
userInput.addEventListener('input', () => {
  autoResize();
  sendBtn.disabled = !userInput.value.trim() || isLoading;
});

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatForm.requestSubmit(); }
});

function autoResize() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
}

// ── Keyboard shortcut Ctrl+/ → focus input ────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === '/') { e.preventDefault(); userInput?.focus(); }
});

// ── Quick action buttons ───────────────────────────────────────
const actionMap = {
  simpler: 'Please explain that more simply using a basic analogy.',
  deeper:  'I understand — can you go deeper with more technical detail?',
  example: 'Can you give me a concrete real-world example of this?',
  quiz:    'Quiz me on what we have covered so far.',
  summary: 'Summarise everything I have learned in this session.',
  next:    'I am ready to move on. What is the next concept I should learn?',
};

document.querySelectorAll('.action-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const text = actionMap[btn.dataset.action];
    if (text && !isLoading) {
      trackEvent('quick_action', { action: btn.dataset.action, topic: profile.topic });
      sendMessage(text);
    }
  });
});

// ── New session button ─────────────────────────────────────────
document.getElementById('btn-new-session').addEventListener('click', () => {
  if (currentUtterance) { speechSynthesis.cancel(); currentUtterance = null; }
  trackEvent('new_session');
  clearSession();
  history    = [];
  Object.assign(profile, { level:'unknown', understanding:0, concepts:[], struggling:[], turnCount:0 });

  chatMessages.innerHTML = '';
  conceptsList.innerHTML = '<li class="concept-placeholder">Nothing yet — let\'s start!</li>';
  progressFill.style.width = '0%';
  progressPct.textContent  = '0%';
  sidebarLevel.textContent = 'Assessing…';
  userInput.value = '';
  autoResize();

  screenLearning.classList.remove('active');
  screenLearning.hidden = true;
  screenSetup.classList.add('active');
  screenSetup.hidden = false;
});

// ── Init ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const data = loadSession();
  if (data?.profile?.topic) {
    sessionBanner.hidden = false;
  }

  initFirebase();

  document.getElementById('btn-google-signin')?.addEventListener('click', signInWithGoogle);
  document.getElementById('btn-signout')?.addEventListener('click', signOutUser);
});
