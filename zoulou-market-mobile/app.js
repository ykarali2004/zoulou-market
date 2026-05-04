const SUPA_URL = "https://mvixpwnrtgarhjndozsz.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12aXhwd25ydGdhcmhqbmRvenN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MzM0NTMsImV4cCI6MjA5MDAwOTQ1M30.QWFsOMAcyo_TlAdJTmfPGDvM_U-NvgU-OT-2H6-b_eQ";

const seedState = {
  mode: "demo",
  role: "patron",
  cashInitial: 100000,
  products: [
    { id: "p1", name: "Water", category: "Boissons", qty: 28, price: 25 },
    { id: "p2", name: "Cola", category: "Boissons", qty: 16, price: 35 },
    { id: "p3", name: "Tacos", category: "Food", qty: 11, price: 85 },
    { id: "p4", name: "Burger", category: "Food", qty: 8, price: 95 },
    { id: "p5", name: "Chips", category: "Snacks", qty: 5, price: 30 },
    { id: "p6", name: "Radio", category: "Objets", qty: 2, price: 220 },
    { id: "p7", name: "Menu Solo", category: "Menus", qty: 14, price: 130 },
    { id: "p8", name: "Menu Crew", category: "Menus", qty: 9, price: 260 }
  ],
  team: [
    { id: "u1", name: "Yann Z", role: "Patron", online: true },
    { id: "u2", name: "Maya", role: "Caisse", online: true },
    { id: "u3", name: "Nassim", role: "Stock", online: false },
    { id: "u4", name: "Lina", role: "Service", online: true }
  ],
  sales: [
    { id: "s1", total: 260, items: "Menu Crew", by: "Maya", time: "12:42", ts: Date.now() - 900000 },
    { id: "s2", total: 95, items: "Burger", by: "Yann Z", time: "12:28", ts: Date.now() - 1800000 },
    { id: "s3", total: 60, items: "2x Chips", by: "Lina", time: "11:51", ts: Date.now() - 3300000 }
  ],
  purchases: [],
  payroll: [],
  adjustments: []
};

let db = null;
let remoteReady = false;
let state = loadState();
let cart = [];
let activeCategory = "Tous";
let currentUser = { id: "mobile", name: "Mobile", role: "mobile" };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `$${Math.round(value || 0).toLocaleString("fr-FR")}`;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const now = () => new Date().toLocaleString("fr-FR");

function loadState() {
  const saved = localStorage.getItem("zoulou-mobile-state");
  return saved ? JSON.parse(saved) : structuredClone(seedState);
}

function saveState() {
  localStorage.setItem("zoulou-mobile-state", JSON.stringify(state));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function setSyncLabel(text, online = false) {
  const label = $("#syncLabel");
  label.textContent = text;
  label.classList.toggle("online", online);
}

async function bootSupabase() {
  if (!window.supabase) {
    setSyncLabel("Mode démo");
    return;
  }

  try {
    db = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    await loadRemoteData();
    subscribeRemote();
    remoteReady = true;
    state.mode = "supabase";
    setSyncLabel("Supabase lié", true);
    showToast("App liée au site");
  } catch (error) {
    console.warn("Supabase fallback:", error);
    remoteReady = false;
    state.mode = "demo";
    setSyncLabel("Mode démo");
  }
  render();
}

async function loadRemoteData() {
  const [
    productsResult,
    salesResult,
    usersResult,
    settingsResult,
    purchasesResult,
    payrollResult,
    adjustmentsResult
  ] = await Promise.all([
    db.from("zm_products").select("*"),
    db.from("zm_ventes").select("*").order("ts", { ascending: false }).limit(80),
    db.from("zm_users").select("*"),
    db.from("zm_settings").select("*"),
    db.from("zm_achats").select("*").order("ts", { ascending: false }).limit(200),
    db.from("zm_payes").select("*").order("ts", { ascending: false }).limit(200),
    db.from("zm_caisse_ajustements").select("*").order("ts", { ascending: false }).limit(200)
  ]);

  const failures = [productsResult, salesResult, usersResult].filter((result) => result.error);
  if (failures.length) throw failures[0].error;

  state.products = (productsResult.data || []).map(fromDbProduct);
  state.sales = (salesResult.data || []).map(fromDbSale);
  state.team = (usersResult.data || []).map(fromDbUser);
  state.cashInitial = Number((settingsResult.data || []).find((item) => item.key === "caisseInitial")?.value || 100000);
  state.purchases = purchasesResult.data || [];
  state.payroll = payrollResult.data || [];
  state.adjustments = adjustmentsResult.data || [];

  const active = (usersResult.data || []).find((user) => user.statut === "actif" && ["patron", "admin"].includes(user.role));
  if (active) currentUser = { id: active.id, name: active.nom, role: active.role };
}

function subscribeRemote() {
  db.channel("zoulou-mobile-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "zm_products" }, loadRemoteDataAndRender)
    .on("postgres_changes", { event: "*", schema: "public", table: "zm_ventes" }, loadRemoteDataAndRender)
    .on("postgres_changes", { event: "*", schema: "public", table: "zm_users" }, loadRemoteDataAndRender)
    .subscribe();
}

async function loadRemoteDataAndRender() {
  if (!remoteReady) return;
  try {
    await loadRemoteData();
    render();
  } catch (error) {
    console.warn(error);
  }
}

function fromDbProduct(product) {
  return {
    id: product.id,
    name: product.nom || "Produit",
    category: product.categorie || "Divers",
    qty: Number(product.qty || 0),
    price: Number(product.prix || 0),
    note: product.note || ""
  };
}

function fromDbSale(sale) {
  return {
    id: sale.id,
    total: Number(sale.total || 0),
    items: (sale.items || []).map((item) => `${item.qty || 1}x ${item.nom || "Article"}`).join(", ") || "Vente",
    by: sale.vendeur || "Équipe",
    time: sale.date_vente || "--:--",
    ts: sale.ts || 0
  };
}

function fromDbUser(user) {
  return {
    id: user.id,
    name: user.nom || "Membre",
    role: user.role || "Équipe",
    online: user.statut === "actif"
  };
}

function getCashBalance() {
  const sales = state.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const purchases = (state.purchases || []).filter((item) => item.via === "entreprise").reduce((sum, item) => sum + Number(item.total || 0), 0);
  const payroll = (state.payroll || []).reduce((sum, item) => sum + Number(item.montant || 0), 0);
  const deposits = (state.adjustments || []).filter((item) => item.type === "depot").reduce((sum, item) => sum + Number(item.montant || 0), 0);
  const withdrawals = (state.adjustments || []).filter((item) => item.type === "retrait").reduce((sum, item) => sum + Number(item.montant || 0), 0);
  return Number(state.cashInitial || 0) + sales - purchases - payroll + deposits - withdrawals;
}

function setPage(page) {
  $$(".page").forEach((node) => node.classList.remove("active"));
  $(`#page-${page}`).classList.add("active");
  $$(".nav-button").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
  $("#pageTitle").textContent = $(`#page-${page}`).dataset.title;
  render();
}

function updateClock() {
  $("#currentTime").textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function renderHome() {
  const total = state.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const low = state.products.filter((product) => product.qty <= 5).length;
  const cash = getCashBalance();
  const percent = Math.max(8, Math.min(94, Math.round((cash / 140000) * 100)));

  $("#cashBalance").textContent = money(cash);
  $("#salesCount").textContent = state.sales.length;
  $("#salesTotal").textContent = money(total);
  $("#lowStockCount").textContent = low;
  $("#cashPercent").textContent = `${percent}%`;
  $("#cashRing").style.strokeDashoffset = String(302 - 302 * (percent / 100));
  $("#cashSubtitle").textContent = remoteReady ? "Synchronisé avec le site web" : "Données locales de démonstration";
  $("#homeActivity").innerHTML = state.sales.slice(0, 3).map(activityTemplate).join("");
  $("#activityList").innerHTML = state.sales.map(activityTemplate).join("");
}

function renderProducts() {
  const search = $("#productSearch").value.trim().toLowerCase();
  const categories = ["Tous", ...new Set(state.products.map((product) => product.category))];
  $("#categoryFilters").innerHTML = categories.map((category) => (
    `<button class="chip ${category === activeCategory ? "active" : ""}" data-category="${category}" type="button">${category}</button>`
  )).join("");

  const list = state.products.filter((product) => {
    const byCategory = activeCategory === "Tous" || product.category === activeCategory;
    const bySearch = !search || product.name.toLowerCase().includes(search);
    return byCategory && bySearch;
  });

  $("#productGrid").innerHTML = list.map((product) => `
    <button class="product-card ${product.qty <= 5 ? "low" : ""}" data-product="${product.id}" type="button">
      <span class="product-visual">${product.name.slice(0, 1)}</span>
      <strong>${product.name}</strong>
      <small>${product.category} · ${product.qty} en stock</small>
      <span class="price">${money(product.price)}</span>
    </button>
  `).join("");
}

function renderCart() {
  const total = cart.reduce((sum, line) => sum + line.qty * line.price, 0);
  const count = cart.reduce((sum, line) => sum + line.qty, 0);
  $("#cartCount").textContent = `${count} article${count > 1 ? "s" : ""}`;
  $("#cartTotal").textContent = money(total);
  $("#cartLines").innerHTML = cart.length ? cart.map((line) => `
    <div class="cart-line">
      <strong>${line.qty}x ${line.name}</strong>
      <span>${money(line.qty * line.price)}</span>
    </div>
  `).join("") : `<div class="cart-line"><span>Aucun article</span><span>${money(0)}</span></div>`;
}

function renderStock() {
  const query = $("#stockSearch").value.trim().toLowerCase();
  const products = state.products.filter((product) => !query || product.name.toLowerCase().includes(query) || product.category.toLowerCase().includes(query));
  const value = state.products.reduce((sum, product) => sum + product.qty * product.price, 0);
  $("#stockValue").textContent = money(value);
  $("#stockList").innerHTML = products.map((product) => `
    <article class="stock-item ${product.qty <= 5 ? "low" : ""}">
      <span class="item-icon">${product.name.slice(0, 1)}</span>
      <div class="item-main">
        <strong>${product.name}</strong>
        <span>${product.category} · ${money(product.price)}</span>
      </div>
      <div class="item-side">
        ${product.qty}
        <small>${product.qty <= 5 ? "à réassortir" : "en stock"}</small>
      </div>
    </article>
  `).join("");
}

function renderTeam() {
  const online = state.team.filter((member) => member.online).length;
  $("#teamOnline").textContent = `${online} en service`;
  $("#teamList").innerHTML = state.team.map((member) => `
    <article class="team-item">
      <span class="item-icon">${member.name.slice(0, 1)}</span>
      <div class="item-main">
        <strong>${member.name}</strong>
        <span>${member.role}</span>
      </div>
      <span class="team-status ${member.online ? "" : "off"}"></span>
    </article>
  `).join("");
}

function activityTemplate(sale) {
  return `
    <article class="activity-item">
      <span class="item-icon">$</span>
      <div class="item-main">
        <strong>${sale.items}</strong>
        <span>${sale.by} · ${sale.time}</span>
      </div>
      <div class="item-side">${money(sale.total)}</div>
    </article>
  `;
}

function renderRole() {
  const label = state.role === "patron" ? "Patron connecté" : "Employé connecté";
  $("#roleLabel").textContent = label;
  $("#avatarInitial").textContent = state.role === "patron" ? "Y" : "E";
}

function render() {
  renderRole();
  renderHome();
  renderProducts();
  renderCart();
  renderStock();
  renderTeam();
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || product.qty <= 0) {
    showToast("Stock indisponible");
    return;
  }
  const inCart = cart.filter((item) => item.id === productId).reduce((sum, item) => sum + item.qty, 0);
  if (inCart >= product.qty) {
    showToast(`Stock max: ${product.qty}`);
    return;
  }
  const line = cart.find((item) => item.id === productId);
  if (line) line.qty += 1;
  else cart.push({ id: product.id, name: product.name, price: product.price, qty: 1 });
  renderCart();
}

async function checkout() {
  if (!cart.length) {
    showToast("Panier vide");
    return;
  }

  const total = cart.reduce((sum, line) => sum + line.qty * line.price, 0);
  const ts = Date.now();
  const items = cart.map((line) => ({
    productId: line.id,
    menuId: null,
    nom: line.name,
    qty: line.qty,
    prixUnit: line.price,
    type: "prod",
    composants: null
  }));

  try {
    if (remoteReady) {
      for (const line of cart) {
        const { data: fresh, error } = await db.from("zm_products").select("qty").eq("id", line.id).single();
        if (error) throw error;
        const nextQty = Math.max(0, Number(fresh?.qty || 0) - line.qty);
        const update = await db.from("zm_products").update({ qty: nextQty }).eq("id", line.id);
        if (update.error) throw update.error;
      }
      const vente = {
        id: uid(),
        date_vente: now(),
        ts,
        vendeur: currentUser.name,
        vendeur_id: currentUser.id,
        items,
        subtotal: total,
        tip: 0,
        total,
        paiement: "cash",
        note: "Vente mobile"
      };
      const saleInsert = await db.from("zm_ventes").insert(vente);
      if (saleInsert.error) throw saleInsert.error;
      await db.from("zm_logs").insert({ id: uid(), msg: `Vente mobile — ${money(total)}`, type: "success", date_log: now(), ts });
      await loadRemoteData();
    } else {
      cart.forEach((line) => {
        const product = state.products.find((item) => item.id === line.id);
        if (product) product.qty = Math.max(0, product.qty - line.qty);
      });
      state.sales.unshift({
        id: uid(),
        total,
        items: cart.map((line) => `${line.qty}x ${line.name}`).join(", "),
        by: state.role === "patron" ? "Yann Z" : "Employé",
        time: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        ts
      });
      saveState();
    }

    cart = [];
    render();
    showToast(`Vente encaissée · ${money(total)}`);
  } catch (error) {
    console.error(error);
    showToast("Erreur pendant la vente");
  }
}

async function addProductFromDialog() {
  const name = $("#newProductName").value.trim();
  if (!name) return;

  const product = {
    id: uid(),
    name,
    category: $("#newProductCategory").value.trim() || "Divers",
    qty: Number($("#newProductQty").value || 0),
    price: Number($("#newProductPrice").value || 0)
  };

  try {
    if (remoteReady) {
      const insert = await db.from("zm_products").insert({
        id: product.id,
        nom: product.name,
        categorie: product.category,
        qty: product.qty,
        prix: product.price,
        note: "Ajouté depuis mobile"
      });
      if (insert.error) throw insert.error;
      await loadRemoteData();
    } else {
      state.products.unshift(product);
      saveState();
    }
    render();
    showToast("Produit ajouté au stock");
  } catch (error) {
    console.error(error);
    showToast("Erreur ajout produit");
  }
}

function bindEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
  $$("[data-open]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.open)));
  $("#categoryFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    activeCategory = button.dataset.category;
    renderProducts();
  });
  $("#productGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-product]");
    if (!button) return;
    addToCart(button.dataset.product);
  });
  $("#productSearch").addEventListener("input", renderProducts);
  $("#stockSearch").addEventListener("input", renderStock);
  $("#checkoutButton").addEventListener("click", checkout);
  $("#clearCart").addEventListener("click", () => {
    cart = [];
    renderCart();
  });
  $("#roleButton").addEventListener("click", () => {
    state.role = state.role === "patron" ? "employe" : "patron";
    saveState();
    renderRole();
    showToast(state.role === "patron" ? "Mode patron" : "Mode employé");
  });
  $("#quickActionButton").addEventListener("click", () => setPage("sell"));
  $("#addStockButton").addEventListener("click", () => $("#stockDialog").showModal());
  $("#saveProductButton").addEventListener("click", addProductFromDialog);
  $("#resetDemo").addEventListener("click", async () => {
    if (remoteReady) {
      await loadRemoteData();
      showToast("Données Supabase rechargées");
    } else {
      state = structuredClone(seedState);
      cart = [];
      saveState();
      showToast("Données de démo restaurées");
    }
    render();
  });
}

bindEvents();
render();
updateClock();
setInterval(updateClock, 1000);
bootSupabase();
