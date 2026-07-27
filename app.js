// ============================================================
// CHARTED — app logic
// ============================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let state = {
  user: null,
  topics: [],
  notes: [],
  checklist: [],
  activity: [],
  currentView: 'dashboard',
  currentTopicId: null,
  currentTab: 'notes',
  isSignup: false,
  pendingImages: [],
  collapsedTopics: new Set(), // ids whose children are hidden on the map
  mapViewMode: localStorage.getItem('charted-map-view') || 'tree', // 'tree' | 'list'
};

const STATUS_LABELS = {
  uncharted: 'Uncharted',
  exploring: 'Exploring',
  charted: 'Charted',
  review: 'Needs review',
};
const STATUS_ORDER = ['uncharted', 'exploring', 'charted', 'review'];

// ---------- DOM shortcuts ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ============================================================
// AUTH
// ============================================================
const authScreen = $('#authScreen');
const appShell = $('#appShell');
const authForm = $('#authForm');
const authError = $('#authError');
const authToggleBtn = $('#authToggleBtn');
const authToggleLabel = $('#authToggleLabel');
const authSubmitBtn = $('#authSubmitBtn');

authToggleBtn.addEventListener('click', () => {
  state.isSignup = !state.isSignup;
  authSubmitBtn.textContent = state.isSignup ? 'Create account' : 'Enter the field';
  authToggleLabel.textContent = state.isSignup ? 'Already charting?' : 'New here?';
  authToggleBtn.textContent = state.isSignup ? 'Sign in instead' : 'Create an account';
  authError.classList.remove('show');
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  authError.classList.remove('show');
  authSubmitBtn.disabled = true;

  try {
    if (state.isSignup) {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      showToast('Account created — check your email if confirmation is required, then sign in.');
      state.isSignup = false;
      authSubmitBtn.textContent = 'Enter the field';
      authToggleLabel.textContent = 'New here?';
      authToggleBtn.textContent = 'Create an account';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    authError.textContent = err.message || 'Something went wrong.';
    authError.classList.add('show');
  } finally {
    authSubmitBtn.disabled = false;
  }
});

$('#signOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    state.user = session.user;
    authScreen.style.display = 'none';
    appShell.classList.add('active');
    initApp();
  } else {
    state.user = null;
    authScreen.style.display = 'grid';
    appShell.classList.remove('active');
  }
});

// ============================================================
// INIT / DATA LOADING
// ============================================================
async function initApp() {
  await Promise.all([loadTopics(), loadNotes(), loadChecklist(), loadActivity()]);
  renderAll();
}

async function loadTopics() {
  const { data, error } = await sb.from('topics').select('*').order('position', { ascending: true });
  if (!error) state.topics = data || [];
}
async function loadNotes() {
  const { data, error } = await sb.from('notes').select('*').order('created_at', { ascending: false });
  if (!error) state.notes = data || [];
}
async function loadChecklist() {
  const { data, error } = await sb.from('checklist_items').select('*').order('position', { ascending: true });
  if (!error) state.checklist = data || [];
}
async function loadActivity() {
  const { data, error } = await sb.from('activity_log').select('*').order('activity_date', { ascending: false });
  if (!error) state.activity = data || [];
}

async function logActivity() {
  const today = new Date().toISOString().slice(0, 10);
  await sb.from('activity_log').upsert(
    { user_id: state.user.id, activity_date: today },
    { onConflict: 'user_id,activity_date' }
  );
  await loadActivity();
}

function computeStreak() {
  if (!state.activity.length) return 0;
  const dates = new Set(state.activity.map((a) => a.activity_date));
  let streak = 0;
  let cursor = new Date();
  // today counts if present; otherwise start checking from yesterday
  if (!dates.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ============================================================
// NAV / VIEW SWITCHING
// ============================================================
$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
$('#backToMapBtn').addEventListener('click', () => switchView('map'));

function switchView(view) {
  state.currentView = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.remove('active'));
  const target = view === 'topic' ? $('#view-topic') : $(`#view-${view}`);
  target.classList.add('active');
  if (view !== 'topic') {
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  }
  renderAll();
}

function renderAll() {
  renderStreak();
  if (state.currentView === 'dashboard') renderDashboard();
  if (state.currentView === 'map') renderMap();
  if (state.currentView === 'topic') renderTopicDetail();
  if (state.currentView === 'guidebook') renderGuidebook();
  if (state.currentView === 'search') renderSearch();
}

// ============================================================
// DASHBOARD
// ============================================================
function renderStreak() {
  const streak = computeStreak();
  $('#streakChip').textContent = `🔥 ${streak}-day streak`;
  const el = $('#statStreak');
  if (el) el.textContent = streak;
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / 86400000);
}

function renderDashboard() {
  const total = state.topics.length;
  const charted = state.topics.filter((t) => t.status === 'charted').length;
  const pct = total ? Math.round((charted / total) * 100) : 0;

  $('#statTopics').textContent = total;
  $('#statNotes').textContent = state.notes.length;

  const needsReview = state.topics.filter(
    (t) => t.status === 'review' || (t.status === 'charted' && daysSince(t.last_reviewed_at) >= 14)
  );
  $('#statReview').textContent = needsReview.length;

  const circumference = 238.76;
  const offset = circumference - (pct / 100) * circumference;
  $('#ringFg').style.strokeDashoffset = offset;
  $('#ringLabel').textContent = `${pct}%`;
  $('#ringSub').textContent = `${charted} of ${total} topics fully charted`;

  const reviewList = $('#reviewList');
  if (!needsReview.length) {
    reviewList.innerHTML = `<div class="empty-note">Nothing needs revisiting yet — nice.</div>`;
  } else {
    reviewList.innerHTML = needsReview
      .map(
        (t) => `<div class="review-item" data-id="${t.id}">
          <span>${escapeHtml(t.title)}</span>
          <span class="days">${t.status === 'review' ? 'flagged' : daysSince(t.last_reviewed_at) + 'd ago'}</span>
        </div>`
      )
      .join('');
    $$('.review-item').forEach((el) =>
      el.addEventListener('click', () => openTopic(el.dataset.id))
    );
  }

  const activityList = $('#activityList');
  const recentNotes = [...state.notes].slice(0, 5);
  if (!recentNotes.length) {
    activityList.innerHTML = `<div class="empty-note">No activity logged yet. Add a topic or note to get started.</div>`;
  } else {
    activityList.innerHTML = recentNotes
      .map((n) => {
        const topic = state.topics.find((t) => t.id === n.topic_id);
        return `<div class="activity-item">
          <span>${escapeHtml(truncate(n.content, 60))}</span>
          <span class="days">${topic ? escapeHtml(topic.title) : ''}</span>
        </div>`;
      })
      .join('');
  }
}

// ============================================================
// MAP (topic tree)
// ============================================================
const STATUS_ICON = { uncharted: '○', exploring: '◐', charted: '●', review: '⚑' };

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const int = parseInt(full, 16);
  const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
function tileColorStyle(t) {
  if (!t.color) return '';
  return `border-color:${t.color};background:${hexToRgba(t.color, 0.16)};box-shadow:0 0 0 3px ${hexToRgba(t.color, 0.14)};color:${t.color};`;
}
function badgeColorStyle(t) {
  if (!t.color) return '';
  return `border-color:${t.color};background:${t.color};`;
}

function computeLayout() {
  const childrenMap = {};
  state.topics.forEach((t) => {
    const key = t.parent_id || 'root';
    (childrenMap[key] = childrenMap[key] || []).push(t);
  });
  Object.values(childrenMap).forEach((arr) => arr.sort((a, b) => a.position - b.position));

  const positions = {};
  let leafCounter = 0;
  function assign(node, depth) {
    const kids = childrenMap[node.id] || [];
    const collapsed = state.collapsedTopics.has(node.id);
    if (!kids.length || collapsed) {
      positions[node.id] = { x: leafCounter, depth, hasChildren: kids.length > 0, collapsed };
      leafCounter += 1;
    } else {
      kids.forEach((k) => assign(k, depth + 1));
      const xs = kids.map((k) => positions[k.id].x);
      positions[node.id] = { x: (Math.min(...xs) + Math.max(...xs)) / 2, depth, hasChildren: true, collapsed: false };
    }
  }
  (childrenMap['root'] || []).forEach((r) => assign(r, 0));
  return { positions, leafCount: Math.max(leafCounter, 1) };
}

function renderMap() {
  $$('#viewModeToggle .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mapViewMode));
  $('#mapCanvasWrap').classList.toggle('hidden', state.mapViewMode !== 'tree');
  $('#listViewWrap').classList.toggle('hidden', state.mapViewMode !== 'list');

  if (state.mapViewMode === 'list') {
    renderListView();
  } else {
    renderTreeMap();
  }
}

$$('#viewModeToggle .mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.mapViewMode = btn.dataset.mode;
    localStorage.setItem('charted-map-view', state.mapViewMode);
    renderMap();
  });
});

function renderListView() {
  const tree = $('#mapListTree');
  tree.innerHTML = renderListNodes(null);
  bindListEvents(tree);
  $('#addRootTopicBtnList').onclick = () => promptNewTopic(null);
}

function renderListNodes(parentId) {
  const children = state.topics.filter((t) => t.parent_id === parentId).sort((a, b) => a.position - b.position);
  if (!children.length) return '';
  return children
    .map((t) => {
      const kids = state.topics.filter((c) => c.parent_id === t.id);
      const collapsed = state.collapsedTopics.has(t.id);
      const sub = kids.length && !collapsed ? renderListNodes(t.id) : '';
      const noteCount = state.notes.filter((n) => n.topic_id === t.id).length;
      return `
      <div class="topic-node">
        <div class="topic-row" data-id="${t.id}">
          ${kids.length
            ? `<button class="row-toggle-btn" data-id="${t.id}" title="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▸' : '▾'}</button>`
            : `<span class="row-toggle-spacer"></span>`}
          <span class="badge ${t.status}" style="${badgeColorStyle(t)}"></span>
          <span class="topic-title">${escapeHtml(t.title)}</span>
          <span class="topic-meta">${noteCount} note${noteCount === 1 ? '' : 's'}</span>
          <span class="topic-row-actions">
            <button class="row-btn row-earlier" data-id="${t.id}" title="Move earlier">↑</button>
            <button class="row-btn row-later" data-id="${t.id}" title="Move later">↓</button>
            <button class="row-btn" data-id="${t.id}" data-action="add" title="Add sub-region">+</button>
            <button class="row-btn row-delete" data-id="${t.id}" title="Delete">✕</button>
          </span>
        </div>
        ${sub ? `<div class="topic-children">${sub}</div>` : ''}
      </div>`;
    })
    .join('');
}

function bindListEvents(container) {
  container.querySelectorAll('.topic-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-toggle-btn, .topic-row-actions')) return;
      openTopic(row.dataset.id);
    });
  });
  container.querySelectorAll('.row-toggle-btn').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(b.dataset.id); })
  );
  container.querySelectorAll('.row-earlier').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); moveTopic(b.dataset.id, -1); })
  );
  container.querySelectorAll('.row-later').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); moveTopic(b.dataset.id, 1); })
  );
  container.querySelectorAll('[data-action="add"]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); promptNewTopic(b.dataset.id); })
  );
  container.querySelectorAll('.row-delete').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteTopic(b.dataset.id); })
  );
}

function renderTreeMap() {
  const { positions, leafCount } = computeLayout();

  // variable tile size: shrink everything as the map grows wider,
  // so a big tree stays readable without a giant scrollbar.
  const scale = Math.max(0.55, Math.min(1, 9 / leafCount));
  const tile = Math.round(60 * scale);
  const colWidth = Math.round(120 * scale);
  const rowHeight = Math.round(112 * scale);
  const padX = 60, padY = 20;
  const fontSize = Math.max(13, Math.round(22 * scale));
  const labelSize = Math.max(10, Math.round(11.5 * scale));

  let maxDepth = 0;
  Object.values(positions).forEach((p) => { if (p.depth > maxDepth) maxDepth = p.depth; });

  const canvas = $('#mapCanvas');
  const svg = $('#mapConnectors');
  const width = leafCount * colWidth + padX * 2;
  const height = (maxDepth + 1) * rowHeight + padY * 2 + 20;

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.innerHTML = '';
  // clear everything in the canvas except the connectors svg itself
  Array.from(canvas.children).forEach((child) => {
    if (child !== svg) child.remove();
  });

  if (!state.topics.length) {
    canvas.style.height = '160px';
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.style.padding = '60px 20px';
    empty.textContent = 'No regions charted yet — add your first expedition point above.';
    canvas.appendChild(empty);
    $('#addRootTopicBtn').onclick = () => promptNewTopic(null);
    return;
  }

  // tile CENTER x / TOP y for a given position entry — this is the single
  // source of truth both nodes and connectors read from, so they can never
  // drift apart the way they did before.
  const centerXOf = (pos) => pos.x * colWidth + padX + colWidth / 2;
  const topYOf = (pos) => pos.depth * rowHeight + padY;

  const visibleTopics = state.topics.filter((t) => positions[t.id]);

  visibleTopics.forEach((t) => {
    if (t.parent_id && positions[t.parent_id]) {
      const pPos = positions[t.parent_id];
      const cPos = positions[t.id];
      const x1 = centerXOf(pPos), y1 = topYOf(pPos) + tile;
      const x2 = centerXOf(cPos), y2 = topYOf(cPos);
      const midY = (y1 + y2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`);
      path.setAttribute('class', `connector ${t.status}`);
      if (t.color) path.setAttribute('style', `stroke:${hexToRgba(t.color, 0.55)}`);
      svg.appendChild(path);
    }
  });

  visibleTopics.forEach((t) => {
    const pos = positions[t.id];
    const centerX = centerXOf(pos);
    const topY = topYOf(pos);
    const noteCount = state.notes.filter((n) => n.topic_id === t.id).length;
    const el = document.createElement('div');
    el.className = 'map-node';
    el.style.left = centerX + 'px';
    el.style.top = topY + 'px';
    el.innerHTML = `
      <div class="map-tile ${t.status}" data-id="${t.id}" style="width:${tile}px;height:${tile}px;font-size:${fontSize}px;${tileColorStyle(t)}">
        <span class="map-tile-icon">${STATUS_ICON[t.status] || '○'}</span>
        <button class="map-add-btn" data-id="${t.id}" title="Add sub-region">+</button>
        <button class="map-delete-btn" data-id="${t.id}" title="Delete this region">✕</button>
        ${pos.hasChildren ? `<button class="map-toggle-btn" data-id="${t.id}" title="${pos.collapsed ? 'Expand' : 'Collapse'} sub-regions">${pos.collapsed ? '▸' : '▾'}</button>` : ''}
      </div>
      <div class="map-label" style="font-size:${labelSize}px;">${escapeHtml(truncate(t.title, 18))}${noteCount ? ` <span style="color:var(--text-muted)">(${noteCount})</span>` : ''}</div>
    `;
    canvas.appendChild(el);
  });

  canvas.querySelectorAll('.map-tile').forEach((tileEl) =>
    tileEl.addEventListener('click', (e) => {
      if (e.target.closest('.map-add-btn, .map-delete-btn, .map-toggle-btn')) return;
      openTopic(tileEl.dataset.id);
    })
  );
  canvas.querySelectorAll('.map-add-btn').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      promptNewTopic(b.dataset.id);
    })
  );
  canvas.querySelectorAll('.map-delete-btn').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTopic(b.dataset.id);
    })
  );
  canvas.querySelectorAll('.map-toggle-btn').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapse(b.dataset.id);
    })
  );
  $('#addRootTopicBtn').onclick = () => promptNewTopic(null);
}

function toggleCollapse(topicId) {
  if (state.collapsedTopics.has(topicId)) {
    state.collapsedTopics.delete(topicId);
  } else {
    state.collapsedTopics.add(topicId);
  }
  renderAll();
}

async function deleteTopic(topicId) {
  const topic = state.topics.find((t) => t.id === topicId);
  if (!topic) return;
  const childCount = state.topics.filter((t) => t.parent_id === topicId).length;
  const warning = childCount
    ? `Delete "${topic.title}" and its ${childCount} sub-region${childCount === 1 ? '' : 's'}, plus all their notes and steps? This can't be undone.`
    : `Delete "${topic.title}" and all its notes and steps? This can't be undone.`;
  if (!confirm(warning)) return;

  const { error } = await sb.from('topics').delete().eq('id', topicId);
  if (error) return showToast('Could not delete: ' + error.message);

  state.collapsedTopics.delete(topicId);
  const wasOpenTopic = state.currentTopicId === topicId;
  await Promise.all([loadTopics(), loadNotes(), loadChecklist()]);

  if (wasOpenTopic || (state.currentTopicId && !state.topics.find((t) => t.id === state.currentTopicId))) {
    switchView('map');
  } else {
    renderAll();
  }
  showToast('Region deleted.');
}

async function moveTopic(topicId, direction) {
  const topic = state.topics.find((t) => t.id === topicId);
  if (!topic) return;
  const siblings = state.topics
    .filter((t) => t.parent_id === topic.parent_id)
    .sort((a, b) => a.position - b.position);
  const idx = siblings.findIndex((t) => t.id === topicId);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;

  const other = siblings[swapIdx];
  const [err1, err2] = await Promise.all([
    sb.from('topics').update({ position: other.position }).eq('id', topic.id).then((r) => r.error),
    sb.from('topics').update({ position: topic.position }).eq('id', other.id).then((r) => r.error),
  ]);
  if (err1 || err2) return showToast('Could not reorder.');

  await loadTopics();
  renderAll();
}

function renderTree(parentId) {
  const children = state.topics.filter((t) => t.parent_id === parentId);
  if (!children.length) return '';
  return children
    .map((t) => {
      const sub = renderTree(t.id);
      const noteCount = state.notes.filter((n) => n.topic_id === t.id).length;
      return `
      <div class="topic-node">
        <div class="topic-row" data-id="${t.id}">
          <span class="badge ${t.status}" style="${badgeColorStyle(t)}"></span>
          <span class="topic-title">${escapeHtml(t.title)}</span>
          <span class="topic-meta">${noteCount} note${noteCount === 1 ? '' : 's'}</span>
        </div>
        ${sub ? `<div class="topic-children">${sub}</div>` : ''}
      </div>`;
    })
    .join('');
}

function bindTreeEvents(container) {
  container.querySelectorAll('.topic-row').forEach((row) => {
    row.addEventListener('click', () => openTopic(row.dataset.id));
  });
}

async function promptNewTopic(parentId) {
  const title = prompt('Name this region (e.g. "Attendance", "Grading", "User Roles"):');
  if (!title || !title.trim()) return;
  const siblings = state.topics.filter((t) => t.parent_id === parentId);
  const { error } = await sb.from('topics').insert({
    user_id: state.user.id,
    parent_id: parentId,
    title: title.trim(),
    position: siblings.length,
  });
  if (error) return showToast('Could not add topic: ' + error.message);
  await logActivity();
  await loadTopics();
  showToast('New region added to the map.');
  renderAll();
}

// ============================================================
// TOPIC DETAIL
// ============================================================
function openTopic(id) {
  state.currentTopicId = id;
  state.currentTab = 'notes';
  switchView('topic');
}

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.currentTab = btn.dataset.tab;
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
  });
});

function renderTopicDetail() {
  const topic = state.topics.find((t) => t.id === state.currentTopicId);
  if (!topic) return switchView('map');

  $('#topicTitle').textContent = topic.title;
  $('#topicMeta').textContent = `Last reviewed ${topic.last_reviewed_at ? daysSince(topic.last_reviewed_at) + ' days ago' : 'never'}`;

  $('#statusSelect').innerHTML = STATUS_ORDER.map(
    (s) => `<button class="status-pill ${s === topic.status ? 'active ' + s : ''}" data-status="${s}">${STATUS_LABELS[s]}</button>`
  ).join('');
  $$('#statusSelect .status-pill').forEach((btn) => {
    btn.addEventListener('click', () => setTopicStatus(topic.id, btn.dataset.status));
  });
  $('#deleteTopicBtn').onclick = () => deleteTopic(topic.id);
  $('#moveEarlierBtn').onclick = () => moveTopic(topic.id, -1);
  $('#moveLaterBtn').onclick = () => moveTopic(topic.id, 1);
  const siblings = state.topics.filter((t) => t.parent_id === topic.parent_id).sort((a, b) => a.position - b.position);
  const idx = siblings.findIndex((t) => t.id === topic.id);
  $('#moveEarlierBtn').disabled = idx <= 0;
  $('#moveLaterBtn').disabled = idx >= siblings.length - 1;

  renderColorPicker(topic);

  renderNotesForTopic(topic.id);
  renderChecklistForTopic(topic.id);
  renderSubtopics(topic.id);
}

const COLOR_PRESETS = ['#C9A227', '#2F9E8F', '#E4572E', '#7C9CFF', '#C77DFF', '#4FB86A', '#E5A5D6', '#93A0AC'];

function renderColorPicker(topic) {
  const swatches = $('#colorSwatches');
  swatches.innerHTML = COLOR_PRESETS.map(
    (c) => `<button class="color-swatch ${topic.color === c ? 'active' : ''}" style="background:${c}" data-color="${c}" title="${c}"></button>`
  ).join('');
  swatches.querySelectorAll('.color-swatch').forEach((b) =>
    b.addEventListener('click', () => setTopicColor(topic.id, b.dataset.color))
  );
  $('#colorCustomInput').value = topic.color || '#c9a227';
  $('#colorCustomInput').onchange = (e) => setTopicColor(topic.id, e.target.value);
  $('#colorClearBtn').onclick = () => setTopicColor(topic.id, null);
}

async function setTopicColor(topicId, color) {
  const { error } = await sb.from('topics').update({ color }).eq('id', topicId);
  if (error) return showToast('Could not update color.');
  await loadTopics();
  renderAll();
}

async function setTopicStatus(topicId, status) {
  const wasCharted = state.topics.find((t) => t.id === topicId)?.status === 'charted';
  const { error } = await sb
    .from('topics')
    .update({ status, last_reviewed_at: new Date().toISOString() })
    .eq('id', topicId);
  if (error) return showToast('Could not update status.');
  await logActivity();
  await loadTopics();
  renderAll();
  if (status === 'charted' && !wasCharted) triggerSeal();
}

function renderSubtopics(topicId) {
  $('#subtopicTree').innerHTML = renderTree(topicId) || `<div class="empty-note">No sub-regions yet.</div>`;
  bindTreeEvents($('#subtopicTree'));
  $('#addSubtopicBtn').onclick = () => promptNewTopic(topicId);
}

// ---------- notes ----------
$('#noteImageInput').addEventListener('change', (e) => {
  state.pendingImages = Array.from(e.target.files || []);
  const row = $('#imagePreviewRow');
  row.innerHTML = state.pendingImages
    .map((f) => `<img src="${URL.createObjectURL(f)}">`)
    .join('');
});

$('#saveNoteBtn').addEventListener('click', saveNote);

async function saveNote() {
  const content = $('#noteContent').value.trim();
  if (!content) return showToast('Write something before saving.');
  const tags = $('#noteTags').value.split(',').map((t) => t.trim()).filter(Boolean);
  const isQuickRef = $('#noteQuickRef').checked;
  const topicId = state.currentTopicId;

  const imagePaths = [];
  for (const file of state.pendingImages) {
    const path = `${state.user.id}/${topicId}/${Date.now()}-${file.name}`;
    const { error: upErr } = await sb.storage.from('note-images').upload(path, file);
    if (!upErr) imagePaths.push(path);
  }

  const { error } = await sb.from('notes').insert({
    user_id: state.user.id,
    topic_id: topicId,
    content,
    tags,
    is_quick_ref: isQuickRef,
    image_paths: imagePaths,
  });
  if (error) return showToast('Could not save note: ' + error.message);

  await sb.from('topics').update({ last_reviewed_at: new Date().toISOString() }).eq('id', topicId);
  await logActivity();
  await Promise.all([loadNotes(), loadTopics()]);

  $('#noteContent').value = '';
  $('#noteTags').value = '';
  $('#noteQuickRef').checked = false;
  $('#noteImageInput').value = '';
  $('#imagePreviewRow').innerHTML = '';
  state.pendingImages = [];

  showToast('Note saved.');
  renderAll();
}

async function renderNotesForTopic(topicId) {
  const notes = state.notes
    .filter((n) => n.topic_id === topicId)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const list = $('#notesList');
  if (!notes.length) {
    list.innerHTML = `<div class="empty-note">No field notes yet for this region.</div>`;
    return;
  }
  list.innerHTML = notes.map((n) => noteCardHtml(n)).join('');

  list.querySelectorAll('.pin-btn').forEach((b) =>
    b.addEventListener('click', () => togglePin(b.dataset.id))
  );
  list.querySelectorAll('.delete-note-btn').forEach((b) =>
    b.addEventListener('click', () => deleteNote(b.dataset.id))
  );

  // resolve signed image urls asynchronously
  for (const n of notes) {
    if (!n.image_paths || !n.image_paths.length) continue;
    const wrap = list.querySelector(`.note-images[data-id="${n.id}"]`);
    if (!wrap) continue;
    const urls = await Promise.all(
      n.image_paths.map(async (p) => {
        const { data } = await sb.storage.from('note-images').createSignedUrl(p, 3600);
        return data?.signedUrl;
      })
    );
    wrap.innerHTML = urls.filter(Boolean).map((u) => `<img src="${u}">`).join('');
  }
}

function noteCardHtml(n) {
  return `
  <div class="note-card ${n.pinned ? 'pinned' : ''}">
    <div class="note-top">
      <span class="note-date">${new Date(n.created_at).toLocaleDateString()} ${n.is_quick_ref ? '· quick ref' : ''}</span>
      <span class="note-actions">
        <button class="pin-btn" data-id="${n.id}">${n.pinned ? '★ unpin' : '☆ pin'}</button>
        <button class="delete-note-btn" data-id="${n.id}">✕</button>
      </span>
    </div>
    <div class="note-content">${escapeHtml(n.content)}</div>
    ${n.tags && n.tags.length ? `<div class="note-tags">${n.tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    ${n.image_paths && n.image_paths.length ? `<div class="note-images" data-id="${n.id}"></div>` : ''}
  </div>`;
}

async function togglePin(noteId) {
  const note = state.notes.find((n) => n.id === noteId);
  await sb.from('notes').update({ pinned: !note.pinned }).eq('id', noteId);
  await loadNotes();
  renderAll();
}
async function deleteNote(noteId) {
  if (!confirm('Delete this note?')) return;
  await sb.from('notes').delete().eq('id', noteId);
  await loadNotes();
  showToast('Note deleted.');
  renderAll();
}

// ---------- checklist ----------
$('#addChecklistBtn').addEventListener('click', addChecklistItem);
async function addChecklistItem() {
  const text = $('#checklistInput').value.trim();
  if (!text) return;
  const existing = state.checklist.filter((c) => c.topic_id === state.currentTopicId);
  const { error } = await sb.from('checklist_items').insert({
    user_id: state.user.id,
    topic_id: state.currentTopicId,
    text,
    position: existing.length,
  });
  if (error) return showToast('Could not add step.');
  $('#checklistInput').value = '';
  await logActivity();
  await loadChecklist();
  renderAll();
}

function renderChecklistForTopic(topicId) {
  const items = state.checklist.filter((c) => c.topic_id === topicId).sort((a, b) => a.position - b.position);
  const list = $('#checklistList');
  if (!items.length) {
    list.innerHTML = `<div class="empty-note">No steps recorded yet.</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (c) => `<div class="checklist-item ${c.checked ? 'checked' : ''}">
        <input type="checkbox" data-id="${c.id}" ${c.checked ? 'checked' : ''}>
        <span class="check-text">${escapeHtml(c.text)}</span>
        <button class="delete-note-btn" data-id="${c.id}" data-type="checklist">✕</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('input[type=checkbox]').forEach((cb) =>
    cb.addEventListener('change', () => toggleChecklistItem(cb.dataset.id, cb.checked))
  );
  list.querySelectorAll('.delete-note-btn').forEach((b) =>
    b.addEventListener('click', () => deleteChecklistItem(b.dataset.id))
  );
}
async function toggleChecklistItem(id, checked) {
  await sb.from('checklist_items').update({ checked }).eq('id', id);
  await loadChecklist();
  renderAll();
}
async function deleteChecklistItem(id) {
  await sb.from('checklist_items').delete().eq('id', id);
  await loadChecklist();
  renderAll();
}

// ============================================================
// GUIDEBOOK
// ============================================================
function renderGuidebook() {
  const chartedTopics = state.topics.filter((t) => t.status === 'charted' || t.status === 'review');
  const container = $('#guidebookList');
  if (!chartedTopics.length) {
    container.innerHTML = `<div class="guide-empty">Nothing charted yet. Once you mark a region "Charted," it shows up here as a polished reference.</div>`;
    return;
  }
  container.innerHTML = chartedTopics
    .map((t) => {
      const notes = state.notes.filter((n) => n.topic_id === t.id);
      const quickRefs = notes.filter((n) => n.is_quick_ref);
      const steps = state.checklist.filter((c) => c.topic_id === t.id).sort((a, b) => a.position - b.position);
      return `<div class="guide-topic">
        <h3>${escapeHtml(t.title)}</h3>
        ${steps.length ? `<ol>${steps.map((s) => `<li>${escapeHtml(s.text)}</li>`).join('')}</ol>` : ''}
        ${(quickRefs.length ? quickRefs : notes)
          .map((n) => `<div class="guide-note">${escapeHtml(n.content)}</div>`)
          .join('')}
      </div>`;
    })
    .join('');
}

// ============================================================
// SEARCH
// ============================================================
$('#searchInput').addEventListener('input', renderSearch);

function renderSearch() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const results = $('#searchResults');
  if (!q) {
    results.innerHTML = `<div class="empty-note">Type to search across every note, step, and region.</div>`;
    return;
  }
  const hits = [];
  state.notes.forEach((n) => {
    const hay = (n.content + ' ' + (n.tags || []).join(' ')).toLowerCase();
    if (hay.includes(q)) {
      const topic = state.topics.find((t) => t.id === n.topic_id);
      hits.push({ topicId: n.topic_id, topicTitle: topic?.title || '', snippet: n.content });
    }
  });
  state.checklist.forEach((c) => {
    if (c.text.toLowerCase().includes(q)) {
      const topic = state.topics.find((t) => t.id === c.topic_id);
      hits.push({ topicId: c.topic_id, topicTitle: topic?.title || '', snippet: c.text });
    }
  });
  state.topics.forEach((t) => {
    if (t.title.toLowerCase().includes(q)) {
      hits.push({ topicId: t.id, topicTitle: t.title, snippet: `Region: ${t.title}` });
    }
  });

  if (!hits.length) {
    results.innerHTML = `<div class="empty-note">No matches for "${escapeHtml(q)}".</div>`;
    return;
  }
  results.innerHTML = hits
    .map(
      (h) => `<div class="result-item" data-id="${h.topicId}">
        <div class="result-topic">${escapeHtml(h.topicTitle)}</div>
        <div class="result-snippet">${highlight(escapeHtml(truncate(h.snippet, 140)), q)}</div>
      </div>`
    )
    .join('');
  results.querySelectorAll('.result-item').forEach((el) =>
    el.addEventListener('click', () => openTopic(el.dataset.id))
  );
}

function highlight(text, q) {
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  return text.replace(re, '<mark>$1</mark>');
}

// ============================================================
// EXPORT MARKDOWN
// ============================================================
$('#exportBtn').addEventListener('click', exportMarkdown);

function exportMarkdown() {
  let md = `# Charted — Field Guide\n\nExported ${new Date().toLocaleDateString()}\n\n`;
  const roots = state.topics.filter((t) => !t.parent_id);
  const writeTopic = (t, depth) => {
    md += `${'#'.repeat(Math.min(depth + 1, 6))} ${t.title} _(${STATUS_LABELS[t.status]})_\n\n`;
    const steps = state.checklist.filter((c) => c.topic_id === t.id).sort((a, b) => a.position - b.position);
    if (steps.length) {
      steps.forEach((s, i) => (md += `${i + 1}. ${s.checked ? '[x]' : '[ ]'} ${s.text}\n`));
      md += '\n';
    }
    const notes = state.notes.filter((n) => n.topic_id === t.id);
    notes.forEach((n) => {
      md += `> ${n.content.replace(/\n/g, '\n> ')}\n\n`;
      if (n.tags && n.tags.length) md += `Tags: ${n.tags.join(', ')}\n\n`;
    });
    state.topics
      .filter((c) => c.parent_id === t.id)
      .forEach((c) => writeTopic(c, depth + 1));
  };
  roots.forEach((t) => writeTopic(t, 1));

  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'charted-guidebook.md';
  a.click();
  showToast('Guidebook exported as Markdown.');
}

// ============================================================
// UI HELPERS
// ============================================================
function showToast(msg) {
  const wrap = $('#toastWrap');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function triggerSeal() {
  const overlay = $('#sealOverlay');
  overlay.classList.add('show');
  setTimeout(() => overlay.classList.remove('show'), 1000);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}
