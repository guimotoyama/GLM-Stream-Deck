/* =========================================================
   GLM Stream Deck - script.js
   ========================================================= */

const DEFAULT_TABS = [
  {
    id: "tab_sistema",
    name: "Sistema",
    buttons: [
      { iconType:"emoji", icon:"▶️", label:"Play/Pause", color:"#1f6feb", actionType:"media", actionValue:"play/pause" },
      { iconType:"emoji", icon:"🔇", label:"Mudo", color:"#374151", actionType:"media", actionValue:"volume mute" },
      { iconType:"emoji", icon:"🔊", label:"Vol +", color:"#2ecc71", actionType:"media", actionValue:"volume up" },
      { iconType:"emoji", icon:"🔉", label:"Vol -", color:"#e67e22", actionType:"media", actionValue:"volume down" },
      { iconType:"emoji", icon:"⏭️", label:"Próxima", color:"#9b59b6", actionType:"media", actionValue:"next track" },
      { iconType:"emoji", icon:"⏮️", label:"Anterior", color:"#9b59b6", actionType:"media", actionValue:"previous track" },
      { iconType:"emoji", icon:"🔒", label:"Bloquear PC", color:"#e5484d", actionType:"key", actionValue:"win+l" },
      { iconType:"emoji", icon:"📸", label:"Print", color:"#34495e", actionType:"key", actionValue:"win+shift+s" },
      { iconType:"emoji", icon:"🗔", label:"Área Trab.", color:"#2980b9", actionType:"key", actionValue:"win+d" }
    ]
  },
  {
    id: "tab_gravacao",
    name: "Gravação",
    buttons: [
      { iconType:"brand", icon:"obsstudio", label:"OBS Studio", color:"#302b45", actionType:"open", actionValue:"obs64" },
      { iconType:"emoji", icon:"⏺️", label:"Gravar", color:"#e5484d", actionType:"key", actionValue:"win+alt+r" }
    ]
  },
  {
    id: "tab_programas",
    name: "Programas",
    buttons: [
      { iconType:"brand", icon:"visualstudiocode", label:"VS Code", color:"#007acc", actionType:"open", actionValue:"code" },
      { iconType:"brand", icon:"whatsapp", label:"WhatsApp", color:"#25d366", actionType:"open", actionValue:"https://web.whatsapp.com" },
      { iconType:"brand", icon:"notion", label:"Notion", color:"#000000", actionType:"open", actionValue:"https://notion.so" },
      { iconType:"brand", icon:"googlechrome", label:"Chrome", color:"#4285f4", actionType:"open", actionValue:"chrome" },
      { iconType:"brand", icon:"discord", label:"Discord", color:"#5865f2", actionType:"open", actionValue:"discord" },
      { iconType:"brand", icon:"spotify", label:"Spotify", color:"#1db954", actionType:"open", actionValue:"spotify" }
    ]
  },
  {
    id: "tab_jogos",
    name: "Jogos",
    buttons: []
  }
];

const STORAGE_KEY = "streamdeck_state";
const PING_MS = 5000;
const TIMEOUT_MS = 3000;

/* Endereço do PC. No GitHub Pages (HTTPS) precisa ser um endereço HTTPS,
   ex: https://meupc.tailxxxx.ts.net  (o navegador bloqueia http a partir de uma página https).
   Se o app for aberto direto pelo bridge (http://IP:8765), usa a própria origem. */
function baseUrl() {
  if (state.host) return state.host;
  return location.protocol === "http:" ? location.origin : "";
}

function normalizeHost(value) {
  let h = value.trim().replace(/\/+$/, "");
  if (h && !/^https?:\/\//i.test(h)) h = "https://" + h;
  return h;
}

const HTTP_ERRORS = {
  401: "Senha incorreta! Verifique em ⚙️",
  403: "Ação bloqueada pelo bridge.",
  429: "Muitas tentativas erradas. Aguarde 1 minuto.",
  400: "Comando inválido.",
  413: "Comando grande demais."
};

let state = { tabs: [], activeTabId: null, token: "", host: "" };

let editMode = false;
let editingIndex = null;
let editingTabId = null;
let uploadedImageData = null;

let pingEnabled = false;
let pingTimer = null;
let pingRun = 0;
let askedToken = false;

/* flag usada para não deixar um "clique" abrir o modal
   logo depois que o usuário acabou de arrastar um item */
let suppressClick = false;

/* contexto do item sendo arrastado no momento (ou null) */
let dragCtx = null;

const $ = (id) => document.getElementById(id);

/* ---------------- STORAGE ---------------- */
function validTabs(tabs) {
  return Array.isArray(tabs) && tabs.length > 0 && tabs.every(t =>
    t && typeof t.id === "string" && typeof t.name === "string" &&
    Array.isArray(t.buttons) &&
    t.buttons.every(b => b && typeof b.label === "string" &&
      typeof b.actionType === "string" && typeof b.actionValue === "string")
  );
}

function loadState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { saved = null; }

  if (saved && validTabs(saved.tabs)) {
    state.tabs = saved.tabs;
    state.activeTabId = saved.activeTabId;
    state.token = saved.token || "";
  } else if (saved && Array.isArray(saved.buttons)) {
    /* formato antigo (sem abas) */
    state.tabs = [{
      id: generateId(),
      name: "Principal",
      buttons: saved.buttons.filter(Boolean).map(b => ({ ...b, iconType: b.iconType || "emoji" }))
    }];
    state.token = saved.token || "";
  } else {
    state.tabs = JSON.parse(JSON.stringify(DEFAULT_TABS));
    state.token = (saved && saved.token) || "";
  }

  state.host = (saved && typeof saved.host === "string") ? saved.host : "";

  if (!state.tabs.some(t => t.id === state.activeTabId)) state.activeTabId = state.tabs[0].id;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    showToast("Não foi possível salvar (armazenamento cheio).");
  }
}

function generateId() {
  return "tab_" + Math.random().toString(36).slice(2, 9);
}

function getActiveTab() {
  return state.tabs.find(t => t.id === state.activeTabId);
}

/* ---------------- RENDER ABAS ---------------- */
function renderTabsBar() {
  const bar = $("tabsBar");
  bar.innerHTML = "";
  bar.classList.toggle("edit-mode", editMode);

  state.tabs.forEach((tab, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tab-chip" + (tab.id === state.activeTabId ? " active" : "");
    chip.textContent = tab.name;
    chip.dataset.index = index;

    chip.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; }
      if (editMode) {
        openTabModal(tab.id);
      } else {
        state.activeTabId = tab.id;
        saveState();
        renderTabsBar();
        renderGrid();
      }
    });

    attachDragHandlers(chip, "tab", index);
    bar.appendChild(chip);
  });

  const addChip = document.createElement("button");
  addChip.type = "button";
  addChip.className = "tab-chip add-tab";
  addChip.textContent = "+";
  addChip.addEventListener("click", () => openTabModal(null));
  bar.appendChild(addChip);
}

/* ---------------- RENDER GRID ---------------- */
function renderGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  grid.classList.toggle("edit-active", editMode);
  const tab = getActiveTab();
  if (!tab) return;

  tab.buttons.forEach((btn, index) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "deck-btn" + (editMode ? " edit-mode" : "");
    el.dataset.index = index;
    el.style.background = `linear-gradient(145deg, ${btn.color}, ${shade(btn.color, -18)})`;

    const label = document.createElement("span");
    label.textContent = btn.label || "";   /* textContent: não interpreta HTML */
    el.append(buildIcon(btn), label);

    el.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; }
      if (editMode) openButtonModal(index);
      else onButtonTap(index, el);
    });

    attachDragHandlers(el, "button", index);
    grid.appendChild(el);
  });

  if (editMode) {
    const addEl = document.createElement("button");
    addEl.type = "button";
    addEl.className = "deck-btn empty";
    addEl.textContent = "+";
    addEl.addEventListener("click", () => openButtonModal(null));
    grid.appendChild(addEl);
  }
}

function emojiIcon(text) {
  const s = document.createElement("span");
  s.className = "icon";
  s.textContent = text;
  return s;
}

function buildIcon(btn) {
  const isImg = (btn.iconType === "brand" || btn.iconType === "image") && btn.icon;
  if (!isImg) return emojiIcon(btn.icon || "🔘");

  const img = document.createElement("img");
  img.className = "icon-img";
  img.alt = "";
  img.draggable = false;
  img.src = btn.iconType === "brand"
    ? `https://cdn.simpleicons.org/${encodeURIComponent(btn.icon)}/ffffff`
    : btn.icon;
  /* sem internet (ou nome inválido): mostra um emoji no lugar */
  img.onerror = () => img.replaceWith(emojiIcon("🔘"));
  return img;
}

function shade(hex, percent) {
  const num = parseInt(String(hex).replace("#", ""), 16);
  if (isNaN(num)) return hex;
  const clamp = (v) => Math.min(255, Math.max(0, v));
  const r = clamp((num >> 16) + percent);
  const g = clamp(((num >> 8) & 0xff) + percent);
  const b = clamp((num & 0xff) + percent);
  return `rgb(${r},${g},${b})`;
}

/* ---------------- TOQUE NO BOTÃO ---------------- */
async function onButtonTap(index, el) {
  const tab = getActiveTab();
  const btn = tab && tab.buttons[index];
  if (!btn) return;
  vibrate();
  const ok = await sendCommand(btn.actionType, btn.actionValue);
  flash(el, ok);
}

function flash(el, ok) {
  if (!el.isConnected) return;
  const cls = ok ? "flash-ok" : "flash-fail";
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 450);
}

function vibrate(ms = 25) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

/* ---------------- MODO EDIÇÃO ---------------- */
$("editModeBtn").addEventListener("click", () => {
  editMode = !editMode;
  $("editModeBtn").classList.toggle("active", editMode);
  $("editHint").classList.toggle("hidden", !editMode);
  renderTabsBar();
  renderGrid();
});

/* =========================================================
   ARRASTAR PARA REORDENAR (abas e botões)
   ========================================================= */

function attachDragHandlers(el, type, index) {
  /* no iOS, segurar pressionado abre o menu de contexto */
  el.addEventListener("contextmenu", (e) => { if (editMode) e.preventDefault(); });

  el.addEventListener("pointerdown", (e) => {
    if (!editMode) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const timer = setTimeout(() => {
      if (!moved) beginDrag(e, el, type, index, startX, startY);
    }, 300);

    function onPreMove(ev) {
      if (Math.abs(ev.clientX - startX) > 8 || Math.abs(ev.clientY - startY) > 8) {
        moved = true;
        clearTimeout(timer);
        cleanup();
      }
    }
    function onPreUp() {
      clearTimeout(timer);
      cleanup();
    }
    function cleanup() {
      el.removeEventListener("pointermove", onPreMove);
      el.removeEventListener("pointerup", onPreUp);
    }

    el.addEventListener("pointermove", onPreMove);
    el.addEventListener("pointerup", onPreUp, { once: true });
  });
}

function beginDrag(e, el, type, index, startX, startY) {
  try { el.setPointerCapture(e.pointerId); } catch {}

  dragCtx = {
    type,
    fromIndex: index,
    hoverIndex: index,
    hoverElRef: null,
    pointerId: e.pointerId,
    el,
    startX,
    startY
  };

  el.classList.add("dragging");
  vibrate(15);

  document.addEventListener("pointermove", onDragMove);
  document.addEventListener("pointerup", onDragEnd);
  document.addEventListener("pointercancel", onDragEnd);
}

function onDragMove(e) {
  if (!dragCtx || e.pointerId !== dragCtx.pointerId) return;
  e.preventDefault();

  const dx = e.clientX - dragCtx.startX;
  const dy = e.clientY - dragCtx.startY;
  dragCtx.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;

  dragCtx.el.style.pointerEvents = "none";
  const target = document.elementFromPoint(e.clientX, e.clientY);
  dragCtx.el.style.pointerEvents = "";

  const selector = dragCtx.type === "tab" ? ".tab-chip:not(.add-tab)" : ".deck-btn:not(.empty)";
  const hoverEl = target ? target.closest(selector) : null;

  /* se o dedo não está sobre outro item, o destino volta a ser a posição original */
  let newIndex = dragCtx.fromIndex;
  if (hoverEl && hoverEl !== dragCtx.el) {
    const i = parseInt(hoverEl.dataset.index, 10);
    if (!isNaN(i)) newIndex = i;
  }

  if (newIndex !== dragCtx.hoverIndex) {
    if (dragCtx.hoverElRef) dragCtx.hoverElRef.classList.remove("drag-over");
    dragCtx.hoverElRef = newIndex !== dragCtx.fromIndex ? hoverEl : null;
    if (dragCtx.hoverElRef) dragCtx.hoverElRef.classList.add("drag-over");
    dragCtx.hoverIndex = newIndex;
  }
}

function onDragEnd(e) {
  if (!dragCtx || e.pointerId !== dragCtx.pointerId) return;

  document.removeEventListener("pointermove", onDragMove);
  document.removeEventListener("pointerup", onDragEnd);
  document.removeEventListener("pointercancel", onDragEnd);

  const { type, fromIndex, hoverIndex, hoverElRef, el } = dragCtx;

  el.classList.remove("dragging");
  el.style.transform = "";
  if (hoverElRef) hoverElRef.classList.remove("drag-over");

  dragCtx = null;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 50);

  if (hoverIndex !== fromIndex) {
    if (type === "tab") {
      const [item] = state.tabs.splice(fromIndex, 1);
      state.tabs.splice(hoverIndex, 0, item);
      saveState();
      renderTabsBar();
    } else {
      const tab = getActiveTab();
      const [item] = tab.buttons.splice(fromIndex, 1);
      tab.buttons.splice(hoverIndex, 0, item);
      saveState();
      renderGrid();
    }
  } else {
    if (type === "tab") renderTabsBar(); else renderGrid();
  }
}

/* ---------------- MODAL DE ABA ---------------- */
const tabModal = $("tabModal");
const tabNameInput = $("tabNameInput");

function openTabModal(tabId) {
  editingTabId = tabId;
  const tab = tabId ? state.tabs.find(t => t.id === tabId) : null;
  $("tabModalTitle").textContent = tab ? "Editar aba" : "Nova aba";
  tabNameInput.value = tab ? tab.name : "";
  $("deleteTabBtn").style.display = tab ? "block" : "none";
  tabModal.classList.remove("hidden");
}

$("closeTabModal").addEventListener("click", () => {
  tabModal.classList.add("hidden");
});

$("saveTabBtn").addEventListener("click", () => {
  const name = tabNameInput.value.trim();
  if (!name) { showToast("Digite um nome para a aba."); return; }

  if (editingTabId) {
    const tab = state.tabs.find(t => t.id === editingTabId);
    tab.name = name;
  } else {
    const newTab = { id: generateId(), name, buttons: [] };
    state.tabs.push(newTab);
    state.activeTabId = newTab.id;
  }
  saveState();
  renderTabsBar();
  renderGrid();
  tabModal.classList.add("hidden");
});

$("deleteTabBtn").addEventListener("click", () => {
  if (state.tabs.length <= 1) { showToast("Precisa ter ao menos uma aba."); return; }
  state.tabs = state.tabs.filter(t => t.id !== editingTabId);
  if (state.activeTabId === editingTabId) state.activeTabId = state.tabs[0].id;
  saveState();
  renderTabsBar();
  renderGrid();
  tabModal.classList.add("hidden");
});

/* ---------------- MODAL DE BOTÃO ---------------- */
const buttonModal = $("buttonModal");
const btnIconType = $("btnIconType");
const btnIcon = $("btnIcon");
const btnBrandSlug = $("btnBrandSlug");
const btnLabel = $("btnLabel");
const btnColor = $("btnColor");
const btnActionType = $("btnActionType");
const btnActionValue = $("btnActionValue");
const btnMediaSelect = $("btnMediaSelect");
const actionValueLabel = $("actionValueLabel");

function toggleIconFields() {
  const type = btnIconType.value;
  $("iconEmojiField").classList.toggle("hidden", type !== "emoji");
  $("iconBrandField").classList.toggle("hidden", type !== "brand");
  $("iconImageField").classList.toggle("hidden", type !== "image");
}
btnIconType.addEventListener("change", toggleIconFields);

function cleanSlug(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function updateBrandPreview() {
  const slug = cleanSlug(btnBrandSlug.value);
  const img = $("brandPreviewImg");
  const hint = $("brandPreviewHint");
  if (!slug) {
    img.classList.add("hidden");
    hint.textContent = "Digite o nome para ver o preview";
    hint.classList.remove("hidden");
    return;
  }
  img.onerror = () => {
    img.classList.add("hidden");
    hint.textContent = "Ícone não encontrado (ou sem internet)";
    hint.classList.remove("hidden");
  };
  img.onload = () => {
    img.classList.remove("hidden");
    hint.classList.add("hidden");
  };
  img.src = `https://cdn.simpleicons.org/${encodeURIComponent(slug)}/ffffff`;
}
btnBrandSlug.addEventListener("input", updateBrandPreview);

function updateImagePreview() {
  const img = $("imagePreviewImg");
  if (uploadedImageData) {
    img.src = uploadedImageData;
    img.classList.remove("hidden");
  } else {
    img.removeAttribute("src");
    img.classList.add("hidden");
  }
}

/* reduz a imagem para no máximo 128px antes de salvar (o localStorage é pequeno) */
function resizeImage(file, size = 128) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w0 = img.naturalWidth || size;
      const h0 = img.naturalHeight || size;
      const scale = Math.min(size / w0, size / h0, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem inválida")); };
    img.src = url;
  });
}

$("btnImageFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    uploadedImageData = await resizeImage(file);
    updateImagePreview();
  } catch {
    showToast("Não foi possível ler essa imagem.");
  }
});

function openButtonModal(index) {
  editingIndex = index;
  const tab = getActiveTab();
  const btn = (index !== null) ? tab.buttons[index] : null;

  $("buttonModalTitle").textContent = btn ? "Editar botão" : "Novo botão";

  const iconType = btn ? (btn.iconType || "emoji") : "emoji";
  btnIconType.value = iconType;
  toggleIconFields();

  btnIcon.value = (btn && iconType === "emoji") ? btn.icon : "";
  btnBrandSlug.value = (btn && iconType === "brand") ? btn.icon : "";
  uploadedImageData = (btn && iconType === "image") ? btn.icon : null;
  $("btnImageFile").value = "";
  updateBrandPreview();
  updateImagePreview();

  btnLabel.value = btn ? btn.label : "";
  btnColor.value = btn ? btn.color : "#1f6feb";
  btnActionType.value = btn ? btn.actionType : "key";
  btnActionValue.value = btn && btn.actionType !== "media" ? btn.actionValue : "";
  btnMediaSelect.value = btn && btn.actionType === "media" ? btn.actionValue : "play/pause";

  $("deleteBtnBtn").style.display = btn ? "block" : "none";

  toggleActionValueField();
  buttonModal.classList.remove("hidden");
}

function toggleActionValueField() {
  const isMedia = btnActionType.value === "media";
  btnMediaSelect.classList.toggle("hidden", !isMedia);
  btnActionValue.classList.toggle("hidden", isMedia);

  const labels = {
    key: "Atalho (ex: ctrl+c, win+d, alt+tab, f13)",
    media: "Selecione a ação de mídia",
    open: "URL (https://...) ou nome do app",
    text: "Texto que será digitado",
    shell: "Comando do sistema (precisa estar liberado no bridge)"
  };
  actionValueLabel.textContent = labels[btnActionType.value];
}
btnActionType.addEventListener("change", toggleActionValueField);

$("closeBtnModal").addEventListener("click", () => {
  buttonModal.classList.add("hidden");
});

$("saveBtnBtn").addEventListener("click", () => {
  const actionType = btnActionType.value;
  const actionValue = actionType === "media" ? btnMediaSelect.value : btnActionValue.value.trim();
  const iconType = btnIconType.value;

  let iconValue = "";
  if (iconType === "emoji") iconValue = btnIcon.value.trim() || "🔘";
  if (iconType === "brand") iconValue = cleanSlug(btnBrandSlug.value);
  if (iconType === "image") iconValue = uploadedImageData || "";

  if (!btnLabel.value.trim() || !actionValue) {
    showToast("Preencha nome e ação.");
    return;
  }
  if (iconType === "brand" && !iconValue) { showToast("Digite o nome do ícone."); return; }
  if (iconType === "image" && !iconValue) { showToast("Escolha uma imagem."); return; }

  const newButton = {
    iconType,
    icon: iconValue,
    label: btnLabel.value.trim(),
    color: btnColor.value,
    actionType,
    actionValue
  };

  const tab = getActiveTab();
  if (editingIndex === null) {
    tab.buttons.push(newButton);
  } else {
    tab.buttons[editingIndex] = newButton;
  }

  saveState();
  renderGrid();
  buttonModal.classList.add("hidden");
});

$("deleteBtnBtn").addEventListener("click", () => {
  if (editingIndex === null) return;
  const tab = getActiveTab();
  tab.buttons.splice(editingIndex, 1);
  saveState();
  renderGrid();
  buttonModal.classList.add("hidden");
});

/* ---------------- CONEXÃO ---------------- */
const connectionModal = $("connectionModal");
const tokenInput = $("tokenInput");
const hostInput = $("hostInput");

function openConnectionModal() {
  hostInput.value = state.host || "";
  tokenInput.value = state.token || "";
  connectionModal.classList.remove("hidden");
}

$("settingsBtn").addEventListener("click", openConnectionModal);

$("closeConnModal").addEventListener("click", () => {
  connectionModal.classList.add("hidden");
});

$("connectBtn").addEventListener("click", () => {
  const host = normalizeHost(hostInput.value);
  if (location.protocol === "https:" && host.startsWith("http://")) {
    showToast("No GitHub Pages o endereço do PC precisa começar com https://");
    return;
  }
  state.host = host;
  state.token = tokenInput.value.trim();
  saveState();
  askedToken = false;
  startPing();
  connectionModal.classList.add("hidden");
});

$("disconnectBtn").addEventListener("click", () => {
  stopPing();
  setStatus("offline", "Desconectado");
  connectionModal.classList.add("hidden");
});

/* ---------------- BACKUP DOS BOTÕES ---------------- */
$("exportBtn").addEventListener("click", () => {
  const data = JSON.stringify({ tabs: state.tabs }, null, 2);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = "glm-stream-deck.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("importBtn").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!validTabs(parsed.tabs)) throw new Error("formato inválido");
    state.tabs = parsed.tabs;
    state.activeTabId = state.tabs[0].id;
    saveState();
    renderTabsBar();
    renderGrid();
    connectionModal.classList.add("hidden");
    showToast("Botões importados!");
  } catch {
    showToast("Arquivo inválido. Use um backup exportado pelo app.");
  }
});

/* ---------------- STATUS / REDE ---------------- */
function setStatus(statusClass, text) {
  $("statusDot").className = "dot " + statusClass;
  $("statusText").textContent = text;
}

function authHeaders() {
  return state.token ? { "X-Auth-Token": state.token } : {};
}

async function fetchTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/* Retorna true se vale a pena continuar verificando. Em caso de senha errada
   ou bloqueio, para de insistir (insistir só aumentaria as tentativas erradas). */
async function checkConnection() {
  const base = baseUrl();
  if (!base) {
    setStatus("offline", "Defina o endereço em ⚙️");
    if (!askedToken) {
      askedToken = true;
      openConnectionModal();
    }
    return false;
  }
  try {
    const res = await fetchTimeout(`${base}/ping`, { headers: authHeaders() });
    if (res.ok) {
      setStatus("online", "Conectado");
      return true;
    }
    if (res.status === 401) {
      setStatus("offline", "Senha incorreta");
      if (!state.token && !askedToken) {
        askedToken = true;
        openConnectionModal();
      }
      return false;
    }
    if (res.status === 429) {
      setStatus("offline", "Bloqueado por 1 min");
      return false;
    }
    setStatus("offline", "Desconectado");
    return true;
  } catch {
    setStatus("offline", "Desconectado");
    return true;
  }
}

async function pingLoop() {
  const id = ++pingRun;
  const keepGoing = await checkConnection();
  if (id !== pingRun) return;   /* uma rodada mais nova assumiu */
  if (keepGoing && pingEnabled && !document.hidden) {
    pingTimer = setTimeout(pingLoop, PING_MS);
  }
}

function startPing() {
  pingEnabled = true;
  clearTimeout(pingTimer);
  setStatus("connecting", "Conectando...");
  pingLoop();
}

function stopPing() {
  pingEnabled = false;
  pingRun++;
  clearTimeout(pingTimer);
}

/* economiza bateria: não verifica com o app em segundo plano */
document.addEventListener("visibilitychange", () => {
  clearTimeout(pingTimer);
  if (!document.hidden && pingEnabled) pingLoop();
});

async function sendCommand(type, value) {
  const base = baseUrl();
  if (!base) {
    showToast("Defina o endereço do PC em ⚙️");
    return false;
  }
  if (!pingEnabled) {
    showToast("Desconectado. Toque em ⚙️ para conectar.");
    return false;
  }
  try {
    const res = await fetchTimeout(`${base}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ type, value })
    });
    if (res.ok) return true;

    if (res.status === 401) setStatus("offline", "Senha incorreta");
    showToast(HTTP_ERRORS[res.status] || "Erro ao executar comando no PC");
    return false;
  } catch {
    showToast("PC não encontrado. Verifique o Tailscale (celular e PC) e o bridge.");
    setStatus("offline", "Desconectado");
    return false;
  }
}

/* ---------------- TOAST ---------------- */
let toastTimer = null;
function showToast(msg) {
  const toast = $("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

/* ---------------- INIT ---------------- */
loadState();
renderTabsBar();
renderGrid();
startPing();
