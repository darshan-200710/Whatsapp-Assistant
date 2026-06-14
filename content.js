/**
 * WhatsApp Assistant — Content Script
 * Injected into web.whatsapp.com
 *
 * Reads real chat messages and media from the WhatsApp Web DOM + blob URLs.
 * Builds a sidebar panel for photo download (ZIP) and chat export (ZIP).
 */

'use strict';

// ─── WA Web DOM Selectors (update if WA changes their DOM) ──────────────────
// These are based on WhatsApp Web as of mid-2026. They may need updating.
const SEL = {
  // Currently open chat header
  chatHeader:     'header [data-testid="conversation-header"]',
  chatTitle:      'header [data-testid="conversation-info-header-chat-title"]',
  chatAvatar:     'header [data-testid="conversation-info-header"] img',

  // Message list container
  msgList:        'div#main [data-testid="conversation-panel-messages"]',
  msgRows:        'div#main [data-testid="conversation-panel-messages"] .message-in, div#main [data-testid="conversation-panel-messages"] .message-out',

  // Media inside messages
  msgImg:         'img.x3nfvp2',           // photo thumbnails
  msgImgAlt:      'img[src^="blob:"]',
  msgVideo:       'video',
  msgText:        '[data-testid="msg-container"] [class*="copyable-text"]',

  // Outgoing vs incoming
  outgoing:       '.message-out',
  incoming:       '.message-in',

  // Timestamp
  timestamp:      '[data-testid="msg-meta"] [dir]',
  timestampAlt:   '.copyable-text[data-pre-plain-text]',

  // Sender (group)
  sender:         '.copyable-text span[dir="auto"]:first-child',
};

// ─── State ──────────────────────────────────────────────────────────────────
let selectedPhotos   = new Set(); // Set of indices into collectedMedia
let collectedMedia   = [];        // [{src, type, timestamp, msgEl}]
let collectedMsgs    = [];        // [{text, isMine, sender, timestamp}]
let currentChat      = { name: '', avatarSrc: '' };
let activeTab        = 'photos';
let pillState        = { media: true, timestamps: true, sender: true };

// ─── Build UI ────────────────────────────────────────────────────────────────
function buildUI() {
  if (document.getElementById('wa-assistant-sidebar')) return;

  // Toggle button
  const toggle = document.createElement('button');
  toggle.id = 'wa-assistant-toggle';
  toggle.title = 'WhatsApp Assistant';
  toggle.innerHTML = '🗂️';
  toggle.addEventListener('click', () => openSidebar());
  document.body.appendChild(toggle);

  // Toast container
  const toastWrap = document.createElement('div');
  toastWrap.className = 'waa-toast-wrap';
  toastWrap.id = 'waa-toasts';
  document.body.appendChild(toastWrap);

  // Sidebar shell
  const sidebar = document.createElement('div');
  sidebar.id = 'wa-assistant-sidebar';
  sidebar.innerHTML = buildSidebarHTML();
  document.body.appendChild(sidebar);

  attachSidebarListeners();
}

function buildSidebarHTML() {
  return `
    <!-- Header -->
    <div class="waa-header">
      <div class="waa-brand">
        <div class="waa-logo">🗂️</div>
        <span class="waa-title">WA Assistant</span>
      </div>
      <button class="waa-close" id="waa-close" title="Close">✕</button>
    </div>

    <!-- Tabs -->
    <div class="waa-tabs">
      <button class="waa-tab active" data-tab="photos" id="waa-tab-photos">
        📷 Photos
      </button>
      <button class="waa-tab" data-tab="chat" id="waa-tab-chat">
        💬 Export Chat
      </button>
    </div>

    <!-- Current chat info -->
    <div class="waa-chat-bar" id="waa-chat-bar">
      <div class="waa-chat-avatar" id="waa-avatar">?</div>
      <div>
        <div class="waa-chat-name" id="waa-chat-name">No chat open</div>
        <div class="waa-chat-sub" id="waa-chat-sub">Open a chat in WhatsApp Web first</div>
      </div>
    </div>

    <!-- ══ PHOTOS PANEL ══ -->
    <div class="waa-panel active" id="waa-panel-photos">

      <!-- Toolbar -->
      <div class="waa-toolbar">
        <div class="waa-toolbar-left">
          <button class="waa-btn-sm" id="waa-scan-btn">🔄 Scan Chat</button>
          <button class="waa-btn-sm" id="waa-selall-btn">☑ All</button>
          <div class="waa-sel-info"><strong id="waa-sel-count">0</strong> selected</div>
        </div>
        <button class="waa-btn-dl" id="waa-dl-btn" disabled>⬇ ZIP</button>
      </div>

      <!-- Progress -->
      <div class="waa-progress" id="waa-photo-progress">
        <div class="waa-progress-lbl">
          <span id="waa-prog-lbl">Packing…</span>
          <strong id="waa-prog-pct">0%</strong>
        </div>
        <div class="waa-progress-bg"><div class="waa-progress-fill" id="waa-prog-fill"></div></div>
      </div>

      <!-- Grid -->
      <div class="waa-photo-grid-wrap">
        <div class="waa-photo-grid" id="waa-photo-grid">
          <div class="waa-empty">
            <div class="waa-empty-icon">📷</div>
            <div class="waa-empty-title">No media yet</div>
            <div class="waa-empty-sub">Open a chat then click <strong>Scan Chat</strong> to find photos &amp; videos.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ CHAT EXPORT PANEL ══ -->
    <div class="waa-panel" id="waa-panel-chat">

      <!-- Config -->
      <div class="waa-export-config">
        <div class="waa-config-title">📅 Date Range</div>

        <div class="waa-date-row">
          <div class="waa-field-group">
            <label class="waa-field-label" for="waa-date-start">From</label>
            <input class="waa-field-input" type="date" id="waa-date-start" />
          </div>
          <div class="waa-field-group">
            <label class="waa-field-label" for="waa-date-end">To</label>
            <input class="waa-field-input" type="date" id="waa-date-end" />
          </div>
        </div>

        <div class="waa-export-pills" id="waa-pills">
          <div class="waa-pill on"  data-key="media">📎 Include Media</div>
          <div class="waa-pill on"  data-key="timestamps">🕐 Timestamps</div>
          <div class="waa-pill on"  data-key="sender">👤 Sender Name</div>
        </div>

        <div class="waa-export-actions">
          <button class="waa-btn-sm" id="waa-preview-btn">👁 Preview</button>
          <button class="waa-btn-export" id="waa-export-btn">📦 Export ZIP</button>
          <div class="waa-msg-count"><strong id="waa-msg-count">0</strong> msgs</div>
        </div>
      </div>

      <!-- Progress (shared) -->
      <div class="waa-progress" id="waa-chat-progress">
        <div class="waa-progress-lbl">
          <span id="waa-chat-prog-lbl">Exporting…</span>
          <strong id="waa-chat-prog-pct">0%</strong>
        </div>
        <div class="waa-progress-bg"><div class="waa-progress-fill" id="waa-chat-prog-fill"></div></div>
      </div>

      <!-- Message preview -->
      <div class="waa-chat-preview" id="waa-chat-preview">
        <div class="waa-empty">
          <div class="waa-empty-icon">💬</div>
          <div class="waa-empty-title">No messages loaded</div>
          <div class="waa-empty-sub">Open a chat, click <strong>Scan Chat</strong> in the Photos tab, then come here to export.</div>
        </div>
      </div>
    </div>
  `;
}

// ─── Sidebar Listeners ────────────────────────────────────────────────────────
function attachSidebarListeners() {
  const sidebar = document.getElementById('wa-assistant-sidebar');

  sidebar.querySelector('#waa-close').addEventListener('click', closeSidebar);

  // Tabs
  sidebar.querySelectorAll('.waa-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Scan
  sidebar.querySelector('#waa-scan-btn').addEventListener('click', scanCurrentChat);

  // Select all
  sidebar.querySelector('#waa-selall-btn').addEventListener('click', toggleSelectAll);

  // Download ZIP
  sidebar.querySelector('#waa-dl-btn').addEventListener('click', downloadPhotosZip);

  // Pills
  sidebar.querySelectorAll('.waa-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      pill.classList.toggle('on');
      pillState[pill.dataset.key] = pill.classList.contains('on');
      renderChatPreview();
    });
  });

  // Date inputs
  sidebar.querySelector('#waa-date-start').addEventListener('change', renderChatPreview);
  sidebar.querySelector('#waa-date-end').addEventListener('change', renderChatPreview);

  // Preview
  sidebar.querySelector('#waa-preview-btn').addEventListener('click', () => {
    renderChatPreview();
    toast('info', 'Preview updated', getFilteredMessages().length + ' messages in range.');
  });

  // Export chat
  sidebar.querySelector('#waa-export-btn').addEventListener('click', exportChatZip);
}

// ─── Sidebar Open/Close ───────────────────────────────────────────────────────
function openSidebar() {
  const sidebar = document.getElementById('wa-assistant-sidebar');
  sidebar.classList.add('open');
  refreshChatInfo();
  if (collectedMsgs.length === 0 && collectedMedia.length === 0) {
    // Auto-scan when first opened with a chat active
    if (getCurrentChatName()) scanCurrentChat();
  }
}

function closeSidebar() {
  document.getElementById('wa-assistant-sidebar').classList.remove('open');
}

function toggleSidebar() {
  const sidebar = document.getElementById('wa-assistant-sidebar');
  if (sidebar) {
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }
}

// Listen for toggle command from the background service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'TOGGLE_SIDEBAR') {
    toggleSidebar();
    sendResponse({ success: true });
  }
});

// ─── Tab Switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.waa-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.waa-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`waa-panel-${tab}`).classList.add('active');
  if (tab === 'chat') renderChatPreview();
}

// ─── Get Current Chat Info from WA Web DOM ────────────────────────────────────
function getCurrentChatName() {
  // Find the header element inside the chat pane, fallback to any chat header
  const header = document.querySelector('div#main header, [data-testid="conversation-header"], header');
  if (!header) return '';

  // 1. Try finding a span or div inside the header that has a title attribute equal to its text content.
  // In WhatsApp Web, the chat title element has title="Name" and innerText="Name".
  const titleElements = header.querySelectorAll('span[title], div[title]');
  for (const el of titleElements) {
    const title = el.getAttribute('title').trim();
    const text = el.textContent.trim();
    if (title && text && title === text) {
      // Exclude common header action/tooltip titles
      const lower = title.toLowerCase();
      if (!['search', 'menu', 'more options', 'attach', 'back', 'voice call', 'video call'].includes(lower)) {
        return title;
      }
    }
  }

  // 2. Fallback: Selectors matching conversation headers
  const selectors = [
    'header [data-testid="conversation-info-header-chat-title"] span',
    'header ._21S-L span',
    '[data-testid="conversation-info-header-chat-title"]',
    'header div[class*="ellipsis"] span',
    'header [tabindex="-1"] span[dir]',
  ];
  for (const s of selectors) {
    const el = header.querySelector(s) || document.querySelector(s);
    if (el && el.textContent.trim()) return el.textContent.trim();
  }

  // 3. Fallback: Parse the first line of the header text content
  const headerText = header.innerText || '';
  const lines = headerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 0) {
    const firstLine = lines[0];
    if (firstLine.length < 60) {
      return firstLine;
    }
  }

  return '';
}

function getCurrentChatAvatar() {
  const header = document.querySelector('div#main header, [data-testid="conversation-header"], header');
  if (!header) return '';

  const img = header.querySelector('img');
  return img?.src || '';
}

function refreshChatInfo() {
  const name = getCurrentChatName();
  const avatar = getCurrentChatAvatar();
  currentChat = { name, avatarSrc: avatar };

  const nameEl   = document.getElementById('waa-chat-name');
  const subEl    = document.getElementById('waa-chat-sub');
  const avatarEl = document.getElementById('waa-avatar');

  if (name) {
    nameEl.textContent = name;
    subEl.textContent  = 'Click "Scan Chat" to load media & messages';
    if (avatar) {
      avatarEl.innerHTML = `<img src="${avatar}" alt="${name}" />`;
    } else {
      avatarEl.textContent = name.charAt(0).toUpperCase();
    }
  } else {
    nameEl.textContent = 'No chat open';
    subEl.textContent  = 'Open a WhatsApp chat first';
    avatarEl.textContent = '?';
  }
}

// ─── Scan Current Chat ────────────────────────────────────────────────────────
async function scanCurrentChat() {
  refreshChatInfo();
  const name = currentChat.name;

  if (!name) {
    toast('warn', 'No chat open', 'Please open a WhatsApp conversation first.');
    return;
  }

  toast('info', 'Scanning…', `Reading messages & media from "${name}"`);

  // Reset
  collectedMedia = [];
  collectedMsgs  = [];
  selectedPhotos.clear();

  const mediaMap = new Map();
  const msgMap = new Map();
  const processedAlbums = new Set();

  // ── Find active chat pane ──
  const pane = document.querySelector('div#main, [data-testid="conversation-panel"], [role="application"]');

  // ── Scroll to load more messages ──
  const msgContainer = pane ? pane.querySelector('[data-testid="conversation-panel-messages"], [class*="conversation-panel-messages"], .copyable-area [role="application"]') : document.querySelector('[data-testid="conversation-panel-messages"], div#main');

  let maxScrolls = msgContainer ? 50 : 1;

  for (let step = 0; step < maxScrolls; step++) {
    toast('info', 'Scanning…', `Loading older messages (Step ${step + 1}/${maxScrolls})`);

    // ── Collect all message rows ──
    let rows = [];
    if (pane) {
      const msgRowSelectors = [
        '[data-testid="msg-container"]',
        '[data-testid^="msg-"]',
        'div#main .message-in, div#main .message-out',
        '.message-in, .message-out',
        '[class*="focusable-list-item"]',
        '[data-id]',
      ];
      for (const sel of msgRowSelectors) {
        rows = [...pane.querySelectorAll(sel)];
        if (rows.length > 0) break;
      }
    } else {
      // Global fallback
      const msgRowSelectors = [
        '[data-testid="msg-container"]',
        '[data-testid^="msg-"]',
        'div#main .message-in, div#main .message-out',
        '.message-in, .message-out',
        '[class*="focusable-list-item"]',
        '[data-id]',
      ];
      for (const sel of msgRowSelectors) {
        rows = [...document.querySelectorAll(sel)];
        if (rows.length > 0) break;
      }
    }

    if (step === 0 && rows.length === 0) {
      console.warn('[WA Assistant] Found 0 messages. Starting DOM diagnostic...');
      console.log('Active Pane:', pane);
      const targetRoot = pane || document.querySelector('div#main') || document.body;
      console.log(`Total divs inspected: ${targetRoot.querySelectorAll('div').length}`);
    }

    for (const row of rows) {
      const isMine = row.classList.contains('message-out') ||
                     row.closest('.message-out') !== null ||
                     row.closest('[class*="message-out"]') !== null ||
                     row.querySelector('[class*="message-out"]') !== null ||
                     row.getAttribute('data-id')?.includes('_out') === true;

      // ── Timestamp ──
      let timestamp = null;
      const timeEl = row.getAttribute('data-pre-plain-text')
        ? row
        : row.querySelector('[data-pre-plain-text], [data-testid="msg-meta"] [dir], .copyable-text, [class*="status-meta"] span');

      if (timeEl) {
        const plainText = timeEl.getAttribute('data-pre-plain-text');
        if (plainText) {
          const match = plainText.match(/\[(\d{1,2}:\d{2})[^\]]*(\d{1,2}\/\d{1,2}\/\d{4})\]/);
          if (match) {
            const [, time, date] = match;
            const parts = date.split('/');
            timestamp = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}T${time}:00`);
            if (isNaN(timestamp)) {
              timestamp = new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}T${time}:00`);
            }
          }
        }
        if (!timestamp || isNaN(timestamp)) {
          const spans = row.querySelectorAll('[class*="status-meta"] span, ._21S-L span');
          for (const s of spans) {
            const t = s.textContent.trim();
            if (/^\d{1,2}:\d{2}/.test(t)) {
              const today = new Date().toISOString().split('T')[0];
              timestamp = new Date(`${today}T${t.padStart(5,'0')}:00`);
              if (!isNaN(timestamp)) break;
            }
          }
        }
      }

      if (!timestamp || isNaN(timestamp)) timestamp = new Date();

      // ── Sender (for groups) ──
      let sender = isMine ? 'You' : (currentChat.name || 'Contact');
      const senderEl = row.querySelector('[data-testid="msg-meta"] span[dir="auto"], .copyable-text span[dir="auto"]');
      if (senderEl && !isMine) {
        const plainText = timeEl?.getAttribute?.('data-pre-plain-text') || '';
        const senderMatch = plainText.match(/\] (.+?): ?$/);
        if (senderMatch) sender = senderMatch[1];
      }

      // ── Text content ──
      const textEl = row.querySelector('[class*="selectable-text"]') ||
                     row.querySelector('span[dir]') ||
                     row.querySelector('[class*="copyable-text"]');
      const text = textEl?.innerText?.trim() || '';

      // ── Media ──
      const imgs   = row.querySelectorAll('img');
      const videos = row.querySelectorAll('video');

      for (const img of imgs) {
        if (!img.src) continue;
        const src = img.src.toLowerCase();
        if (src.includes('emoji') || img.className.includes('emoji')) continue;
        if (src.includes('avatar') || img.className.includes('avatar')) continue;
        if (src.includes('pps.whatsapp.net')) continue;
        
        if (src.startsWith('blob:') || src.startsWith('http')) {
          mediaMap.set(img.src, { src: img.src, type: 'image', timestamp, msgEl: row, isMine });
        }
      }

      for (const vid of videos) {
        if (vid.src) {
          mediaMap.set(vid.src, { src: vid.src, type: 'video', timestamp, msgEl: row, isMine });
        }
      }

      // ── Albums ──
      const divs = row.querySelectorAll('div');
      let albumOverlay = null;
      for (const div of divs) {
        const txt = div.innerText?.trim();
        if (txt && /^\+\d+$/.test(txt) && txt.length < 8) {
          if (row.querySelector('img')) {
            albumOverlay = div;
            break;
          }
        }
      }

      if (albumOverlay) {
        let msgId = row.getAttribute('data-id') || row.querySelector('[data-id]')?.getAttribute('data-id');
        if (!msgId) msgId = timestamp.getTime() + '_' + (text ? text.slice(0, 20) : Math.random().toString());
        
        if (!processedAlbums.has(msgId)) {
          processedAlbums.add(msgId);
          await extractAlbum(albumOverlay, mediaMap, timestamp, isMine, row, sender);
        }
      }

      // Store message
      if (text) {
        const key = `${timestamp.getTime()}_${text.slice(0, 50)}`;
        msgMap.set(key, { text, isMine, sender, timestamp });
      }
    }

    // Scroll up to trigger older messages
    if (msgContainer && step < maxScrolls - 1) {
      const oldScroll = msgContainer.scrollTop;
      const oldHeight = msgContainer.scrollHeight;
      
      // Scroll up by approximately one page height to trigger virtual list loading gracefully
      msgContainer.scrollTop -= (msgContainer.clientHeight || 800);
      if (msgContainer.scrollTop < 100) msgContainer.scrollTop = 0;
      
      await sleep(1000);
      
      // If we've reached the top and no new messages were added
      if (msgContainer.scrollTop === 0 && msgContainer.scrollHeight === oldHeight) {
        break; // Reached absolute top
      }
    }
  }

  // Scroll back to bottom
  if (msgContainer) {
    msgContainer.scrollTop = msgContainer.scrollHeight;
    await sleep(600);
  }

  collectedMedia = Array.from(mediaMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  collectedMsgs = Array.from(msgMap.values()).sort((a, b) => a.timestamp - b.timestamp);

  toast('success', 'Scan Complete', `Found ${collectedMedia.length} media items & ${collectedMsgs.length} messages.`);

  // Set default date range
  if (collectedMsgs.length > 0) {
    const dates = collectedMsgs.map(m => m.timestamp).filter(d => !isNaN(d));
    if (dates.length) {
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));
      const startInput = document.getElementById('waa-date-start');
      const endInput   = document.getElementById('waa-date-end');
      if (!startInput.value) startInput.value = minDate.toISOString().split('T')[0];
      if (!endInput.value)   endInput.value   = maxDate.toISOString().split('T')[0];
    }
  }

  renderPhotoGrid();
  renderChatPreview();
}

// ─── Album Extraction ────────────────────────────────────────────────────────
async function extractAlbum(overlayEl, mediaMap, timestamp, isMine, msgEl, sender) {
  toast('info', 'Extracting Album', `Found a hidden album! Expanding it to load all photos... (Do not click anything)`);
  
  overlayEl.click();
  const btn = overlayEl.closest('[role="button"]');
  if (btn) btn.click();
  const imgNear = overlayEl.parentElement?.querySelector('img') || overlayEl.closest('div')?.querySelector('img');
  if (imgNear) imgNear.click();

  await sleep(1500);

  const isModalOpen = document.querySelector('[aria-label="Close"], [data-testid="btn-close"], [data-testid="x"], div[role="dialog"]') ||
                      document.querySelector('span[data-icon="x"]');

  if (!isModalOpen) {
    console.warn('[WA Assistant] Failed to open album viewer.');
    return; // Abort safely without pressing Escape
  }

  const closeViewer = () => {
    const closeBtn = document.querySelector('[aria-label="Close"], [data-testid="btn-close"], [data-testid="x"]') ||
                     document.querySelector('span[data-icon="x"]')?.closest('div[role="button"]');
    if (closeBtn) {
      closeBtn.click();
    } else {
      if (document.querySelector('div[role="dialog"]')) {
        const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true });
        document.dispatchEvent(esc);
      }
    }
  };

  let noNextBtnCount = 0;
  for (let i = 0; i < 150; i++) {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (!img.src) continue;
      const src = img.src.toLowerCase();
      if (src.includes('emoji') || img.className.includes('emoji')) continue;
      if (src.includes('avatar') || img.className.includes('avatar')) continue;
      if (src.includes('pps.whatsapp.net')) continue;
      
      if (src.startsWith('blob:') || src.startsWith('http')) {
        if (!mediaMap.has(img.src)) {
          try {
            const resp = await fetch(img.src);
            const blob = await resp.blob();
            mediaMap.set(img.src, { src: URL.createObjectURL(blob), type: 'image', timestamp, msgEl, isMine });
          } catch (e) {
            mediaMap.set(img.src, { src: img.src, type: 'image', timestamp, msgEl, isMine });
          }
        }
      }
    }
    
    const videos = document.querySelectorAll('video');
    for (const vid of videos) {
      if (vid.src && !mediaMap.has(vid.src)) {
        try {
          const resp = await fetch(vid.src);
          const blob = await resp.blob();
          mediaMap.set(vid.src, { src: URL.createObjectURL(blob), type: 'video', timestamp, msgEl, isMine });
        } catch (e) {
          mediaMap.set(vid.src, { src: vid.src, type: 'video', timestamp, msgEl, isMine });
        }
      }
    }

    const nextBtn = document.querySelector('[aria-label="Next"], [data-testid="chevron-right"], [data-testid="btn-next"]') ||
                    document.querySelector('span[data-icon="chevron-right"]')?.closest('div[role="button"]');
                    
    if (!nextBtn || nextBtn.disabled || nextBtn.style.display === 'none' || nextBtn.closest('[style*="display: none"]')) {
      noNextBtnCount++;
      if (noNextBtnCount > 1) break;
    } else {
      noNextBtnCount = 0;
      nextBtn.click();
    }
    await sleep(600);
  }

  closeViewer();
  await sleep(1000);
}

// ─── Photo Grid ───────────────────────────────────────────────────────────────
function renderPhotoGrid() {
  const grid = document.getElementById('waa-photo-grid');

  updatePhotoToolbar();

  if (!collectedMedia.length) {
    grid.innerHTML = `
      <div class="waa-empty">
        <div class="waa-empty-icon">📷</div>
        <div class="waa-empty-title">No media found</div>
        <div class="waa-empty-sub">Try scrolling up in the chat to load older photos, then click Scan again.</div>
      </div>`;
    return;
  }

  grid.innerHTML = collectedMedia.map((item, idx) => `
    <div class="waa-photo-card ${selectedPhotos.has(idx) ? 'selected' : ''}"
         data-idx="${idx}" role="checkbox" aria-checked="${selectedPhotos.has(idx)}" tabindex="0">
      ${item.type === 'video'
        ? `<video src="${item.src}" muted preload="metadata"></video>`
        : `<img src="${item.src}" alt="Photo ${idx + 1}" loading="lazy" crossorigin="anonymous" />`
      }
      <div class="waa-photo-check">✓</div>
      <div class="waa-photo-type-badge">${item.type === 'video' ? '🎬 Video' : '📷 Photo'}</div>
    </div>`).join('');

  grid.querySelectorAll('.waa-photo-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.idx);
      if (selectedPhotos.has(idx)) selectedPhotos.delete(idx);
      else selectedPhotos.add(idx);
      card.classList.toggle('selected');
      card.setAttribute('aria-checked', selectedPhotos.has(idx));
      updatePhotoToolbar();
    });
  });
}

function updatePhotoToolbar() {
  const count = selectedPhotos.size;
  document.getElementById('waa-sel-count').textContent = count;
  document.getElementById('waa-dl-btn').disabled = count === 0;
}

function toggleSelectAll() {
  if (selectedPhotos.size === collectedMedia.length && collectedMedia.length > 0) {
    selectedPhotos.clear();
  } else {
    collectedMedia.forEach((_, i) => selectedPhotos.add(i));
  }
  renderPhotoGrid();
}

// ─── Download Photos as ZIP ───────────────────────────────────────────────────
async function downloadPhotosZip() {
  if (!selectedPhotos.size) return;

  const items = [...selectedPhotos].map(i => collectedMedia[i]);
  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const chatSlug = (currentChat.name || 'chat').replace(/[^a-z0-9]/gi, '_').toUpperCase();
  const filename = `whatsapp_photos_${chatSlug}_${dateStr}.zip`;

  const dlBtn = document.getElementById('waa-dl-btn');
  const progress = document.getElementById('waa-photo-progress');

  dlBtn.disabled = true;
  progress.classList.add('show');

  try {
    const zip = new JSZip();
    const folder = zip.folder('photos');
    let done = 0;

    for (const item of items) {
      try {
        const resp = await fetch(item.src);
        const blob = await resp.blob();
        const ext  = item.type === 'video' ? 'mp4' : (blob.type.includes('png') ? 'png' : 'jpg');
        const name = `photo_${String(done + 1).padStart(3, '0')}_${item.timestamp.toISOString().replace(/[:.]/g,'-').slice(0,19)}.${ext}`;
        folder.file(name, blob);
      } catch (e) {
        console.warn('[WA Assistant] Could not fetch media:', item.src, e);
      }

      done++;
      const pct = Math.round((done / items.length) * 85);
      setProgress('photo', `Packing ${done}/${items.length}…`, pct);
      await sleep(30);
    }

    setProgress('photo', 'Finalizing ZIP…', 95);
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    setProgress('photo', 'Done!', 100);

    await sleep(300);

    // Trigger download via object URL
    const url  = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    toast('success', 'Download Started!',
      `Successfully downloaded ${items.length} photo${items.length > 1 ? 's' : ''} as "${filename}".`);

  } catch (err) {
    toast('error', 'Download Failed', err.message || 'Unknown error occurred.');
    console.error('[WA Assistant]', err);
  } finally {
    await sleep(600);
    progress.classList.remove('show');
    document.getElementById('waa-prog-fill').style.width = '0%';
    dlBtn.disabled = selectedPhotos.size === 0;
  }
}

// ─── Chat Preview ─────────────────────────────────────────────────────────────
function getFilteredMessages() {
  const startVal = document.getElementById('waa-date-start')?.value;
  const endVal   = document.getElementById('waa-date-end')?.value;
  const start = startVal ? new Date(startVal + 'T00:00:00') : new Date(0);
  const end   = endVal   ? new Date(endVal   + 'T23:59:59') : new Date();
  return collectedMsgs.filter(m => m.timestamp >= start && m.timestamp <= end);
}

function renderChatPreview() {
  const filtered = getFilteredMessages();
  document.getElementById('waa-msg-count').textContent = filtered.length;

  const preview = document.getElementById('waa-chat-preview');

  if (!collectedMsgs.length) {
    preview.innerHTML = `
      <div class="waa-empty">
        <div class="waa-empty-icon">💬</div>
        <div class="waa-empty-title">No messages loaded</div>
        <div class="waa-empty-sub">Go to Photos tab and click <strong>Scan Chat</strong> first.</div>
      </div>`;
    return;
  }

  if (!filtered.length) {
    preview.innerHTML = `
      <div class="waa-empty">
        <div class="waa-empty-icon">📅</div>
        <div class="waa-empty-title">No messages in range</div>
        <div class="waa-empty-sub">Try expanding the date range.</div>
      </div>`;
    return;
  }

  let html = '';
  let lastDay = '';

  for (const msg of filtered) {
    const day = msg.timestamp.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    if (day !== lastDay) {
      html += `<div class="waa-date-pill">${day}</div>`;
      lastDay = day;
    }

    const time = pillState.timestamps
      ? `<div class="waa-msg-time">${msg.timestamp.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}</div>`
      : '';

    const senderLine = (!msg.isMine && pillState.sender)
      ? `<div class="waa-msg-sender">${escapeHtml(msg.sender)}</div>`
      : '';

    html += `
      <div class="waa-msg ${msg.isMine ? 'mine' : 'theirs'}">
        ${senderLine}
        ${escapeHtml(msg.text)}
        ${time}
      </div>`;
  }

  preview.innerHTML = html;
  preview.scrollTop = preview.scrollHeight;
}

// ─── Export Chat as ZIP ───────────────────────────────────────────────────────
async function exportChatZip() {
  const startVal = document.getElementById('waa-date-start')?.value;
  const endVal   = document.getElementById('waa-date-end')?.value;

  if (!startVal || !endVal) {
    toast('warn', 'Date Required', 'Please select both start and end dates.');
    return;
  }

  if (new Date(startVal) > new Date(endVal)) {
    toast('error', 'Invalid Range', 'Start date must be before end date.');
    return;
  }

  const filtered = getFilteredMessages();
  if (!filtered.length) {
    toast('warn', 'No Messages', 'No messages found in the selected date range.');
    return;
  }

  const chatSlug = (currentChat.name || 'chat').replace(/[^a-z0-9]/gi, '_').toUpperCase();
  const dateStr  = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const filename = `whatsapp_chat_${chatSlug}_${dateStr}.zip`;

  const exportBtn = document.getElementById('waa-export-btn');
  const progress  = document.getElementById('waa-chat-progress');

  exportBtn.disabled = true;
  progress.classList.add('show');

  try {
    const zip    = new JSZip();
    const startLabel = new Date(startVal).toLocaleDateString('en-IN');
    const endLabel   = new Date(endVal).toLocaleDateString('en-IN');

    // ── Build plain text export ──
    let txtContent = `WhatsApp Chat Export\n`;
    txtContent    += `════════════════════════════════════\n`;
    txtContent    += `Chat:       ${currentChat.name}\n`;
    txtContent    += `Date Range: ${startLabel} → ${endLabel}\n`;
    txtContent    += `Messages:   ${filtered.length}\n`;
    txtContent    += `Exported:   ${new Date().toLocaleString('en-IN')}\n`;
    txtContent    += `════════════════════════════════════\n\n`;

    let lastDay = '';
    for (const msg of filtered) {
      const day = msg.timestamp.toLocaleDateString('en-IN', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
      if (day !== lastDay) {
        txtContent += `\n──── ${day} ────\n\n`;
        lastDay = day;
      }

      const time = msg.timestamp.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
      const who  = pillState.sender ? msg.sender : (msg.isMine ? 'You' : 'Contact');
      txtContent += `[${time}] ${who}: ${msg.text}\n`;
    }

    zip.file('chat.txt', txtContent);
    setProgress('chat', 'Writing messages…', 40);
    await sleep(200);

    // ── Optionally include media in date range ──
    if (pillState.media) {
      const start = new Date(startVal + 'T00:00:00');
      const end   = new Date(endVal   + 'T23:59:59');
      const mediaInRange = collectedMedia.filter(m => m.timestamp >= start && m.timestamp <= end);

      if (mediaInRange.length > 0) {
        const mediaFolder = zip.folder('media');
        let fetched = 0;
        setProgress('chat', `Packing ${mediaInRange.length} media files…`, 50);

        for (const item of mediaInRange) {
          try {
            const resp = await fetch(item.src);
            const blob = await resp.blob();
            const ext  = item.type === 'video' ? 'mp4' : (blob.type.includes('png') ? 'png' : 'jpg');
            const name = `media_${String(fetched + 1).padStart(3,'0')}.${ext}`;
            mediaFolder.file(name, blob);
            fetched++;
            const pct = 50 + Math.round((fetched / mediaInRange.length) * 40);
            setProgress('chat', `Packing media ${fetched}/${mediaInRange.length}…`, pct);
            await sleep(20);
          } catch (e) {
            console.warn('[WA Assistant] Skipped media:', e);
          }
        }
      }
    }

    setProgress('chat', 'Generating ZIP…', 95);
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    setProgress('chat', 'Done!', 100);
    await sleep(300);

    const url  = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    toast('success', 'Export Complete!',
      `Successfully exported ${filtered.length} messages from "${currentChat.name}" (${startLabel} → ${endLabel}) as "${filename}".`);

  } catch (err) {
    toast('error', 'Export Failed', err.message || 'Unknown error.');
    console.error('[WA Assistant]', err);
  } finally {
    await sleep(600);
    progress.classList.remove('show');
    document.getElementById('waa-chat-prog-fill').style.width = '0%';
    exportBtn.disabled = false;
  }
}

// ─── Progress Helpers ─────────────────────────────────────────────────────────
function setProgress(type, label, pct) {
  if (type === 'photo') {
    document.getElementById('waa-prog-lbl').textContent  = label;
    document.getElementById('waa-prog-pct').textContent  = pct + '%';
    document.getElementById('waa-prog-fill').style.width = pct + '%';
  } else {
    document.getElementById('waa-chat-prog-lbl').textContent  = label;
    document.getElementById('waa-chat-prog-pct').textContent  = pct + '%';
    document.getElementById('waa-chat-prog-fill').style.width = pct + '%';
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(type, title, msg, duration = 5000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const wrap = document.getElementById('waa-toasts');
  const el = document.createElement('div');
  el.className = `waa-toast ${type}`;
  el.innerHTML = `
    <div class="waa-toast-icon">${icons[type] || '📌'}</div>
    <div>
      <div class="waa-toast-title">${escapeHtml(title)}</div>
      <div class="waa-toast-msg">${escapeHtml(msg)}</div>
    </div>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'waaFadeOut 0.35s ease forwards';
    setTimeout(() => el.remove(), 350);
  }, duration);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Observe chat changes (auto-rescan when user switches chat) ──────────────
let lastChatName = '';

const chatObserver = new MutationObserver(() => {
  const name = getCurrentChatName();
  if (name && name !== lastChatName) {
    lastChatName = name;
    // Auto-reset when chat switches
    if (document.getElementById('wa-assistant-sidebar')?.classList.contains('open')) {
      collectedMedia = [];
      collectedMsgs  = [];
      selectedPhotos.clear();
      refreshChatInfo();
      renderPhotoGrid();
      renderChatPreview();
      // Auto-scan after a brief delay to let WA load the chat
      setTimeout(scanCurrentChat, 1500);
    } else {
      refreshChatInfo();
    }
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  buildUI();

  // Periodically ensure our UI elements exist (handles WhatsApp Web React mounting clearing the body)
  setInterval(() => {
    if (!document.getElementById('wa-assistant-sidebar')) {
      console.log('[WhatsApp Assistant] Re-building UI elements...');
      buildUI();
    }
  }, 2000);

  // Start observing chat title changes
  const mainEl = document.querySelector('div#main') || document.body;
  chatObserver.observe(mainEl, { childList: true, subtree: true, characterData: true });

  console.log('[WhatsApp Assistant] ✅ Loaded — click the 🗂️ button on the right to open.');
}

// WhatsApp Web is a SPA — wait for it to fully load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // Already loaded; small delay for WA React hydration
  setTimeout(init, 2000);
}
