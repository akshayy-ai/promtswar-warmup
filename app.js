'use strict';

// ── Google Analytics 4 ─────────────────────────────────────────
const GA_ID = 'G-GL9PBMHZ4G';
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', GA_ID, { anonymize_ip: true });

/** Fires a GA4 event without throwing if gtag is unavailable. */
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
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
let   geminiModel = 'gemini-1.5-flash';
function geminiUrl() { return `${GEMINI_BASE}/${geminiModel}:streamGenerateContent?alt=sse`; }

// ── Google Cloud Translation API ───────────────────────────────
const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';

/** Builds the fetch URL and headers for the Gemini streaming API. */
function buildFetchOptions() {
  return {
    url:     `${geminiUrl()}&key=${encodeURIComponent(apiKey.trim())}`,
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

let history         = [];
let apiKey          = '';
let translateKey    = '';
let isLoading       = false;
let ttsActive       = false;
let lastMCQSelected = null;

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

// ── Input validation ───────────────────────────────────────────
/** Returns true if str looks like a valid Google API key (starts with AIza, 35–50 chars). */
function validateApiKey(str) {
  return typeof str === 'string' && str.startsWith('AIza') && str.length >= 35 && str.length <= 50;
}

/** Returns a sanitized, length-limited string safe for use in prompts. */
function sanitize(str) {
  if (!str) return '';
  return String(str).slice(0, 500).replace(/[<>]/g, '');
}

// ── Session persistence ────────────────────────────────────────
const SESSION_KEY = 'lc_session_v2';

/** Saves current profile and history to localStorage and Firestore. */
function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      profile: { ...profile },
      history: history.slice(-30),
    }));
    saveSessionToFirestore();
  } catch (_) {}
}

/** Loads a saved session from localStorage; returns data object or false. */
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.profile?.topic) return false;
    return data;
  } catch (_) { return false; }
}

/** Removes the saved session from localStorage and Firestore. */
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
/** Initialises Firebase, Auth, and Firestore; reveals the auth section when ready. */
function initFirebase() {
  try {
    firebase.initializeApp(FB_CONFIG);
    auth = firebase.auth();
    db   = firebase.firestore();
    document.getElementById('auth-section').hidden = false;

    auth.getRedirectResult().then(result => {
      if (result && result.user) trackEvent('sign_in', { method: 'google' });
    }).catch(e => {
      if (e.code !== 'auth/no-auth-event') showToast('Sign-in failed: ' + e.message);
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
    await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
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

/** Persists the current session to Firestore for the signed-in user. */
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

/** Retrieves the current user's session from Firestore; returns data or null. */
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
  try { await db.collection('sessions').doc(currentUser.uid).delete(); } catch (_) {}
}

// ── Google Cloud Translation API ───────────────────────────────
/** Translates plainText to targetLang via Cloud Translation API; returns translated string or null. */
async function translateText(plainText, targetLang) {
  if (!translateKey) return null;
  try {
    const res = await fetch(`${TRANSLATE_URL}?key=${encodeURIComponent(translateKey)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ q: plainText, target: targetLang, format: 'text' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.translations?.[0]?.translatedText || null;
  } catch (_) {
    return null;
  }
}

// ── System prompt ──────────────────────────────────────────────
/** Builds the adaptive system instruction embedding the current learner profile. */
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

QUIZ FORMAT — when the learner asks for a quiz, ALWAYS use this exact structure:
[One clear question ending with ?]
A) [option]
B) [option]
C) [option]
D) [option]
After they reply, tell them if they were correct or wrong, briefly explain why, then continue teaching.

METADATA FOOTER — always append at the end of EVERY response, exactly like this:
<!--META
level: <beginner|intermediate|advanced>
understanding: <0-100>
concepts_mastered: <comma-separated list or none>
concepts_struggling: <comma-separated list or none>
-->`;
}

// ── Gemini streaming API ───────────────────────────────────────
/** Sends userMessage to Gemini, calling onChunk per token; returns the full response text. */
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
/** Parses the <!--META--> block from a Gemini response; returns fields or null. */
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

/** Removes the <!--META--> block from a response string and trims whitespace. */
function stripMeta(text) {
  return text.replace(/<!--META[\s\S]*?-->/g, '').trim();
}

/** Applies parsed metadata to the learner profile and updates sidebar UI. */
function applyMeta(meta) {
  if (!meta) return;
  if (meta.level && meta.level !== 'unknown') {
    profile.level = meta.level;
    sidebarLevel.textContent = capitalize(meta.level);
  }
  if (!isNaN(meta.understanding)) {
    const prev = profile.understanding;
    profile.understanding = Math.max(0, Math.min(100, meta.understanding));
    checkMilestone(prev, profile.understanding);
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
  const pct = profile.understanding;
  progressFill.style.width = `${pct}%`;
  progressFill.style.background = pct >= 75 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--brand)';
  progressFill.parentElement.setAttribute('aria-valuenow', pct);
  progressPct.textContent = `${pct}%`;
}

function renderConcepts() {
  if (!profile.concepts.length) return;
  const existing = new Set([...conceptsList.querySelectorAll('.concept-item')].map(li => li.textContent.trim()));
  profile.concepts.forEach(c => {
    if (existing.has(c)) return;
    conceptsList.querySelector('.concept-placeholder')?.remove();
    const li = document.createElement('li');
    li.className = 'concept-item concept-new';
    li.textContent = c;
    conceptsList.appendChild(li);
    setTimeout(() => li.classList.remove('concept-new'), 800);
  });
}

// ── Text-to-Speech (Web Speech API) ───────────────────────────
let currentUtterance = null;

/** Reads text aloud via Web Speech API; toggles off if already speaking. */
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
/** Returns a YouTube search URL for "learn <concept>". */
function youtubeSearchUrl(concept) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`learn ${concept}`)}`;
}

// ── Message action buttons ─────────────────────────────────────
/** Creates TTS, Copy, YouTube, and (when translateKey is set) Translate buttons for a message. */
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
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
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

  if (translateKey) {
    const tBtn = document.createElement('button');
    tBtn.className = 'msg-action-btn';
    tBtn.setAttribute('aria-label', 'Translate this message');
    tBtn.innerHTML = '🌐 Translate';
    tBtn.addEventListener('click', async () => {
      tBtn.textContent = 'Translating…';
      tBtn.disabled = true;
      const browserLang = navigator.language.split('-')[0];
      const targetLang  = browserLang === 'en' ? 'es' : (browserLang || 'es');
      const translated  = await translateText(plainText, targetLang);
      if (translated) {
        const box = document.createElement('div');
        box.className = 'translation-box';
        box.setAttribute('aria-label', 'Translated message');
        box.textContent = translated;
        tBtn.closest('.message-content').insertBefore(box, actions);
        tBtn.remove();
        trackEvent('translate_message', { target_lang: targetLang, topic: profile.topic });
      } else {
        tBtn.textContent = '🌐 Translate';
        tBtn.disabled = false;
        showToast('Translation unavailable. Check your Cloud Translation API key.');
      }
    });
    actions.appendChild(tBtn);
  }

  return actions;
}

// ── Render a chat message ──────────────────────────────────────
/** Renders a chat message bubble with optional action buttons appended. */
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
/** Sends a message to Gemini, streams the response token-by-token, and updates the sidebar.
 *  Pass silent=true on auto-retry so the user bubble isn't duplicated. */
async function sendMessage(text, { silent = false } = {}) {
  if (isLoading || !text.trim()) return;
  isLoading = true;
  setInputState(false);

  const prompt = text === '__init__'
    ? `Please start our learning session. My topic is "${sanitize(profile.topic)}". Begin with your opening diagnostic question.`
    : sanitize(text);

  if (!silent && text !== '__init__') {
    appendMessage('user', text);
    trackEvent('message_sent', { topic: profile.topic, turn: profile.turnCount });
  }

  showTyping();

  try {
    hideTyping();
    const streamDiv = document.createElement('div');
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
    const cleanResponse = stripMeta(fullText);

    // Mark last MCQ answer correct/wrong based on AI response keywords
    if (lastMCQSelected) {
      const lower = cleanResponse.toLowerCase();
      const correct = /\b(correct|right|well done|exactly|great job|that('s| is) right|yes[,!])\b/.test(lower);
      const wrong   = /\b(incorrect|wrong|not quite|that('s| is) not|unfortunately|actually[,])\b/.test(lower);
      if (correct)      lastMCQSelected.classList.add('correct');
      else if (wrong)   lastMCQSelected.classList.add('wrong');
      lastMCQSelected = null;
    }

    const mcq = parseMCQ(cleanResponse);
    if (mcq) {
      renderMCQInBubble(mcq, bubble);
    } else {
      bubble.innerHTML = parseMarkdown(cleanResponse);
    }

    streamDiv.querySelector('.message-content').appendChild(createMessageActions(cleanResponse));
    applyMeta(parseMeta(fullText));

  } catch (err) {
    hideTyping();
    if (history.length && history[history.length - 1].role === 'user') history.pop();

    const retryMatch = err.message.match(/retry in (\d+(?:\.\d+)?)/i);
    if (retryMatch) {
      const waitSec = Math.ceil(parseFloat(retryMatch[1]));
      trackEvent('rate_limit_hit', { wait_sec: waitSec, topic: profile.topic });
      showCountdown('⏳ Rate limit hit.', waitSec, () => {
        isLoading = false;
        sendMessage(text, { silent: true });
      });
      return;
    }

    showToast(`Error: ${err.message}`);
  }

  isLoading = false;
  setInputState(true);
  userInput.focus();
}

function setInputState(enabled) {
  userInput.disabled = !enabled;
  sendBtn.disabled   = !enabled || !userInput.value.trim();
}

// ── Markdown renderer ──────────────────────────────────────────
/** Converts a markdown string to sanitised HTML; all captured groups are HTML-escaped. */
function parseMarkdown(text) {
  const e = escapeHtml;
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, _lang, code) =>
      `<pre><code>${e(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g,          (_, c) => `<code>${e(c)}</code>`)
    .replace(/^### (.+)$/gm,        (_, t) => `<h3>${e(t)}</h3>`)
    .replace(/^## (.+)$/gm,         (_, t) => `<h2>${e(t)}</h2>`)
    .replace(/^# (.+)$/gm,          (_, t) => `<h1>${e(t)}</h1>`)
    .replace(/\*\*\*(.+?)\*\*\*/g,  (_, t) => `<strong><em>${e(t)}</em></strong>`)
    .replace(/\*\*(.+?)\*\*/g,      (_, t) => `<strong>${e(t)}</strong>`)
    .replace(/\*(.+?)\*/g,          (_, t) => `<em>${e(t)}</em>`)
    .replace(/^> (.+)$/gm,          (_, t) => `<blockquote>${e(t)}</blockquote>`)
    .replace(/^\s*[-*] (.+)$/gm,    (_, t) => `<li>${e(t)}</li>`)
    .replace(/(<li>[^\n]*<\/li>\n?)+/g, m  => `<ul>${m.trim()}</ul>`)
    .replace(/^\d+\. (.+)$/gm,      (_, t) => `<li>${e(t)}</li>`)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hup\d]|<block|<pre)(.+)$/gm, '<p>$1</p>')
    .replace(/([^>])\n([^<])/g, '$1<br>$2')
    .replace(/<p>\s*<\/p>/g, '');
}

/** Escapes HTML special characters to prevent XSS injection. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ── MCQ quiz parser ────────────────────────────────────────────
/** Parses A/B/C/D multiple-choice options from text; returns {question, options} or null. */
function parseMCQ(text) {
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
  const optRe  = /^([A-D])[).]\s*(.+)/;
  const opts   = [];
  const qLines = [];
  let seenOpts = false;

  for (const line of lines) {
    const m = line.match(optRe);
    if (m) { seenOpts = true; opts.push({ label: m[1], text: m[2] }); }
    else if (!seenOpts) qLines.push(line);
  }

  return opts.length >= 2 ? { question: qLines.join('\n'), options: opts } : null;
}

/** Replaces bubble innerHTML with an interactive MCQ UI; clicking an option submits the answer. */
function renderMCQInBubble(mcq, bubble) {
  bubble.innerHTML = parseMarkdown(mcq.question);

  const grid = document.createElement('div');
  grid.className = 'mcq-options';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Quiz options — choose one');

  mcq.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'mcq-option';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', `Option ${opt.label}: ${opt.text}`);
    btn.innerHTML = `<span class="mcq-label">${escapeHtml(opt.label)}</span><span class="mcq-text">${escapeHtml(opt.text)}</span>`;
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.mcq-option').forEach(b => { b.disabled = true; });
      btn.classList.add('selected');
      lastMCQSelected = btn;
      trackEvent('quiz_answer', { topic: profile.topic });
      sendMessage(`My answer is ${opt.label}) ${opt.text}`);
    });
    grid.appendChild(btn);
  });

  bubble.appendChild(grid);
}

/** Shows a celebratory toast when understanding crosses a milestone (25/50/75/100). */
function checkMilestone(prev, next) {
  const milestones = [25, 50, 75, 100];
  const hit = milestones.find(m => prev < m && next >= m);
  if (!hit) return;
  const labels = { 25: '🌱 Great start!', 50: '🔥 Halfway there!', 75: '⚡ Almost an expert!', 100: '🏆 Full understanding!' };
  showToast(`${labels[hit]} ${hit}% understanding reached!`, 3500);
  trackEvent('milestone_reached', { milestone: hit, topic: profile.topic });
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg, duration = 4500, variant = '') {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = variant ? `toast toast-${variant}` : 'toast';
  t.setAttribute('role', 'alert');
  t.setAttribute('aria-live', 'assertive');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

/** Shows a live countdown toast, then calls onDone when it reaches zero. */
function showCountdown(prefix, seconds, onDone) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast toast-warning';
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  document.body.appendChild(t);

  let remaining = Math.ceil(seconds);
  const tick = () => { t.textContent = `${prefix} Retrying in ${remaining}s…`; };
  tick();

  const id = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(id); t.remove(); onDone(); }
    else tick();
  }, 1000);
}

// ── Screen transition ──────────────────────────────────────────
function startLearningScreen() {
  screenSetup.classList.remove('active');
  screenSetup.hidden = true;
  screenLearning.classList.add('active');
  screenLearning.hidden = false;
  sidebarTopic.textContent = profile.topic;
  sidebarLevel.textContent = profile.level === 'unknown' ? 'Assessing…' : capitalize(profile.level);
}

// ── Setup form ─────────────────────────────────────────────────
setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const key   = document.getElementById('api-key').value.trim();
  const topic = document.getElementById('topic').value.trim();

  if (!validateApiKey(key)) { showToast('Invalid API key — must start with AIza and be 35–50 characters.'); return; }
  if (!topic)               { showToast('Please enter a topic to learn.'); return; }

  apiKey             = key;
  translateKey       = document.getElementById('translate-key').value.trim();
  geminiModel        = document.getElementById('model-select').value;
  profile.topic      = sanitize(topic);
  profile.background = sanitize(document.getElementById('background').value.trim());
  profile.goal       = sanitize(document.getElementById('goal').value.trim());

  trackEvent('session_start', {
    topic:          profile.topic,
    has_background: !!profile.background,
    has_goal:       !!profile.goal,
    signed_in:      !!currentUser,
    has_translate:  !!translateKey,
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
  if (!validateApiKey(key)) { showToast('Please enter a valid Gemini API key first.'); return; }
  apiKey       = key;
  translateKey = document.getElementById('translate-key').value.trim();

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

// ── Textarea auto-resize ───────────────────────────────────────
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
  quiz:    'Give me a multiple-choice quiz question (A/B/C/D) on what we have covered so far.',
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
  history      = [];
  translateKey = '';
  Object.assign(profile, { level: 'unknown', understanding: 0, concepts: [], struggling: [], turnCount: 0 });

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
  if (data?.profile?.topic) sessionBanner.hidden = false;

  initFirebase();

  document.getElementById('btn-google-signin')?.addEventListener('click', signInWithGoogle);
  document.getElementById('btn-signout')?.addEventListener('click', signOutUser);
});
