/* =============================================================
 * Melissa Personator Search — Lead Update Widget (Code 2 Logic Integrated)
 * -------------------------------------------------------------
 * Flow:
 * 1. Zoho SDK PageLoad -> get current Lead ID
 * 2. Fetch current Lead from Zoho CRM (input only)
 * 3. Build Melissa Personator Search request (USING CODE 2 LOGIC: Full Name + State)
 * 4. Call Melissa Personator Search API (progressive, Auto)
 * 5. Render matching Melissa records in the results table
 * 6. User selects a row -> preview shows
 * 7. Update button writes selected Melissa values to current Lead
 * 8. Success modal -> close popup
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

const LEAD_SNAPSHOT_STORAGE_PREFIX = "melissaWidget:leadSearchCriteria:";

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
      Email:            String(leadRecord?.Email            || ""),
      Phone:            String(leadRecord?.Phone            || ""),
      Mobile:           String(leadRecord?.Mobile           || ""),
      Year_of_Birth:    String(leadRecord?.Year_of_Birth    || ""),
      Date_of_Birth:    String(leadRecord?.Date_of_Birth    || ""),
      DOB:              String(leadRecord?.DOB              || ""),
      Home_Address_Zip: String(leadRecord?.Home_Address_Zip || ""),
      Zip_Code:         String(leadRecord?.Zip_Code         || ""),
      // ADDED FOR CODE 2 LOGIC: Capture State from Lead
      State:            String(leadRecord?.State || leadRecord?.LOCATION_ADDRESS_STATE || ""),
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
 * DOM REFERENCES
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

/* ===============================
 * UI HELPERS
 * =============================== */

function showBanner(message, type = "info") {
  els.banner.textContent = message;
  els.banner.className = `banner banner-${type}`;
}

function hideBanner() {
  els.banner.className = "banner banner-hidden";
  els.banner.textContent = "";
}

function setLoading(isLoading) {
  els.loading.classList.toggle("hidden", !isLoading);
}

function showEmpty(show) {
  els.empty.classList.toggle("hidden", !show);
}

function setEmptyMessage(msg) {
  const p = els.empty.querySelector("p");
  if (p) p.textContent = msg;
}

function showResults(show) {
  els.resultsWrap.classList.toggle("hidden", !show);
}

function showPreview(show) {
  els.previewSec.classList.toggle("hidden", !show);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let updateLeadBtn = null;

function refreshUpdateButton() {
  const disabled = !sdkReady || !currentLeadId || !selectedMelissaRecord;
  if (updateLeadBtn) updateLeadBtn.disabled = disabled;
  if (els.previewUpdateBtn) els.previewUpdateBtn.disabled = disabled;
}

/* ===============================
 * ZOHO SDK INIT
 * =============================== */

ZOHO.embeddedApp.on("PageLoad", async function (data) {
  console.log("PageLoad data:", data);
  sdkReady = true;

  try {
    if (ZOHO?.CRM?.UI?.Resize) {
      ZOHO.CRM.UI.Resize({ height: "1000", width: "1900" });
    }
  } catch (resizeErr) {
    console.warn("ZOHO.CRM.UI.Resize failed:", resizeErr);
  }

  if (melissaTableRendered) {
    console.log("PageLoad re-fired after initial render — skipping to preserve Melissa table phones.");
    return;
  }

  if (data) {
    if (data.EntityId) {
      currentLeadId = Array.isArray(data.EntityId) ? data.EntityId[0] : data.EntityId;
    } else if (data.Entity) {
      currentLeadId = Array.isArray(data.Entity) ? data.Entity[0] : data.Entity;
    }
  }

  console.log("Current Lead ID:", currentLeadId);

  if (!currentLeadId) {
    setLoading(false);
    showBanner("Current Lead ID not found. Please open this widget from a Lead record.", "error");
    els.leadContext.textContent = "No Lead context";
    return;
  }

  els.leadContext.textContent = `Current Lead ID: ${currentLeadId}`;

  try {
    currentLeadRecord = await fetchCurrentLead(currentLeadId);
    console.log("Current Lead Data (live CRM):", currentLeadRecord);

    const savedCriteria = loadSavedLeadSearchCriteria(currentLeadId);
    if (savedCriteria) {
      searchLeadRecord = savedCriteria;
    } else {
      searchLeadRecord = persistLeadSearchCriteria(currentLeadId, currentLeadRecord) || currentLeadRecord;
    }

    // 2) Build identity params using CODE 2 LOGIC (Full Name + State)
    const baseParams = buildMelissaSearchParams(searchLeadRecord);
    console.log("Lead identity for search (Code 2 Logic):", baseParams);

    if (!baseParams.full) {
      setLoading(false);
      setEmptyMessage("Cannot search Melissa: Full Name is required on the Lead.");
      showEmpty(true);
      showResults(false);
      return;
    }

    // 3) Only ONE attempt is made, matching Code 2 exactly. No ladder.
    const searchAttempts = [
      {
        label: "Full Name + State (Progressive)",
        params: { full: baseParams.full, state: baseParams.state },
      }
    ];

    const allRecords = [];
    let licenseIssueDetected = false;
    let lastTransmissionResults = "";
    let lastRawResponse = null;

    for (const attempt of searchAttempts) {
      console.log(`Attempt: ${attempt.label}`, attempt.params);

      let rawResponse = null;
      try {
        rawResponse = await callMelissaSearchAPI(attempt.params);
      } catch (attemptErr) {
        console.error(`Attempt "${attempt.label}" threw:`, attemptErr);
        continue;
      }

      lastRawResponse = rawResponse;
      if (hasLicenseError(rawResponse)) {
        licenseIssueDetected = true;
        lastTransmissionResults = String(rawResponse?.TransmissionResults || "");
        break;
      }

      const recs = Array.isArray(rawResponse?.Records) ? rawResponse.Records : [];
      allRecords.push(...recs);
    }

    if (licenseIssueDetected) {
      setLoading(false);
      setEmptyMessage("Melissa license key or Personator Search access issue.");
      showEmpty(true);
      showResults(false);
      return;
    }

    // Deduplicate exact same records to keep table clean
    const uniqueRaw = dedupRawMelissaRecords(allRecords);
    
    // CODE 2 LOGIC: Code 2 trusts the API and does NOT run a strict JS filter.
    // So we bypass the old strict filter and accept the records API returned.
    const matchedRaw = uniqueRaw; 
    
    console.log("Final rendered records count:", matchedRaw.length);

    setLoading(false);

    if (matchedRaw.length === 0) {
      setEmptyMessage("No Melissa records found for this Name and State.");
      showEmpty(true);
      showResults(false);
      return;
    }

    // Map to flat rows for the table
    const flattenedMelissaRows = mapMelissaRecords(matchedRaw);
    const uniqueRows = dedupMelissaRows(flattenedMelissaRows);

    if (uniqueRows.length === 0) {
      setEmptyMessage("No valid address records found to display.");
      showEmpty(true);
      showResults(false);
      return;
    }

    melissaRecords  = uniqueRows.map((r) => Object.freeze({ ...r }));
    filteredRecords = melissaRecords.slice();

    renderResults(filteredRecords);
    showResults(true);
    els.filterInput.disabled = false;
    melissaTableRendered = true;

  } catch (err) {
    console.error("Widget load error:", err);
    setLoading(false);
    showBanner(`Failed to load Melissa Search results: ${err.message || err}`, "error");
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
  try {
    const resp = await ZOHO.CRM.API.getRecord({
      Entity: "Leads",
      RecordID: leadId,
    });
    if (resp && resp.data && resp.data.length > 0) {
      return resp.data[0];
    }
    throw new Error("Lead not found in CRM.");
  } catch (err) {
    throw new Error(`Lead fetch failed: ${err.message || err}`);
  }
}

/* ===============================
 * MELISSA SEARCH — INPUT PARAMS (CODE 2 LOGIC)
 * =============================== */

function buildMelissaSearchParams(lead) {
  // Extracting exactly what Code 2 extracts: Full Name and State
  const first = String(lead?.First_Name || "").trim();
  const last = String(lead?.Last_Name || "").trim();
  const fullName = (first + " " + last).trim();
  
  return {
    full: fullName,
    state: String(lead?.State || lead?.LOCATION_ADDRESS_STATE || "").trim()
  };
}

/* ===============================
 * NORMALIZATION HELPERS
 * =============================== */

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeZip(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function extractYear(value) {
  if (!value) return "";
  const m = String(value).match(/(19|20)\d{2}/);
  return m ? m[0] : "";
}

/* ===============================
 * RECORD DEDUPLICATION
 * =============================== */

function getMelissaUniqueKey(record) {
  const mik = record?.MelissaIdentityKey || record?.melissaIdentityKey || record?.MelissaIdentityKEY || "";
  if (mik) return `mik:${String(mik).trim()}`;

  const phones = (record?.PhoneRecords || [])
    .map((p) => normalizePhone((typeof p === "string" ? p : p?.phoneNumber || p?.PhoneNumber || p?.Phone) || ""))
    .filter(Boolean).sort().join("|");

  const emails = (record?.EmailRecords || [])
    .map((e) => normalizeEmail((typeof e === "string" ? e : e?.email || e?.Email || e?.EmailAddress) || ""))
    .filter(Boolean).sort().join("|");

  const fullName = record?.FullName || 
    [ record?.Name?.FirstName || record?.FirstName || record?.First_Name || record?.First || "",
      record?.Name?.MiddleName || record?.MiddleName || "",
      record?.Name?.LastName || record?.LastName || record?.Last_Name || record?.Last || "" ]
      .map((s) => String(s || "").trim()).filter(Boolean).join(" ");

  return [ "combined", normalizeText(fullName), String(record?.DateOfBirth || "").trim(),
    normalizeText(record?.CurrentAddress?.AddressLine1 || ""), normalizeZip(record?.CurrentAddress?.PostalCode || ""),
    phones, emails, ].join("||");
}

function dedupRawMelissaRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const uniqueRecordsMap = new Map();
  records.forEach((record) => {
    const key = getMelissaUniqueKey(record);
    if (!uniqueRecordsMap.has(key)) {
      uniqueRecordsMap.set(key, record);
    }
  });
  return Array.from(uniqueRecordsMap.values());
}

function dedupMelissaRows(rows) {
  const seen = new Set();
  const unique = [];
  rows.forEach((row) => {
    const key = [
      String(row.melissaRecordLabel || "").trim(), normalizeName(row.firstName),
      normalizeName(row.lastName), String(row.birthYear || "").trim(),
      normalizeName(row.dataType), normalizeName(row.homeAddressStreet),
      normalizeName(row.homeAddressCity), normalizeName(row.homeAddressState),
      normalizeZip(row.homeAddressZip), normalizePhone(row.phone), normalizeEmail(row.email),
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });
  return unique;
}

/* ===============================
 * MELISSA SEARCH — API CALL
 * =============================== */

const MELISSA_FETCH_TIMEOUT_MS = 20000;

async function callMelissaSearchAPI(params) {
  const maxAttempts = 2; 
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchMelissaOnce(params);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.log("Retrying Melissa Search...");
      }
    }
  }
  throw lastError;
}

async function fetchMelissaOnce(params) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MELISSA_FETCH_TIMEOUT_MS);

  try {
    if (PERSONATOR_PROXY_URL) {
      const response = await fetch(PERSONATOR_PROXY_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Proxy returned ${response.status} ${response.statusText}`);
      return await response.json();
    }

    const optional = (key, value) => value ? "&" + key + "=" + encodeURIComponent(value) : "";

    // API URL CONSTRUCTED EXACTLY LIKE CODE 2 
    const url =
      PERSONATOR_ENDPOINT +
      "?id=" + encodeURIComponent(PERSONATOR_LICENSE_KEY) +
      "&cols=GrpAll" +
      "&format=JSON" +
      "&full=" + encodeURIComponent(params.full || "") +
      optional("state", params.state) +
      "&opt=SearchConditions:progressive,SearchType:Auto";

    const maskedUrl = maskKeyInUrl(url);
    console.log("Melissa Search URL:", maskedUrl);

    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (!response.ok) throw new Error(`Melissa Search API error ${response.status}`);
    return await response.json();

  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("Melissa Search request timed out.");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function maskKeyInUrl(url) {
  return String(url).replace(/([?&]id=)[^&]+/i, "$1***MASKED***");
}

/* =====================================================================
 * MELISSA SEARCH — RESPONSE MAPPING (Untouched UI code)
 * ===================================================================== */

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
    
    const firstName = toDisplayString(record.Name?.FirstName || record.FirstName || record.First_Name || record.First || "");
    const middleName = toDisplayString(record.Name?.MiddleName || record.MiddleName || record.Middle_Name || record.Middle || "");
    const lastName = toDisplayString(record.Name?.LastName || record.LastName || record.Last_Name || record.Last || "");

    const rawDob = String(record.DateOfBirth || "");
    const birthYear = rawDob && rawDob.length >= 4 ? rawDob.substring(0, 4) : "";

    const blankRow = {
      melissaRecordLabel: groupLabel, firstName, middleName, lastName, birthYear,
      dataType: "", homeAddressStreet: "", homeAddressState: "", homeAddressCity: "", homeAddressZip: "", phone: "", email: "",
    };

    const buildAddressRow = (addr, label, phoneStr, emailStr) => ({
      ...blankRow, dataType: label,
      homeAddressStreet: toDisplayString(addr?.AddressLine1 || addr?.AddressLine || addr?.Address || addr?.Street || ""),
      homeAddressState: toDisplayString(addr?.State || addr?.AdministrativeArea || addr?.StateProvince || ""),
      homeAddressCity: toDisplayString(addr?.City || addr?.Locality || ""),
      homeAddressZip: toDisplayString(addr?.PostalCode || addr?.Zip || addr?.ZipCode || ""),
      phone: phoneStr || "", email: emailStr || "",
    });

    const allPhones = (record.PhoneRecords || [])
      .map((entry) => typeof entry === "string" ? entry : entry?.PhoneNumber || entry?.phoneNumber || entry?.Phone || "")
      .map(toDisplayString).filter(Boolean);

    const allEmails = (record.EmailRecords || [])
      .map((entry) => typeof entry === "string" ? entry : entry?.Email || entry?.email || entry?.EmailAddress || "")
      .map(toDisplayString).filter(Boolean);

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
      const phone = allPhones[phoneOffset + i] || "";
      const email = workingEmails[i] || "";
      rows.push(buildAddressRow(addr, "Previous Address", phone, email));
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
  if (!records.length) {
    showEmpty(true);
    showResults(false);
    return;
  }
  showEmpty(false);
  showResults(true);

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
 * SELECT RECORD
 * =============================== */

function selectRecord(index) {
  const record = filteredRecords[index];
  if (!record) return;

  if (selectedIndex === index) {
    selectedIndex = -1;
    selectedMelissaRecord = null;
    markSelectedRow(-1);
    showPreview(false);
    refreshUpdateButton();
    return;
  }

  selectedIndex = index;
  selectedMelissaRecord = record;
  markSelectedRow(index);
  renderPreview(record);
  showPreview(true);
  refreshUpdateButton();
}

function markSelectedRow(index) {
  const rows = els.resultsBody.querySelectorAll("tr");
  rows.forEach((row) => {
    const isSel = parseInt(row.dataset.index, 10) === index;
    row.classList.toggle("selected", isSel);
    const btn = row.querySelector(".btn-select");
    if (btn) {
      btn.classList.toggle("is-selected", isSel);
      btn.textContent = isSel ? "Selected" : "Select";
    }
  });
}

function renderPreview(rec) {
  const fields = [
    ["Melissa Record", rec.melissaRecordLabel], ["First Name", rec.firstName], ["Last Name", rec.lastName],
    ["Year of Birth", rec.birthYear], ["Data Type", rec.dataType],
    ["Home Address Street", rec.homeAddressStreet], ["Home Address State", rec.homeAddressState],
    ["Home Address City", rec.homeAddressCity], ["Home Address Zip", rec.homeAddressZip],
    ["Phone", rec.phone], ["Email", rec.email],
  ];

  els.previewGrid.innerHTML = fields
    .map(([label, value]) => `
      <div class="preview-item">
        <span class="preview-label">${escapeHtml(label)}</span>
        <span class="preview-value ${value ? "" : "empty"}">${value ? escapeHtml(value) : "—"}</span>
      </div>
    `).join("");
}

/* ===============================
 * FILTER
 * =============================== */

els.filterInput.addEventListener("input", (e) => {
  const q = (e.target.value || "").trim().toLowerCase();
  if (!q) {
    filteredRecords = [...melissaRecords];
  } else {
    filteredRecords = melissaRecords.filter((r) =>
      [ r.melissaRecordLabel, r.firstName, r.lastName, r.birthYear, r.dataType, r.homeAddressStreet,
        r.homeAddressState, r.homeAddressCity, r.homeAddressZip, r.phone, r.email,
      ].join(" ").toLowerCase().includes(q)
    );
  }
  selectedIndex = -1;
  selectedMelissaRecord = null;
  showPreview(false);
  refreshUpdateButton();
  renderResults(filteredRecords);
});

/* ===============================
 * UPDATE LEAD IN ZOHO CRM
 * =============================== */

function attachUpdateLeadHandler() {
  updateLeadBtn = document.getElementById("updateLeadBtn");
  if (!updateLeadBtn) return;
  updateLeadBtn.addEventListener("click", async function () { await updateLeadRecord(); });
}

if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", attachUpdateLeadHandler); } 
else { attachUpdateLeadHandler(); }

async function updateLeadRecord() {
  if (!sdkReady || !currentLeadId || !selectedMelissaRecord) {
    showBanner("Error: Missing context or selection.", "error");
    return;
  }

  const updateSnapshot = {
    homeAddressStreet: String(selectedMelissaRecord.homeAddressStreet || ""),
    homeAddressState:  String(selectedMelissaRecord.homeAddressState  || ""),
    homeAddressCity:   String(selectedMelissaRecord.homeAddressCity   || ""),
    homeAddressZip:    String(selectedMelissaRecord.homeAddressZip    || ""),
    phone:             String(selectedMelissaRecord.phone             || ""),
    email:             String(selectedMelissaRecord.email             || ""),
    yearOfBirth:       String(selectedMelissaRecord.birthYear         || ""),
  };

  hideBanner();
  if (updateLeadBtn) { updateLeadBtn.disabled = true; updateLeadBtn.textContent = "Updating..."; }
  if (els.previewUpdateBtn) { els.previewUpdateBtn.disabled = true; els.previewUpdateBtn.textContent = "Updating..."; }

  try {
    const updatePayload = buildUpdatePayload(currentLeadId, updateSnapshot);
    const updateResponse = await ZOHO.CRM.API.updateRecord({ Entity: "Leads", APIData: updatePayload });

    showPreview(false);
    selectedIndex = -1;
    selectedMelissaRecord = null;
    markSelectedRow(-1);
    refreshUpdateButton();

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
    const payload = { id: leadId };
    const homeAddress = {};
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

/* ===============================
 * SUCCESS MODAL + CLOSE
 * =============================== */

function showSuccessModal(message) {
  const modal = document.getElementById("successModal");
  if (!modal) { alert(message || "Record updated successfully"); return; }
  const msgEl = document.getElementById("successMessage") || modal.querySelector(".success-message, .modal-message, h3, p");
  if (msgEl) msgEl.textContent = message || "Record updated successfully";
  modal.classList.remove("hidden");
  modal.style.display = "flex";
}

els.successClose.addEventListener("click", closeWidget);
els.cancelBtn.addEventListener("click", closeWidget);

if (els.previewCancelBtn) {
  els.previewCancelBtn.addEventListener("click", function () {
    selectedIndex = -1;
    selectedMelissaRecord = null;
    markSelectedRow(-1);
    showPreview(false);
    refreshUpdateButton();
  });
}

if (els.previewUpdateBtn) {
  els.previewUpdateBtn.addEventListener("click", async function () { await updateLeadRecord(); });
}

function closeWidget() {
  try {
    ZOHO.CRM.UI.Popup.closeReload().catch(() => {
      if (ZOHO.CRM.UI.Popup.close) ZOHO.CRM.UI.Popup.close();
    });
  } catch (e) {
    console.warn("Popup close failed:", e);
  }
}
