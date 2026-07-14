/* =============================================================
 * Melissa Personator Search — Lead Update Widget (DEBUG BUILD)
 * -------------------------------------------------------------
 * TEMPORARY: contains phone/email diagnostic logging.
 * Remove the ">>> DEBUG" blocks once the real field path is known.
 * -------------------------------------------------------------
 * Flow:
 * 1. Zoho SDK PageLoad -> get current Lead ID
 * 2. Fetch current Lead from Zoho CRM (Fresh data only)
 * 3. Build Melissa Request (EXACT CODE 2 LOGIC: Full_Name + State)
 * 4. Call Melissa API (SearchConditions:progressive,SearchType:Auto)
 * 5. Bypass strict JS filters -> Render exactly what API returns
 * 6. Update Zoho CRM on selection
 * ============================================================= */

/* ===============================
 * CONFIGURATION — EDIT BEFORE GO-LIVE
 * =============================== */

const PERSONATOR_ENDPOINT =
  "https://personatorsearch.melissadata.net/WEB/doPersonatorSearch";

const PERSONATOR_PROXY_URL = ""; // <-- SET THIS for production

const PERSONATOR_LICENSE_KEY = "NNyQiGBQttkIhzONLxAqXx**";

const ADDRESS_UPDATE_MODE = "separate"; // "separate" | "compound"

const FIELD_API_NAMES = {
  street:       "LOCATION_ADDRESS",
  state:        "LOCATION_ADDRESS_STATE",
  city:         "LOCATION_ADDRESS_CITY",
  zip:          "Home_Address_Zip",
  phone:        "Phone",
  email:        "Email",
  yearOfBirth:  "Year_of_Birth",
};

/* ===============================
 * STATE
 * =============================== */

let sdkReady = false;
let currentLeadId = null;
let currentLeadRecord = null;
let melissaRecords = [];
let filteredRecords = [];
let selectedMelissaRecord = null;
let selectedIndex = -1;
let melissaTableRendered = false;
let searchLeadRecord = null;

// FORCE CACHE CLEAR: Changed prefix to VFINAL so it ignores any old missing-state data
const LEAD_SNAPSHOT_STORAGE_PREFIX = "melissaWidget:leadSearch_VFINAL_:";

function getLeadSnapshotStorageKey(leadId) {
  return LEAD_SNAPSHOT_STORAGE_PREFIX + String(leadId);
}

function loadSavedLeadSearchCriteria(leadId) {
  try {
    const raw = localStorage.getItem(getLeadSnapshotStorageKey(leadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    console.warn("loadSavedLeadSearchCriteria failed:", e);
    return null;
  }
}

function persistLeadSearchCriteria(leadId, leadRecord) {
  try {
    const snapshot = {
      First_Name:       String(leadRecord?.First_Name       || ""),
      Last_Name:        String(leadRecord?.Last_Name        || ""),
      Full_Name:        String(leadRecord?.Full_Name        || ""),
      Email:            String(leadRecord?.Email            || ""),
      Phone:            String(leadRecord?.Phone            || ""),
      Mobile:           String(leadRecord?.Mobile           || ""),
      Year_of_Birth:    String(leadRecord?.Year_of_Birth    || ""),
      Date_of_Birth:    String(leadRecord?.Date_of_Birth    || ""),
      DOB:              String(leadRecord?.DOB              || ""),
      Home_Address_Zip: String(leadRecord?.Home_Address_Zip || ""),
      Zip_Code:         String(leadRecord?.Zip_Code         || ""),
      // Safely capture state from all possible Zoho standard/custom fields
      State:            String(leadRecord?.State || leadRecord?.LOCATION_ADDRESS_STATE || leadRecord?.Home_Address_State || ""),
    };
    localStorage.setItem(
      getLeadSnapshotStorageKey(leadId),
      JSON.stringify(snapshot)
    );
    return snapshot;
  } catch (e) {
    console.warn("persistLeadSearchCriteria failed:", e);
    return null;
  }
}

/* ===============================
 * DOM REFERENCES & UI HELPERS
 * =============================== */

const els = {
  banner: document.getElementById("banner"),
  leadContext: document.getElementById("leadContext"),
  loading: document.getElementById("loadingState"),
  empty: document.getElementById("emptyState"),
  resultsWrap: document.getElementById("resultsWrapper"),
  resultsBody: document.getElementById("resultsBody"),
  previewSec: document.getElementById("previewSection"),
  previewGrid: document.getElementById("previewGrid"),
  previewCancelBtn: document.getElementById("previewCancelBtn"),
  previewUpdateBtn: document.getElementById("previewUpdateBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  filterInput: document.getElementById("filterInput"),
  successModal: document.getElementById("successModal"),
  successClose: document.getElementById("successCloseBtn"),
};

function showBanner(message, type = "info") {
  els.banner.textContent = message;
  els.banner.className = `banner banner-${type}`;
}
function hideBanner() {
  els.banner.className = "banner banner-hidden";
  els.banner.textContent = "";
}
function setLoading(isLoading) { els.loading.classList.toggle("hidden", !isLoading); }
function showEmpty(show) { els.empty.classList.toggle("hidden", !show); }
function setEmptyMessage(msg) {
  const p = els.empty.querySelector("p");
  if (p) p.textContent = msg;
}
function showResults(show) { els.resultsWrap.classList.toggle("hidden", !show); }
function showPreview(show) { els.previewSec.classList.toggle("hidden", !show); }
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

let updateLeadBtn = null;
function refreshUpdateButton() {
  const disabled = !sdkReady || !currentLeadId || !selectedMelissaRecord;
  if (updateLeadBtn) updateLeadBtn.disabled = disabled;
  if (els.previewUpdateBtn) els.previewUpdateBtn.disabled = disabled;
}

/* ===============================
 * >>> DEBUG: DEEP KEY SCANNER (TEMPORARY)
 * Recursively walks the record and prints every path whose key OR value
 * looks phone/email related. This tells us the EXACT field path without guessing.
 * =============================== */
function debugScanForContact(obj, pathPrefix = "record") {
  const hits = [];
  const phoneKeyRe = /phone|tel|mobile|cell/i;
  const emailKeyRe = /email|mail/i;
  const phoneValRe = /^\+?[\d().\-\s]{7,}$/;
  const emailValRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function walk(node, path) {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (phoneValRe.test(node) || emailValRe.test(node)) hits.push(`${path} = ${JSON.stringify(node)}`);
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    Object.keys(node).forEach((k) => {
      const childPath = `${path}.${k}`;
      if (phoneKeyRe.test(k) || emailKeyRe.test(k)) {
        hits.push(`KEY-MATCH ${childPath} = ${JSON.stringify(node[k])}`);
      }
      walk(node[k], childPath);
    });
  }

  walk(obj, pathPrefix);
  return hits;
}

/* ===============================
 * ZOHO SDK INIT
 * =============================== */

ZOHO.embeddedApp.on("PageLoad", async function (data) {
  console.log("PageLoad data:", data);
  sdkReady = true;

  try { if (ZOHO?.CRM?.UI?.Resize) ZOHO.CRM.UI.Resize({ height: "1000", width: "1900" }); } 
  catch (e) { console.warn("Resize failed:", e); }

  if (melissaTableRendered) return;

  if (data) {
    if (data.EntityId) currentLeadId = Array.isArray(data.EntityId) ? data.EntityId[0] : data.EntityId;
    else if (data.Entity) currentLeadId = Array.isArray(data.Entity) ? data.Entity[0] : data.Entity;
  }

  if (!currentLeadId) {
    setLoading(false);
    showBanner("Current Lead ID not found.", "error");
    return;
  }

  els.leadContext.textContent = `Current Lead ID: ${currentLeadId}`;

  try {
    currentLeadRecord = await fetchCurrentLead(currentLeadId);
    console.log("Current Lead Data (live CRM):", currentLeadRecord);

    const savedCriteria = loadSavedLeadSearchCriteria(currentLeadId);
    if (savedCriteria) searchLeadRecord = savedCriteria;
    else searchLeadRecord = persistLeadSearchCriteria(currentLeadId, currentLeadRecord) || currentLeadRecord;

    // Build params EXACTLY like Code 2
    const baseParams = buildMelissaSearchParams(searchLeadRecord);
    console.log("Lead identity for search (Code 2 Logic):", baseParams);

    if (!baseParams.full) {
      setLoading(false);
      setEmptyMessage("Cannot search Melissa: Full Name is required.");
      showEmpty(true);
      return;
    }

    const rawResponse = await callMelissaSearchAPI(baseParams);

    /* >>> DEBUG: full response + top-level shape */
    console.log("========== FULL MELISSA RESPONSE ==========");
    console.log(JSON.stringify(rawResponse, null, 2));
    console.log("RESPONSE TOP-LEVEL KEYS:", rawResponse && typeof rawResponse === "object" ? Object.keys(rawResponse) : typeof rawResponse);
    /* <<< DEBUG */

    if (hasLicenseError(rawResponse)) {
      setLoading(false);
      setEmptyMessage("Melissa license key issue.");
      showEmpty(true);
      return;
    }

    const allRecords = Array.isArray(rawResponse?.Records) ? rawResponse.Records : [];

    /* >>> DEBUG: per-record structure + contact scan */
    console.log("========== RECORD COUNT ==========", allRecords.length);
    allRecords.forEach((record, i) => {
      console.log(`---------- RECORD #${i} ----------`);
      console.log("RECORD KEYS:", Object.keys(record || {}));
      console.log("FULL RECORD:", JSON.stringify(record, null, 2));
      const hits = debugScanForContact(record, `record[${i}]`);
      console.log(`CONTACT-LIKE PATHS in record #${i}:`, hits.length ? hits : "(none found — phone/email likely NOT in response)");
    });
    /* <<< DEBUG */

    // Bypass strict JS filter to ensure AZ and ghost records are kept just like Code 2
    const matchedRaw = dedupRawMelissaRecords(allRecords); 
    
    console.log("Final rendered records count:", matchedRaw.length);
    setLoading(false);

    if (matchedRaw.length === 0) {
      setEmptyMessage("No Melissa records found for this Name and State.");
      showEmpty(true);
      return;
    }

    const flattenedMelissaRows = mapMelissaRecords(matchedRaw);
    const uniqueRows = dedupMelissaRows(flattenedMelissaRows);

    if (uniqueRows.length === 0) {
      setEmptyMessage("No valid address records found to display.");
      showEmpty(true);
      return;
    }

    melissaRecords = uniqueRows.map((r) => Object.freeze({ ...r }));
    filteredRecords = melissaRecords.slice();

    renderResults(filteredRecords);
    showResults(true);
    els.filterInput.disabled = false;
    melissaTableRendered = true;

  } catch (err) {
    console.error("Widget load error:", err);
    setLoading(false);
    showBanner(`Failed to load results: ${err.message || err}`, "error");
  }
});

function hasLicenseError(response) {
  if (!response) return false;
  const tr = String(response.TransmissionResults || "");
  return /\bGE0[5-8]\b/.test(tr) || /\bSE01\b/.test(tr);
}

ZOHO.embeddedApp.init();

/* ===============================
 * FETCH CURRENT LEAD
 * =============================== */

async function fetchCurrentLead(leadId) {
  const resp = await ZOHO.CRM.API.getRecord({ Entity: "Leads", RecordID: leadId });
  if (resp && resp.data && resp.data.length > 0) return resp.data[0];
  throw new Error("Lead not found in CRM.");
}

/* ===============================
 * MELISSA SEARCH — INPUT PARAMS (CODE 2 LOGIC)
 * =============================== */

function buildMelissaSearchParams(lead) {
  // Try Full_Name first, fallback to First+Last
  const fullName = lead?.Full_Name ? String(lead.Full_Name).trim() : (String(lead?.First_Name || "").trim() + " " + String(lead?.Last_Name || "").trim()).trim();
  const state = String(lead?.State || lead?.LOCATION_ADDRESS_STATE || lead?.Home_Address_State || "").trim();

  return { full: fullName, state: state };
}

/* ===============================
 * NORMALIZATION & DEDUP
 * =============================== */

function normalizeName(value) { return String(value || "").trim().toLowerCase(); }
function normalizeText(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function normalizeZip(value) { return String(value || "").replace(/\D/g, "").slice(0, 5); }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/* ---------------------------------------------------------------
 * PHONE / EMAIL EXTRACTION HELPERS (Phone/Email display fix)
 * Melissa Personator Search returns phones/emails as plain string
 * arrays named "Phones"/"Emails". Older/proxy shapes may use
 * "PhoneRecords"/"EmailRecords" with sub-objects. These helpers
 * tolerate BOTH shapes so phone/email are extracted correctly
 * without altering any other mapping/address behavior.
 * --------------------------------------------------------------- */
function extractPhoneList(record) {
  const source = (Array.isArray(record?.Phones) && record.Phones.length)
    ? record.Phones
    : (record?.PhoneRecords || []);
  return source
    .map((entry) => (typeof entry === "string"
      ? entry
      : (entry?.PhoneNumber || entry?.Phone || entry?.Number || "")))
    .map(toDisplayString)
    .filter(Boolean);
}

function extractEmailList(record) {
  const source = (Array.isArray(record?.Emails) && record.Emails.length)
    ? record.Emails
    : (record?.EmailRecords || []);
  return source
    .map((entry) => (typeof entry === "string"
      ? entry
      : (entry?.Email || entry?.EmailAddress || entry?.Address || "")))
    .map(toDisplayString)
    .filter(Boolean);
}

function getMelissaUniqueKey(record) {
  const mik = record?.MelissaIdentityKey || record?.melissaIdentityKey || "";
  if (mik) return `mik:${String(mik).trim()}`;

  const phones = extractPhoneList(record).map((p) => normalizePhone(p)).filter(Boolean).sort().join("|");
  const emails = extractEmailList(record).map((e) => normalizeEmail(e)).filter(Boolean).sort().join("|");
  const fullName = record?.FullName || [ record?.Name?.FirstName || record?.First || "", record?.Name?.MiddleName || record?.Middle || "", record?.Name?.LastName || record?.Last || "" ].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
  return [ "combined", normalizeText(fullName), String(record?.DateOfBirth || "").trim(), normalizeText(record?.CurrentAddress?.AddressLine1 || ""), normalizeZip(record?.CurrentAddress?.PostalCode || ""), phones, emails ].join("||");
}

function dedupRawMelissaRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const uniqueRecordsMap = new Map();
  records.forEach((record) => {
    const key = getMelissaUniqueKey(record);
    if (!uniqueRecordsMap.has(key)) uniqueRecordsMap.set(key, record);
  });
  return Array.from(uniqueRecordsMap.values());
}

function dedupMelissaRows(rows) {
  const seen = new Set();
  const unique = [];
  rows.forEach((row) => {
    const key = [ String(row.melissaRecordLabel || "").trim(), normalizeName(row.firstName), normalizeName(row.lastName), String(row.birthYear || "").trim(), normalizeName(row.dataType), normalizeName(row.homeAddressStreet), normalizeName(row.homeAddressCity), normalizeName(row.homeAddressState), normalizeZip(row.homeAddressZip), normalizePhone(row.phone), normalizeEmail(row.email) ].join("|");
    if (seen.has(key)) return;
    seen.add(key); unique.push(row);
  });
  return unique;
}

/* ===============================
 * MELISSA SEARCH — API CALL
 * =============================== */

async function callMelissaSearchAPI(params) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    if (PERSONATOR_PROXY_URL) {
      const response = await fetch(PERSONATOR_PROXY_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Proxy error ${response.status}`);
      return await response.json();
    }

    // EXACT URL STRUCTURE AS CODE 2
    // Phone/Email fix: request valid Personator Search column groups so
    // Phones and Emails are actually returned. "GrpAll" was invalid and
    // caused Melissa to omit phone/email columns entirely.
    let url = PERSONATOR_ENDPOINT + "?id=" + encodeURIComponent(PERSONATOR_LICENSE_KEY) + "&format=JSON&opt=SearchConditions:progressive,SearchType:Auto&cols=GrpName,GrpAddress,GrpPhone,GrpEmail,PreviousAddress,DateOfBirth";
    if (params.full) url += "&full=" + encodeURIComponent(params.full);
    if (params.state) url += "&state=" + encodeURIComponent(params.state);

    console.log("Melissa Search URL (Masked):", url.replace(/([?&]id=)[^&]+/i, "$1***MASKED***"));

    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("Melissa Search timed out.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ===============================
 * MELISSA SEARCH — RESPONSE MAPPING
 * =============================== */

function toDisplayString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function mapMelissaRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const snapshotForLabels = searchLeadRecord || currentLeadRecord || {};
  const leadPhone = normalizePhone(snapshotForLabels.Phone || snapshotForLabels.Mobile || "");
  const leadEmail = normalizeEmail(snapshotForLabels.Email || "");
  const rows = [];

  records.forEach((record, recordIndex) => {
    const groupLabel = `Person #${recordIndex + 1}`;
    const firstName = toDisplayString(record.Name?.FirstName || record.FirstName || record.First || "");
    const middleName = toDisplayString(record.Name?.MiddleName || record.MiddleName || record.Middle || "");
    const lastName = toDisplayString(record.Name?.LastName || record.LastName || record.Last || "");
    const rawDob = String(record.DateOfBirth || "");
    const birthYear = rawDob && rawDob.length >= 4 ? rawDob.substring(0, 4) : "";

    const blankRow = { melissaRecordLabel: groupLabel, firstName, middleName, lastName, birthYear, dataType: "", homeAddressStreet: "", homeAddressState: "", homeAddressCity: "", homeAddressZip: "", phone: "", email: "" };
    const buildAddressRow = (addr, label, phoneStr, emailStr) => ({ ...blankRow, dataType: label, homeAddressStreet: toDisplayString(addr?.AddressLine1 || addr?.Street || ""), homeAddressState: toDisplayString(addr?.State || addr?.StateProvince || ""), homeAddressCity: toDisplayString(addr?.City || addr?.Locality || ""), homeAddressZip: toDisplayString(addr?.PostalCode || addr?.ZipCode || ""), phone: phoneStr || "", email: emailStr || "" });

    // Phone/Email fix: use tolerant extractors that support both the real
    // Melissa "Phones"/"Emails" string arrays and the legacy
    // "PhoneRecords"/"EmailRecords" object arrays.
    const allPhones = extractPhoneList(record);
    const allEmails = extractEmailList(record);
    
    const workingEmails = [...allEmails];
    let currentEmail = "";

    if (record.CurrentAddress) {
      const currentPhone = allPhones[0] || "";
      currentEmail = (leadEmail && allEmails.find((e) => normalizeEmail(e) === leadEmail)) || allEmails[0] || "";
      if (currentEmail) {
        const idx = workingEmails.findIndex((e) => normalizeEmail(e) === normalizeEmail(currentEmail));
        if (idx !== -1) workingEmails.splice(idx, 1);
      }
      rows.push(buildAddressRow(record.CurrentAddress, "Current Address", currentPhone, currentEmail));
    }

    const prevAddresses = record.PreviousAddresses || [];
    const phoneOffset = record.CurrentAddress ? 1 : 0;
    prevAddresses.forEach((addr, i) => {
      rows.push(buildAddressRow(addr, "Previous Address", allPhones[phoneOffset + i] || "", workingEmails[i] || ""));
    });

    const extraPhoneStart = phoneOffset + prevAddresses.length;
    const extraPhones = allPhones.slice(extraPhoneStart);
    const extraEmails = workingEmails.slice(prevAddresses.length);
    const additionalCount = Math.max(extraPhones.length, extraEmails.length);

    for (let i = 0; i < additionalCount; i++) {
      const phone = extraPhones[i] || "";
      const email = extraEmails[i] || "";
      if (!phone && !email) continue;
      rows.push({ ...blankRow, dataType: "Additional Contact", phone, email });
    }
  });
  return rows;
}

/* ===============================
 * RENDER RESULTS TABLE
 * =============================== */

function renderResults(records) {
  els.resultsBody.innerHTML = "";
  if (!records.length) { showEmpty(true); showResults(false); return; }
  showEmpty(false); showResults(true);

  let prevGroup = null;
  records.forEach((rec, index) => {
    const tr = document.createElement("tr");
    tr.dataset.index = index;
    tr.dataset.melissaRecord = rec.melissaRecordLabel || "";

    if (rec.melissaRecordLabel && rec.melissaRecordLabel !== prevGroup) {
      tr.style.borderTop = "2px solid #c5cee0";
      tr.style.backgroundColor = "#f5f8fc";
      prevGroup = rec.melissaRecordLabel;
    }

    tr.innerHTML = `
      <td>${escapeHtml(rec.melissaRecordLabel) || "—"}</td>
      <td>${escapeHtml(rec.firstName) || "—"}</td>
      <td>${escapeHtml(rec.middleName) || "—"}</td>
      <td>${escapeHtml(rec.lastName) || "—"}</td>
      <td>${escapeHtml(rec.birthYear) || "—"}</td>
      <td>${escapeHtml(rec.dataType) || "—"}</td>
      <td>${escapeHtml(rec.homeAddressStreet) || "—"}</td>
      <td>${escapeHtml(rec.homeAddressState) || "—"}</td>
      <td>${escapeHtml(rec.homeAddressCity) || "—"}</td>
      <td>${escapeHtml(rec.homeAddressZip) || "—"}</td>
      <td>${escapeHtml(rec.phone) || "—"}</td>
      <td>${escapeHtml(rec.email) || "—"}</td>
      <td class="action-cell">
        <button class="btn btn-select" data-action="select" data-index="${index}">Select</button>
      </td>
    `;
    tr.addEventListener("click", () => selectRecord(index));
    els.resultsBody.appendChild(tr);
  });
  if (selectedIndex >= 0) markSelectedRow(selectedIndex);
}

/* ===============================
 * UI INTERACTIONS & ZOHO UPDATE
 * =============================== */

function selectRecord(index) {
  const record = filteredRecords[index];
  if (!record) return;
  if (selectedIndex === index) {
    selectedIndex = -1; selectedMelissaRecord = null; markSelectedRow(-1); showPreview(false); refreshUpdateButton(); return;
  }
  selectedIndex = index; selectedMelissaRecord = record;
  markSelectedRow(index); renderPreview(record); showPreview(true); refreshUpdateButton();
}

function markSelectedRow(index) {
  const rows = els.resultsBody.querySelectorAll("tr");
  rows.forEach((row) => {
    const isSel = parseInt(row.dataset.index, 10) === index;
    row.classList.toggle("selected", isSel);
    const btn = row.querySelector(".btn-select");
    if (btn) { btn.classList.toggle("is-selected", isSel); btn.textContent = isSel ? "Selected" : "Select"; }
  });
}

function renderPreview(rec) {
  const fields = [ ["Melissa Record", rec.melissaRecordLabel], ["First Name", rec.firstName], ["Last Name", rec.lastName], ["Year of Birth", rec.birthYear], ["Data Type", rec.dataType], ["Home Address Street", rec.homeAddressStreet], ["Home Address State", rec.homeAddressState], ["Home Address City", rec.homeAddressCity], ["Home Address Zip", rec.homeAddressZip], ["Phone", rec.phone], ["Email", rec.email] ];
  els.previewGrid.innerHTML = fields.map(([label, value]) => `<div class="preview-item"><span class="preview-label">${escapeHtml(label)}</span><span class="preview-value ${value ? "" : "empty"}">${value ? escapeHtml(value) : "—"}</span></div>`).join("");
}

els.filterInput.addEventListener("input", (e) => {
  const q = (e.target.value || "").trim().toLowerCase();
  filteredRecords = !q ? [...melissaRecords] : melissaRecords.filter((r) => [r.melissaRecordLabel, r.firstName, r.lastName, r.birthYear, r.dataType, r.homeAddressStreet, r.homeAddressState, r.homeAddressCity, r.homeAddressZip, r.phone, r.email].join(" ").toLowerCase().includes(q));
  selectedIndex = -1; selectedMelissaRecord = null; showPreview(false); refreshUpdateButton(); renderResults(filteredRecords);
});

function attachUpdateLeadHandler() {
  updateLeadBtn = document.getElementById("updateLeadBtn");
  if (updateLeadBtn) updateLeadBtn.addEventListener("click", async function () { await updateLeadRecord(); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachUpdateLeadHandler); 
else attachUpdateLeadHandler();

async function updateLeadRecord() {
  if (!sdkReady || !currentLeadId || !selectedMelissaRecord) { showBanner("Error: Missing selection.", "error"); return; }
  const updateSnapshot = { homeAddressStreet: String(selectedMelissaRecord.homeAddressStreet || ""), homeAddressState: String(selectedMelissaRecord.homeAddressState || ""), homeAddressCity: String(selectedMelissaRecord.homeAddressCity || ""), homeAddressZip: String(selectedMelissaRecord.homeAddressZip || ""), phone: String(selectedMelissaRecord.phone || ""), email: String(selectedMelissaRecord.email || ""), yearOfBirth: String(selectedMelissaRecord.birthYear || "") };
  
  hideBanner();
  if (updateLeadBtn) { updateLeadBtn.disabled = true; updateLeadBtn.textContent = "Updating..."; }
  if (els.previewUpdateBtn) { els.previewUpdateBtn.disabled = true; els.previewUpdateBtn.textContent = "Updating..."; }

  try {
    const updatePayload = buildUpdatePayload(currentLeadId, updateSnapshot);
    const updateResponse = await ZOHO.CRM.API.updateRecord({ Entity: "Leads", APIData: updatePayload });
    showPreview(false); selectedIndex = -1; selectedMelissaRecord = null; markSelectedRow(-1); refreshUpdateButton();
    const success = updateResponse?.data?.[0]?.code === "SUCCESS" || updateResponse?.data?.[0]?.status === "success";
    if (!success) throw new Error(updateResponse?.data?.[0]?.message || "Zoho update failed.");
    showSuccessModal("Record updated successfully");
  } catch (error) {
    showBanner("Update failed: " + (error.message || error), "error");
  } finally {
    if (updateLeadBtn) { updateLeadBtn.disabled = false; updateLeadBtn.textContent = "Update Lead"; }
    if (els.previewUpdateBtn) els.previewUpdateBtn.textContent = "Update Lead";
    refreshUpdateButton();
  }
}

function buildUpdatePayload(leadId, rec) {
  const yobStr = String(rec.yearOfBirth || "").trim();
  const yobNum = /^\d{4}$/.test(yobStr) ? Number(yobStr) : null;
  if (ADDRESS_UPDATE_MODE === "compound") {
    const payload = { id: leadId }; const homeAddress = {};
    if (rec.homeAddressStreet) homeAddress.Street = rec.homeAddressStreet;
    if (rec.homeAddressState)  homeAddress.State  = rec.homeAddressState;
    if (rec.homeAddressCity)   homeAddress.City   = rec.homeAddressCity;
    if (rec.homeAddressZip)    homeAddress.Zip    = rec.homeAddressZip;
    if (Object.keys(homeAddress).length) payload.Home_Address = homeAddress;
    if (rec.phone) payload[FIELD_API_NAMES.phone] = rec.phone;
    if (rec.email) payload[FIELD_API_NAMES.email] = rec.email;
    if (yobNum !== null) payload[FIELD_API_NAMES.yearOfBirth] = yobNum;
    return payload;
  }
  const updatePayload = { id: leadId };
  if (rec.homeAddressStreet) updatePayload[FIELD_API_NAMES.street] = rec.homeAddressStreet;
  if (rec.homeAddressState)  updatePayload[FIELD_API_NAMES.state]  = rec.homeAddressState;
  if (rec.homeAddressCity)   updatePayload[FIELD_API_NAMES.city]   = rec.homeAddressCity;
  if (rec.homeAddressZip)    updatePayload[FIELD_API_NAMES.zip]    = rec.homeAddressZip;
  if (rec.phone)             updatePayload[FIELD_API_NAMES.phone]  = rec.phone;
  if (rec.email)             updatePayload[FIELD_API_NAMES.email]  = rec.email;
  if (yobNum !== null)       updatePayload[FIELD_API_NAMES.yearOfBirth] = yobNum;
  return updatePayload;
}

function showSuccessModal(message) {
  const modal = document.getElementById("successModal");
  if (!modal) { alert(message || "Record updated successfully"); return; }
  const msgEl = document.getElementById("successMessage") || modal.querySelector(".success-message, .modal-message, h3, p");
  if (msgEl) msgEl.textContent = message || "Record updated successfully";
  modal.classList.remove("hidden"); modal.style.display = "flex";
}

els.successClose.addEventListener("click", closeWidget);
els.cancelBtn.addEventListener("click", closeWidget);
if (els.previewCancelBtn) els.previewCancelBtn.addEventListener("click", function () { selectedIndex = -1; selectedMelissaRecord = null; markSelectedRow(-1); showPreview(false); refreshUpdateButton(); });
if (els.previewUpdateBtn) els.previewUpdateBtn.addEventListener("click", async function () { await updateLeadRecord(); });

function closeWidget() {
  try { ZOHO.CRM.UI.Popup.closeReload().catch(() => { if (ZOHO.CRM.UI.Popup.close) ZOHO.CRM.UI.Popup.close(); }); } 
  catch (e) { console.warn("Popup close failed:", e); }
}
