// ================================================================
//  MATA RAJRANI HOSPITAL — COMPLETE GOOGLE APPS SCRIPT v2
//  Single Source of Truth — All data lives in Google Sheets
//
//  SETUP (one time only):
//  1. Open Google Sheets → Extensions → Apps Script
//  2. Paste this entire file → Save
//  3. Deploy → New Deployment → Web App
//     Execute as: Me | Access: Anyone
//  4. Copy the URL → paste in index.html and admin-portal.html
//     where it says: PASTE_YOUR_SCRIPT_URL_HERE
// ================================================================

const NOTIFY_EMAIL = "hospital@example.com"; // ← CHANGE to real email

const SH = {
  bookings    : "Bookings",
  tests       : "Tests",
  doctors     : "Doctors",
  departments : "Departments",
  homeServices: "HomeServices",
  config      : "Config",
  timeslots   : "TimeSlots",
};

// ─── ROUTER ──────────────────────────────────────────────
function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.action === "saveBooking")       return ok(saveBooking(b.data));
    if (b.action === "saveDoctor")        return ok(upsert(SH.doctors,      b.data, "id",  doctorCols));
    if (b.action === "deleteDoctor")      return ok(del(SH.doctors,         b.id));
    if (b.action === "saveTest")          return ok(upsert(SH.tests,        b.data, "id",  testCols));
    if (b.action === "deleteTest")        return ok(del(SH.tests,           b.id));
    if (b.action === "saveDept")          return ok(upsert(SH.departments,  b.data, "id",  deptCols));
    if (b.action === "deleteDept")        return ok(del(SH.departments,     b.id));
    if (b.action === "saveHomeService")   return ok(upsert(SH.homeServices, b.data, "id",  homeCols));
    if (b.action === "deleteHomeService") return ok(del(SH.homeServices,    b.id));
    if (b.action === "saveConfig")        return ok(saveConfig(b.data));
    if (b.action === "saveSlots")         return ok(saveSlots(b.slots));
    return err("Unknown action: " + b.action);
  } catch(e) { return err(e.message); }
}

function doGet(e) {
  try {
    const a = e.parameter.action || "getAll";
    if (a === "getAll")      return ok(getAllData());
    if (a === "getBookings") return ok(getBookings());
    if (a === "getStats")    return ok(getStats());
    return err("Unknown action");
  } catch(e) { return err(e.message); }
}

function ok(data)  { return res({ success: true,  ...data }); }
function err(msg)  { return res({ success: false, error: msg }); }
function res(obj)  { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

// ─── COLUMN DEFINITIONS ──────────────────────────────────
const testCols    = ["id","category","name","price","duration","preparation","description"];
const doctorCols  = ["id","name","specialty","experience","description","imageUrl"];
const deptCols    = ["id","name","icon","consultationFee","doctors","description"];
const homeCols    = ["id","name","icon","price","description","availability","duration"];

// ─── GET ALL (website loads this once on page open) ───────
function getAllData() {
  initSheets();
  return {
    config      : getConfig(),
    tests       : getRows(SH.tests,        testCols),
    doctors     : getRows(SH.doctors,      doctorCols),
    departments : getRows(SH.departments,  deptCols),
    homeServices: getRows(SH.homeServices, homeCols),
    timeSlots   : getTimeSlots(),
  };
}

// ─── GENERIC ROW READER ──────────────────────────────────
function getRows(sheetName, cols) {
  const vals = sheet(sheetName).getDataRange().getValues();
  return vals.slice(1).filter(r => r[0]).map(r => {
    const obj = {};
    cols.forEach((c,i) => obj[c] = r[i] !== undefined ? r[i] : "");
    return obj;
  });
}

// ─── GENERIC UPSERT ──────────────────────────────────────
function upsert(sheetName, data, keyField, cols) {
  const s    = sheet(sheetName);
  const vals = s.getDataRange().getValues();
  const row  = cols.map(c => data[c] !== undefined ? data[c] : "");
  if (!data[keyField]) data[keyField] = sheetName + "_" + Date.now();
  row[0] = data[keyField];

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === data[keyField]) {
      s.getRange(i+1, 1, 1, cols.length).setValues([row]);
      return { updated: true };
    }
  }
  s.appendRow(row);
  return { inserted: true, id: data[keyField] };
}

// ─── GENERIC DELETE ──────────────────────────────────────
function del(sheetName, id) {
  const s    = sheet(sheetName);
  const vals = s.getDataRange().getValues();
  for (let i = vals.length - 1; i >= 1; i--) {
    if (vals[i][0] === id) { s.deleteRow(i+1); return { deleted: true }; }
  }
  return { deleted: false, error: "Not found" };
}

// ─── BOOKINGS ─────────────────────────────────────────────
function saveBooking(data) {
  const s   = sheet(SH.bookings);
  const now = new Date();
  const ref = "MRH-" + now.getFullYear()
            + String(now.getMonth()+1).padStart(2,"0")
            + String(now.getDate()).padStart(2,"0")
            + "-" + String(Math.floor(Math.random()*9000)+1000);
  s.appendRow([ref, now.toLocaleString("en-IN"), data.bookingType||"", data.patientName||"",
    data.patientAge||"", data.patientPhone||"", data.patientGender||"",
    data.serviceName||"", data.price||"", data.preferredDate||"",
    data.timeSlot||"", data.doctor||"", data.address||"",
    data.notes||"", data.paymentId||"PENDING", "Confirmed"]);
  try { sendEmail(data, ref); } catch(x) {}
  return { refId: ref };
}

function getBookings() {
  const vals = sheet(SH.bookings).getDataRange().getValues();
  if (vals.length < 2) return { bookings: [] };
  const headers = vals[0];
  return { bookings: vals.slice(1).map(r => { const o={}; headers.forEach((h,i)=>o[h]=r[i]); return o; }) };
}

function getStats() {
  const rows  = sheet(SH.bookings).getDataRange().getValues().slice(1);
  const today = new Date().toLocaleDateString("en-IN");
  return { stats: {
    total       : rows.length,
    today       : rows.filter(r => new Date(r[1]).toLocaleDateString("en-IN")===today).length,
    tests       : rows.filter(r => r[2]==="Test").length,
    appointments: rows.filter(r => r[2]==="Appointment").length,
    homeService : rows.filter(r => r[2]==="Home Service").length,
    revenue     : rows.reduce((s,r) => s+(parseFloat(r[8])||0), 0)
  }};
}

// ─── CONFIG ───────────────────────────────────────────────
function getConfig() {
  const vals = sheet(SH.config).getDataRange().getValues();
  const cfg  = {};
  vals.slice(1).forEach(r => { if(r[0]) cfg[r[0]] = r[1]; });
  return cfg;
}

function saveConfig(data) {
  const s    = sheet(SH.config);
  const vals = s.getDataRange().getValues();
  for (const [key, val] of Object.entries(data)) {
    let found = false;
    for (let i=1; i<vals.length; i++) { if(vals[i][0]===key){ s.getRange(i+1,2).setValue(val); found=true; break; } }
    if (!found) s.appendRow([key, val]);
  }
  return { saved: true };
}

// ─── TIME SLOTS ───────────────────────────────────────────
function getTimeSlots() {
  return sheet(SH.timeslots).getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>r[0]);
}

function saveSlots(slots) {
  const s = sheet(SH.timeslots);
  s.clearContents();
  s.appendRow(["Time Slot"]);
  slots.forEach(t => s.appendRow([t]));
  return { saved: true };
}

// ─── HELPERS ─────────────────────────────────────────────
function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function initSheets() {
  // Only creates sheets + headers + default data if they don't exist
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function ensure(name, headers, defaultRows) {
    if (!ss.getSheetByName(name)) {
      const s = ss.insertSheet(name);
      s.appendRow(headers);
      const hr = s.getRange(1,1,1,headers.length);
      hr.setBackground("#14b8a6"); hr.setFontColor("white"); hr.setFontWeight("bold");
      s.setFrozenRows(1);
      (defaultRows||[]).forEach(r => s.appendRow(r));
    }
  }

  ensure(SH.bookings, ["Booking ID","Timestamp","Type","Patient Name","Age","Phone","Gender","Service","Amount (₹)","Date","Time Slot","Doctor","Address","Notes","Payment ID","Status"]);

  ensure(SH.tests, ["id","category","name","price","duration","preparation","description"], [
    ["mri_brain","radiology","MRI Brain",3500,"45 min","No metal objects. Inform doctor of implants.","Brain imaging for tumors, strokes, abnormalities."],
    ["mri_spine","radiology","MRI Spine (Lumbar)",4000,"45 min","No metal objects.","Assessment of disc herniation, spinal cord."],
    ["ct_chest","radiology","CT Scan Chest",2800,"20 min","Remove all metal jewellery.","Cross-sectional imaging of lungs and chest."],
    ["xray_chest","radiology","X-Ray Chest",300,"10 min","Remove metal from chest area.","Standard chest radiograph for lungs, heart."],
    ["usg_abdomen","radiology","USG Abdomen",800,"20 min","Fast 6 hrs, drink 1L water 1 hr before.","Ultrasound imaging of abdominal organs."],
    ["cbc","blood_tests","Complete Blood Count (CBC)",200,"Same day","No fasting required.","Measures RBC, WBC, platelets, haemoglobin."],
    ["lft","blood_tests","Liver Function Test (LFT)",500,"Same day","Fast for 8 hours.","Evaluates liver via enzyme and protein levels."],
    ["tsh","blood_tests","Thyroid Profile (TSH,T3,T4)",600,"Same day","Early morning fasting preferred.","Comprehensive thyroid hormone assessment."],
    ["hba1c","blood_tests","HbA1c (Diabetes Control)",350,"Same day","No fasting required.","3-month average blood sugar control marker."],
    ["lipid","blood_tests","Lipid Profile",400,"Same day","Fast for 12 hours.","Cholesterol, triglycerides, HDL, LDL."],
    ["ecg","cardiac","ECG (12 Lead)",200,"10 min","Rest 5 min before test.","Records heart electrical activity."],
    ["echo","cardiac","2D Echocardiography",1800,"30 min","No special preparation.","Ultrasound assessment of heart chambers."],
    ["tmt","cardiac","TMT Stress Test",1500,"45 min","Comfortable shoes. Fast 4 hours.","Heart response to controlled physical stress."],
    ["pap","womens_health","Pap Smear",600,"Same day","Avoid intercourse 48 hrs before.","Cervical cancer screening test."],
    ["mammo","womens_health","Mammography",1200,"20 min","No deodorant on the day.","Breast imaging for cancer detection."],
  ]);

  ensure(SH.doctors, ["id","name","specialty","experience","description","imageUrl"], [
    ["doc_1","Dr. A. Sharma","Orthopedics","15+","Specialist in joint replacement and trauma surgery.",""],
    ["doc_2","Dr. B. Singh","Gynecology","12+","Expert in high-risk pregnancies and laparoscopic surgeries.",""],
    ["doc_3","Dr. M. Kapoor","Cardiology","18+","Preventive cardiology and echocardiography specialist.",""],
    ["doc_4","Dr. P. Gupta","Pediatrics","10+","Child health, immunization, and developmental care.",""],
    ["doc_5","Dr. R. Verma","General Medicine","20+","Diabetes, hypertension, and internal medicine expert.",""],
    ["doc_6","Dr. K. Das","ENT","8+","Ear, nose and throat surgeries and hearing disorders.",""],
  ]);

  ensure(SH.departments, ["id","name","icon","consultationFee","doctors","description"], [
    ["general","General Medicine","fas fa-stethoscope",300,"Dr. R. Verma","Primary care, chronic disease, fever, diabetes."],
    ["pediatrics","Pediatrics","fas fa-baby",350,"Dr. P. Gupta","Child health from newborn to adolescent."],
    ["orthopedics","Orthopedics","fas fa-bone",400,"Dr. A. Sharma","Fractures, joint pain, spine problems."],
    ["gynecology","Gynecology","fas fa-heartbeat",400,"Dr. B. Singh","Prenatal care, deliveries, laparoscopy."],
    ["cardiology","Cardiology","fas fa-heart",500,"Dr. M. Kapoor","Heart conditions, ECG interpretation."],
    ["ent","ENT","fas fa-deaf",350,"Dr. K. Das","Ear, nose and throat disorders."],
  ]);

  ensure(SH.homeServices, ["id","name","icon","price","description","availability","duration"], [
    ["blood_home","Home Blood Collection","fas fa-tint",100,"Certified phlebotomist visits home to collect samples.","7 AM – 11 AM","30 min"],
    ["nursing_home","Home Nursing Care","fas fa-user-nurse",500,"Professional nursing including dressings, injections.","24/7 On Request","Per visit"],
    ["physio_home","Home Physiotherapy","fas fa-walking",600,"Certified physiotherapist for rehabilitation.","8 AM – 6 PM","45 min"],
    ["doctor_home","Doctor Home Visit","fas fa-user-md",800,"Qualified doctor visits for consultation.","10 AM – 6 PM","30 min"],
  ]);

  ensure(SH.config, ["Key","Value"], [
    ["hospital_name","Mata Rajrani Memorial Hospital"],
    ["tagline","Compassionate Care, Advanced Healing."],
    ["address","Joda Talab, Ambikapur, Chhattisgarh, India"],
    ["phone","+91-9876543210"],
    ["emergency","+91-9876543211"],
    ["email","info@matarajrani.com"],
    ["established","2005"],
    ["opd_hours","Mon – Sat, 9:00 AM – 5:00 PM"],
    ["facebook","#"],
    ["instagram","#"],
    ["map_embed_url","https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d58920!2d83.18!3d23.12!5e0!3m2!1sen!2sin!4v1"],
    ["razorpay_key","rzp_test_YourKeyHere"],
    ["razorpay_color","#14b8a6"],
    ["razorpay_company","Mata Rajrani Memorial Hospital"],
  ]);

  ensure(SH.timeslots, ["Time Slot"],
    ["09:00 AM","09:30 AM","10:00 AM","10:30 AM","11:00 AM","11:30 AM","12:00 PM","12:30 PM","02:00 PM","02:30 PM","03:00 PM","03:30 PM","04:00 PM","04:30 PM"].map(t=>[t])
  );
}

function sendEmail(data, ref) {
  GmailApp.sendEmail(NOTIFY_EMAIL,
    `New Booking: ${data.serviceName} — ${ref}`,
    `Ref: ${ref}\nType: ${data.bookingType}\nService: ${data.serviceName}\nAmount: ₹${data.price}\n\nPatient: ${data.patientName}\nAge: ${data.patientAge}\nPhone: ${data.patientPhone}\n\nDate: ${data.preferredDate} at ${data.timeSlot}\nDoctor: ${data.doctor||"Any"}\n${data.address?"Address: "+data.address+"\n":""}\nPayment: ${data.paymentId||"Pending"}`
  );
}
