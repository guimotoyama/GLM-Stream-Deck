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
      { iconType:"emoji", icon:"⏺️", label:"Iniciar Grav.", color:"#e5484d", actionType:"key", actionValue:"win+alt+r" },
      { iconType:"emoji", icon:"⏹️", label:"Parar Grav.", color:"#374151", actionType:"key", actionValue:"win+alt+r" }
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

let state = {
  tabs: [],
  activeTabId: null,
  ip: "",
  port: "8765",
  token: ""
};

let editMode = false;
let editingIndex = null;
let editingTabId = null;
let uploadedImageData = null;
let pingInterval = null;

/* flag usada para não deixar um "clique" abrir o modal
   logo depois que o usuário acabou de arrastar um item */
let suppressClick = false;

/* contexto do item sendo arrastado no momento (ou null) */
let dragCtx = null;

/* ---------------- STORAGE ---------------- */
function loadState() {
  const saved = localStorage.getItem("streamdeck_state");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.tabs) {
      state = parsed;
    } else {
      state = {
        tabs: [{
          id: generateId(),
          name: "Principal",
          buttons: (parsed.buttons || []).filter(Boolean).map(b => ({ ...b, iconType: b.iconType || "emoji" }))
        }],
        activeTabId: null,
        ip: parsed.ip || "",
        port: parsed.port || "8765",
        token: parsed.token || ""
      };
    }
  } else {
    state.tabs = JSON.parse(JSON.stringify(DEFAULT_TABS));
  }
  if (!state.activeTabId && state.tabs.length) state.activeTabId = state.tabs[0].id;
  if (!state.token) state.token = "";
}

function saveState() {
  localStorage.setItem("streamdeck_state", JSON.stringify(state));
}

function generateId() {
  return "tab_" + Math.random().toString(36).slice(2, 9);
}

function getActiveTab() {
  return state.tabs.find(t => t.id === state.activeTabId);
}

/* ---------------- RENDER ABAS ---------------- */
function renderTabsBar() {
  const bar = document.getElementById("tabsBar");
  bar.innerHTML = "";
  bar.classList.toggle("edit-mode", editMode);

  state.tabs.forEach((tab, index) => {
    const chip = document.createElement("button");
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
  addChip.className = "tab-chip add-tab";
  addChip.textContent = "+";
  addChip.addEventListener("click", () => openTabModal(null));
  bar.appendChild(addChip);
}

/* ---------------- RENDER GRID ---------------- */
function renderGrid() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  grid.classList.toggle("edit-active", editMode);
  const tab = getActiveTab();
  if (!tab) return;

  tab.buttons.forEach((btn, index) => {
    const el = document.createElement("div");
    el.className = "deck-btn";
    el.dataset.index = index;
    el.style.background = `linear-gradient(145deg, ${btn.color}, ${shade(btn.color, -18)})`;
    el.innerHTML = `${renderIconHtml(btn)}<span>${btn.label || ""}</span>`;
    if (editMode) el.classList.add("edit-mode");

    el.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; }
      onButtonTap(index);
    });

    attachDragHandlers(el, "button", index);
    grid.appendChild(el);
  });

  if (editMode) {
    const addEl = document.createElement("div");
    addEl.className = "deck-btn empty";
    addEl.textContent = "+";
    addEl.addEventListener("click", () => openButtonModal(null));
    grid.appendChild(addEl);
  }
}

function renderIconHtml(btn) {
  if (btn.iconType === "brand" && btn.icon) {
    return `<img class="icon-img" src="https://cdn.simpleicons.org/${btn.icon}/ffffff" alt="">`;
  }
  if (btn.iconType === "image" && btn.icon) {
    return `<img class="icon-img" src="${btn.icon}" alt="">`;
  }
  return `<span class="icon">${btn.icon || "🔘"}</span>`;
}

function shade(hex, percent) {
  try {
    const num = parseInt(hex.replace("#", ""), 16);
    let r = (num >> 16) + percent;
    let g = ((num >> 8) & 0x00ff) + percent;
    let b = (num & 0x0000ff) + percent;
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return `rgb(${r},${g},${b})`;
  } catch {
    return hex;
  }
}

/* ---------------- TOQUE NO BOTÃO ---------------- */
function onButtonTap(index) {
  if (editMode) {
    openButtonModal(index);
    return;
  }
  const tab = getActiveTab();
  const btn = tab.buttons[index];
  if (!btn) return;
  vibrate();
  sendCommand(btn.actionType, btn.actionValue);
}

function vibrate(ms = 25) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

/* ---------------- MODO EDIÇÃO ---------------- */
document.getElementById("editModeBtn").addEventListener("click", () => {
  editMode = !editMode;
  document.getElementById("editModeBtn").style.background = editMode ? "#1f6feb" : "";
  document.getElementById("editHint").classList.toggle("hidden", !editMode);
  renderTabsBar();
  renderGrid();
});

/* =========================================================
   ARRASTAR PARA REORDENAR (abas e botões)
   ========================================================= */

function attachDragHandlers(el, type, index) {
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

  if (hoverEl && hoverEl !== dragCtx.el) {
    const hoverIndex = parseInt(hoverEl.dataset.index, 10);
    if (!isNaN(hoverIndex) && hoverIndex !== dragCtx.hoverIndex) {
      if (dragCtx.hoverElRef) dragCtx.hoverElRef.classList.remove("drag-over");
      hoverEl.classList.add("drag-over");
      dragCtx.hoverElRef = hoverEl;
      dragCtx.hoverIndex = hoverIndex;
    }
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
const tabModal = document.getElementById("tabModal");
const tabNameInput = document.getElementById("tabNameInput");

function openTabModal(tabId) {
  editingTabId = tabId;
  const tab = tabId ? state.tabs.find(t => t.id === tabId) : null;
  document.getElementById("tabModalTitle").textContent = tab ? "Editar aba" : "Nova aba";
  tabNameInput.value = tab ? tab.name : "";
  document.getElementById("deleteTabBtn").style.display = tab ? "block" : "none";
  tabModal.classList.remove("hidden");
}

document.getElementById("closeTabModal").addEventListener("click", () => {
  tabModal.classList.add("hidden");
});

document.getElementById("saveTabBtn").addEventListener("click", () => {
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

document.getElementById("deleteTabBtn").addEventListener("click", () => {
  if (state.tabs.length <= 1) { showToast("Precisa ter ao menos uma aba."); return; }
  state.tabs = state.tabs.filter(t => t.id !== editingTabId);
  if (state.activeTabId === editingTabId) state.activeTabId = state.tabs[0].id;
  saveState();
  renderTabsBar();
  renderGrid();
  tabModal.classList.add("hidden");
});

/* ---------------- MODAL DE BOTÃO ---------------- */
const buttonModal = document.getElementById("buttonModal");
const btnIconType = document.getElementById("btnIconType");
const btnIcon = document.getElementById("btnIcon");
const btnBrandSlug = document.getElementById("btnBrandSlug");
const btnLabel = document.getElementById("btnLabel");
const btnColor = document.getElementById("btnColor");
const btnActionType = document.getElementById("btnActionType");
const btnActionValue = document.getElementById("btnActionValue");
const btnMediaSelect = document.getElementById("btnMediaSelect");
const actionValueLabel = document.getElementById("actionValueLabel");

function toggleIconFields() {
  const type = btnIconType.value;
  document.getElementById("iconEmojiField").classList.toggle("hidden", type !== "emoji");
  document.getElementById("iconBrandField").classList.toggle("hidden", type !== "brand");
  document.getElementById("iconImageField").classList.toggle("hidden", type !== "image");
}
btnIconType.addEventListener("change", toggleIconFields);

function updateBrandPreview() {
  const slug = btnBrandSlug.value.trim().toLowerCase().replace(/\s+/g, "");
  const img = document.getElementById("brandPreviewImg");
  const hint = document.getElementById("brandPreviewHint");
  if (!slug) {
    img.classList.add("hidden");
    hint.textContent = "Digite o nome para ver o preview";
    hint.classList.remove("hidden");
    return;
  }
  img.onerror = () => {
    img.classList.add("hidden");
    hint.textContent = "Ícone não encontrado, verifique o nome";
    hint.classList.remove("hidden");
  };
  img.onload = () => {
    img.classList.remove("hidden");
    hint.classList.add("hidden");
  };
  img.src = `https://cdn.simpleicons.org/${slug}/ffffff`;
}
btnBrandSlug.addEventListener("input", updateBrandPreview);

function updateImagePreview() {
  const img = document.getElementById("imagePreviewImg");
  if (uploadedImageData) {
    img.src = uploadedImageData;
    img.classList.remove("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
  }
}

document.getElementById("btnImageFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    uploadedImageData = reader.result;
    updateImagePreview();
  };
  reader.readAsDataURL(file);
});

function openButtonModal(index) {
  editingIndex = index;
  const tab = getActiveTab();
  const btn = (index !== null) ? tab.buttons[index] : null;

  document.getElementById("buttonModalTitle").textContent = btn ? "Editar botão" : "Novo botão";

  const iconType = btn ? (btn.iconType || "emoji") : "emoji";
  btnIconType.value = iconType;
  toggleIconFields();

  btnIcon.value = (btn && iconType === "emoji") ? btn.icon : "";
  btnBrandSlug.value = (btn && iconType === "brand") ? btn.icon : "";
  uploadedImageData = (btn && iconType === "image") ? btn.icon : null;
  updateBrandPreview();
  updateImagePreview();

  btnLabel.value = btn ? btn.label : "";
  btnColor.value = btn ? btn.color : "#1f6feb";
  btnActionType.value = btn ? btn.actionType : "key";
  btnActionValue.value = btn && btn.actionType !== "media" ? btn.actionValue : "";
  btnMediaSelect.value = btn && btn.actionType === "media" ? btn.actionValue : "play/pause";

  document.getElementById("deleteBtnBtn").style.display = btn ? "block" : "none";

  toggleActionValueField();
  buttonModal.classList.remove("hidden");
}

function toggleActionValueField() {
  const isMedia = btnActionType.value === "media";
  btnMediaSelect.classList.toggle("hidden", !isMedia);
  btnActionValue.classList.toggle("hidden", isMedia);

  const labels = {
    key: "Atalho (ex: ctrl+c, win+d, alt+tab)",
    media: "Selecione a ação de mídia",
    open: "URL (https://...) ou nome do app",
    text: "Texto que será digitado",
    shell: "Comando do sistema (use com cuidado)"
  };
  actionValueLabel.textContent = labels[btnActionType.value];
}
btnActionType.addEventListener("change", toggleActionValueField);

document.getElementById("closeBtnModal").addEventListener("click", () => {
  buttonModal.classList.add("hidden");
});

document.getElementById("saveBtnBtn").addEventListener("click", () => {
  const actionType = btnActionType.value;
  const actionValue = actionType === "media" ? btnMediaSelect.value : btnActionValue.value.trim();
  const iconType = btnIconType.value;

  let iconValue = "";
  if (iconType === "emoji") iconValue = btnIcon.value.trim() || "🔘";
  if (iconType === "brand") iconValue = btnBrandSlug.value.trim().toLowerCase().replace(/\s+/g, "");
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

document.getElementById("deleteBtnBtn").addEventListener("click", () => {
  if (editingIndex === null) return;
  const tab = getActiveTab();
  tab.buttons.splice(editingIndex, 1);
  saveState();
  renderGrid();
  buttonModal.classList.add("hidden");
});

/* ---------------- CONEXÃO ---------------- */
const connectionModal = document.getElementById("connectionModal");
const ipInput = document.getElementById("ipInput");
const portInput = document.getElementById("portInput");
const tokenInput = document.getElementById("tokenInput");

document.getElementById("settingsBtn").addEventListener("click", () => {
  ipInput.value = state.ip;
  portInput.value = state.port;
  tokenInput.value = state.token || "";
  connectionModal.classList.remove("hidden");
});

document.getElementById("closeConnModal").addEventListener("click", () => {
  connectionModal.classList.add("hidden");
});

document.getElementById("connectBtn").addEventListener("click", () => {
  state.ip = ipInput.value.trim();
  state.port = portInput.value.trim() || "8765";
  state.token = tokenInput.value.trim();
  saveState();
  connectWS();
  connectionModal.classList.add("hidden");
});

document.getElementById("disconnectBtn").addEventListener("click", () => {
  stopPing();
  setStatus("offline", "Desconectado");
});

function setStatus(statusClass, text) {
  document.getElementById("statusDot").className = "dot " + statusClass;
  document.getElementById("statusText").textContent = text;
}

function baseUrl() {
  return `http://${state.ip}:${state.port}`;
}

function authHeaders() {
  return state.token ? { "X-Auth-Token": state.token } : {};
}

function connectWS() {
  if (!state.ip) {
    showToast("Informe o IP do PC em ⚙️");
    return;
  }
  setStatus("connecting", "Conectando...");
  checkConnection();
  stopPing();
  pingInterval = setInterval(checkConnection, 5000);
}

function stopPing() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = null;
}

async function checkConnection() {
  try {
    const res = await fetch(`${baseUrl()}/ping`, {
      method: "GET",
      headers: { ...authHeaders() }
    });
    if (res.ok) {
      setStatus("online", "Conectado");
    } else if (res.status === 401) {
      setStatus("offline", "Senha incorreta");
    } else {
      setStatus("offline", "Desconectado");
    }
  } catch {
    setStatus("offline", "Desconectado");
  }
}

async function sendCommand(type, value) {
  if (!state.ip) {
    showToast("Não conectado ao PC (toque em ⚙️)");
    return;
  }
  try {
    const res = await fetch(`${baseUrl()}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ type, value })
    });
    if (res.status === 401) {
      showToast("Senha incorreta! Verifique em ⚙️");
      return;
    }
    if (!res.ok) showToast("Erro ao executar comando no PC");
  } catch {
    showToast("PC não encontrado. Verifique o bridge.ps1 e o IP.");
    setStatus("offline", "Desconectado");
  }
}

/* ---------------- TOAST ---------------- */
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

/* ---------------- INIT ---------------- */
loadState();
renderTabsBar();
renderGrid();
if (state.ip) connectWS();