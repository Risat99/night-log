/* =========================================================
   CONSTANTS & SHIMS
   ========================================================= */
const STORAGE_PREFIX = 'report:';
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHIFT_EPOCH = 12*60; // re-base the clock at noon so overnight shifts don't wrap mid-chart

const hasRealStorage = !!(window.storage && window.storage.get && window.storage.set && window.storage.list);
const storageApi = {
  async get(key, shared=false){
    if (hasRealStorage) return window.storage.get(key, shared);
    const val = localStorage.getItem(key);
    if (val === null) throw new Error('not found');
    return { key, value: val, shared };
  },
  async set(key, value, shared=false){
    if (hasRealStorage) return window.storage.set(key, value, shared);
    localStorage.setItem(key, value);
    return { key, value, shared };
  },
  async delete(key, shared=false){
    if (hasRealStorage) return window.storage.delete(key, shared);
    localStorage.removeItem(key);
    return { key, deleted:true, shared };
  },
  async list(prefix='', shared=false){
    if (hasRealStorage) return window.storage.list(prefix, shared);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!prefix || k.startsWith(prefix)) {
        keys.push(k);
      }
    }
    return { keys, prefix, shared };
  }
};

const state = { view: 'MONTH', overviewSelection: null, months:{}, activeMonth:null, settings: { base: 900, food: 250, otMult: 1.5, dayOff: 5 } };

/* =========================================================
   EMBEDDED SEED DATA (your first imported report)
   ========================================================= */
// Default fallback data removed

/* =========================================================
   PARSING
   ========================================================= */
function toMinutes(hhmm){
  if (!hhmm) return null;
  const t = String(hhmm).trim();
  if (!t || !t.includes(':')) return null;
  const [h,m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h*60+m;
}
function fmtHM(mins){
  mins = Math.round(mins||0);
  const h = Math.floor(mins/60), m = mins%60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function parseDateParts(d){
  const [dd,mm,yyyy] = d.split('.').map(Number);
  return { day:dd, month:mm, year:yyyy };
}
function dateObj(d){
  const {day,month,year} = parseDateParts(d);
  return new Date(year, month-1, day);
}
function formatDate(d){
  const {day,month,year} = parseDateParts(d);
  const wd = dateObj(d).toLocaleDateString('en-US',{weekday:'short'});
  return `${wd}, ${MONTH_NAMES[month-1].slice(0,3)} ${String(day).padStart(2,'0')}`;
}
function monthKeyFromRows(rows){
  const row = rows.find(r=>r.date);
  if (!row) throw new Error('No dated rows found.');
  const {month,year} = parseDateParts(row.date);
  return `${year}-${String(month).padStart(2,'0')}`;
}
function monthLabel(key){
  const [y,m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m-1]} ${y}`;
}
function shiftMinutes(absMin){
  let v = absMin - SHIFT_EPOCH;
  if (v < 0) v += 1440;
  return v;
}
function shiftToClock(shiftMin){
  const abs = (Math.round(shiftMin) + SHIFT_EPOCH) % 1440;
  const h = Math.floor(abs/60), m = abs%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function minutesToClock(mins){
  if (mins == null) return '—';
  const h = Math.floor(mins/60), m = Math.round(mins%60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function parseReportText(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length>0);
  if (lines.length < 2) throw new Error("That file doesn't look like a Sahl time report.");
  const rows = lines.slice(1).map(line=>{
    const c = line.split('\t');
    while (c.length < 18) c.push('');
    return {
      employeeId:c[0], store:c[1], date:c[2].trim(),
      punchIn:c[3].trim(), punchOut:c[4].trim(),
      regHours:c[5].trim(), overtime:c[6].trim(),
      irregular:c[7].trim(), timeOff:c[8].trim(), dayOff:c[9].trim(),
      totalHours:c[10].trim(), shift:c[11].trim(),
      shiftStart:c[12].trim(), shiftEnd:c[13].trim(),
      addReg:c[14].trim(), addOt:c[15].trim(),
      dedReg:c[16].trim(), dedOt:c[17].trim()
    };
  }).filter(r => r.date && /\d{2}\.\d{2}\.\d{4}/.test(r.date));
  if (!rows.length) throw new Error('No daily rows found in this file.');
  rows.sort((a,b)=> dateObj(a.date) - dateObj(b.date));
  return rows;
}

function summarize(rows){
  let regMin=0, otMin=0, addRegMin=0, addOtMin=0, dedRegMin=0, dedOtMin=0, totalMin=0;
  let worked=0, rest=0, absences=0;
  let longest=null, holiday=null;
  const punchInPts=[], punchOutPts=[];
  let totalPhysicalMins=0, totalWasteMins=0, holidayWorkedMins=0;

  const dayOffVal = state.settings.dayOff;

  rows.forEach(r=>{
    const reg = toMinutes(r.regHours)||0, ot = toMinutes(r.overtime)||0;
    const addReg = toMinutes(r.addReg)||0, addOt = toMinutes(r.addOt)||0;
    const dedReg = toMinutes(r.dedReg)||0, dedOt = toMinutes(r.dedOt)||0;
    const tot = toMinutes(r.totalHours)||0;
    regMin+=reg; otMin+=ot; addRegMin+=addReg; addOtMin+=addOt;
    dedRegMin+=dedReg; dedOtMin+=dedOt; totalMin+=tot;

    const pin = toMinutes(r.punchIn);
    const pout = toMinutes(r.punchOut);
    const hasPunch = pin != null || pout != null;
    const isHoliday = !!r.irregular;
    const d = dateObj(r.date);
    const isDayOff = d.getDay() === dayOffVal;

    if (hasPunch) worked++; else rest++;
    if (!hasPunch && !isHoliday && !isDayOff) absences++;

    let waste = 0, phys = 0;
    if (pin != null && pout != null) {
      let diff = pout - pin;
      if (diff < 0) diff += 1440;
      phys = diff;
      totalPhysicalMins += phys;
      let actual = Math.max(0, phys - 60); // 1 hour break
      let paid = reg + ot + addReg + addOt;
      waste = Math.max(0, actual - paid);
      totalWasteMins += waste;
    }
    r._waste = waste;
    r._isAbsence = (!hasPunch && !isHoliday && !isDayOff);

    if (isHoliday && hasPunch) {
      holidayWorkedMins += tot;
    }

    if (!longest || tot > longest.minutes) longest = { date:r.date, minutes:tot };
    if (r.irregular) holiday = { date:r.date, label:r.irregular };

    if (pin!=null) punchInPts.push({ date:r.date, abs:pin, shift:shiftMinutes(pin) });
    if (pout!=null) punchOutPts.push({ date:r.date, abs:pout, shift:shiftMinutes(pout) });
  });

  const avgPunchIn = punchInPts.length ? punchInPts.reduce((a,b)=>a+b.abs,0)/punchInPts.length : null;
  const avgPunchOut = punchOutPts.length ? punchOutPts.reduce((a,b)=>a+b.abs,0)/punchOutPts.length : null;
  const avgShiftLen = worked ? totalMin/worked : 0;

  return {
    regMin, otMin, addRegMin, addOtMin, dedRegMin, dedOtMin, totalMin,
    worked, rest, absences, days: rows.length, longest, holiday,
    totalPhysicalMins, totalWasteMins, holidayWorkedMins,
    punchInPts, punchOutPts, avgPunchIn, avgPunchOut, avgShiftLen
  };
}

function renderStatGrid(summary){
  const items = [
    { label:'Total hours', value: fmtHM(summary.totalMin) },
    { label:'Waste time', value: fmtHM(summary.totalWasteMins) },
    { label:'Absences', value: `${summary.absences} days`, sub: summary.absences ? `-${fmtHM(summary.absences * 8 * 60)} base` : '' },
    { label:'Nights worked', value: `${summary.worked}/${summary.days}` },
    { label:'Rest days', value: `${summary.rest}` },
    { label:'Longest shift', value: summary.longest ? fmtHM(summary.longest.minutes) : '—', sub: summary.longest ? formatDate(summary.longest.date) : '' }
  ];
  if (summary.addRegMin || summary.addOtMin){
    items.push({ label:'Additional hours', value: fmtHM(summary.addRegMin+summary.addOtMin) });
  }
  if (summary.dedRegMin || summary.dedOtMin){
    items.push({ label:'Deductions', value: fmtHM(summary.dedRegMin+summary.dedOtMin) });
  }
  const grid = document.getElementById('statGrid');
  if (!grid) return;
  grid.innerHTML = items.map(it => `
    <div class="stat-card">
      <div class="value">${it.value}</div>
      <div class="label">${it.label}</div>
      ${it.sub ? `<div class="sub">${it.sub}</div>` : ''}
    </div>
  `).join('');
}

function renderArcCaption(summary){
  const el = document.getElementById('arcCenter');
  if (el) el.querySelector('.num').textContent = summary.worked ? fmtHM(summary.avgShiftLen) : '—';
  const cap = document.getElementById('arcCaption');
  if (!cap) return;
  if (summary.avgPunchIn!=null && summary.avgPunchOut!=null){
    cap.innerHTML = `<strong>${minutesToClock(summary.avgPunchIn)}</strong> → <strong>${minutesToClock(summary.avgPunchOut)}</strong> avg, across ${summary.worked} nights`;
  } else {
    cap.textContent = 'No punches recorded this month.';
  }
}

function renderTable(rows){
  const hasAdd = rows.some(r => (toMinutes(r.addReg)||0) || (toMinutes(r.addOt)||0));
  const hasDed = rows.some(r => (toMinutes(r.dedReg)||0) || (toMinutes(r.dedOt)||0));

  const thead = document.querySelector('#logTable thead');
  const tbody = document.querySelector('#logTable tbody');
  if (!thead || !tbody) return;
  
  let cols = ['Date','In','Out','Regular','Overtime','Total','Waste'];
  if (hasAdd) cols.push('Additional');
  if (hasDed) cols.push('Deduction');
  cols.push('Notes');
  thead.innerHTML = `<tr>${cols.map(c=>`<th scope="col">${c}</th>`).join('')}</tr>`;

  tbody.innerHTML = rows.map(r=>{
    const noPunch = !r.punchIn && !r.punchOut;
    let notes = '';
    if (r.irregular) {
      notes = `<span class="tag holiday">${String(r.irregular).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[s])}</span>`;
    } else if (r._isAbsence) {
      notes = `<span class="tag" style="background:rgba(255,107,107,0.15);color:var(--bad);">Absent</span>`;
    } else if (noPunch) {
      notes = `<span class="tag off">Day off</span>`;
    }

    let cells = [
      formatDate(r.date),
      r.punchIn || '—',
      r.punchOut || '—',
      r.regHours || '—',
      r.overtime || '—',
      r.totalHours || '00:00',
      r._waste ? `<span style="color:var(--amber)">${fmtHM(r._waste)}</span>` : '—'
    ];
    if (hasAdd){
      const a = (toMinutes(r.addReg)||0) + (toMinutes(r.addOt)||0);
      cells.push(a ? fmtHM(a) : '—');
    }
    if (hasDed){
      const d = (toMinutes(r.dedReg)||0) + (toMinutes(r.dedOt)||0);
      cells.push(d ? fmtHM(d) : '—');
    }
    const noteCell = `<td>${notes}</td>`;
    return `<tr>${cells.map((c,i)=> i===0 ? `<td>${c}</td>` : `<td class="${(c==='—')?'muted':''}">${c}</td>`).join('')}${noteCell}</tr>`;
  }).join('');
}

function calculatePayDetails(summary, monthKey) {
  const s = state.settings;
  const [y, m] = monthKey.split('-');
  const daysInMonth = new Date(y, m, 0).getDate();
  const dynamicRate = s.base / (daysInMonth * 8);
  
  const basePay = s.base;
  const absentDed = summary.absences * 8 * dynamicRate;
  const otPay = (summary.otMin/60) * dynamicRate * s.otMult;
  const addPay = ((summary.addRegMin/60)*dynamicRate) + ((summary.addOtMin/60)*dynamicRate*s.otMult);
  const dedPay = ((summary.dedRegMin/60)*dynamicRate) + ((summary.dedOtMin/60)*dynamicRate*s.otMult);
  
  const gross = basePay + s.food - absentDed + otPay + addPay - dedPay;
  const wasteLoss = (summary.totalWasteMins/60) * dynamicRate * s.otMult;

  return { daysInMonth, dynamicRate, basePay, absentDed, otPay, addPay, dedPay, gross, wasteLoss };
}

function recomputePay(summary){
  const s = state.settings;
  const box = document.getElementById('payResult');
  if (!box) return;
  if (!s.base || s.base<=0){
    box.innerHTML = `<p class="pay-note">Enter your basic salary to see an estimate.</p>`;
    return;
  }

  const details = calculatePayDetails(summary, state.activeMonth);
  const { dynamicRate, basePay, absentDed, otPay, addPay, dedPay, gross, wasteLoss, daysInMonth } = details;

  const rows = [
    [`Base Salary (Fixed)`, basePay],
    [`Food Allowance`, s.food]
  ];
  if (summary.absences > 0) rows.push([`<span style="color:var(--bad)">Absence Deduction · ${summary.absences} days</span>`, -absentDed]);
  rows.push([`Overtime · ${fmtHM(summary.otMin)} × ${dynamicRate.toFixed(2)}×${s.otMult}`, otPay]);
  
  if (summary.addRegMin > 0) rows.push([`Additional Reg · ${fmtHM(summary.addRegMin)}`, (summary.addRegMin/60)*dynamicRate]);
  if (summary.addOtMin > 0) rows.push([`Additional OT · ${fmtHM(summary.addOtMin)}`, (summary.addOtMin/60)*dynamicRate*s.otMult]);
  
  if (summary.dedRegMin > 0) rows.push([`<span style="color:var(--bad)">Sahl Deduction (Reg) · ${fmtHM(summary.dedRegMin)}</span>`, -((summary.dedRegMin/60)*dynamicRate)]);
  if (summary.dedOtMin > 0) rows.push([`<span style="color:var(--bad)">Sahl Deduction (OT) · ${fmtHM(summary.dedOtMin)}</span>`, -((summary.dedOtMin/60)*dynamicRate*s.otMult)]);

  let html = rows.map(([label,val])=> `
    <div class="row"><span>${label}</span><span style="${val < 0 ? 'color:var(--bad)' : ''}">${val < 0 ? '-' : ''}${Math.abs(val).toFixed(2)} SAR</span></div>
  `).join('');

  if (summary.totalWasteMins > 0) {
    html += `
      <div class="row" style="color:rgba(255,107,107,0.75); border-bottom:1px dashed rgba(255,107,107,0.3); padding-top:10px; margin-top:4px;">
        <span>Unpaid Waste Time · ${fmtHM(summary.totalWasteMins)}</span>
        <span>(${wasteLoss.toFixed(2)} SAR lost)</span>
      </div>`;
  }

  box.innerHTML = html + `<div class="row total"><span>Estimated gross</span><span>${gross.toFixed(2)} SAR</span></div>
  <p class="pay-note">Calculated using Fixed Base + OT - Absences. Hourly rate (${dynamicRate.toFixed(2)} SAR) calculated dynamically for ${daysInMonth} days.</p>`;
}

/* =========================================================
   MAIN RENDER + APP SHELL
   ========================================================= */
function appShellHTML(){
  return `
    <section class="hero reveal">
      <div>
        <div class="arc-card">
          <svg id="nightArc"></svg>
          <div class="arc-center" id="arcCenter">
            <div class="num"></div>
            <div class="lbl">avg shift</div>
          </div>
        </div>
        <div class="arc-caption" id="arcCaption"></div>
      </div>
      <div class="stat-grid" id="statGrid"></div>
    </section>

    <section class="panel reveal">
      <h2>Daily rhythm</h2>
      <p class="panel-sub">Regular hours and overtime, night by night.</p>
      <div class="chart-box"><canvas id="rhythmChart"></canvas></div>
    </section>

    <section class="panel reveal">
      <h2>Punch-in consistency</h2>
      <p class="panel-sub">When you clocked in and out each night — gaps are rest days, spikes are outliers.</p>
      <div class="chart-box small"><canvas id="punchChart"></canvas></div>
    </section>

    <section class="panel reveal">
      <h2>Full log</h2>
      <p class="panel-sub">Every day in this report.</p>
      <div class="table-wrap">
        <table id="logTable">
          <thead></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section class="panel reveal">
      <button class="panel-head-toggle" id="payToggle" aria-expanded="false">
        <h2>Estimate pay</h2>
        <span class="chev" id="payChev">›</span>
      </button>
      <div class="pay-body" id="payBody" hidden>
        <p class="panel-sub">Not your real payslip — a quick estimate from this report's hours.</p>
        <div class="pay-controls">
          <label>Basic salary (SAR)
            <input type="number" id="baseInput" min="0" step="10" value="${state.settings.base}" />
          </label>
          <label>Food allowance
            <input type="number" id="foodInput" min="0" step="10" value="${state.settings.food}" />
          </label>
          <label>Overtime multiplier
            <input type="number" id="otMultInput" min="1" step="0.05" value="${state.settings.otMult}" />
          </label>
          <label>Regular day off
            <select id="dayOffInput">
              <option value="0" ${state.settings.dayOff===0?'selected':''}>Sunday</option>
              <option value="1" ${state.settings.dayOff===1?'selected':''}>Monday</option>
              <option value="2" ${state.settings.dayOff===2?'selected':''}>Tuesday</option>
              <option value="3" ${state.settings.dayOff===3?'selected':''}>Wednesday</option>
              <option value="4" ${state.settings.dayOff===4?'selected':''}>Thursday</option>
              <option value="5" ${state.settings.dayOff===5?'selected':''}>Friday</option>
              <option value="6" ${state.settings.dayOff===6?'selected':''}>Saturday</option>
            </select>
          </label>
        </div>
        <div class="pay-result" id="payResult">
          <p class="pay-note">Enter your basic salary to see an estimate.</p>
        </div>
      </div>
    </section>
  `;
}

function wireInteractiveBits(){
  document.getElementById('payToggle').addEventListener('click', ()=>{
    const body = document.getElementById('payBody');
    const chev = document.getElementById('payChev');
    const open = body.hasAttribute('hidden');
    if (open){ body.removeAttribute('hidden'); chev.classList.add('open'); document.getElementById('payToggle').setAttribute('aria-expanded','true'); }
    else { body.setAttribute('hidden',''); chev.classList.remove('open'); document.getElementById('payToggle').setAttribute('aria-expanded','false'); }
  });

  const updateSettings = () => {
    state.settings.base = parseFloat(document.getElementById('baseInput').value) || 0;
    state.settings.food = parseFloat(document.getElementById('foodInput').value) || 0;
    state.settings.otMult = parseFloat(document.getElementById('otMultInput').value) || 1.5;
    const oldDayOff = state.settings.dayOff;
    state.settings.dayOff = parseInt(document.getElementById('dayOffInput').value);
    
    const rows = state.months[state.activeMonth].rows;
    const summary = summarize(rows);
    if (oldDayOff !== state.settings.dayOff) {
      renderStatGrid(summary);
      renderTable(rows);
    }
    recomputePay(summary);
  };

  document.getElementById('baseInput').addEventListener('input', updateSettings);
  document.getElementById('foodInput').addEventListener('input', updateSettings);
  document.getElementById('otMultInput').addEventListener('input', updateSettings);
  document.getElementById('dayOffInput').addEventListener('change', updateSettings);
}

function renderAll(){
  if (state.view === 'OVERVIEW') {
    document.getElementById('app').innerHTML = overviewHTML();
    renderOverview();
  } else {
    const data = state.months[state.activeMonth];
    if (!data) return;
    document.getElementById('app').innerHTML = appShellHTML();
    wireInteractiveBits();

    const rows = data.rows;
    const summary = summarize(rows);
    renderStatGrid(summary);
    if(window.buildArc) buildArc(summary);
    renderArcCaption(summary);
    if(window.renderRhythmChart) renderRhythmChart(rows);
    if(window.renderPunchChart) renderPunchChart(rows);
    renderTable(rows);
    recomputePay(summary);

    const meta = document.getElementById('metaLine');
    if (meta) meta.textContent = data.savedAt ? `${rows.length} days · saved ${relTime(data.savedAt)}` : `${rows.length} days`;
  }
  setTimeout(() => initScrollAnimations(), 50); // wait for DOM
}

function renderMonthTabs(){
  const wrap = document.getElementById('monthTabs');
  const keys = Object.keys(state.months).sort();
  let html = `<button class="month-pill ${state.view==='OVERVIEW'?'active':''}" data-view="OVERVIEW">📊 Overview</button>`;
  html += keys.map(k => `
    <button class="month-pill ${(state.view==='MONTH' && k===state.activeMonth)?'active':''}" data-month="${k}">${monthLabel(k)}</button>
  `).join('');
  wrap.innerHTML = html;
  
  wrap.querySelectorAll('.month-pill').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (btn.dataset.view === 'OVERVIEW') {
        state.view = 'OVERVIEW';
      } else {
        state.view = 'MONTH';
        state.activeMonth = btn.dataset.month;
      }
      renderMonthTabs();
      renderAll();
    });
  });
}

/* =========================================================
   OVERVIEW VIEW
   ========================================================= */
function overviewHTML() {
  return `
    <section class="panel reveal">
      <div class="panel-head" style="align-items:center;">
        <div>
          <h2>Comparative Analysis</h2>
          <p class="panel-sub">Performance trends across imported months.</p>
        </div>
        <div id="overviewChecks" style="display:flex; gap:8px; flex-wrap:wrap;"></div>
      </div>
      <div class="chart-box"><canvas id="overviewGrossChart"></canvas></div>
    </section>

    <section class="panel reveal">
      <h2>Loss & Absences Trend</h2>
      <p class="panel-sub">Tracking uncompensated time and missed shifts.</p>
      <div class="chart-box small"><canvas id="overviewLossChart"></canvas></div>
    </section>

    <section class="panel reveal">
      <h2>Metrics Breakdown</h2>
      <p class="panel-sub">Month-to-month detailed stats.</p>
      <div class="table-wrap">
        <table id="overviewTable">
          <thead></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>
  `;
}

function renderOverview() {
  const keys = Object.keys(state.months).sort();
  if (keys.length === 0) {
    document.getElementById('app').innerHTML = '<div class="loading">No reports imported.</div>';
    return;
  }
  
  if (!state.overviewSelection) state.overviewSelection = [...keys];

  const checksDiv = document.getElementById('overviewChecks');
  if (checksDiv && checksDiv.innerHTML === '') {
    checksDiv.innerHTML = keys.map(k => `
      <label style="font-size:12px; font-family:'Inter',sans-serif; color:var(--dawn); display:flex; align-items:center; gap:4px; cursor:pointer;">
        <input type="checkbox" value="${k}" ${state.overviewSelection.includes(k)?'checked':''}> ${monthLabel(k).split(' ')[0]}
      </label>
    `).join('');
    checksDiv.querySelectorAll('input').forEach(chk => {
      chk.addEventListener('change', (e) => {
        if (e.target.checked) state.overviewSelection.push(e.target.value);
        else state.overviewSelection = state.overviewSelection.filter(v => v !== e.target.value);
        renderOverviewData();
      });
    });
  }
  renderOverviewData();
}

let overviewGrossChart=null, overviewLossChart=null;
function renderOverviewData() {
  const keys = Object.keys(state.months).sort().filter(k => state.overviewSelection.includes(k));
  const labels = keys.map(k => monthLabel(k));
  const grossData = [];
  const hoursData = [];
  const wasteData = [];
  const absentData = [];
  const rowsData = [];

  keys.forEach(k => {
    const summary = summarize(state.months[k].rows);
    const pay = calculatePayDetails(summary, k);
    grossData.push(pay.gross);
    hoursData.push(summary.totalMin / 60);
    wasteData.push(summary.totalWasteMins / 60);
    absentData.push(summary.absences);
    rowsData.push({ k, summary, pay });
  });

  const ctxG = document.getElementById('overviewGrossChart');
  if (overviewGrossChart) overviewGrossChart.destroy();
  if (ctxG && window.Chart) {
    overviewGrossChart = new Chart(ctxG, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'line', label: 'Total Hours', data: hoursData, borderColor: '#5FD9A0', backgroundColor: '#5FD9A0', yAxisID: 'y1', tension: 0.3 },
          { type: 'bar', label: 'Gross Pay (SAR)', data: grossData, backgroundColor: '#FFB347', borderRadius: 6, yAxisID: 'y' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#8E96B5', font: { family: 'Inter', size: 12 } } } },
        scales: {
          x: { ticks: { color: '#8E96B5' }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { type: 'linear', position: 'left', ticks: { color: '#FFB347' }, grid: { color: 'rgba(255,255,255,0.06)' }, title: { display: true, text: 'SAR', color: '#8E96B5' } },
          y1: { type: 'linear', position: 'right', ticks: { color: '#5FD9A0' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Hours', color: '#8E96B5' } }
        }
      }
    });
  }

  const ctxL = document.getElementById('overviewLossChart');
  if (overviewLossChart) overviewLossChart.destroy();
  if (ctxL && window.Chart) {
    overviewLossChart = new Chart(ctxL, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Wasted Hours', data: wasteData, backgroundColor: 'rgba(255,107,77,0.8)', borderRadius: 4, stack: 's' },
          { label: 'Absences (Days)', data: absentData, backgroundColor: 'rgba(255,107,107,0.4)', borderRadius: 4, stack: 's' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#8E96B5', font: { family: 'Inter', size: 12 } } } },
        scales: {
          x: { ticks: { color: '#8E96B5' }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#8E96B5' }, grid: { color: 'rgba(255,255,255,0.06)' } }
        }
      }
    });
  }

  const thead = document.querySelector('#overviewTable thead');
  const tbody = document.querySelector('#overviewTable tbody');
  if (thead && tbody) {
    if (keys.length === 0) {
      thead.innerHTML = ''; tbody.innerHTML = '<tr><td class="muted">No months selected</td></tr>';
      return;
    }
    thead.innerHTML = `<tr><th>Metric</th>${labels.map(l => `<th>${l}</th>`).join('')}</tr>`;
    const mkRow = (name, extractor, isFmt=false) => {
      return `<tr><td>${name}</td>${rowsData.map(d => `<td class="muted">${isFmt ? fmtHM(extractor(d)*60) : extractor(d).toFixed(2)}</td>`).join('')}</tr>`;
    };
    tbody.innerHTML = [
      mkRow('Gross Pay (SAR)', d => d.pay.gross),
      mkRow('Total Hours', d => d.summary.totalMin / 60, true),
      mkRow('Overtime Pay (SAR)', d => d.pay.otPay),
      mkRow('Waste Time', d => d.summary.totalWasteMins / 60, true),
      mkRow('Lost Income (SAR)', d => d.pay.wasteLoss),
      mkRow('Absences (Days)', d => d.summary.absences, false)
    ].join('');
  }
}

function relTime(iso){
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function toast(msg, isError=false){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, 3200);
}

/* =========================================================
   IMPORT / STORAGE WIRING
   ========================================================= */
const importBtn = document.getElementById('importBtn');
const fileInput = document.getElementById('fileInput');
const clearBtn = document.getElementById('clearBtn');

if (importBtn && fileInput) {
  importBtn.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    try{
      const text = await file.text();
      const rows = parseReportText(text);
      const mk = monthKeyFromRows(rows);
      const payload = { rows, savedAt: new Date().toISOString() };
      const ok = await storageApi.set(STORAGE_PREFIX+mk, JSON.stringify(payload), false);
      if (!ok) throw new Error('Could not save that report.');
      state.months[mk] = payload;
      state.activeMonth = mk;
      renderMonthTabs();
      renderAll();
      toast(`Saved ${monthLabel(mk)}`);
    }catch(err){
      console.error(err);
      toast(err.message || 'Could not read that file.', true);
    }
    e.target.value = '';
  });
}

if (clearBtn) {
  let clearTimer = null;
  clearBtn.addEventListener('click', async ()=>{
    if (clearBtn.textContent.trim() === 'Clear') {
      clearBtn.textContent = 'Sure?';
      clearBtn.style.color = 'var(--bad)';
      clearTimer = setTimeout(() => {
        clearBtn.textContent = 'Clear';
        clearBtn.style.color = '';
      }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    clearBtn.textContent = 'Clear';
    clearBtn.style.color = '';

    try{
      for (const k of Object.keys(state.months)){
        await storageApi.delete(STORAGE_PREFIX+k, false);
      }
      state.months = {};
      state.activeMonth = null;
      await init();
      toast('Cleared all saved months.');
    }catch(err){
      toast('Could not clear data.', true);
    }
  });
}

/* =========================================================
   INIT
   ========================================================= */
async function init(){
  const loadState = document.getElementById('loadingState');
  if (loadState) document.getElementById('app').innerHTML = '<div class="loading">loading your report…</div>';

  let months = {};
  try{
    const list = await storageApi.list(STORAGE_PREFIX, false);
    for (const k of (list && list.keys) || []){
      try{
        const got = await storageApi.get(k, false);
        months[k.slice(STORAGE_PREFIX.length)] = JSON.parse(got.value);
      }catch(e){ console.warn('skip', k, e); }
    }
  }catch(e){ console.warn('storage list failed', e); }

  // Default data loading has been removed

  state.months = months;
  const keys = Object.keys(months).sort();
  state.activeMonth = keys[keys.length-1] || null;

  const banner = document.getElementById('banner');
  if (banner) {
    if (!hasRealStorage){
      banner.hidden = false;
      banner.textContent = "Running outside Claude's saved storage right now — imports will work, but won't persist once you close this. Open it from the chat to keep your history.";
    } else {
      banner.hidden = true;
    }
  }

  if (state.activeMonth){
    renderMonthTabs();
    renderAll();
  } else {
    document.getElementById('app').innerHTML = '<div class="loading">No report yet — import a Sahl .txt to get started.</div>';
  }
}

/* =========================================================
   SCROLL ANIMATIONS
   ========================================================= */
function initScrollAnimations() {
  if (!CSS.supports('animation-timeline: scroll()')) {
    const sp = document.getElementById('scroll-progress');
    if (sp) {
      window.addEventListener('scroll', () => {
        const winScroll = document.documentElement.scrollTop || document.body.scrollTop;
        const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = height > 0 ? (winScroll / height) : 0;
        sp.style.transform = `scaleX(${scrolled})`;
      });
    }
  }

  if (!CSS.supports('(animation-timeline: view()) and (animation-range: entry)')) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }
}

// Start app
window.addEventListener('DOMContentLoaded', init);
