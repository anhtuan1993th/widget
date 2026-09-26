import { getFullDateInfo } from './lunar.js';

// Check if running inside Tauri runtime
const isTauri = typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core;
const invoke = isTauri ? window.__TAURI__.core.invoke : async (cmd, args) => null;

let currentMode = 'expanded'; // 'pill' or 'expanded'

// Net speed sparkline history (24 data points)
const downHistory = Array(24).fill(2.4);
const upHistory = Array(24).fill(0.9);

function initSparkline(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

let downPlot = null;
let upPlot = null;

function drawWave(plot, history, maxClamp = 5) {
  if (!plot) return;
  const { canvas, ctx } = plot;
  const w = canvas.width = canvas.offsetWidth;
  const h = canvas.height = canvas.offsetHeight;
  if (!w || !h) return;

  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0, 229, 255, 0.4)');
  grad.addColorStop(1, 'rgba(0, 229, 255, 0.0)');

  const step = w / (history.length - 1);
  const maxVal = Math.max(...history, maxClamp);

  ctx.beginPath();
  history.forEach((val, i) => {
    const x = i * step;
    const y = h - (val / maxVal) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  // Area fill
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Wave line
  ctx.beginPath();
  history.forEach((val, i) => {
    const x = i * step;
    const y = h - (val / maxVal) * (h - 6) - 3;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

function redrawWaves() {
  drawWave(downPlot, downHistory, 8);
  drawWave(upPlot, upHistory, 4);
}

// Convert bytes to human readable format (GB / MB)
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 GB';
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024 * 1024) {
    return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  }
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
}

// Update Calendar information
function updateCalendar() {
  const info = getFullDateInfo();
  const { solar, lunar } = info;

  // Header month tag (e.g. SEP 25 or OCT 22)
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const headerDateStr = `${monthNames[solar.month - 1]} ${solar.day}`;
  document.getElementById('calHeaderDate').innerText = headerDateStr;

  // Solar box
  document.getElementById('solarWeekday').innerText = solar.weekday;
  document.getElementById('solarDayBig').innerText = solar.day;
  document.getElementById('solarFullStr').innerText = `Solar: ${solar.day} Thg ${solar.month}, ${solar.year}`;

  // Lunar box
  document.getElementById('lunarYearHour').innerText = `${lunar.canChiYear} | Giờ: ${lunar.canChiHour}`;
  
  const lunarMonthPad = lunar.lunarMonth.toString().padStart(2, '0');
  const lunarDayPad = lunar.lunarDay.toString().padStart(2, '0');
  document.getElementById('lunarMonthTitle').innerText = `THÁNG ${lunarMonthPad} | ${lunarDayPad}`;
  document.getElementById('lunarShort').innerText = `${lunarDayPad}/${lunarMonthPad} AL${lunar.lunarLeap ? ' (Nhuận)' : ''}`;
  document.getElementById('lunarDayDetail').innerText = `Ngày ${lunar.canChiDay}, Tiết ${lunar.tietKhi}`;
}

// Update System Monitor UI
function updateUI(stats) {
  const cpuPercent = Math.round(stats.cpu_usage);
  const cpuTemp = Math.round(stats.cpu_temp);
  const ramPercent = Math.round(stats.ram_percent);

  const ramUsedGB = (stats.ram_used_bytes / (1024 * 1024 * 1024)).toFixed(1);
  const ramTotalGB = (stats.ram_total_bytes / (1024 * 1024 * 1024)).toFixed(0);

  const downSpeedStr = formatSpeed(stats.net_rx_bytes_per_sec);
  const upSpeedStr = formatSpeed(stats.net_tx_bytes_per_sec);

  // 1. Mini Top Pill
  document.getElementById('pillCpuTemp').innerText = `${cpuTemp}°C`;
  document.getElementById('pillCpuUsage').innerText = `${cpuPercent}%`;
  document.getElementById('pillRamUsage').innerText = `${ramPercent}%`;
  document.getElementById('pillNetSpeed').innerText = downSpeedStr;

  // 2. Expanded Gauges
  document.getElementById('cardCpuUsage').innerText = `${cpuPercent}%`;
  document.getElementById('cardCpuUsageSub').innerText = `${cpuTemp}°C`;
  document.getElementById('cardCpuTemp').innerText = `${cpuTemp}°C`;

  // Ring Circumference = 270.17
  const cpuOffset = 270.17 - (cpuPercent / 100) * 270.17;
  document.getElementById('circleCpuUsage').style.strokeDashoffset = Math.max(0, cpuOffset);

  // Temp offset (range 30°C to 95°C)
  const tempRatio = Math.min(Math.max((cpuTemp - 30) / 65, 0), 1);
  const tempOffset = 270.17 - tempRatio * 270.17;
  document.getElementById('circleCpuTemp').style.strokeDashoffset = Math.max(0, tempOffset);

  // 3. RAM bar
  document.getElementById('ramText').innerText = `${ramPercent}% | ${ramUsedGB}GB / ${ramTotalGB}GB`;
  document.getElementById('ramBar').style.width = `${ramPercent}%`;

  // 4. SSD bar (First disk or C:)
  if (stats.disks && stats.disks.length > 0) {
    const primaryDisk = stats.disks.find(d => d.mount_point.toUpperCase().includes('C:')) || stats.disks[0];
    const diskUsedGB = Math.round(primaryDisk.used_bytes / (1024 * 1024 * 1024));
    const diskTotalGB = Math.round(primaryDisk.total_bytes / (1024 * 1024 * 1024));
    const diskPercent = Math.round(primaryDisk.usage_percent);

    document.getElementById('ssdText').innerText = `${diskUsedGB}GB / ${diskTotalGB}GB`;
    document.getElementById('ssdBar').style.width = `${diskPercent}%`;
    document.getElementById('ssdPercent').innerText = `${diskPercent}%`;
  }

  // 5. Network speeds and sparklines
  document.getElementById('cardDownVal').innerText = downSpeedStr;
  document.getElementById('cardUpVal').innerText = upSpeedStr;

  const downMB = stats.net_rx_bytes_per_sec / (1024 * 1024);
  const upMB = stats.net_tx_bytes_per_sec / (1024 * 1024);

  downHistory.shift();
  downHistory.push(downMB);
  upHistory.shift();
  upHistory.push(upMB);

  redrawWaves();
}

// Fetch stats loop
async function fetchStats() {
  if (isTauri) {
    try {
      const stats = await invoke('get_system_stats');
      if (stats) updateUI(stats);
    } catch (err) {
      console.error("Lỗi khi đọc get_system_stats:", err);
    }
  } else {
    // Simulated data if running in browser / dev without backend
    const simCpu = Math.floor(20 + Math.random() * 8);
    const simTemp = Math.floor(46 + Math.random() * 4);
    const simRam = 45;
    const simDown = 2.4 * 1024 * 1024 + (Math.random() - 0.5) * 500000;
    const simUp = 0.9 * 1024 * 1024 + (Math.random() - 0.5) * 200000;

    updateUI({
      cpu_usage: simCpu,
      cpu_temp: simTemp,
      cpu_brand: "AMD Ryzen 7 / Intel Core i7",
      ram_used_bytes: 14.4 * 1024 * 1024 * 1024,
      ram_total_bytes: 32 * 1024 * 1024 * 1024,
      ram_percent: simRam,
      disks: [
        {
          name: "Local Disk",
          mount_point: "C:\\",
          total_bytes: 940 * 1024 * 1024 * 1024,
          available_bytes: 260 * 1024 * 1024 * 1024,
          used_bytes: 680 * 1024 * 1024 * 1024,
          usage_percent: 72
        }
      ],
      net_rx_bytes_per_sec: simDown,
      net_tx_bytes_per_sec: simUp
    });
  }
}

// Switch between Mini Pill mode and Expanded Card mode
async function switchMode(targetMode) {
  currentMode = targetMode;
  const card = document.getElementById('expandedCard');
  const arrowIcon = document.getElementById('pillArrowIcon');

  if (currentMode === 'pill') {
    card.style.display = 'none';
    if (arrowIcon) arrowIcon.style.transform = 'rotate(0deg)';
  } else {
    card.style.display = 'flex';
    if (arrowIcon) arrowIcon.style.transform = 'rotate(180deg)';
    setTimeout(redrawWaves, 50);
  }

  if (isTauri) {
    try {
      await invoke('set_widget_mode', { mode: currentMode });
    } catch (e) {
      console.warn("Lỗi set_widget_mode:", e);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  downPlot = initSparkline('downCanvas');
  upPlot = initSparkline('upCanvas');

  updateCalendar();
  setInterval(updateCalendar, 10000);

  // Initial fetch and 1-second interval
  fetchStats();
  setInterval(fetchStats, 1000);

  // Setup click listeners for toggling
  const miniPill = document.getElementById('miniPill');
  const btnToggleMode = document.getElementById('btnToggleMode');
  const btnCollapse = document.getElementById('btnCollapse');

  const handleToggle = (e) => {
    // Only toggle if not clicking drag area if drag was moved
    if (currentMode === 'pill') {
      switchMode('expanded');
    } else {
      switchMode('pill');
    }
  };

  btnToggleMode.addEventListener('click', (e) => {
    e.stopPropagation();
    handleToggle(e);
  });

  miniPill.addEventListener('click', (e) => {
    if (e.target.closest('.interactive')) return;
    handleToggle(e);
  });

  btnCollapse.addEventListener('click', (e) => {
    e.stopPropagation();
    switchMode('pill');
  });

  // Window resize event for canvas
  window.addEventListener('resize', redrawWaves);
});
