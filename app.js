const PASS_LIMIT = 50, GOODS_LIMIT = 30;
const PASS_SEVERE = 80;

const PASS_PREFIX = ["22","25","30","37","39","19","35","m2"];
const GOODS_PREFIX = ["23","27","28","31","32","33","34","41","42","43","44","51","60","65"];

let violationModalInstance = null;
let homeSignalMap = {};   // ← FSD Home signals will be stored here
let pSummary = { trains: 0, viol: 0, max: 0 };
let gSummary = { trains: 0, viol: 0, max: 0 };
let chart1, chart2;
let map, markerLayer;
let passGlobal = {}, goodsGlobal = {};

/* ================= CMS MAPS ================= */
let cmsTrainMap = {}; // trainNo -> crew info
let cmsLocoMap  = {}; // locoNo  -> crew info

window.onload = () => initMap();

/* ================= MAP ================= */
function initMap() {
  map = L.map("map").setView([22.57, 88.36], 6);

  const normalMap = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: "© OpenStreetMap" }
  );

  const earthMap = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "© Esri" }
  );

  normalMap.addTo(map);

  L.control.layers({
    "🗺️ Normal View": normalMap,
    "🌍 Earth View": earthMap
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
}

/* ================= CSV BUTTON ================= */
document.getElementById("analyzeBtn").addEventListener("click", () => {

  const rtisFile = document.getElementById("csvFile").files[0];
  const fsdFile  = document.getElementById("fsdFile").files[0];
  const cmsFile  = document.getElementById("cmsFile").files[0];

  if (!rtisFile) {
    alert("Please upload RTIS CSV file");
    return;
  }

  // reset optional maps
  homeSignalMap = {};
  cmsTrainMap = {};
  cmsLocoMap  = {};

  // 1️⃣ Load FSD if present
  if (fsdFile) {
    Papa.parse(fsdFile, {
      header: true,
      skipEmptyLines: true,
      complete: fsdRes => loadHomeSignals(fsdRes.data)
    });
  }

  // 2️⃣ Load CMS if present
  if (cmsFile) {
    Papa.parse(cmsFile, {
      header: true,
      skipEmptyLines: true,
      complete: cmsRes => loadCMSData(cmsRes.data)
    });
  }

  // 3️⃣ Always analyze RTIS
  Papa.parse(rtisFile, {
    header: true,
    skipEmptyLines: true,
    complete: rtisRes => analyze(rtisRes.data)
  });

});



/* ================= HELPERS ================= */
function find(row, keys) {
  for (let k in row) {
    const ck = k.toLowerCase().replace(/\s|\./g, "");
    for (let key of keys)
      if (ck.includes(key)) return row[k] || "NA";
  }
  return "NA";
}

function getType(loco) {
  if (!loco || loco === "NA") return null;
  const p = loco.toString().substring(0, 2).toLowerCase();
  if (PASS_PREFIX.includes(p)) return "PASS";
  if (GOODS_PREFIX.includes(p)) return "GOODS";
  return null;
}

function detectTrainType(row) {
  const rawTrain = find(row, ["train"]);
  const trainStr = rawTrain.toString().trim().toLowerCase();

  if (trainStr && /^\d+$/.test(trainStr)) return "PASS";

  if (
    trainStr.includes("motor") ||
    trainStr.includes("trolley") ||
    trainStr.includes("pwi") ||
    trainStr.includes("mt")
  ) return "GOODS";

  if (!trainStr || trainStr === "na") {
    return getType(find(row, ["loco"]));
  }

  return getType(find(row, ["loco"]));
}

/* ================= DIRECTION ================= */
function getDirection(train) {
  if (!train || train === "NA") return null;
  const t = train.toString().trim();
  const last = parseInt(t.slice(-1));
  if (isNaN(last)) return null;
  return last % 2 === 0 ? "DN" : "UP";
}

/* ================= HOME SIGNAL LOAD ================= */
function loadHomeSignals(data) {
  homeSignalMap = {};

  data.forEach(r => {
    if (r.Type && r.Type.toUpperCase() === "HOME") {
      const stn  = r.Station?.trim();
      const dirn = r.DIRN?.trim().toUpperCase();

      if (stn && dirn) {
        homeSignalMap[`${stn}_${dirn}`] = {
          lat: parseFloat(r.Latitude),
          lon: parseFloat(r.Longitude)
        };
      }
    }
  });
}

/* ================= DISTANCE ================= */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/* ================= ANALYZE ================= */
function analyze(data) {
  const pass = {}, goods = {};
  pSummary = { trains: 0, viol: 0, max: 0 };
  gSummary = { trains: 0, viol: 0, max: 0 };

  markerLayer.clearLayers();
  let bounds = [];

  data.forEach(r => {
    const speed = Number(find(r, ["speed"]));
    if (isNaN(speed)) return;

    const loco  = find(r, ["loco"]);
    const train = find(r, ["train"]);
    const type  = detectTrainType(r);
    if (!type) return;

    const limit = type === "PASS" ? PASS_LIMIT : GOODS_LIMIT;
    if (speed <= limit) return;

    const mapRef = type === "PASS" ? pass : goods;
    const sum    = type === "PASS" ? pSummary : gSummary;

    sum.viol++;
    sum.max = Math.max(sum.max, speed);

    if (!mapRef[train]) mapRef[train] = { loco, viol: 0, rows: [] };
    mapRef[train].viol++;

    const severe = type === "PASS" ? speed >= PASS_SEVERE : speed >= 50;

    const station = find(r, ["station"]);
    const latVal  = parseFloat(find(r, ["lat"]));
    const lonVal  = parseFloat(find(r, ["lon"]));
    const dirn    = getDirection(train);

    /* ================= ERROR DISTANCE ================= */
    let errorDist = "NA";
    if (dirn && station && !isNaN(latVal) && !isNaN(lonVal)) {
      const home = homeSignalMap[`${station}_${dirn}`];
      if (home) {
        errorDist = distanceMeters(latVal, lonVal, home.lat, home.lon);
      }
    }

    /* ================= CREW FETCH (NEW) ================= */
    /*let crewName = "NA";
    let crewId   = "NA";

    if (type === "PASS") {
      // 1️⃣ Train first
      if (cmsTrainMap[train]) {
        crewName = cmsTrainMap[train].crewName;
        crewId   = cmsTrainMap[train].crewId;
      }
      // 2️⃣ Else loco
      else if (cmsLocoMap[loco]) {
        crewName = cmsLocoMap[loco].crewName;
        crewId   = cmsLocoMap[loco].crewId;
      }
    }

    if (type === "GOODS") {
      // Only loco
      if (cmsLocoMap[loco]) {
        crewName = cmsLocoMap[loco].crewName;
        crewId   = cmsLocoMap[loco].crewId;
      }
    }*/
    /* ================= CREW FETCH (SMART) ================= */
    let crewName = "NA";
    let crewId   = "NA";

    const eventTime = find(r, ["event"]); // event = event time

    if (type === "PASS") {

      // 1️⃣ Passenger → Train No priority
      if (cmsTrainMap[train]) {
        const crew = selectCrewByMinTimeGap(
          cmsTrainMap[train],
          eventTime
        );
        if (crew) {
          crewName = crew.crewName;
          crewId   = crew.crewId;
        }
      }

      // 2️⃣ Fallback → Loco No
      else if (cmsLocoMap[loco]) {
        const crew = selectCrewByMinTimeGap(
          cmsLocoMap[loco],
          eventTime
        );
        if (crew) {
          crewName = crew.crewName;
          crewId   = crew.crewId;
        }
      }
    }

    /* ===== GOODS ===== */
    if (type === "GOODS") {

      // Only Loco based
      if (cmsLocoMap[loco]) {
        const crew = selectCrewByMinTimeGap(
          cmsLocoMap[loco],
          eventTime
        );
        if (crew) {
          crewName = crew.crewName;
          crewId   = crew.crewId;
        }
      }
    }

    /* ================= ROW ================= */
    const row = {
      station,
      dirn: dirn || "NA",
      speed,
      evt: find(r, ["event"]),
      lat: latVal,
      lon: lonVal,
      error: errorDist,
      crewName,
      crewId,
      time: find(r, ["time"]),
      severe
    };

    mapRef[train].rows.push(row);

    /* ================= MAP ================= */
    if (!isNaN(latVal) && !isNaN(lonVal)) {
      const marker = L.circleMarker([latVal, lonVal], {
        radius: severe ? 9 : 6,
        color: severe ? "#d00000" : (type === "PASS" ? "#1f4e79" : "#1a8f3a"),
        fillOpacity: 0.9
      }).bindPopup(
        `<b>Train:</b> ${train}<br>
         <b>Loco:</b> ${loco}<br>
         <b>Type:</b> ${type}<br>
         <b>Station:</b> ${station}<br>
         <b>Speed:</b> ${speed} kmph<br>
         <b>Error:</b> ${errorDist} m<br>
         <b>Crew:</b> ${crewName} (${crewId})<br>
         <b>Time:</b> ${row.time}`
      );

      markerLayer.addLayer(marker);
      bounds.push([latVal, lonVal]);
    }
  });

  pSummary.trains = Object.keys(pass).length;
  gSummary.trains = Object.keys(goods).length;

  passGlobal = pass;
  goodsGlobal = goods;

  updateSummary();
  render(pass, "passengerTable");
  render(goods, "goodsTable");
  updateViolationLeaders(pass, goods);
  drawCharts();

  if (bounds.length) map.fitBounds(bounds);
}

/* ================= SUMMARY ================= */
function updateSummary() {
  pTrains.innerText = pSummary.trains;
  pViolations.innerText = pSummary.viol;
  pMax.innerText = pSummary.max;

  gTrains.innerText = gSummary.trains;
  gViolations.innerText = gSummary.viol;
  gMax.innerText = gSummary.max;
}

function updateViolationLeaders(pass, goods) {

  /* ================= PASSENGER ================= */

  // ---- Passenger : Train-wise ----
  const passTrainArr = Object.entries(pass)
    .map(([train, d]) => {
      const name =
        train === "NA" || !train ? `NA / ${d.loco}` : train;
      return { name, count: d.viol };
    })
    .sort((a, b) => b.count - a.count);

  fillList(passTrainArr, "topPassengerTrains", "train");

  document.getElementById("maxPassengerTrain").innerText =
    passTrainArr.length
      ? `${passTrainArr[0].name} (${passTrainArr[0].count})`
      : "NA";


  // ---- Passenger : Station-wise ----
  const passStationCount = {};
  Object.values(pass).forEach(d => {
    d.rows.forEach(r => {
      if (!r.station) return;
      passStationCount[r.station] =
        (passStationCount[r.station] || 0) + 1;
    });
  });

  const passStationArr = Object.entries(passStationCount)
    .map(([stn, count]) => ({ name: stn, count }))
    .sort((a, b) => b.count - a.count);

  fillList(passStationArr, "topPassengerStations", "station");

  document.getElementById("maxPassengerStation").innerText =
    passStationArr.length
      ? `${passStationArr[0].name} (${passStationArr[0].count})`
      : "NA";


  /* ================= GOODS ================= */

  // ---- Goods : Train-wise ----
  const goodsTrainArr = Object.entries(goods)
    .map(([train, d]) => {
      const name =
        train === "NA" || !train ? `NA / ${d.loco}` : train;
      return { name, count: d.viol };
    })
    .sort((a, b) => b.count - a.count);

  fillList(goodsTrainArr, "topGoodsTrains", "train");

  document.getElementById("maxGoodsTrain").innerText =
    goodsTrainArr.length
      ? `${goodsTrainArr[0].name} (${goodsTrainArr[0].count})`
      : "NA";


  // ---- Goods : Station-wise ----
  const goodsStationCount = {};
  Object.values(goods).forEach(d => {
    d.rows.forEach(r => {
      if (!r.station) return;
      goodsStationCount[r.station] =
        (goodsStationCount[r.station] || 0) + 1;
    });
  });

  const goodsStationArr = Object.entries(goodsStationCount)
    .map(([stn, count]) => ({ name: stn, count }))
    .sort((a, b) => b.count - a.count);

  fillList(goodsStationArr, "topGoodsStations", "station");

  document.getElementById("maxGoodsStation").innerText =
    goodsStationArr.length
      ? `${goodsStationArr[0].name} (${goodsStationArr[0].count})`
      : "NA";
}

function updateTrainLeaders(map, listId, maxId) {
  const arr = Object.entries(map)
    .map(([train, d]) => {
      const name =
        train === "NA" || !train
          ? `NA / ${d.loco || "Unknown"}`
          : train;

      return { name, count: d.viol };
    })
    .sort((a, b) => b.count - a.count);

  fillList(arr, listId);

  document.getElementById(maxId).innerText =
    arr.length ? `${arr[0].name} (${arr[0].count})` : "NA";
}


/* ===== STATION LEADERS ===== */
function updateStationLeaders(map, listId, maxId) {
  const stationCount = {};

  Object.values(map).forEach(d => {
    d.rows.forEach(r => {
      if (!r.station) return;
      stationCount[r.station] = (stationCount[r.station] || 0) + 1;
    });
  });

  const arr = Object.entries(stationCount)
    .map(([stn, count]) => ({ name: stn, count }))
    .sort((a, b) => b.count - a.count);

  fillList(arr, listId);
  document.getElementById(maxId).innerText =
    arr.length ? `${arr[0].name} (${arr[0].count})` : "NA";
}

function fillList(arr, listId, scope) {
  const ul = document.getElementById(listId);
  ul.innerHTML = "";

  arr.slice(0, 3).forEach((e, i) => {
    const li = document.createElement("li");
    li.className = "list-group-item d-flex justify-content-between";

    li.innerHTML = `
      <span>${i + 1}. ${e.name}</span>
      <span class="badge bg-secondary violation-badge"
            data-name="${e.name}"
            data-scope="${scope}">
        ${e.count}
      </span>
    `;
    ul.appendChild(li);
  });
}



/* ================= TABLE ================= */
function render(map, tid) {
  const tb = document.getElementById(tid);
  tb.innerHTML = "";

  let sl = 1;

  Object.keys(map).forEach(train => {
    const d = map[train];
    const rowCount = d.rows.length;

    d.rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      if (r.severe) tr.classList.add("severe");

      tr.innerHTML = `
        ${i === 0 ? `
          <td rowspan="${rowCount}">${sl++}</td>
          <td rowspan="${rowCount}">${d.loco}</td>
          <td rowspan="${rowCount}">${train}</td>
          <td rowspan="${rowCount}">${d.viol}</td>
        ` : ""}

        <td>${r.station}</td>
        <td>${r.dirn || "NA"}</td>
        <td>${r.speed}${r.severe ? " <span class='warn'>⚠️</span>" : ""}</td>
        <td>${r.evt || ""}</td>
        <td>${r.lat || ""}</td>
        <td>${r.lon || ""}</td>
        <td>${r.error || "NA"}</td>
        <td>${r.crewName || "NA"}</td>
        <td>${r.crewId || "NA"}</td>
      `;
      tb.appendChild(tr);
    });
  });
}
function drawCharts() {
  if (chart1) chart1.destroy();
  if (chart2) chart2.destroy();

  chart1 = new Chart(violationChart, {
    type: "bar",
    data: {
      labels: ["Passenger", "Goods"],
      datasets: [{
        data: [pSummary.viol, gSummary.viol],
        backgroundColor: ["#2c6faa", "#6f2c2c"]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "#e0e0e0" }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });

  chart2 = new Chart(speedChart, {
    type: "line",
    data: {
      labels: ["Passenger", "Goods"],
      datasets: [{
        data: [pSummary.max, gSummary.max],
        borderColor: ["#1E90FF", "#32CD32"],
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "#e0e0e0" }
        }
      }
    }
  });
}

document.addEventListener("click", e => {
  if (!e.target.classList.contains("violation-badge")) return;

  const name = e.target.dataset.name;
  const type = e.target.dataset.type;

  openViolationModal(name, type);
});

function openViolationModal(name, scope, type) {
  const source = type === "PASS" ? passGlobal : goodsGlobal;
  const tbody = document.getElementById("violationModalBody");
  tbody.innerHTML = "";

  const headerBox = document.getElementById("modalHeaderBox");
  headerBox.innerHTML = "";   // reset every time

  /* ================= TRAIN CLICK ================= */
  if (scope === "train") {
    for (const [train, d] of Object.entries(source)) {
      const displayName =
        train === "NA" || !train ? `NA / ${d.loco}` : train;

      if (displayName !== name) continue;

      // ✅ Train modal header
      headerBox.innerHTML = `
        <b>Train:</b> ${train} &nbsp; | &nbsp;
        <b>Loco:</b> ${d.loco || "NA"} &nbsp; | &nbsp;
        <b>DIRN:</b> ${d.rows[0]?.dirn || "NA"}
      `;

      d.rows.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${train}</td>
          <td>${d.loco || "NA"}</td>
          <td>${r.dirn || "NA"}</td>
          <td>${r.station}</td>
          <td>${r.speed}</td>
          <td>${r.error}</td>
          <td>${r.time}</td>
          <td>${r.crewName || "NA"}</td>
          <td>${r.crewId || "NA"}</td>
        `;
        tbody.appendChild(tr);
      });
      break;
    }
  }

  /* ================= STATION CLICK ================= */
  if (scope === "station") {

    // ✅ Station modal header (ONLY station name)
    headerBox.innerHTML = `
      <b>Station:</b> ${name}
    `;

    Object.entries(source).forEach(([train, d]) => {
      d.rows.forEach(r => {
        if (r.station !== name) return;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${train}</td>
          <td>${d.loco || "NA"}</td>
          <td>${r.dirn || "NA"}</td>
          <td>${r.station}</td>
          <td>${r.speed}</td>
          <td>${r.error}</td>
          <td>${r.time}</td>
          <td>${r.crewName || "NA"}</td>
          <td>${r.crewId || "NA"}</td>

        `;
        tbody.appendChild(tr);
      });
    });
  }

  const modalEl = document.getElementById("violationModal");

  if (!modalEl) {
    console.error("Modal element not found");
    return;
  }

  if (!violationModalInstance) {
    violationModalInstance = new bootstrap.Modal(modalEl, {
      backdrop: true,
      keyboard: true
    });
  }

  violationModalInstance.show();

}

document.addEventListener("click", e => {
  if (!e.target.classList.contains("violation-badge")) return;

  const name = e.target.dataset.name;
  const scope = e.target.dataset.scope;

  const type =
    e.target.closest("#topPassengerTrains") ||
    e.target.closest("#topPassengerStations")
      ? "PASS"
      : "GOODS";

  openViolationModal(name, scope, type);
});

/* ================= MODAL CLEANUP ================= */
document
  .getElementById("violationModal")
  .addEventListener("hidden.bs.modal", () => {

    document.querySelectorAll(".modal-backdrop")
      .forEach(b => b.remove());

    document.body.classList.remove("modal-open");

    violationModalInstance = null;
  });

/* ================= CMS LOAD ================= */
/*function loadCMSData(data) {
  cmsTrainMap = {};
  cmsLocoMap  = {};

  data.forEach(r => {
    const train = find(r, ["train"]);
    const loco  = find(r, ["loco"]);
    const crewName = find(r, ["crewname", "crew name", "name"]);
    const crewId   = find(r, ["crewid", "crew id", "emp"]);

    const crewInfo = {
      crewName: crewName || "NA",
      crewId: crewId || "NA"
    };

    // 🔹 Train-wise map
    if (train && train !== "NA") {
      cmsTrainMap[train] = crewInfo;
    }

    // 🔹 Loco-wise map
    if (loco && loco !== "NA") {
      cmsLocoMap[loco] = crewInfo;
    }
  });

  console.log("CMS Train Map:", cmsTrainMap);
  console.log("CMS Loco Map:", cmsLocoMap);
}*/

function loadCMSData(data) {
  cmsTrainMap = {};
  cmsLocoMap  = {};

  data.forEach(r => {
    const train = find(r, ["train"]);
    const loco  = find(r, ["loco"]);
    const crewName = find(r, ["crewname", "crew name", "name"]);
    const crewId   = find(r, ["crewid", "crew id", "emp"]);
    const signOnTime = find(r, ["signon", "sign on", "duty on", "on time"]);

    const crewRow = {
      crewName: crewName || "NA",
      crewId: crewId || "NA",
      signOnTime
    };

    // 🔹 TRAIN MAP (Passenger)
    if (train && train !== "NA") {
      if (!cmsTrainMap[train]) cmsTrainMap[train] = [];
      cmsTrainMap[train].push(crewRow);
    }

    // 🔹 LOCO MAP (Goods / fallback)
    if (loco && loco !== "NA") {
      if (!cmsLocoMap[loco]) cmsLocoMap[loco] = [];
      cmsLocoMap[loco].push(crewRow);
    }
  });

  console.log("CMS Train Map:", cmsTrainMap);
  console.log("CMS Loco Map:", cmsLocoMap);
}


/* ================= CREW SELECTOR ================= */
function selectCrewByMinTimeGap(rows, eventTime) {
  if (!rows || !rows.length || !eventTime) return null;

  const evtTime = new Date(eventTime).getTime();
  if (isNaN(evtTime)) return null;

  let best = null;
  let minGap = Infinity;

  rows.forEach(r => {
    const signOn = new Date(r.signOnTime).getTime();
    if (isNaN(signOn)) return;

    const gap = Math.abs(evtTime - signOn);
    if (gap < minGap) {
      minGap = gap;
      best = r;
    }
  });

  return best;
}
