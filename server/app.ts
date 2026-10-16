// My Profile — page app (moved verbatim from the former inline <script>).
// Relative fetches only; localStorage access wrapped in try/catch.
(() => {
  const GROUPS = ["identity", "contact", "government", "business"];
  const FIELDS: Record<string, string[]> = {
    identity: ["full_name", "date_of_birth"],
    contact: ["address_line1", "address_line2", "city", "province", "postal_code", "country", "phone", "email", "work_email"],
    government: ["sin", "ramq", "driver_license"],
    business: ["business_name", "neq", "gst_number", "qst_number"],
  };
  const SENSITIVE = new Set(["sin", "ramq", "driver_license"]);
  const WIDE = new Set(["full_name", "address_line1", "address_line2", "email", "business_name"]);
  const L: Record<string, any> = {
    fr: {
      title: "Mon profil",
      sub: "Renseigné une seule fois ici ; l'agent y puise pour remplir formulaires fiscaux et autres. Tout est rangé dans le coffre de clés, jamais en clair.",
      groups: { identity: "Identité", contact: "Contact", government: "Gouvernemental", business: "Affaires" },
      desc: {
        identity: "Nom et date de naissance.",
        contact: "Adresse, téléphone et courriel.",
        government: "Numéros d'identification personnels.",
        business: "Numéros d'entreprise (votre entreprise ou autre).",
      },
      note: "Champs sensibles : l'agent demandera toujours ta confirmation avant de les utiliser, tant que le réglage « sensitive_require_confirmation » reste activé.",
      labels: {
        full_name: "Nom complet", date_of_birth: "Date de naissance (AAAA-MM-JJ)",
        address_line1: "Adresse (ligne 1)", address_line2: "Adresse (ligne 2)",
        city: "Ville", province: "Province", postal_code: "Code postal", country: "Pays",
        phone: "Téléphone", email: "Courriel",
        work_email: "Courriel de travail",
        sin: "NAS — no d'assurance sociale", ramq: "No de RAMQ", driver_license: "Permis de conduire",
        business_name: "Nom de l'entreprise", neq: "NEQ (Québec)", gst_number: "TPS", qst_number: "TVQ",
      },
      save: "Enregistrer", saving: "Enregistrement…",
      saved: "Enregistré dans le coffre ✓", show: "voir", hide: "cacher",
      footer: "my-profile · les valeurs restent dans le coffre de clés ; cette page ne les affiche que pour toi.",
      errLoad: "Impossible de charger le profil (API en échec) : ",
      errSave: "Échec de l'enregistrement : ",
      cards: {
        title: "Cartes de paiement",
        desc: "Débit et crédit, avec statut actif ou inactif (carte obsolète ou désactivée par le fournisseur).",
        warning: "Métadonnées seulement : marque et 4 derniers chiffres. N'entre jamais le numéro complet ni le CVV.",
        empty: "Aucune carte enregistrée.",
        add: "Ajouter",
        adding: "Ajout…",
        added: "Carte ajoutée ✓",
        type: "Type", brand: "Marque", last4: "4 derniers chiffres", expiry: "Expire (AAAA-MM)", label: "Note (optionnel)",
        debit: "Débit", credit: "Crédit",
        active: "active", inactive: "inactive",
        activate: "Activer", deactivate: "Désactiver", remove: "Supprimer",
        confirmRemove: "Supprimer cette carte ?",
        errCards: "Impossible de charger les cartes : ",
      },
    },
    en: {
      title: "My Profile",
      sub: "Fill it in once here; the agent draws from it to complete tax and other forms. Everything is stored in the key vault, never in plaintext.",
      groups: { identity: "Identity", contact: "Contact", government: "Government", business: "Business" },
      desc: {
        identity: "Name and date of birth.",
        contact: "Address, phone and email.",
        government: "Personal ID numbers.",
        business: "Business numbers (your business or other).",
      },
      note: "Sensitive fields: the agent will always ask for your confirmation before using them, as long as the “sensitive_require_confirmation” setting stays on.",
      labels: {
        full_name: "Full name", date_of_birth: "Date of birth (YYYY-MM-DD)",
        address_line1: "Address (line 1)", address_line2: "Address (line 2)",
        city: "City", province: "Province", postal_code: "Postal code", country: "Country",
        phone: "Phone", email: "Email",
        work_email: "Work email",
        sin: "SIN — Social Insurance Number", ramq: "RAMQ number", driver_license: "Driver's license",
        business_name: "Business name", neq: "NEQ (Quebec)", gst_number: "GST", qst_number: "QST",
      },
      save: "Save", saving: "Saving…",
      saved: "Saved to the vault ✓", show: "show", hide: "hide",
      footer: "my-profile · values stay in the key vault; this page only shows them to you.",
      errLoad: "Could not load the profile (API failure): ",
      errSave: "Save failed: ",
      cards: {
        title: "Payment cards",
        desc: "Debit and credit, with an active or inactive status (obsolete card, or deactivated by the provider).",
        warning: "Metadata only: brand and last 4 digits. Never enter the full number or the CVV.",
        empty: "No cards stored yet.",
        add: "Add",
        adding: "Adding…",
        added: "Card added ✓",
        type: "Type", brand: "Brand", last4: "Last 4 digits", expiry: "Expires (YYYY-MM)", label: "Note (optional)",
        debit: "Debit", credit: "Credit",
        active: "active", inactive: "inactive",
        activate: "Activate", deactivate: "Deactivate", remove: "Remove",
        confirmRemove: "Remove this card?",
        errCards: "Could not load the cards: ",
      },
    },
  };
  let lang = "fr";
  try {
    const saved = localStorage.getItem("my-profile-lang");
    lang = saved || ((navigator.language || "").toLowerCase().startsWith("fr") ? "fr" : "en");
  } catch {}

  const $ = (id: string) => document.getElementById(id);
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  const inputs: Record<string, HTMLInputElement> = {};

  function buildCards() {
    const t = L[lang];
    $("t-title")!.textContent = t.title;
    $("t-sub")!.textContent = t.sub;
    $("langbtn")!.textContent = lang === "fr" ? "English" : "Français";
    $("t-footer")!.textContent = t.footer;
    const root = $("cards")!;
    root.innerHTML = "";
    for (const g of GROUPS) {
      const card = document.createElement("section");
      card.className = "card";
      let html = `<h2>${esc(t.groups[g])}</h2><p class="desc">${esc(t.desc[g])}</p>`;
      if (g === "government") html += `<p class="note">${esc(t.note)}</p>`;
      html += `<div class="grid">`;
      for (const f of FIELDS[g]) {
        const eye = SENSITIVE.has(f)
          ? `<button type="button" class="eye" data-eye="${f}">${esc(t.show)}</button>`
          : "";
        html += `<div class="f${WIDE.has(f) ? " wide" : ""}">
          <label for="in-${f}">${esc(t.labels[f])}</label>
          <div class="senswrap"><input id="in-${f}" type="${SENSITIVE.has(f) ? "password" : "text"}" autocomplete="off">
          ${eye}</div>
        </div>`;
      }
      html += `</div><div class="actions">
        <button type="button" class="save" data-group="${g}">${esc(t.save)}</button>
        <span class="status" id="st-${g}"></span>
      </div>`;
      card.innerHTML = html;
      root.appendChild(card);
      for (const f of FIELDS[g]) inputs[f] = card.querySelector(`#in-${f}`) as HTMLInputElement;
    }
    // ----- payment cards section -----
    const cc = t.cards;
    const sc = document.createElement("section");
    sc.className = "card";
    sc.innerHTML = `<h2>${esc(cc.title)}</h2><p class="desc">${esc(cc.desc)}</p>
      <p class="note">${esc(cc.warning)}</p>
      <div id="cardlist"><p class="empty">${esc(cc.empty)}</p></div>
      <div class="addgrid">
        <div class="f"><label for="nc-type">${esc(cc.type)}</label>
          <select id="nc-type"><option value="debit">${esc(cc.debit)}</option><option value="credit">${esc(cc.credit)}</option></select></div>
        <div class="f"><label for="nc-brand">${esc(cc.brand)}</label><input id="nc-brand" autocomplete="off"></div>
        <div class="f"><label for="nc-last4">${esc(cc.last4)}</label><input id="nc-last4" inputmode="numeric" maxlength="4" autocomplete="off"></div>
        <div class="f"><label for="nc-expiry">${esc(cc.expiry)}</label><input id="nc-expiry" placeholder="2029-05" autocomplete="off"></div>
        <div class="f wide"><label for="nc-label">${esc(cc.label)}</label><input id="nc-label" autocomplete="off"></div>
      </div>
      <div class="actions">
        <button type="button" class="save" id="nc-add">${esc(cc.add)}</button>
        <span class="status" id="st-cards"></span>
      </div>`;
    root.appendChild(sc);
    sc.querySelector("#nc-add")!.addEventListener("click", addCard);
    root.querySelectorAll("button.save").forEach((b) => b.addEventListener("click", () => saveGroup((b as HTMLElement).dataset.group!)));
    root.querySelectorAll("button.eye").forEach((b) =>
      b.addEventListener("click", () => {
        const inp = inputs[(b as HTMLElement).dataset.eye!];
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        b.textContent = show ? L[lang].hide : L[lang].show;
      })
    );
    refreshCardList();
  }

  function cardRowHtml(c: any) {
    const cc = L[lang].cards;
    const name = [c.brand, c.label].filter(Boolean).join(" · ") || cc[c.type];
    return `<div class="cardrow" data-id="${esc(c.id)}">
      <span class="badge">${esc(cc[c.type] || c.type)}</span>
      <span class="grow">•••• ${esc(c.last4)}${name ? " — " + esc(name) : ""}${c.expiry ? " · " + esc(c.expiry) : ""}</span>
      <span class="pill ${esc(c.status)}">${esc(cc[c.status] || c.status)}</span>
      <button type="button" class="minibtn" data-act="toggle" data-id="${esc(c.id)}" data-status="${esc(c.status)}">
        ${esc(c.status === "active" ? cc.deactivate : cc.activate)}</button>
      <button type="button" class="minibtn danger" data-act="remove" data-id="${esc(c.id)}">${esc(cc.remove)}</button>
    </div>`;
  }

  async function refreshCardList() {
    const cc = L[lang].cards;
    const list = $("cardlist")!;
    try {
      const r = await fetch("api/cards");
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.erreur || `HTTP ${r.status}`);
      list.innerHTML = d.cards.length ? d.cards.map(cardRowHtml).join("") : `<p class="empty">${esc(cc.empty)}</p>`;
    } catch (e) {
      list.innerHTML = "";
      banner(cc.errCards + (e && e.message ? e.message : e));
    }
  }

  function wireCardActions() {
    $("cardlist")!.addEventListener("click", async (ev) => {
      const btn = (ev.target as HTMLElement).closest("button[data-act]") as HTMLElement | null;
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === "toggle") {
        const next = btn.dataset.status === "active" ? "inactive" : "active";
        await fetch(`api/cards/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        refreshCardList();
      } else if (btn.dataset.act === "remove") {
        if (!confirm(L[lang].cards.confirmRemove)) return;
        await fetch(`api/cards/${id}`, { method: "DELETE" });
        refreshCardList();
      }
    });
  }

  async function addCard() {
    const cc = L[lang].cards;
    const btn = $("nc-add") as HTMLButtonElement;
    const st = $("st-cards")!;
    btn.disabled = true;
    st.className = "status";
    st.textContent = cc.adding;
    try {
      const r = await fetch("api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: ($("nc-type") as HTMLSelectElement).value,
          brand: ($("nc-brand") as HTMLInputElement).value,
          last4: ($("nc-last4") as HTMLInputElement).value,
          expiry: ($("nc-expiry") as HTMLInputElement).value,
          label: ($("nc-label") as HTMLInputElement).value,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.erreur || `HTTP ${r.status}`);
      st.className = "status ok";
      st.textContent = cc.added;
      banner("");
      ($("nc-brand") as HTMLInputElement).value = ""; ($("nc-last4") as HTMLInputElement).value = ""; ($("nc-expiry") as HTMLInputElement).value = ""; ($("nc-label") as HTMLInputElement).value = "";
      refreshCardList();
    } catch (e) {
      st.className = "status err";
      st.textContent = (e && e.message ? e.message : String(e));
    } finally {
      btn.disabled = false;
    }
  }

  function banner(msg: string) {
    const b = $("banner")!;
    if (!msg) { b.style.display = "none"; return; }
    b.textContent = msg;
    b.style.display = "block";
  }

  async function loadProfile() {
    try {
      const r = await fetch("api/profile");
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.erreur || `HTTP ${r.status}`);
      banner("");
      for (const g of GROUPS) {
        const values = (d.groups && d.groups[g] && d.groups[g].values) || {};
        for (const f of FIELDS[g]) inputs[f].value = values[f] || "";
      }
    } catch (e) {
      banner(L[lang].errLoad + (e && e.message ? e.message : e));
    }
  }

  async function saveGroup(g: string) {
    const t = L[lang];
    const btn = document.querySelector(`button.save[data-group="${g}"]`) as HTMLButtonElement;
    const st = $("st-" + g)!;
    btn.disabled = true;
    st.className = "status";
    st.textContent = t.saving;
    const group: Record<string, string> = {};
    for (const f of FIELDS[g]) group[f] = inputs[f].value;
    try {
      const r = await fetch("api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groups: { [g]: group } }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.erreur || `HTTP ${r.status}`);
      st.className = "status ok";
      st.textContent = t.saved;
      banner("");
      // values reach this page back through the control-plane re-sync; check shortly
      setTimeout(loadProfile, 2000);
    } catch (e) {
      st.className = "status err";
      st.textContent = t.errSave + (e && e.message ? e.message : e);
      banner(L[lang].errSave + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
    }
  }

  $("langbtn")!.addEventListener("click", () => {
    lang = lang === "fr" ? "en" : "fr";
    try { localStorage.setItem("my-profile-lang", lang); } catch {}
    buildCards();
    loadProfile();
  });

  buildCards();
  loadProfile();
  wireCardActions();
})();
