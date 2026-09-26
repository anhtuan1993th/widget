import { getFullDateInfo } from './lunar.js';

// Running inside Tauri, or opened directly in a browser for UI work (simulated data)
const tauri = window.__TAURI__;
const isTauri = !!tauri?.core;
const invoke = isTauri ? tauri.core.invoke : async () => null;
const appWindow = isTauri ? tauri.window.getCurrentWindow() : null;

const $ = (id) => document.getElementById(id);
const GB = 1024 ** 3;
const RING = 270.18; // 2πr for r = 43
const HISTORY_LEN = 30;
const POLL_MS = 1000;

const downHistory = Array(HISTORY_LEN).fill(0);
const upHistory = Array(HISTORY_LEN).fill(0);

// ---------------------------------------------------------------- helpers

function formatSpeed(bps) {
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(bps < 10 * 1024 ? 1 : 0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatGB(bytes) {
  const gb = bytes / GB;
  return gb >= 100 ? gb.toFixed(0) : gb.toFixed(1);
}

function levelClass(percent) {
  if (percent >= 90) return 'level-crit';
  if (percent >= 75) return 'level-warn';
  return '';
}

function setLevel(el, percent) {
  el.classList.remove('level-warn', 'level-crit');
  const cls = levelClass(percent);
  if (cls) el.classList.add(cls);
}

function setRing(el, percent) {
  const p = Math.min(Math.max(percent, 0), 100);
  el.style.strokeDashoffset = RING - (p / 100) * RING;
  setLevel(el, p);
}

const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- sparkline

function drawWave(canvas, history) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Autoscale with a 64 KB/s floor so idle noise doesn't fill the chart
  const maxVal = Math.max(...history, 64 * 1024);
  const step = w / (history.length - 1);
  const yOf = (v) => h - 2 - (v / maxVal) * (h - 6);

  ctx.beginPath();
  history.forEach((v, i) => (i ? ctx.lineTo(i * step, yOf(v)) : ctx.moveTo(0, yOf(v))));
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
  grad.addColorStop(1, 'rgba(0, 229, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fill();
}

function redrawWaves() {
  if (!root.classList.contains('expanded')) return;
  drawWave($('downCanvas'), downHistory);
  drawWave($('upCanvas'), upHistory);
}

// ---------------------------------------------------------------- calendar

function updateCalendar() {
  const { solar, lunar } = getFullDateInfo();
  const lunarMonth = `${lunar.lunarMonth}${lunar.lunarLeap ? ' nhuận' : ''}`;

  // Mini pill
  $('pillSolar').textContent = `${solar.weekdayShort}, ${pad2(solar.day)}/${pad2(solar.month)}/${solar.year}`;
  $('pillLunar').textContent =
    `${pad2(lunar.lunarDay)}/${pad2(lunar.lunarMonth)}${lunar.lunarLeap ? 'N' : ''} ÂL · ${lunar.canChiYear}`;

  // Expanded card
  $('calWeekday').textContent = solar.weekday;
  $('solarDay').textContent = pad2(solar.day);
  $('solarMonthYear').textContent = `Tháng ${solar.month}, ${solar.year}`;
  $('lunarDay').textContent = pad2(lunar.lunarDay);
  $('lunarMonthYear').textContent = `Tháng ${lunarMonth}, ${lunar.canChiYear}`;
  $('canChiDay').textContent = lunar.canChiDay;
  $('canChiMonth').textContent = lunar.canChiMonth;
  $('canChiHour').textContent = lunar.canChiHour;
  $('tietKhi').textContent = lunar.tietKhi;
}

// ---------------------------------------------------------------- stats

function renderDisks(disks) {
  const list = $('diskList');
  // Rebuild only when the set of drives changes; otherwise update in place
  const key = disks.map((d) => d.mount_point).join('|');
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.innerHTML = disks
      .map(
        (d, i) => `
        <div class="disk-row" data-i="${i}">
          <span class="disk-name mono">${d.mount_point.replace(/[&<>"]/g, '')}</span>
          <div class="bar-track"><div class="bar-fill"></div></div>
          <span class="disk-pct mono"></span>
          <span class="disk-size mono"></span>
        </div>`,
      )
      .join('');
  }
  disks.forEach((d, i) => {
    const row = list.children[i];
    const pct = Math.round(d.usage_percent);
    setLevel(row, pct);
    row.querySelector('.bar-fill').style.width = `${pct}%`;
    row.querySelector('.disk-pct').textContent = `${pct}%`;
    row.querySelector('.disk-size').textContent = `${formatGB(d.used_bytes)}/${formatGB(d.total_bytes)} GB`;
  });
}

function updateUI(stats) {
  const cpu = Math.round(stats.cpu_usage);
  const ram = Math.round(stats.ram_percent);
  const hasCpuTemp = stats.cpu_temp != null;
  const down = formatSpeed(stats.net_rx_bytes_per_sec);
  const up = formatSpeed(stats.net_tx_bytes_per_sec);

  // Mini pill; the temperature column only shows when a sensor is readable
  $('pillCpuUsage').textContent = `${cpu}%`;
  document.querySelectorAll('[data-temp]').forEach((el) => (el.hidden = !hasCpuTemp));
  if (hasCpuTemp) $('pillCpuTemp').textContent = `${Math.round(stats.cpu_temp)}°C`;
  $('pillRamUsage').textContent = `${ram}%`;
  $('pillNetDown').textContent = down;
  $('pillNetUp').textContent = up;

  // CPU gauge
  $('cardCpuUsage').textContent = `${cpu}%`;
  setRing($('circleCpu'), cpu);
  const cpuTemp = $('cardCpuTemp');
  cpuTemp.textContent = hasCpuTemp ? `${Math.round(stats.cpu_temp)}°C` : '--°C';
  cpuTemp.classList.toggle('muted', !hasCpuTemp);
  cpuTemp.title = hasCpuTemp ? '' : 'Máy không cung cấp cảm biến nhiệt độ';
  $('cpuGaugeBox').title = stats.cpu_brand || '';

  // RAM gauge
  $('cardRamUsage').textContent = `${ram}%`;
  $('cardRamSize').textContent = `${formatGB(stats.ram_used_bytes)} / ${Math.round(stats.ram_total_bytes / GB)} GB`;
  setRing($('circleRam'), ram);
  const ramTemp = $('cardRamTemp');
  ramTemp.hidden = stats.ram_temp == null;
  if (stats.ram_temp != null) ramTemp.textContent = `${Math.round(stats.ram_temp)}°C`;

  renderDisks(stats.disks || []);

  // Network
  $('cardDownVal').textContent = down;
  $('cardUpVal').textContent = up;
  downHistory.shift();
  downHistory.push(stats.net_rx_bytes_per_sec);
  upHistory.shift();
  upHistory.push(stats.net_tx_bytes_per_sec);
  redrawWaves();
}

function simulatedStats() {
  return {
    cpu_usage: 10 + Math.random() * 15,
    cpu_temp: 52 + Math.random() * 4,
    cpu_brand: 'Simulated CPU',
    ram_used_bytes: 10.3 * GB,
    ram_total_bytes: 16 * GB,
    ram_percent: 64.4,
    ram_temp: null,
    disks: [
      { mount_point: 'C:', total_bytes: 351 * GB, used_bytes: 197 * GB, usage_percent: 56.1 },
      { mount_point: 'D:', total_bytes: 580 * GB, used_bytes: 490 * GB, usage_percent: 84.5 },
    ],
    net_rx_bytes_per_sec: Math.random() * 400 * 1024,
    net_tx_bytes_per_sec: Math.random() * 60 * 1024,
  };
}

// Chained timeout instead of setInterval so slow reads never pile up
async function pollStats() {
  if (!document.hidden) {
    try {
      const stats = isTauri ? await invoke('get_system_stats') : simulatedStats();
      if (stats) updateUI(stats);
    } catch (err) {
      console.error('get_system_stats failed:', err);
    }
  }
  setTimeout(pollStats, POLL_MS);
}

// ---------------------------------------------------------------- window

const root = $('root');

function setMode(expanded) {
  root.classList.toggle('expanded', expanded);
  if (expanded) requestAnimationFrame(redrawWaves);
}

// Keep the native window exactly as tall as the content
function fitWindow() {
  const height = Math.ceil(root.getBoundingClientRect().height);
  if (isTauri && height > 0) invoke('resize_widget', { height }).catch(console.warn);
}

// Dragging starts only after the mouse moves a few pixels, so a plain click on the
// pill still toggles the widget instead of being swallowed by the OS drag loop.
let dragOrigin = null;
let dragged = false;

document.addEventListener('mousedown', (e) => {
  dragged = false;
  if (e.button !== 0 || !e.target.closest('[data-drag]') || e.target.closest('[data-no-drag]')) return;
  dragOrigin = { x: e.screenX, y: e.screenY };
});

document.addEventListener('mousemove', (e) => {
  if (!dragOrigin) return;
  if (!(e.buttons & 1)) {
    dragOrigin = null;
    return;
  }
  if (Math.abs(e.screenX - dragOrigin.x) + Math.abs(e.screenY - dragOrigin.y) > 4) {
    dragOrigin = null;
    dragged = true;
    appWindow?.startDragging().catch(console.warn);
  }
});

document.addEventListener('mouseup', () => (dragOrigin = null));

// ---------------------------------------------------------------- init

window.addEventListener('DOMContentLoaded', () => {
  new ResizeObserver(fitWindow).observe(root);

  $('miniPill').addEventListener('click', () => {
    if (dragged) return;
    setMode(!root.classList.contains('expanded'));
  });
  $('btnCollapse').addEventListener('click', () => setMode(false));
  window.addEventListener('resize', redrawWaves);

  updateCalendar();
  setInterval(updateCalendar, 30_000);
  pollStats();
});
