/* Melissa Personator Search — Lead Update Widget */

const PERSONATOR_ENDPOINT = "https://personatorsearch.melissadata.net/web/doPersonatorSearch";
const PERSONATOR_PROXY_URL = "";
const ENABLE_MELISSA_CONTACT_DEBUG = false;
const PERSONATOR_LICENSE_KEY = "NNyQiGBQttkIhzONLxAqXx**";
const ADDRESS_UPDATE_MODE = "separate"; // "separate" | "compound"

const FIELD_API_NAMES = {
  street: "LOCATION_ADDRESS",
  state: "LOCATION_ADDRESS_STATE",
  city: "LOCATION_ADDRESS_CITY",
  zip: "Home_Address_Zip",
  phone: "Phone",
  email: "Email",
  yearOfBirth: "Year_of_Birth",
};

let sdkReady = false;
let currentLeadId = null;
let currentLeadRecord = null;
let melissaRecords = [];
let filteredRecords = [];
let selectedMelissaRecord = null;
let selectedIndex = -1;
let melissaTableRendered = false;
let searchLeadRecord = null;
let updateLeadBtn = null;

const LEAD_SNAPSHOT_STORAGE_PREFIX = "melissaWidget:leadSearch_VFINAL_:";
const getLeadSnapshotStorageKey = (leadId) => LEAD_SNAPSHOT_STORAGE_PREFIX + String(leadId);

function loadSavedLeadSearchCriteria(leadId) {
  try {
    const raw = localStorage.getItem(getLeadSnapshotStorageKey(leadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("loadSavedLeadSearchCriteria failed:", error);
    return null;
  }
}

function persistLeadSearchCriteria(leadId, leadRecord) {
  try {
    const s = (k) => String(leadRecord?.[k] || "");
    const snapshot = {
      First_Name: s("First_Name"), Last_Name: s("Last_Name"), Full_Name: s("Full_Name"),
      Email: s("Email"), Phone: s("Phone"), Mobile: s("Mobile"),
      Year_of_Birth: s("Year_of_Birth"), Date_of_Birth: s("Date_of_Birth"), DOB: s("DOB"),
      Home_Address_Zip: s("Home_Address_Zip"), Zip_Code: s("Zip_Code"),
      State: String(leadRecord?.State || leadRecord?.LOCATION_ADDRESS_STATE || leadRecord?.Home_Address_State || ""),
    };
    localStorage.setItem(getLeadSnapshotStorageKey(leadId), JSON.stringify(snapshot));
    return snapshot;
  } catch (error) {
    console.warn("persistLeadSearchCriteria failed:", error);
    return null;
  }
}

const $ = (id) => document.getElementById(id);
const els = {
  banner: $("banner"), leadContext: $("leadContext"), loading: $("loadingState"),
  empty: $("emptyState"), resultsWrap: $("resultsWrapper"), resultsBody: $("resultsBody"),
  previewSec: $("previewSection"), previewGrid: $("previewGrid"),
  previewCancelBtn: $("previewCancelBtn"), previewUpdateBtn: $("previewUpdateBtn"),
  cancelBtn: $("cancelBtn"), filterInput: $("filterInput"),
  successModal: $("successModal"), successClose: $("successCloseBtn"),
};

// One-time startup diagnostic: logs which expected DOM elements are missing.
// Helps catch HTML/JS id mismatches without breaking the widget.
(function logMissingElements() {
  try {
    const missing = Object.keys(els).filter((k) => !els[k]);
    if (missing.length) console.warn("[Melissa Widget] Missing DOM elements (check HTML ids):", missing);
  } catch (e) { /* no-op */ }
})();

const toggle = (el, cls, show) => { if (el) el.classList.toggle(cls, show); };
function showBanner(message, type = "info") { if (!els.banner) return; els.banner.textContent = message; els.banner.className = `banner banner-${type}`; }
function hideBanner() { if (!els.banner) return; els.banner.className = "banner banner-hidden"; els.banner.textContent = ""; }
function setLoading(isLoading) { toggle(els.loading, "hidden", !isLoading); }
function showEmpty(show) { toggle(els.empty, "hidden", !show); }
function setEmptyMessage(message) { if (!els.empty) return; const p = els.empty.querySelector("p"); if (p) p.textContent = message; }
function showResults(show) { toggle(els.resultsWrap, "hidden", !show); }
function showPreview(show) { toggle(els.previewSec, "hidden", !show); }

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function refreshUpdateButton() {
  const disabled = !sdkReady || !currentLeadId || !selectedMelissaRecord;
  if (updateLeadBtn) updateLeadBtn.disabled = disabled;
  if (els.previewUpdateBtn) els.previewUpdateBtn.disabled = disabled;
}

/* Contact debug scanner */
function debugScanForContact(object, pathPrefix = "record") {
  const hits = [];
  const phoneKeyRegex = /phone|tel|mobile|cell/i, emailKeyRegex = /email|mail/i;
  const phoneValueRegex = /^\+?[\d().\-\s]{7,}$/, emailValueRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function walk(node, path) {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (phoneValueRegex.test(node) || emailValueRegex.test(node)) hits.push(`${path} = ${JSON.stringify(node)}`);
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`)); return; }
    Object.keys(node).forEach((key) => {
      const childPath = `${path}.${key}`;
      if (phoneKeyRegex.test(key) || emailKeyRegex.test(key)) hits.push(`KEY-MATCH ${childPath} = ${JSON.stringify(node[key])}`);
      walk(node[key], childPath);
    });
  }
  walk(object, pathPrefix);
  return hits;
}

/* Zoho SDK init */
ZOHO.embeddedApp.on("PageLoad", async function (data) {
  console.log("PageLoad data:", data);
  sdkReady = true;
  try { if (ZOHO?.CRM?.UI?.Resize) ZOHO.CRM.UI.Resize({ height: "1000", width: "1900" }); }
  catch (error) { console.warn("Resize failed:", error); }

  if (melissaTableRendered) return;

  if (data) {
    if (data.EntityId) currentLeadId = Array.isArray(data.EntityId) ? data.EntityId[0] : data.EntityId;
    else if (data.Entity) currentLeadId = Array.isArray(data.Entity) ? data.Entity[0] : data.Entity;
  }

  if (!currentLeadId) { setLoading(false); showBanner("Current Lead ID not found.", "error"); return; }

  if (els.leadContext) els.leadContext.textContent = `Current Lead ID: ${currentLeadId}`;

  try {
    currentLeadRecord = await fetchCurrentLead(currentLeadId);
    console.log("Current Lead Data (live CRM):", currentLeadRecord);

    const savedCriteria = loadSavedLeadSearchCriteria(currentLeadId);
    searchLeadRecord = savedCriteria || persistLeadSearchCriteria(currentLeadId, currentLeadRecord) || currentLeadRecord;

    const baseParams = buildMelissaSearchParams(searchLeadRecord);
    console.log("Lead identity for search (Code 2 Logic):", baseParams);

    if (!baseParams.full) {
      setLoading(false);
      setEmptyMessage("Cannot search Melissa: Full Name is required.");
      showEmpty(true);
      return;
    }

    const rawResponse = await callMelissaSearchAPI(baseParams);

    if (ENABLE_MELISSA_CONTACT_DEBUG) {
      console.log("========== FULL MELISSA RESPONSE ==========");
      console.log(JSON.stringify(rawResponse, null, 2));
      console.log("RESPONSE TOP-LEVEL KEYS:", rawResponse && typeof rawResponse === "object" ? Object.keys(rawResponse) : typeof rawResponse);
    }

    if (hasLicenseError(rawResponse)) {
      setLoading(false); setEmptyMessage("Melissa license key issue."); showEmpty(true); return;
    }

    const allRecords = Array.isArray(rawResponse?.Records) ? rawResponse.Records : [];

    if (ENABLE_MELISSA_CONTACT_DEBUG) {
      console.log("========== RECORD COUNT ==========", allRecords.length);
      allRecords.forEach((record, index) => {
        console.log(`---------- RECORD #${index} ----------`);
        console.log("RECORD KEYS:", Object.keys(record || {}));
        console.log("FULL RECORD:", JSON.stringify(record, null, 2));
        const hits = debugScanForContact(record, `record[${index}]`);
        console.log(`CONTACT-LIKE PATHS in record #${index}:`, hits.length ? hits : "(none found — phone/email likely NOT in response)");
      });
    }

    const matchedRaw = dedupRawMelissaRecords(allRecords);
    console.log("Final rendered records count:", matchedRaw.length);
    setLoading(false);

    if (!matchedRaw.length) {
      setEmptyMessage("No Melissa records found for this Name and State."); showEmpty(true); return;
    }

    const uniqueRows = dedupMelissaRows(mapMelissaRecords(matchedRaw));

    if (!uniqueRows.length) {
      setEmptyMessage("No valid address records found to display."); showEmpty(true); return;
    }

    melissaRecords = uniqueRows.map((record) => Object.freeze({ ...record }));
    filteredRecords = melissaRecords.slice();

    renderResults(filteredRecords);
    showResults(true);
    if (els.filterInput) els.filterInput.disabled = false;
    melissaTableRendered = true;
  } catch (error) {
    console.error("Widget load error:", error);
    setLoading(false);
    showBanner(`Failed to load results: ${error.message || error}`, "error");
  }
});

function hasLicenseError(response) {
  if (!response) return false;
  const tr = String(response.TransmissionResults || "");
  return /\bGE0[5-8]\b/.test(tr) || /\bSE01\b/.test(tr);
}

ZOHO.embeddedApp.init();

/* Zoho lead retrieval */
async function fetchCurrentLead(leadId) {
  const response = await ZOHO.CRM.API.getRecord({ Entity: "Leads", RecordID: leadId });
  if (response?.data && response.data.length > 0) return response.data[0];
  throw new Error("Lead not found in CRM.");
}

/* Melissa search input */
function buildMelissaSearchParams(lead) {
  let fullName = lead?.Full_Name
    ? String(lead.Full_Name).trim()
    : (String(lead?.First_Name || "").trim() + " " + String(lead?.Last_Name || "").trim()).trim();
  // Deluge parity: strip everything except letters, digits, space and hyphen
  // (Deluge: name.replaceAll("[^A-Za-z0-9 -]","")). Ensures the exact same
  // `full` string is sent to Melissa as the Deluge function.
  fullName = fullName.replace(/[^A-Za-z0-9 -]/g, "");
  const state = String(lead?.State || lead?.LOCATION_ADDRESS_STATE || lead?.Home_Address_State || "").trim();
  return { full: fullName, state };
}

/* Normalization + dedup */
const normalizeName = (v) => String(v || "").trim().toLowerCase();
const normalizeText = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
const normalizeZip = (v) => String(v || "").replace(/\D/g, "").slice(0, 5);
const normalizeEmail = (v) => String(v || "").trim().toLowerCase();
function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}
function toDisplayString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/* Phone and email extraction */
const extractPhoneList = (record) =>
  (Array.isArray(record?.PhoneRecords) ? record.PhoneRecords : []).map((e) => toDisplayString(e?.phoneNumber)).filter(Boolean);
const extractEmailList = (record) =>
  (Array.isArray(record?.EmailRecords) ? record.EmailRecords : []).map((e) => toDisplayString(e?.email)).filter(Boolean);

function getMelissaUniqueKey(record) {
  const melissaIdentityKey = record?.MelissaIdentityKey || record?.melissaIdentityKey || "";
  if (melissaIdentityKey) return `mik:${String(melissaIdentityKey).trim()}`;
  const phones = extractPhoneList(record).map(normalizePhone).filter(Boolean).sort().join("|");
  const emails = extractEmailList(record).map(normalizeEmail).filter(Boolean).sort().join("|");
  const fullName = record?.FullName || [
    record?.Name?.FirstName || record?.First || "",
    record?.Name?.MiddleName || record?.Middle || "",
    record?.Name?.LastName || record?.Last || "",
  ].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  return [
    "combined", normalizeText(fullName), String(record?.DateOfBirth || "").trim(),
    normalizeText(record?.CurrentAddress?.AddressLine1 || ""), normalizeZip(record?.CurrentAddress?.PostalCode || ""),
    phones, emails,
  ].join("||");
}

function dedupRawMelissaRecords(records) {
  if (!Array.isArray(records) || !records.length) return [];
  const uniqueRecords = new Map();
  records.forEach((record) => {
    const key = getMelissaUniqueKey(record);
    if (!uniqueRecords.has(key)) uniqueRecords.set(key, record);
  });
  return Array.from(uniqueRecords.values());
}

function dedupMelissaRows(rows) {
  const seen = new Set();
  const uniqueRows = [];
  rows.forEach((row) => {
    const key = [
      String(row.melissaRecordLabel || "").trim(), normalizeName(row.firstName), normalizeName(row.lastName),
      String(row.birthYear || "").trim(), normalizeName(row.dataType), normalizeName(row.homeAddressStreet),
      normalizeName(row.homeAddressCity), normalizeName(row.homeAddressState), normalizeZip(row.homeAddressZip),
      normalizePhone(row.phone), normalizeEmail(row.email),
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    uniqueRows.push(row);
  });
  return uniqueRows;
}

/* Melissa API request */
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
    let url = PERSONATOR_ENDPOINT + "?id=" + encodeURIComponent(PERSONATOR_LICENSE_KEY) +
      "&format=JSON&opt=SearchConditions:progressive,SearchType:Auto&cols=PreviousAddress,DateOfBirth,Phone,Email";
    if (params.full) url += "&full=" + encodeURIComponent(params.full);
    if (params.state) url += "&state=" + encodeURIComponent(params.state);
    console.log("Melissa Search URL (Masked):", url.replace(/([?&]id=)[^&]+/i, "$1***MASKED***"));
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Melissa Search timed out.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* Melissa response mapping */
function mapMelissaRecords(records) {
  if (!Array.isArray(records) || !records.length) return [];
  const snapshotForLabels = searchLeadRecord || currentLeadRecord || {};
  const leadEmail = normalizeEmail(snapshotForLabels.Email || "");
  const rows = [];

  records.forEach((record, recordIndex) => {
    const groupLabel = `Person #${recordIndex + 1}`;
    const firstName = toDisplayString(record.Name?.FirstName || record.FirstName || record.First || "");
    const middleName = toDisplayString(record.Name?.MiddleName || record.MiddleName || record.Middle || "");
    const lastName = toDisplayString(record.Name?.LastName || record.LastName || record.Last || "");
    const rawDob = String(record.DateOfBirth || "");
    const birthYear = rawDob.length >= 4 ? rawDob.substring(0, 4) : "";

    const blankRow = {
      melissaRecordLabel: groupLabel, firstName, middleName, lastName, birthYear,
      dataType: "", homeAddressStreet: "", homeAddressState: "", homeAddressCity: "",
      homeAddressZip: "", phone: "", email: "",
    };
    const buildAddressRow = (address, label, phone, email) => ({
      ...blankRow, dataType: label,
      homeAddressStreet: toDisplayString(address?.AddressLine1 || address?.Street || ""),
      homeAddressState: toDisplayString(address?.State || address?.StateProvince || ""),
      homeAddressCity: toDisplayString(address?.City || address?.Locality || ""),
      homeAddressZip: toDisplayString(address?.PostalCode || address?.ZipCode || ""),
      phone: phone || "", email: email || "",
    });

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

    const previousAddresses = record.PreviousAddresses || [];
    const phoneOffset = record.CurrentAddress ? 1 : 0;
    previousAddresses.forEach((address, index) => {
      rows.push(buildAddressRow(address, "Previous Address", allPhones[phoneOffset + index] || "", workingEmails[index] || ""));
    });

    const extraPhones = allPhones.slice(phoneOffset + previousAddresses.length);
    const extraEmails = workingEmails.slice(previousAddresses.length);
    const additionalCount = Math.max(extraPhones.length, extraEmails.length);
    for (let index = 0; index < additionalCount; index++) {
      const phone = extraPhones[index] || "", email = extraEmails[index] || "";
      if (!phone && !email) continue;
      rows.push({ ...blankRow, dataType: "Additional Contact", phone, email });
    }
  });
  return rows;
}

/* Table rendering */
function renderResults(records) {
  if (!els.resultsBody) return;
  els.resultsBody.innerHTML = "";
  if (!records.length) { showEmpty(true); showResults(false); return; }
  showEmpty(false); showResults(true);

  let previousGroup = null;
  records.forEach((record, index) => {
    const row = document.createElement("tr");
    row.dataset.index = index;
    row.dataset.melissaRecord = record.melissaRecordLabel || "";
    if (record.melissaRecordLabel && record.melissaRecordLabel !== previousGroup) {
      row.style.borderTop = "2px solid #c5cee0";
      row.style.backgroundColor = "#f5f8fc";
      previousGroup = record.melissaRecordLabel;
    }
    const cells = [
      record.melissaRecordLabel, record.firstName, record.middleName, record.lastName, record.birthYear,
      record.dataType, record.homeAddressStreet, record.homeAddressState, record.homeAddressCity,
      record.homeAddressZip, record.phone, record.email,
    ];
    row.innerHTML = cells.map((c) => `<td>${escapeHtml(c) || "—"}</td>`).join("") +
      `<td class="action-cell"><button class="btn btn-select" data-action="select" data-index="${index}">Select</button></td>`;
    row.addEventListener("click", () => selectRecord(index));
    els.resultsBody.appendChild(row);
  });
  if (selectedIndex >= 0) markSelectedRow(selectedIndex);
}

/* Selection and preview */
function clearSelection() {
  selectedIndex = -1; selectedMelissaRecord = null;
  markSelectedRow(-1); showPreview(false); refreshUpdateButton();
}

function selectRecord(index) {
  const record = filteredRecords[index];
  if (!record) return;
  if (selectedIndex === index) { clearSelection(); return; }
  selectedIndex = index; selectedMelissaRecord = record;
  markSelectedRow(index); renderPreview(record); showPreview(true); refreshUpdateButton();
}

function markSelectedRow(index) {
  if (!els.resultsBody) return;
  els.resultsBody.querySelectorAll("tr").forEach((row) => {
    const isSelected = parseInt(row.dataset.index, 10) === index;
    row.classList.toggle("selected", isSelected);
    const button = row.querySelector(".btn-select");
    if (button) { button.classList.toggle("is-selected", isSelected); button.textContent = isSelected ? "Selected" : "Select"; }
  });
}

function renderPreview(record) {
  if (!els.previewGrid) return;
  const fields = [
    ["Melissa Record", record.melissaRecordLabel], ["First Name", record.firstName], ["Last Name", record.lastName],
    ["Year of Birth", record.birthYear], ["Data Type", record.dataType], ["Home Address Street", record.homeAddressStreet],
    ["Home Address State", record.homeAddressState], ["Home Address City", record.homeAddressCity],
    ["Home Address Zip", record.homeAddressZip], ["Phone", record.phone], ["Email", record.email],
  ];
  els.previewGrid.innerHTML = fields.map(([label, value]) =>
    `<div class="preview-item"><span class="preview-label">${escapeHtml(label)}</span><span class="preview-value ${value ? "" : "empty"}">${value ? escapeHtml(value) : "—"}</span></div>`
  ).join("");
}

/* Filtering */
if (els.filterInput) {
  els.filterInput.addEventListener("input", (event) => {
    const query = String(event.target.value || "").trim().toLowerCase();
    filteredRecords = !query ? [...melissaRecords] : melissaRecords.filter((record) =>
      [record.melissaRecordLabel, record.firstName, record.lastName, record.birthYear, record.dataType,
       record.homeAddressStreet, record.homeAddressState, record.homeAddressCity, record.homeAddressZip,
       record.phone, record.email].join(" ").toLowerCase().includes(query)
    );
    clearSelection();
    renderResults(filteredRecords);
  });
}

/* Zoho CRM update */
function attachUpdateLeadHandler() {
  updateLeadBtn = $("updateLeadBtn");
  if (updateLeadBtn) updateLeadBtn.addEventListener("click", async () => { await updateLeadRecord(); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachUpdateLeadHandler);
else attachUpdateLeadHandler();

async function updateLeadRecord() {
  if (!sdkReady || !currentLeadId || !selectedMelissaRecord) { showBanner("Error: Missing selection.", "error"); return; }
  const g = (k) => String(selectedMelissaRecord[k] || "");
  const updateSnapshot = {
    homeAddressStreet: g("homeAddressStreet"), homeAddressState: g("homeAddressState"),
    homeAddressCity: g("homeAddressCity"), homeAddressZip: g("homeAddressZip"),
    phone: g("phone"), email: g("email"), yearOfBirth: g("birthYear"),
  };

  hideBanner();
  if (updateLeadBtn) { updateLeadBtn.disabled = true; updateLeadBtn.textContent = "Updating..."; }
  if (els.previewUpdateBtn) { els.previewUpdateBtn.disabled = true; els.previewUpdateBtn.textContent = "Updating..."; }

  try {
    const updatePayload = buildUpdatePayload(currentLeadId, updateSnapshot);
    const updateResponse = await ZOHO.CRM.API.updateRecord({ Entity: "Leads", APIData: updatePayload });
    clearSelection();
    const result = updateResponse?.data?.[0];
    const success = result?.code === "SUCCESS" || result?.status === "success";
    if (!success) throw new Error(result?.message || "Zoho update failed.");
    showSuccessModal("Record updated successfully");
  } catch (error) {
    showBanner("Update failed: " + (error.message || error), "error");
  } finally {
    if (updateLeadBtn) { updateLeadBtn.disabled = false; updateLeadBtn.textContent = "Update Lead"; }
    if (els.previewUpdateBtn) els.previewUpdateBtn.textContent = "Update Lead";
    refreshUpdateButton();
  }
}

function buildUpdatePayload(leadId, record) {
  const yearOfBirthString = String(record.yearOfBirth || "").trim();
  const yearOfBirthNumber = /^\d{4}$/.test(yearOfBirthString) ? Number(yearOfBirthString) : null;

  if (ADDRESS_UPDATE_MODE === "compound") {
    const payload = { id: leadId };
    const homeAddress = {};
    if (record.homeAddressStreet) homeAddress.Street = record.homeAddressStreet;
    if (record.homeAddressState) homeAddress.State = record.homeAddressState;
    if (record.homeAddressCity) homeAddress.City = record.homeAddressCity;
    if (record.homeAddressZip) homeAddress.Zip = record.homeAddressZip;
    if (Object.keys(homeAddress).length) payload.Home_Address = homeAddress;
    if (record.phone) payload[FIELD_API_NAMES.phone] = record.phone;
    if (record.email) payload[FIELD_API_NAMES.email] = record.email;
    if (yearOfBirthNumber !== null) payload[FIELD_API_NAMES.yearOfBirth] = yearOfBirthNumber;
    return payload;
  }

  const updatePayload = { id: leadId };
  [
    ["homeAddressStreet", FIELD_API_NAMES.street], ["homeAddressState", FIELD_API_NAMES.state],
    ["homeAddressCity", FIELD_API_NAMES.city], ["homeAddressZip", FIELD_API_NAMES.zip],
    ["phone", FIELD_API_NAMES.phone], ["email", FIELD_API_NAMES.email],
  ].forEach(([property, apiName]) => { if (record[property]) updatePayload[apiName] = record[property]; });
  if (yearOfBirthNumber !== null) updatePayload[FIELD_API_NAMES.yearOfBirth] = yearOfBirthNumber;
  return updatePayload;
}

/* Modal and close handlers */
function showSuccessModal(message) {
  const modal = $("successModal");
  if (!modal) { alert(message || "Record updated successfully"); return; }
  const messageElement = $("successMessage") || modal.querySelector(".success-message, .modal-message, h3, p");
  if (messageElement) messageElement.textContent = message || "Record updated successfully";
  modal.classList.remove("hidden");
  modal.style.display = "flex";
}

function closeWidget() {
  try {
    ZOHO.CRM.UI.Popup.closeReload().catch(() => { if (ZOHO.CRM.UI.Popup.close) ZOHO.CRM.UI.Popup.close(); });
  } catch (error) { console.warn("Popup close failed:", error); }
}

/* Null-safe event binding — a single missing element must not break the others.
   Each binding is guarded so preview Update/Cancel always attach even if the
   success modal or top-level cancel button is absent from the HTML. */
if (els.successClose) els.successClose.addEventListener("click", closeWidget);
if (els.cancelBtn) els.cancelBtn.addEventListener("click", closeWidget);
if (els.previewCancelBtn) els.previewCancelBtn.addEventListener("click", clearSelection);
if (els.previewUpdateBtn) els.previewUpdateBtn.addEventListener("click", async () => { await updateLeadRecord(); });
