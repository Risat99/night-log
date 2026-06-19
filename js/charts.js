/* =========================================================
   ARC (signature visual)
   ========================================================= */
function polar(cx,cy,r,angleDeg){
  const rad = (angleDeg-90) * Math.PI/180;
  return { x: cx + r*Math.cos(rad), y: cy + r*Math.sin(rad) };
}
function describeArc(cx,cy,r,startAngle,endAngle){
  const s = polar(cx,cy,r,startAngle), e = polar(cx,cy,r,endAngle);
  const largeArc = (endAngle-startAngle) > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs){
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function buildArc(summary){
  const svg = document.getElementById('nightArc');
  if (!svg) return;
  svg.setAttribute('viewBox','0 0 300 300');
  svg.innerHTML = '';
  const cx=150, cy=150, R=112, R2=126;

  svg.appendChild(svgEl('circle', { cx, cy, r:R, fill:'none', stroke:'rgba(255,255,255,0.08)', 'stroke-width':12 }));

  [0,6,12,18].forEach(h=>{
    const ang = h/24*360;
    const p1 = polar(cx,cy,R-14,ang), p2 = polar(cx,cy,R+14,ang);
    svg.appendChild(svgEl('line', { x1:p1.x.toFixed(1), y1:p1.y.toFixed(1), x2:p2.x.toFixed(1), y2:p2.y.toFixed(1), stroke:'rgba(243,231,211,0.3)', 'stroke-width':1.4 }));
    const lp = polar(cx,cy,R+28,ang);
    const t = svgEl('text', { x:lp.x.toFixed(1), y:lp.y.toFixed(1), fill:'#8E96B5', 'font-size':10, 'font-family':"'JetBrains Mono', monospace", 'text-anchor':'middle' });
    t.setAttribute('dominant-baseline','middle');
    t.textContent = String(h).padStart(2,'0');
    svg.appendChild(t);
  });

  if (summary.avgPunchIn!=null && summary.avgPunchOut!=null){
    let startAngle = summary.avgPunchIn/1440*360;
    let endAngle = summary.avgPunchOut/1440*360;
    if (endAngle <= startAngle) endAngle += 360;

    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id:'arcGrad', x1:'0%', y1:'0%', x2:'100%', y2:'100%' });
    grad.appendChild(svgEl('stop', { offset:'0%', 'stop-color':'#FFB347' }));
    grad.appendChild(svgEl('stop', { offset:'100%', 'stop-color':'#FF6B4D' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    const arc = svgEl('path', {
      d: describeArc(cx,cy,R,startAngle,endAngle),
      fill:'none', stroke:'url(#arcGrad)', 'stroke-width':12, 'stroke-linecap':'round'
    });
    arc.classList.add('arc-sweep');
    svg.appendChild(arc);

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(()=>{
      try{
        const len = arc.getTotalLength();
        if (reduceMotion){ arc.style.strokeDasharray='none'; }
        else {
          arc.style.strokeDasharray = len;
          arc.style.strokeDashoffset = len;
          requestAnimationFrame(()=>{ arc.style.strokeDashoffset = 0; });
        }
      }catch(e){}
    });
  }

  summary.punchInPts.forEach(p=>{
    const ang = p.abs/1440*360;
    const pos = polar(cx,cy,R2,ang);
    const isHoliday = summary.holiday && summary.holiday.date === p.date;
    svg.appendChild(svgEl('circle', { cx:pos.x.toFixed(1), cy:pos.y.toFixed(1), r: isHoliday?4:2.6, fill: isHoliday?'#F3E7D3':'#FFB347', opacity:0.9 }));
  });
  summary.punchOutPts.forEach(p=>{
    const ang = p.abs/1440*360;
    const pos = polar(cx,cy,R-26,ang);
    svg.appendChild(svgEl('circle', { cx:pos.x.toFixed(1), cy:pos.y.toFixed(1), r:2.2, fill:'#FF6B4D', opacity:0.6 }));
  });
}

/* =========================================================
   CHART.JS RENDERING
   ========================================================= */
let rhythmChart=null, punchChart=null;

function renderRhythmChart(rows){
  const ctx = document.getElementById('rhythmChart');
  if (!ctx) return;
  const labels = rows.map(r => String(parseDateParts(r.date).day));
  const reg = rows.map(r => (toMinutes(r.regHours)||0)/60);
  const ot = rows.map(r => (toMinutes(r.overtime)||0)/60);
  const regColors = rows.map(r => r.irregular ? '#F3E7D3' : '#FFB347');
  const otColors = rows.map(r => r.irregular ? '#FFD66B' : '#FF6B4D');

  if (rhythmChart) rhythmChart.destroy();
  rhythmChart = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[
      { label:'Regular', data:reg, backgroundColor:regColors, borderRadius:4, stack:'s' },
      { label:'Overtime', data:ot, backgroundColor:otColors, borderRadius:4, stack:'s' }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ labels:{ color:'#8E96B5', font:{ family:'Inter', size:12 } } },
        tooltip:{
          backgroundColor:'#1B2142', borderColor:'rgba(255,255,255,0.1)', borderWidth:1,
          titleColor:'#F3E7D3', bodyColor:'#F3E7D3',
          callbacks:{
            title: (items)=> rows[items[0].dataIndex] ? formatDate(rows[items[0].dataIndex].date) : ''
          }
        }
      },
      scales:{
        x:{ stacked:true, ticks:{ color:'#8E96B5', font:{ family:'JetBrains Mono', size:10 } }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y:{ stacked:true, beginAtZero:true, ticks:{ color:'#8E96B5', font:{ size:11 } }, grid:{ color:'rgba(255,255,255,0.06)' }, title:{ display:true, text:'Hours', color:'#8E96B5' } }
      }
    }
  });
}

function renderPunchChart(rows){
  const ctx = document.getElementById('punchChart');
  if (!ctx) return;
  const labels = rows.map(r => String(parseDateParts(r.date).day));
  const pin = rows.map(r => { const m = toMinutes(r.punchIn); return m==null ? null : shiftMinutes(m); });
  const pout = rows.map(r => { const m = toMinutes(r.punchOut); return m==null ? null : shiftMinutes(m); });

  if (punchChart) punchChart.destroy();
  punchChart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[
      { label:'Punch in', data:pin, borderColor:'#FFB347', backgroundColor:'#FFB347', pointRadius:3, tension:0.3, spanGaps:false },
      { label:'Punch out', data:pout, borderColor:'#FF6B4D', backgroundColor:'#FF6B4D', pointRadius:3, tension:0.3, spanGaps:false }
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ labels:{ color:'#8E96B5', font:{ family:'Inter', size:12 } } },
        tooltip:{
          backgroundColor:'#1B2142', borderColor:'rgba(255,255,255,0.1)', borderWidth:1,
          titleColor:'#F3E7D3', bodyColor:'#F3E7D3',
          callbacks:{
            title:(items)=> rows[items[0].dataIndex] ? formatDate(rows[items[0].dataIndex].date) : '',
            label:(item)=> `${item.dataset.label}: ${shiftToClock(item.raw)}`
          }
        }
      },
      scales:{
        x:{ ticks:{ color:'#8E96B5', font:{ family:'JetBrains Mono', size:10 } }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y:{ min:0, max:1440, ticks:{ stepSize:180, color:'#8E96B5', font:{ family:'JetBrains Mono', size:10 }, callback:(v)=> shiftToClock(v) }, grid:{ color:'rgba(255,255,255,0.06)' } }
      }
    }
  });
}
