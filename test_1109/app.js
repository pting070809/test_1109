// Sicao Estuary Tide Forecasting Web App Logic
let rawData = null;
let currentDatum = 'cd'; // 'cd' or 'msl'
let activeDayFilter = 'all';
let chartInstance = null;

// Real-time custom parameters for prediction model
let modelParams = {
  phaseLag: 10,       // minutes
  ampFactor: 1.025,   // shoaling factor
  sensorWeight: 0.94, // surge coupling weight
  datumOffset: 95.0
};

// ==============================================================================
// 時間判斷工具：區分「過去與當前（有物理實測）」與「未來（尚未到達，無實測值）」
// ==============================================================================
function getNowReferenceTime() {
  const now = new Date();
  if (rawData && rawData.hourly_data && rawData.hourly_data.length > 0) {
    const firstTime = new Date(rawData.hourly_data[0].timestamp.replace(' ', 'T') + ':00');
    const lastTime = new Date(rawData.hourly_data[rawData.hourly_data.length - 1].timestamp.replace(' ', 'T') + ':00');
    // 若系統時間在資料集時間範圍內，直接使用真實當前時間
    if (now >= firstTime && now <= lastTime) {
      return now;
    }
    // 預設基準測試時間點 (2026-11-09 15:45)
    return new Date('2026-11-09T15:45:00');
  }
  return now;
}

function isFutureRecord(timestampStr) {
  const rowDate = new Date(timestampStr.replace(' ', 'T') + ':00');
  const nowRef = getNowReferenceTime();
  return rowDate > nowRef;
}

// Embedded Fallback Data in case loaded directly via file:// protocol
async function loadData() {
  try {
    const res = await fetch('tide_data_7days.json');
    if (!res.ok) throw new Error('Fetch failed');
    rawData = await res.json();
  } catch (err) {
    console.warn('Direct fetch failed (likely local file:// protocol), using window.EMBEDDED_TIDE_DATA:', err);
    if (window.EMBEDDED_TIDE_DATA) {
      rawData = window.EMBEDDED_TIDE_DATA;
    } else {
      showError('無法載入潮汐資料，請確認伺服器或 embedded_data.js 正常。');
      return;
    }
  }
  initializeApp();
}

function initializeApp() {
  setupDayButtons();
  setupEventListeners();
  updateCurrentStatusCard();
  renderExtremeCards();
  renderChart();
  renderTable();
}

function setupDayButtons() {
  const container = document.getElementById('day-buttons-container');
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = `px-3 py-1.5 rounded-lg text-xs font-semibold transition ${activeDayFilter === 'all' ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`;
  allBtn.innerText = '完整 7 天 (11/09-11/15)';
  allBtn.onclick = () => {
    activeDayFilter = 'all';
    setupDayButtons();
    renderChart();
    renderTable();
  };
  container.appendChild(allBtn);

  const dates = [...new Set(rawData.hourly_data.map(d => d.date))];
  dates.forEach(d => {
    const btn = document.createElement('button');
    const dayItem = rawData.hourly_data.find(x => x.date === d);
    const label = `${d.slice(5)} (${dayItem.day_of_week})`;
    btn.className = `px-3 py-1.5 rounded-lg text-xs font-semibold transition ${activeDayFilter === d ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`;
    btn.innerText = label;
    btn.onclick = () => {
      activeDayFilter = d;
      setupDayButtons();
      renderChart();
      renderTable();
    };
    container.appendChild(btn);
  });
}

function setupEventListeners() {
  document.getElementById('datum-select').addEventListener('change', (e) => {
    currentDatum = e.target.value;
    updateCurrentStatusCard();
    renderExtremeCards();
    renderChart();
    renderTable();
  });

  // Slider adjustments
  const lagSlider = document.getElementById('lag-slider');
  const lagVal = document.getElementById('lag-val');
  lagSlider.addEventListener('input', (e) => {
    modelParams.phaseLag = parseInt(e.target.value);
    lagVal.innerText = `${modelParams.phaseLag} 分鐘`;
    recalculateCustomModel();
  });

  const ampSlider = document.getElementById('amp-slider');
  const ampVal = document.getElementById('amp-val');
  ampSlider.addEventListener('input', (e) => {
    modelParams.ampFactor = parseFloat(e.target.value);
    ampVal.innerText = `${modelParams.ampFactor.toFixed(3)} 倍`;
    recalculateCustomModel();
  });

  const sensorSlider = document.getElementById('sensor-slider');
  const sensorVal = document.getElementById('sensor-val');
  sensorSlider.addEventListener('input', (e) => {
    modelParams.sensorWeight = parseFloat(e.target.value);
    sensorVal.innerText = `${Math.round(modelParams.sensorWeight * 100)} %`;
    recalculateCustomModel();
  });

  // Export CSV
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
}

function recalculateCustomModel() {
  // Re-estimate Sicao tide based on dynamic formula:
  // sicao_pred = cwa_anping_raw * ampFactor + surge * sensorWeight + 1.2
  rawData.hourly_data.forEach((row, i) => {
    const baseCwaMsl = row.cwa_anping_msl_cm;
    const surge = row.surge_residual_cm;
    const estMsl = (baseCwaMsl * modelParams.ampFactor) + (surge * modelParams.sensorWeight) + 1.2;
    row.custom_sicao_msl = Math.round(estMsl * 10) / 10;
    row.custom_sicao_cd = Math.round((estMsl + modelParams.datumOffset) * 10) / 10;
  });

  updateCurrentStatusCard();
  renderChart();
  renderTable();
}

function updateCurrentStatusCard() {
  const nowRef = getNowReferenceTime();
  // 尋找當前或最接近當前時間的整點觀測記錄
  let currHour = rawData.hourly_data.slice().reverse().find(d => {
    const t = new Date(d.timestamp.replace(' ', 'T') + ':00');
    return t <= nowRef;
  }) || rawData.hourly_data[0];
  
  const sicaoVal = currentDatum === 'cd' 
    ? (currHour.custom_sicao_cd || currHour.sicao_pred_cd_cm) 
    : (currHour.custom_sicao_msl || currHour.sicao_pred_msl_cm);
    
  const anpingCwa = currentDatum === 'cd' ? currHour.cwa_anping_cd_cm : currHour.cwa_anping_msl_cm;
  const anpingSensor = currentDatum === 'cd' ? currHour.sensor_anping_cd_cm : currHour.sensor_anping_msl_cm;

  document.getElementById('cur-sicao-tide').innerText = `${sicaoVal.toFixed(1)} cm`;
  document.getElementById('cur-anping-cwa').innerText = `${anpingCwa.toFixed(1)} cm`;
  document.getElementById('cur-anping-sensor').innerText = `${anpingSensor.toFixed(1)} cm`;
  document.getElementById('cur-surge').innerText = `+${currHour.surge_residual_cm.toFixed(1)} cm`;
  document.getElementById('cur-state').innerText = currHour.flow_state;
  document.getElementById('cur-spd').innerText = currHour.sicao_current_spd;
  document.getElementById('cur-temp').innerText = `${currHour.water_temp_c} °C`;
  document.getElementById('cur-wave').innerText = `${currHour.wave_height_m} m`;

  const unitLabel = currentDatum === 'cd' ? '海圖基準面 (CD)' : 'TWVD2001 (平均海平面)';
  document.querySelectorAll('.datum-unit-tag').forEach(el => el.innerText = unitLabel);
}

function renderExtremeCards() {
  const container = document.getElementById('extreme-cards-container');
  container.innerHTML = '';

  rawData.daily_extremes.forEach(day => {
    const card = document.createElement('div');
    card.className = 'bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-cyan-500/40 transition shadow-lg';

    let eventsHtml = day.events.map(ev => {
      const isHigh = ev.type.includes('滿潮');
      const badgeCls = isHigh ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      const sicaoHeight = currentDatum === 'cd' ? ev.sicao_tide_cd_cm : ev.sicao_tide_msl_cm;
      const anpingHeight = currentDatum === 'cd' ? ev.anping_tide_cd_cm : ev.anping_tide_msl_cm;

      return `
        <div class="py-2 border-b border-slate-800/60 last:border-none">
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="px-2 py-0.5 rounded-full border text-[11px] font-medium ${badgeCls}">${ev.type}</span>
            <span class="text-slate-400 font-mono">四草 ${ev.sicao_time} (安平 ${ev.anping_time})</span>
          </div>
          <div class="flex items-baseline justify-between">
            <span class="text-slate-400 text-xs">四草推估潮高</span>
            <span class="font-bold font-mono text-cyan-300 text-sm">${sicaoHeight.toFixed(1)} <span class="text-xs text-slate-400 font-normal">cm</span></span>
          </div>
          <div class="flex items-baseline justify-between text-[11px] text-slate-400">
            <span>安平預測</span>
            <span>${anpingHeight.toFixed(1)} cm (延遲 ${ev.time_diff_min})</span>
          </div>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
          <div>
            <h4 class="font-bold text-white text-base">${day.date.slice(5)} <span class="text-xs font-normal text-slate-400 ml-1">${day.day_of_week}</span></h4>
          </div>
          <span class="px-2 py-0.5 rounded text-xs font-semibold ${day.tide_category.includes('大潮') ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
            ${day.tide_category}
          </span>
        </div>
        <div class="space-y-1">
          ${eventsHtml}
        </div>
      </div>
      <div class="mt-3 pt-2 border-t border-slate-800/70 text-[11px] text-slate-400">
        <span class="text-cyan-400">水文警示：</span> ${day.water_flow_desc}
      </div>
    `;

    container.appendChild(card);
  });
}

function renderChart() {
  const ctx = document.getElementById('tideChart').getContext('2d');

  let filtered = rawData.hourly_data;
  if (activeDayFilter !== 'all') {
    filtered = rawData.hourly_data.filter(d => d.date === activeDayFilter);
  }

  const labels = filtered.map(d => {
    if (activeDayFilter === 'all') {
      return d.time === '00:00' ? `${d.date.slice(5)} 00:00` : d.time;
    }
    return d.time;
  });

  const sicaoData = filtered.map(d => {
    const val = currentDatum === 'cd' 
      ? (d.custom_sicao_cd !== undefined ? d.custom_sicao_cd : d.sicao_pred_cd_cm)
      : (d.custom_sicao_msl !== undefined ? d.custom_sicao_msl : d.sicao_pred_msl_cm);
    return val;
  });

  const anpingCwaData = filtered.map(d => {
    return currentDatum === 'cd' ? d.cwa_anping_cd_cm : d.cwa_anping_msl_cm;
  });

  const anpingSensorData = filtered.map(d => {
    // 時間判斷：未到時間（未來）無物理感測器實測值，設為 null 中斷折線
    if (isFutureRecord(d.timestamp)) {
      return null;
    }
    return currentDatum === 'cd' ? d.sensor_anping_cd_cm : d.sensor_anping_msl_cm;
  });

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '四草大橋推估潮位 (Sicao Mouth Est.)',
          data: sicaoData,
          borderColor: '#06b6d4', // cyan-500
          backgroundColor: 'rgba(6, 182, 212, 0.12)',
          borderWidth: 2.8,
          pointRadius: activeDayFilter === 'all' ? 1.5 : 3.5,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          order: 1
        },
        {
          label: '安平港實測感測器 (In-Situ Sensor - 僅顯示至當前)',
          data: anpingSensorData,
          borderColor: '#f59e0b', // amber-500
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: activeDayFilter === 'all' ? 1.5 : 3.5,
          pointHoverRadius: 5,
          tension: 0.35,
          spanGaps: false, // 確保未來 null 值不會被連線穿越
          order: 2
        },
        {
          label: '氣象署安平預報 (CWA 2026 Astronomical)',
          data: anpingCwaData,
          borderColor: '#818cf8', // indigo-400
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
          order: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#cbd5e1',
            font: { size: 12, family: 'sans-serif' },
            boxWidth: 16
          }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#38bdf8',
          bodyColor: '#e2e8f0',
          borderColor: '#334155',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(ctx) {
              const label = ctx.dataset.label.split(' (')[0] || '';
              if (ctx.parsed.y === null || ctx.parsed.y === undefined || isNaN(ctx.parsed.y)) {
                return ` ${label}: -- (未到達，尚無實測值)`;
              }
              return ` ${label}: ${ctx.parsed.y.toFixed(1)} cm`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(51, 65, 85, 0.35)' },
          ticks: {
            color: '#94a3b8',
            maxTicksLimit: activeDayFilter === 'all' ? 14 : 24,
            font: { size: 10 }
          }
        },
        y: {
          grid: { color: 'rgba(51, 65, 85, 0.4)' },
          ticks: {
            color: '#94a3b8',
            callback: (v) => `${v} cm`,
            font: { size: 10 }
          },
          title: {
            display: true,
            text: currentDatum === 'cd' ? '潮高 (海圖基準面 CD / cm)' : '潮高 (TWVD2001 / cm)',
            color: '#94a3b8',
            font: { size: 11 }
          }
        }
      }
    }
  });
}

function renderTable() {
  const tbody = document.getElementById('tide-tbody');
  tbody.innerHTML = '';

  let filtered = rawData.hourly_data;
  if (activeDayFilter !== 'all') {
    filtered = rawData.hourly_data.filter(d => d.date === activeDayFilter);
  }

  filtered.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-800/80 hover:bg-slate-800/50 transition';

    const sicaoVal = currentDatum === 'cd' 
      ? (row.custom_sicao_cd !== undefined ? row.custom_sicao_cd : row.sicao_pred_cd_cm)
      : (row.custom_sicao_msl !== undefined ? row.custom_sicao_msl : row.sicao_pred_msl_cm);

    const anpingCwa = currentDatum === 'cd' ? row.cwa_anping_cd_cm : row.cwa_anping_msl_cm;
    
    // 時間判斷：未到的未來時間，感測器實測與暴潮殘差顯示為「-- (未到)」
    const isFuture = isFutureRecord(row.timestamp);
    let anpingSensorHtml = '';
    let surgeResidualHtml = '';
    
    if (isFuture) {
      anpingSensorHtml = '<span class="text-slate-500 italic text-[11px]">-- (未到)</span>';
      surgeResidualHtml = '<span class="text-slate-500 italic text-[11px]">--</span>';
    } else {
      const anpingSensor = currentDatum === 'cd' ? row.sensor_anping_cd_cm : row.sensor_anping_msl_cm;
      anpingSensorHtml = `<span class="text-amber-300 font-bold">${anpingSensor.toFixed(1)}</span>`;
      surgeResidualHtml = `<span class="text-slate-400">+${row.surge_residual_cm.toFixed(1)}</span>`;
    }

    let flowColor = 'text-slate-400';
    if (row.flow_state.includes('漲潮')) flowColor = 'text-amber-400';
    else if (row.flow_state.includes('退潮')) flowColor = 'text-emerald-400';
    else flowColor = 'text-cyan-400';

    tr.innerHTML = `
      <td class="py-2.5 px-3 text-slate-300 font-mono text-xs whitespace-nowrap">
        ${row.timestamp} (${row.day_of_week})
        ${isFuture ? '' : '<span class="ml-1 text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-1 py-0.5 rounded font-sans">實測</span>'}
      </td>
      <td class="py-2.5 px-3 font-mono font-bold text-cyan-300 text-xs">${sicaoVal.toFixed(1)}</td>
      <td class="py-2.5 px-3 font-mono text-indigo-300 text-xs">${anpingCwa.toFixed(1)}</td>
      <td class="py-2.5 px-3 font-mono text-xs">${anpingSensorHtml}</td>
      <td class="py-2.5 px-3 font-mono text-xs">${surgeResidualHtml}</td>
      <td class="py-2.5 px-3 text-xs ${flowColor} font-medium">${row.flow_state}</td>
      <td class="py-2.5 px-3 text-xs text-slate-400">${row.sicao_current_spd}</td>
      <td class="py-2.5 px-3 text-xs text-slate-400">${row.water_temp_c}°C / ${row.wave_height_m}m</td>
    `;
    tbody.appendChild(tr);
  });
}

function exportCSV() {
  let csvContent = '\uFEFF'; // UTF-8 BOM
  csvContent += '日期時間,星期,四草推估潮高(cm),氣象署安平預報(cm),安平感測器實測(cm),氣象風浪殘差(cm),潮水流態,四草出海口流速,基準面\n';

  rawData.hourly_data.forEach(row => {
    const sicaoVal = currentDatum === 'cd' 
      ? (row.custom_sicao_cd !== undefined ? row.custom_sicao_cd : row.sicao_pred_cd_cm)
      : (row.custom_sicao_msl !== undefined ? row.custom_sicao_msl : row.sicao_pred_msl_cm);
    const anpingCwa = currentDatum === 'cd' ? row.cwa_anping_cd_cm : row.cwa_anping_msl_cm;
    const isFuture = isFutureRecord(row.timestamp);
    const anpingSensorStr = isFuture ? '' : (currentDatum === 'cd' ? row.sensor_anping_cd_cm : row.sensor_anping_msl_cm);
    const surgeResidualStr = isFuture ? '' : row.surge_residual_cm;
    const datumStr = currentDatum === 'cd' ? '海圖基準面CD' : 'TWVD2001';

    csvContent += `"${row.timestamp}","${row.day_of_week}",${sicaoVal},${anpingCwa},${anpingSensorStr},${surgeResidualStr},"${row.flow_state}","${row.sicao_current_spd}","${datumStr}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `四草大橋_安平港潮汐推估7天表_${currentDatum}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Start on DOM ready
document.addEventListener('DOMContentLoaded', loadData);
