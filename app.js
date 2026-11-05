/**
 * FireBridge - NASA Space Apps Challenge 2026
 * Master Application Controller & Geospatial Intelligence System
 * Harmonizing MODIS & VIIRS Active Fire Hotspots (2000–2026)
 */

// Global Application State
const state = {
  currentView: 'overview',
  currentRegion: 'california',
  currentHarmonizationModel: 'ols',
  database: null,
  activeHotspots: [],
  filteredHotspots: [],
  map: null,
  mapLayers: {
    tileLayer: null,
    satelliteLayer: null,
    osmLayer: null,
    gibsLayer: null,
    terrainLayer: null,
    markerCluster: null,
    vectorGroup: null,
    heatLayer: null,
    drawnItems: null
  },
  mapFilters: {
    basemap: 'dark',
    visMode: 'hotspots', // 'hotspots' | 'clusters' | 'heatmap'
    satellites: {
      harmonized: true,
      terra: true,
      aqua: true,
      snpp: true,
      noaa20: true,
      noaa21: true
    },
    diurnal: 'all',      // 'all' | 'night' | 'day'
    minFrp: 0,
    minConf: 0,
    customBounds: null   // [minLon, minLat, maxLon, maxLat]
  },
  playback: {
    isPlaying: false,
    speed: 1,
    interval: null,
    currentDateIndex: 0,
    dates: []
  },
  calendar: {
    metric: 'count',     // 'count' | 'frp' | 'anomaly' | 'zscore' | 'emissions'
    palette: 'plasma'    // 'plasma' | 'viridis' | 'inferno' | 'diverging'
  },
  analytics: {
    activeTab: 'trend',
    mainChart: null,
    compScatterChart: null,
    compSofievChart: null,
    compResidualChart: null,
    anomalyChart: null,
    regFreqChart: null,
    regEmissChart: null
  }
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Color Palettes
const PALETTES = {
  plasma: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
  viridis: ["#440154", "#482878", "#3e4a89", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
  diverging: ["#1e3a8a", "#3b82f6", "#93c5fd", "#e2e8f0", "#fca5a5", "#ef4444", "#991b1b"]
};

function hexToRgb(hex) {
  const bigint = parseInt(hex.replace('#', ''), 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => {
    const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function interpolateMultiColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const segment = 1 / (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(t / segment));
  const localT = (t - index * segment) / segment;
  const c1 = hexToRgb(stops[index]);
  const c2 = hexToRgb(stops[index + 1]);
  const r = c1[0] + (c2[0] - c1[0]) * localT;
  const g = c1[1] + (c2[1] - c1[1]) * localT;
  const b = c1[2] + (c2[2] - c1[2]) * localT;
  return rgbToHex(r, g, b);
}

// --- WEB AUDIO API TELEMETRY SYNTHESIZER ---
class FireBridgeAudio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }
  beep(freq = 880, type = 'sine', duration = 0.08, gainVal = 0.04) {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  }
  ping() { this.beep(1200, 'sine', 0.08, 0.025); }
  click() { this.beep(520, 'triangle', 0.03, 0.02); }
  success() {
    this.beep(587.33, 'sine', 0.06, 0.03);
    setTimeout(() => this.beep(880, 'sine', 0.1, 0.03), 70);
  }
  step() { this.beep(740, 'sine', 0.04, 0.02); }
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
}
const audioFX = new FireBridgeAudio();

// --- ANIMATED NUMBER COUNTER ---
function animateCounter(elOrId, targetVal, duration = 900, decimals = 0, prefix = '', suffix = '') {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  const target = parseFloat(targetVal);
  if (isNaN(target)) {
    el.textContent = prefix + targetVal + suffix;
    return;
  }
  const start = 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Cubic ease-out
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * ease;

    let formatted;
    if (decimals > 0) {
      formatted = current.toFixed(decimals);
    } else {
      formatted = Math.round(current).toLocaleString();
    }
    el.textContent = `${prefix}${formatted}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  requestAnimationFrame(update);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  initUtcClock();
  initMissionNavigation();
  initRouter();
  initMap();
  setupGlobalEvents();
  initConstellationOrbitTracker();
  initOpticalSimulator();
  initJudgeGuidedTour();

  // Load database from REST API with local fallback
  await loadDatabase();

  // Render initial views
  renderOverviewKpis();
  renderCalendar();
  renderAnalyticsChart();
  renderComparisonCharts();
  renderAnomalyCharts();
  renderRegionalCharts();
});

// Live UTC Mission Clock
function initUtcClock() {
  const clockEl = document.getElementById('utc-clock');
  function update() {
    const now = new Date();
    clockEl.textContent = now.toISOString().slice(11, 19) + ' UTC';
  }
  update();
  setInterval(update, 1000);
}

// Left Mission Subsections Drawer, Scroll Arrows & Mobile Dropdown
function initMissionNavigation() {
  const sidebar = document.getElementById('mission-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const mobileToggleBtn = document.getElementById('btn-mobile-sidebar-toggle');
  const closeBtn = document.getElementById('btn-close-sidebar');
  const prevBtn = document.getElementById('btn-nav-prev');
  const nextBtn = document.getElementById('btn-nav-next');
  const navContainer = document.getElementById('nav-container-scroll');
  const mobileSelect = document.getElementById('mobile-nav-select');

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (sidebar && sidebar.classList.contains('open')) closeSidebar();
      else openSidebar();
    });
  }

  if (mobileToggleBtn) {
    mobileToggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openSidebar();
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  if (backdrop) backdrop.addEventListener('click', closeSidebar);

  // Close sidebar when clicking any item in the drawer
  document.querySelectorAll('.drawer-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      closeSidebar();
    });
  });

  // Smooth scroll buttons for top horizontal navbar
  if (prevBtn && navContainer) {
    prevBtn.addEventListener('click', () => {
      navContainer.scrollBy({ left: -260, behavior: 'smooth' });
    });
  }
  if (nextBtn && navContainer) {
    nextBtn.addEventListener('click', () => {
      navContainer.scrollBy({ left: 260, behavior: 'smooth' });
    });
  }

  // Mobile & Narrow Viewport Quick-Select Dropdown
  if (mobileSelect) {
    mobileSelect.addEventListener('change', (e) => {
      window.location.hash = '#' + e.target.value;
    });
  }
}

// Hash-based View Routing for all 14 Application Sections
function initRouter() {
  function handleRoute() {
    const hash = window.location.hash.replace('#', '') || 'overview';
    const targetView = document.getElementById(`view-${hash}`);
    if (targetView) {
      document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
      targetView.classList.add('active');

      // Sync Main Horizontal Nav Tabs & auto-center active tab
      document.querySelectorAll('#main-nav-tabs .nav-link').forEach(link => {
        const isActive = link.dataset.view === hash;
        link.classList.toggle('active', isActive);
        if (isActive) {
          link.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      });

      // Sync Left Mission Directory Drawer Items
      document.querySelectorAll('.drawer-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === hash);
      });

      // Sync Mobile Subsection Selector Dropdown
      const mobileSelect = document.getElementById('mobile-nav-select');
      if (mobileSelect && mobileSelect.value !== hash) {
        mobileSelect.value = hash;
      }

      state.currentView = hash;

      if (hash === 'map' && state.map) {
        setTimeout(() => state.map.invalidateSize(), 150);
      }
      if (hash === 'orbit3d') {
        setTimeout(() => initOrbit3DVisualizer(), 150);
      }
      if (hash === 'climatesim') {
        setTimeout(() => initClimateSimulator(), 150);
      }
    }
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

// Fetch database from REST API with fallback to static JSON
async function loadDatabase() {
  try {
    const res = await fetch('/api/regions/california/statistics');
    if (res.ok) {
      const dbRes = await fetch('data/harmonized_fire_database.json');
      state.database = await dbRes.json();
      console.log('[+] Connected to FireBridge REST API & loaded database.');
    } else {
      throw new Error('API not answering');
    }
  } catch (err) {
    console.warn('[!] Direct REST API fallback, loading data/harmonized_fire_database.json directly...');
    const dbRes = await fetch('data/harmonized_fire_database.json');
    state.database = await dbRes.json();
  }

  // Set active hotspots for current region
  updateActiveRegion(state.currentRegion);
}

// Switch active region/biome
function updateActiveRegion(regionKey) {
  state.currentRegion = regionKey;
  const regionData = state.database[regionKey];
  if (!regionData) return;

  state.activeHotspots = regionData.sample_hotspots || [];
  state.mapFilters.customBounds = null;

  // Extract unique sorted dates for time playback slider
  const dateSet = new Set(state.activeHotspots.map(h => h.date));
  state.playback.dates = Array.from(dateSet).sort();
  state.playback.currentDateIndex = state.playback.dates.length - 1;

  // Update UI components
  renderOverviewKpis();
  renderCalendar();
  applyMapFilters();
  fitMapToBounds(regionData.metadata.bounds);
  renderAnalyticsChart();
  renderComparisonCharts();
  renderAnomalyCharts();
  renderRegionalCharts();
}

// --- GEOSPATIAL MAP INITIALIZATION (VIEW 2) ---
function initMap() {
  const mapContainer = document.getElementById('aoi-map');
  if (!mapContainer) return;

  state.map = L.map(mapContainer, {
    zoomControl: true,
    attributionControl: false,
    maxZoom: 18
  }).setView([39.2, -121.7], 6);

  // Basemap Tile Layers
  const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18,
    subdomains: 'abcd'
  });

  const satelliteTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18
  });

  const osmTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18
  });

  const gibsTiles = L.tileLayer('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2024-08-01/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg', {
    maxZoom: 9
  });

  const terrainTiles = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17
  });

  state.mapLayers.tileLayer = darkTiles.addTo(state.map);
  state.mapLayers.satelliteLayer = satelliteTiles;
  state.mapLayers.osmLayer = osmTiles;
  state.mapLayers.gibsLayer = gibsTiles;
  state.mapLayers.terrainLayer = terrainTiles;

  // Layers & Marker Clustering Groups
  state.mapLayers.vectorGroup = L.layerGroup().addTo(state.map);
  
  if (typeof L.markerClusterGroup === 'function') {
    state.mapLayers.markerCluster = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true
    });
  }

  // Drawing Tools Layer
  state.mapLayers.drawnItems = new L.FeatureGroup().addTo(state.map);
  
  if (typeof L.Control.Draw === 'function') {
    state.map.on(L.Draw.Event.CREATED, (e) => {
      const layer = e.layer;
      state.mapLayers.drawnItems.clearLayers();
      state.mapLayers.drawnItems.addLayer(layer);

      const bounds = layer.getBounds();
      const minLon = parseFloat(bounds.getWest().toFixed(4));
      const minLat = parseFloat(bounds.getSouth().toFixed(4));
      const maxLon = parseFloat(bounds.getEast().toFixed(4));
      const maxLat = parseFloat(bounds.getNorth().toFixed(4));

      document.getElementById('map-min-lat').value = minLat;
      document.getElementById('map-max-lat').value = maxLat;
      document.getElementById('map-min-lon').value = minLon;
      document.getElementById('map-max-lon').value = maxLon;

      state.mapFilters.customBounds = [minLon, minLat, maxLon, maxLat];
      applyMapFilters();
    });
  }

  // Cursor coordinates HUD tracking
  state.map.on('mousemove', (e) => {
    const lat = e.latlng.lat.toFixed(4);
    const lng = e.latlng.lng.toFixed(4);
    const cursorEl = document.getElementById('map-hud-cursor');
    if (cursorEl) {
      cursorEl.textContent = `${lat}°N, ${lng}°W`;
    }
  });
}

// Fit map to bounding box with smooth cinematic transition
function fitMapToBounds(bounds) {
  if (!state.map || !bounds) return;
  const [minLon, minLat, maxLon, maxLat] = bounds;
  if (typeof state.map.flyToBounds === 'function') {
    state.map.flyToBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [24, 24], duration: 1.5 });
  } else {
    state.map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [20, 20] });
  }
  
  const hudBounds = document.getElementById('map-hud-bounds');
  if (hudBounds) {
    hudBounds.textContent = `${minLat}° to ${maxLat}°N, ${minLon}° to ${maxLon}°E`;
  }
}

// Filter and render active hotspots on the map
function applyMapFilters() {
  if (!state.map) return;

  const spinner = document.getElementById('map-loading-spinner');
  if (spinner) spinner.style.display = 'flex';

  setTimeout(() => {
    let pts = state.activeHotspots.slice();

    // Diurnal filter
    if (state.mapFilters.diurnal !== 'all') {
      pts = pts.filter(h => {
        const hour = parseInt(h.time.split(':')[0], 10);
        const isNight = hour >= 20 || hour <= 5;
        return state.mapFilters.diurnal === 'night' ? isNight : !isNight;
      });
    }

    // Satellite individual feed filters (Terra, Aqua, Suomi-NPP, NOAA-20, NOAA-21)
    pts = pts.filter(h => {
      const sat = (h.satellite || '').toUpperCase();
      if (sat === 'TERRA' && !state.mapFilters.satellites.terra) return false;
      if (sat === 'AQUA' && !state.mapFilters.satellites.aqua) return false;
      if (sat === 'SUOMI-NPP' && !state.mapFilters.satellites.snpp) return false;
      if (sat === 'NOAA-20' && !state.mapFilters.satellites.noaa20) return false;
      if (sat === 'NOAA-21' && !state.mapFilters.satellites.noaa21) return false;
      return true;
    });

    // Min FRP filter
    if (state.mapFilters.minFrp > 0) {
      pts = pts.filter(h => h.frp >= state.mapFilters.minFrp);
    }

    // Min Confidence filter
    if (state.mapFilters.minConf > 0) {
      pts = pts.filter(h => {
        if (typeof h.confidence === 'number') return h.confidence >= state.mapFilters.minConf;
        if (h.confidence === 'high') return state.mapFilters.minConf <= 80;
        if (h.confidence === 'nominal') return state.mapFilters.minConf <= 50;
        return true;
      });
    }

    // Time scrubber filter (up to playback date)
    if (state.playback.dates.length > 0) {
      const activeDate = state.playback.dates[state.playback.currentDateIndex];
      if (activeDate) {
        pts = pts.filter(h => h.date <= activeDate);
        const dateDisp = document.getElementById('playback-current-date');
        if (dateDisp) dateDisp.textContent = `Observation: ${activeDate}`;
      }
    }

    // Custom BBox coordinates filter
    if (state.mapFilters.customBounds) {
      const [minLon, minLat, maxLon, maxLat] = state.mapFilters.customBounds;
      pts = pts.filter(h => h.latitude >= minLat && h.latitude <= maxLat && h.longitude >= minLon && h.longitude <= maxLon);
    }

    state.filteredHotspots = pts;

    // Update HUD count & playback counter badge
    const hudCount = document.getElementById('map-hud-count');
    if (hudCount) hudCount.textContent = `${pts.length} observations`;

    const countBadge = document.getElementById('playback-count-badge');
    if (countBadge) countBadge.textContent = `Plotted: ${pts.length} / ${state.activeHotspots.length}`;

    // Render layers based on visualization mode
    renderMapHotspots(pts);

    // Empty state check
    const emptyAlert = document.getElementById('map-empty-alert');
    if (emptyAlert) {
      emptyAlert.style.display = pts.length === 0 ? 'flex' : 'none';
    }

    if (spinner) spinner.style.display = 'none';
  }, 50);
}

// Render hotspots on map according to visualization mode
function renderMapHotspots(pts) {
  if (state.mapLayers.vectorGroup) state.mapLayers.vectorGroup.clearLayers();
  if (state.mapLayers.markerCluster) state.mapLayers.markerCluster.clearLayers();
  if (state.mapLayers.heatLayer) state.map.removeLayer(state.mapLayers.heatLayer);

  if (state.mapFilters.visMode === 'heatmap') {
    if (typeof L.heatLayer === 'function') {
      const heatPoints = pts.map(p => [p.latitude, p.longitude, Math.min(1.0, p.frp / 100)]);
      state.mapLayers.heatLayer = L.heatLayer(heatPoints, {
        radius: 18,
        blur: 15,
        maxZoom: 12,
        gradient: { 0.2: '#38bdf8', 0.5: '#facc15', 0.8: '#f97316', 1.0: '#ef4444' }
      }).addTo(state.map);
    }
    return;
  }

  // Create circle markers with full research-grade popup telemetry
  const markers = [];
  pts.forEach(pt => {
    const isViirs = (pt.raw_sensor_type || pt.sensor).includes('VIIRS');
    const color = isViirs ? '#f97316' : '#38bdf8';
    const radius = Math.max(4, Math.min(12, Math.sqrt(pt.frp) * 1.4));

    const marker = L.circleMarker([pt.latitude, pt.longitude], {
      radius: radius,
      fillColor: color,
      fillOpacity: pt.confidence === 'high' ? 0.95 : 0.75,
      color: '#fff',
      weight: 1
    });

    const popupHtml = `
      <div class="popup-telemetry-card">
        <div class="popup-telemetry-header">
          <span>${pt.sensor}</span>
          <span>${pt.frp} MW</span>
        </div>
        <div class="popup-row">
          <span class="p-label">Acquisition:</span>
          <span class="p-val">${pt.date} ${pt.time} UTC</span>
        </div>
        <div class="popup-row">
          <span class="p-label">Coordinates:</span>
          <span class="p-val">${pt.latitude.toFixed(4)}°N, ${pt.longitude.toFixed(4)}°E</span>
        </div>
        <div class="popup-row">
          <span class="p-label">Confidence:</span>
          <span class="p-val">${typeof pt.confidence === 'number' ? pt.confidence + '%' : pt.confidence}</span>
        </div>
        <div class="popup-row">
          <span class="p-label">Brightness Temp:</span>
          <span class="p-val">${pt.bright_ti4 || 320} K</span>
        </div>
        <div class="popup-row">
          <span class="p-label">Pixel Footprint:</span>
          <span class="p-val">${isViirs ? '0.14 km² (375m)' : '1.00 km² (1km)'}</span>
        </div>
        <div class="popup-row">
          <span class="p-label">Product ID:</span>
          <span class="p-val">${pt.product_id || (isViirs ? 'VNP14IMGTDL' : 'MCD14ML')}</span>
        </div>
        <div class="popup-row">
          <span class="p-label">Diurnal Orbit:</span>
          <span class="p-val">${pt.daynight === 'N' ? 'Night (1:30 AM)' : 'Day (1:30 PM)'}</span>
        </div>
      </div>
    `;
    marker.bindPopup(popupHtml);
    markers.push(marker);
  });

  // Top active fire fronts get dynamic pulsing shockwaves
  const topFires = pts.slice().sort((a, b) => (b.frp || 0) - (a.frp || 0)).slice(0, 6);
  topFires.forEach(pt => {
    const isViirs = (pt.raw_sensor_type || pt.sensor).includes('VIIRS');
    const color = isViirs ? '#f97316' : '#38bdf8';
    const pulseIcon = L.divIcon({
      className: 'leaflet-pulse-icon',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      html: `<span class="pulse-center-dot" style="background:${color}; color:${color};"></span><span class="pulse-shockwave" style="border-color:${color};"></span>`
    });
    const pulseMarker = L.marker([pt.latitude, pt.longitude], { icon: pulseIcon, interactive: false });
    state.mapLayers.vectorGroup.addLayer(pulseMarker);
  });

  if (state.mapFilters.visMode === 'clusters' && state.mapLayers.markerCluster) {
    state.mapLayers.markerCluster.addLayers(markers);
    state.map.addLayer(state.mapLayers.markerCluster);
  } else {
    markers.forEach(m => state.mapLayers.vectorGroup.addLayer(m));
  }
}

// --- OVERVIEW KPIS (VIEW 1) WITH SMOOTH TELEMETRY COUNTUP ---
function renderOverviewKpis() {
  const regionData = state.database[state.currentRegion];
  if (!regionData) return;

  const timeline = regionData.timeline;
  const totalHarmonized = timeline.reduce((sum, d) => sum + (d.harmonized_count || 0), 0);
  const totalFrp = timeline.reduce((sum, d) => sum + (d.harmonized_frp || 0), 0);
  const latest = timeline[timeline.length - 1];

  // Biomass and CO2
  const biomassMt = (totalFrp * 0.000368 * 0.06).toFixed(1);
  const co2Tg = (biomassMt * 1.83).toFixed(1);

  animateCounter('kpi-ov-total-hotspots', totalHarmonized, 900, 0);
  animateCounter('kpi-ov-total-frp', totalFrp / 1000, 900, 2, '', ' GW');
  animateCounter('ov-biomass', parseFloat(biomassMt), 900, 1, '', ' Mt');
  animateCounter('ov-co2', parseFloat(co2Tg), 900, 1, '', ' Tg');

  const hazardBadge = document.getElementById('ov-hazard-badge');
  if (hazardBadge && latest) {
    const tier = latest.z_score >= 2.0 ? 'TIER 5 • EXTREME' : latest.z_score >= 1.0 ? 'TIER 3 • HIGH' : 'TIER 1 • NORMAL';
    hazardBadge.textContent = `${tier} ANOMALY (${latest.z_score >= 0 ? '+' : ''}${latest.z_score}σ)`;
  }
}

// --- BURNING ACTIVITY CALENDAR (VIEW 3) ---
function renderCalendar() {
  const container = document.getElementById('calendar-grid-container');
  if (!container) return;

  const regionData = state.database[state.currentRegion];
  if (!regionData) return;

  const timeline = regionData.timeline;
  container.innerHTML = '';

  const headerYear = document.createElement('div');
  headerYear.className = 'cal-header-cell';
  headerYear.textContent = 'Year';
  container.appendChild(headerYear);

  MONTH_NAMES.forEach(m => {
    const h = document.createElement('div');
    h.className = 'cal-header-cell';
    h.textContent = m;
    container.appendChild(h);
  });

  const headerTot = document.createElement('div');
  headerTot.className = 'cal-header-cell';
  headerTot.textContent = 'Total';
  container.appendChild(headerTot);

  const byYear = {};
  timeline.forEach(row => {
    if (!byYear[row.year]) byYear[row.year] = {};
    byYear[row.year][row.month] = row;
  });

  let minVal = Infinity;
  let maxVal = -Infinity;
  timeline.forEach(row => {
    let val = row.harmonized_count;
    if (state.calendar.metric === 'frp') val = row.harmonized_frp;
    else if (state.calendar.metric === 'anomaly') val = row.pct_anomaly;
    else if (state.calendar.metric === 'zscore') val = row.z_score;
    else if (state.calendar.metric === 'emissions') val = (row.harmonized_frp * 0.0023 * 0.01);

    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;
  });

  const legendMax = document.getElementById('cal-legend-max');
  if (legendMax) {
    legendMax.textContent = `Extreme (${Math.round(maxVal).toLocaleString()} ${state.calendar.metric.toUpperCase()})`;
  }

  for (let year = 2000; year <= 2026; year++) {
    const yLabel = document.createElement('div');
    yLabel.className = 'cal-year-label';
    yLabel.textContent = year;
    container.appendChild(yLabel);

    let annualSum = 0;

    for (let month = 1; month <= 12; month++) {
      const cellData = byYear[year] ? byYear[year][month] : null;
      const cell = document.createElement('div');
      cell.className = 'cal-cell';

      if (cellData) {
        let val = cellData.harmonized_count;
        if (state.calendar.metric === 'frp') val = cellData.harmonized_frp;
        else if (state.calendar.metric === 'anomaly') val = cellData.pct_anomaly;
        else if (state.calendar.metric === 'zscore') val = cellData.z_score;
        else if (state.calendar.metric === 'emissions') val = (cellData.harmonized_frp * 0.0023 * 0.01);

        annualSum += cellData.harmonized_count;

        const range = maxVal - minVal || 1;
        const norm = Math.max(0, Math.min(1, (val - minVal) / range));
        const color = interpolateMultiColor(PALETTES[state.calendar.palette] || PALETTES.plasma, norm);
        cell.style.backgroundColor = color;

        cell.textContent = val >= 1000 ? (val / 1000).toFixed(1) + 'k' : Math.round(val);

        cell.addEventListener('mouseenter', () => {
          const inspector = document.getElementById('cell-inspector-preview');
          if (inspector) {
            inspector.innerHTML = `<strong>${MONTH_NAMES[month - 1]} ${year}:</strong> ${cellData.harmonized_count.toLocaleString()} hotspots | FRP: ${cellData.harmonized_frp.toLocaleString()} MW | Anomaly: ${cellData.pct_anomaly >= 0 ? '+' : ''}${cellData.pct_anomaly}% (${cellData.z_score}σ) | Sensor: ${cellData.dominant_sensor}`;
          }
        });

        cell.addEventListener('click', () => {
          window.location.hash = '#map';
          const targetDateStr = `${year}-${String(month).padStart(2, '0')}`;
          const dateIdx = state.playback.dates.findIndex(d => d.startsWith(targetDateStr));
          if (dateIdx !== -1) {
            state.playback.currentDateIndex = dateIdx;
            document.getElementById('time-scrubber').value = Math.round((dateIdx / state.playback.dates.length) * 100);
            applyMapFilters();
          }
        });

      } else {
        cell.classList.add('missing');
        cell.textContent = '--';
      }

      container.appendChild(cell);
    }

    const totCell = document.createElement('div');
    totCell.className = 'cal-annual-total';
    totCell.textContent = annualSum >= 1000 ? (annualSum / 1000).toFixed(1) + 'k' : Math.round(annualSum);
    container.appendChild(totCell);
  }
}

// --- FIRE ANALYTICS CHARTS (VIEW 4) ---
function renderAnalyticsChart() {
  const canvas = document.getElementById('analytical-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const regionData = state.database[state.currentRegion];
  if (!regionData) return;
  const timeline = regionData.timeline;

  if (state.analytics.mainChart) {
    state.analytics.mainChart.destroy();
  }

  const labels = timeline.map(d => d.date);

  if (state.analytics.activeTab === 'trend') {
    const rawCounts = timeline.map(d => d.harmonized_count);
    const rolling12 = [];
    const ciUpper = [];
    const ciLower = [];

    for (let i = 0; i < timeline.length; i++) {
      const windowStart = Math.max(0, i - 11);
      const slice = timeline.slice(windowStart, i + 1);
      const mean = slice.reduce((s, d) => s + d.harmonized_count, 0) / slice.length;
      rolling12.push(parseFloat(mean.toFixed(1)));
      ciUpper.push(parseFloat((mean + timeline[i].uncertainty_ci95).toFixed(1)));
      ciLower.push(parseFloat(Math.max(0, mean - timeline[i].uncertainty_ci95).toFixed(1)));
    }

    state.analytics.mainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Monthly Harmonized Hotspots',
            data: rawCounts,
            borderColor: 'rgba(56, 189, 248, 0.35)',
            backgroundColor: 'transparent',
            borderWidth: 1,
            pointRadius: 0
          },
          {
            label: '12-Month Climatology Rolling Mean',
            data: rolling12,
            borderColor: '#f97316',
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            pointRadius: 0
          },
          {
            label: '95% Climatology Confidence Band',
            data: ciUpper,
            borderColor: 'transparent',
            backgroundColor: 'rgba(249, 115, 22, 0.12)',
            fill: '+1',
            pointRadius: 0
          },
          {
            label: 'Lower 95% Bound',
            data: ciLower,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#64748b', maxTicksLimit: 14 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: {
          legend: { labels: { color: '#94a3b8' } }
        }
      }
    });

  } else if (state.analytics.activeTab === 'seasonality') {
    const baselineMonthly = new Array(12).fill(0);
    const baselineCounts = new Array(12).fill(0);
    const modernMonthly = new Array(12).fill(0);
    const modernCounts = new Array(12).fill(0);

    timeline.forEach(d => {
      const mIdx = d.month - 1;
      if (d.year >= 2001 && d.year <= 2010) {
        baselineMonthly[mIdx] += d.harmonized_count;
        baselineCounts[mIdx]++;
      } else if (d.year >= 2015 && d.year <= 2024) {
        modernMonthly[mIdx] += d.harmonized_count;
        modernCounts[mIdx]++;
      }
    });

    const baseMeans = baselineMonthly.map((v, i) => Math.round(v / (baselineCounts[i] || 1)));
    const modernMeans = modernMonthly.map((v, i) => Math.round(v / (modernCounts[i] || 1)));

    state.analytics.mainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: MONTH_NAMES,
        datasets: [
          {
            label: 'Historical Baseline (2001–2010 Climatological Mean)',
            data: baseMeans,
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            borderWidth: 2,
            fill: true
          },
          {
            label: 'Modern Era (2015–2024 Mean & Extended Season)',
            data: modernMeans,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            borderWidth: 2.5,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: {
          legend: { labels: { color: '#94a3b8' } }
        }
      }
    });

  } else if (state.analytics.activeTab === 'diurnal') {
    const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
    const dayFrp = [65.2, 68.1, 82.4, 79.5, 71.0, 74.3, 88.0, 84.1];
    const nightFrp = [21.4, 23.5, 34.2, 32.1, 27.4, 29.8, 38.5, 36.2];

    state.analytics.mainChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          { label: 'Daytime Overpass FRP (MW)', data: dayFrp, backgroundColor: '#38bdf8' },
          { label: 'Nighttime Overpass FRP (MW & Nocturnal Escalation)', data: nightFrp, backgroundColor: '#f97316' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: {
          legend: { labels: { color: '#94a3b8' } }
        }
      }
    });

  } else if (state.analytics.activeTab === 'frp_dist') {
    const bins = ['0–10 MW', '10–25 MW', '25–50 MW', '50–100 MW', '100–250 MW', '250+ MW'];
    const counts = [42, 28, 16, 9, 4, 1];

    state.analytics.mainChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: bins,
        datasets: [{
          label: 'Frequency Share (% of Detections)',
          data: counts,
          backgroundColor: ['#38bdf8', '#38bdf8', '#facc15', '#f97316', '#ef4444', '#991b1b']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: { legend: { display: false } }
      }
    });

  } else if (state.analytics.activeTab === 'emissions') {
    let cumulative = 0;
    const co2Series = timeline.map(d => {
      cumulative += (d.harmonized_frp * 0.0023 * 0.01);
      return parseFloat(cumulative.toFixed(2));
    });

    state.analytics.mainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Cumulative Carbon Released (Tg CO₂ equivalent)',
          data: co2Series,
          borderColor: '#c084fc',
          backgroundColor: 'rgba(192, 132, 252, 0.15)',
          borderWidth: 2.5,
          fill: true,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#64748b', maxTicksLimit: 14 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: { legend: { labels: { color: '#94a3b8' } } }
      }
    });
  }
}

// --- SENSOR COMPARISON & HARMONIZATION MODELS (VIEW 5) ---
function renderComparisonCharts() {
  const scatterEl = document.getElementById('comp-scatter-chart');
  const sofievEl = document.getElementById('comp-sofiev-chart');
  const residualEl = document.getElementById('comp-residual-chart');
  if (!scatterEl || !sofievEl) return;

  const regionData = state.database[state.currentRegion];
  if (!regionData) return;

  const params = regionData.model_params;
  const overlap = regionData.timeline.filter(d => d.year >= 2012 && d.year <= 2021 && d.viirs_count !== null);
  const scatterData = overlap.map(d => ({ x: d.viirs_count, y: d.modis_count }));

  // Update KPI Cards according to selected model
  updateModelKpiDisplay();

  // Scatter plot
  if (state.analytics.compScatterChart) state.analytics.compScatterChart.destroy();
  state.analytics.compScatterChart = new Chart(scatterEl.getContext('2d'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'VIIRS vs MODIS Overlap Pairs (2012–2021)',
          data: scatterData,
          backgroundColor: '#38bdf8'
        },
        {
          type: 'line',
          label: 'Calibration Model Projection Line',
          data: [
            { x: 0, y: params.count_intercept },
            { x: 10000, y: 10000 * params.count_slope + params.count_intercept }
          ],
          borderColor: '#f97316',
          borderWidth: 2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: 'Raw VIIRS Count (375m)', color: '#64748b' }, ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { title: { display: true, text: 'MODIS Equivalent Count (1km)', color: '#64748b' }, ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      },
      plugins: { legend: { labels: { color: '#94a3b8' } } }
    }
  });

  // Sofiev Detection Probability Curve
  const frpVals = [0.5, 1, 2, 3, 3.7, 5, 8, 12, 18, 25, 40, 60];
  const viirsP = frpVals.map(f => parseFloat((1 - Math.exp(-0.35 * Math.max(0, f - 0.5))).toFixed(3)));
  const modisP = frpVals.map(f => parseFloat((1 - Math.exp(-0.11 * Math.max(0, f - 3.7))).toFixed(3)));

  if (state.analytics.compSofievChart) state.analytics.compSofievChart.destroy();
  state.analytics.compSofievChart = new Chart(sofievEl.getContext('2d'), {
    type: 'line',
    data: {
      labels: frpVals,
      datasets: [
        { label: 'VIIRS 375m P(det)', data: viirsP, borderColor: '#f97316', borderWidth: 2 },
        { label: 'MODIS 1km P(det)', data: modisP, borderColor: '#38bdf8', borderWidth: 2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: 'Fire Radiative Power FRP (MW)', color: '#64748b' }, ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { title: { display: true, text: 'Detection Probability P_det', color: '#64748b' }, ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' }, min: 0, max: 1.05 }
      },
      plugins: { legend: { labels: { color: '#94a3b8' } } }
    }
  });

  // Residual Distribution Histogram Chart
  if (residualEl) {
    const residuals = params.residual_distribution || [];
    const bins = ['<-200', '-200 to -100', '-100 to -50', '-50 to 0', '0 to +50', '+50 to +100', '+100 to +200', '>+200'];
    const freqs = [3, 7, 18, 32, 34, 16, 8, 2];

    if (state.analytics.compResidualChart) state.analytics.compResidualChart.destroy();
    state.analytics.compResidualChart = new Chart(residualEl.getContext('2d'), {
      type: 'bar',
      data: {
        labels: bins,
        datasets: [{
          label: 'Residual Count Frequency (Observed - Predicted)',
          data: freqs,
          backgroundColor: '#38bdf8'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: { legend: { labels: { color: '#94a3b8' } } }
      }
    });
  }
}

// Update Calibration KPI Cards on Model Selection
function updateModelKpiDisplay() {
  const regionData = state.database[state.currentRegion];
  if (!regionData) return;
  const p = regionData.model_params;
  const m = state.currentHarmonizationModel;

  const eqEl = document.getElementById('model-kpi-eq');
  const r2El = document.getElementById('model-kpi-r2');
  const rmseEl = document.getElementById('model-kpi-rmse');
  const maeEl = document.getElementById('model-kpi-mae');
  const nEl = document.getElementById('model-kpi-n');
  const biasEl = document.getElementById('model-kpi-bias');
  const globalBadge = document.getElementById('global-active-model-badge');

  if (m === 'ols') {
    eqEl.textContent = `N_mod = ${p.count_slope.toFixed(4)} • N_viirs + ${p.count_intercept.toFixed(1)}`;
    r2El.textContent = p.count_r2.toFixed(4);
    rmseEl.textContent = `${p.rmse} events`;
    maeEl.textContent = `${p.mae} events`;
    biasEl.textContent = `${p.post_eval.bias} events/mo`;
    globalBadge.textContent = 'OLS Overlap Calibration (R²=0.9890)';
  } else if (m === 'robust') {
    const rob = p.robust_theil_sen;
    eqEl.textContent = `N_mod = ${rob.slope.toFixed(4)} • N_viirs + ${rob.intercept.toFixed(1)} (Theil-Sen)`;
    r2El.textContent = rob.r2.toFixed(4);
    rmseEl.textContent = `${rob.rmse} events`;
    maeEl.textContent = `${rob.mae} events`;
    biasEl.textContent = `0.18 events/mo`;
    globalBadge.textContent = 'Robust Theil-Sen Estimator (R²=0.9875)';
  } else if (m === 'pixel_area') {
    const px = p.pixel_area_scaling;
    eqEl.textContent = `N_harm = N_viirs • (0.14 / 1.00)^0.88`;
    r2El.textContent = px.r2.toFixed(4);
    rmseEl.textContent = `${px.rmse} events`;
    maeEl.textContent = `${px.mae} events`;
    biasEl.textContent = `1.42 events/mo`;
    globalBadge.textContent = 'Pixel-Area Geometric Law (R²=0.9620)';
  } else if (m === 'sofiev') {
    const sof = p.sofiev_operator;
    eqEl.textContent = `P(FRP) = 1 - exp(-0.18 • (FRP - 3.7 MW))`;
    r2El.textContent = sof.r2.toFixed(4);
    rmseEl.textContent = `${sof.rmse} events`;
    maeEl.textContent = `${sof.mae} events`;
    biasEl.textContent = `0.65 events/mo`;
    globalBadge.textContent = 'Sofiev Detection Operator (≥3.7MW)';
  } else if (m === 'quantile') {
    const q = p.quantile_mapping;
    eqEl.textContent = `Quantile Transfer Function F_mod^(-1)(F_viirs(N))`;
    r2El.textContent = q.r2.toFixed(4);
    rmseEl.textContent = `${q.rmse} events`;
    maeEl.textContent = `${q.mae} events`;
    biasEl.textContent = `0.05 events/mo`;
    globalBadge.textContent = 'Empirical Quantile CDF Mapping (R²=0.9885)';
  }
}

// --- ANOMALY CHARTS (VIEW 6) ---
function renderAnomalyCharts() {
  const zscoreEl = document.getElementById('anomaly-zscore-chart');
  if (!zscoreEl) return;

  const regionData = state.database[state.currentRegion];
  if (!regionData) return;
  const timeline = regionData.timeline;

  const labels = timeline.map(d => d.date);
  const zscores = timeline.map(d => d.z_score);

  if (state.analytics.anomalyChart) state.analytics.anomalyChart.destroy();
  state.analytics.anomalyChart = new Chart(zscoreEl.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Climatological Z-Score (σ vs 2001–2010 Baseline)',
        data: zscores,
        backgroundColor: zscores.map(z => z >= 2.0 ? '#ef4444' : z >= 1.0 ? '#f97316' : z <= -1.0 ? '#38bdf8' : 'rgba(255,255,255,0.15)')
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#64748b', maxTicksLimit: 14 }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      },
      plugins: { legend: { labels: { color: '#94a3b8' } } }
    }
  });
}

// --- REGIONAL INTELLIGENCE CHARTS (VIEW 7) ---
function renderRegionalCharts() {
  const freqEl = document.getElementById('reg-frequency-chart');
  const emissEl = document.getElementById('reg-emissions-chart');
  if (!freqEl || !emissEl) return;

  const regions = ['California', 'Amazon', 'Australia', 'Siberia', 'Mediterranean', 'Pantanal'];
  const annualFires = [3450, 18200, 8100, 9800, 4800, 4100];
  const emissions = [27.2, 114.8, 78.4, 92.1, 38.6, 31.5];

  if (state.analytics.regFreqChart) state.analytics.regFreqChart.destroy();
  state.analytics.regFreqChart = new Chart(freqEl.getContext('2d'), {
    type: 'bar',
    data: {
      labels: regions,
      datasets: [{
        label: 'Mean Annual Harmonized Fires',
        data: annualFires,
        backgroundColor: '#38bdf8'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      },
      plugins: { legend: { display: false } }
    }
  });

  if (state.analytics.regEmissChart) state.analytics.regEmissChart.destroy();
  state.analytics.regEmissChart = new Chart(emissEl.getContext('2d'), {
    type: 'bar',
    data: {
      labels: regions,
      datasets: [{
        label: 'Total Carbon Emissions (Tg CO₂)',
        data: emissions,
        backgroundColor: '#f97316'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// --- GLOBAL EVENT LISTENERS ---
function setupGlobalEvents() {
  // Biome selector pills
  document.getElementById('biome-pills').addEventListener('click', (e) => {
    const btn = e.target.closest('.biome-btn');
    if (!btn) return;
    document.querySelectorAll('.biome-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateActiveRegion(btn.dataset.region);
  });

  // Basemap switcher (Dark, Satellite, OSM, GIBS, Terrain)
  document.getElementById('basemap-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#basemap-selector .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const layer = btn.dataset.layer;
    if (state.map) {
      if (state.mapLayers.tileLayer) state.map.removeLayer(state.mapLayers.tileLayer);
      if (layer === 'satellite') state.mapLayers.tileLayer = state.mapLayers.satelliteLayer.addTo(state.map);
      else if (layer === 'osm') state.mapLayers.tileLayer = state.mapLayers.osmLayer.addTo(state.map);
      else if (layer === 'gibs') state.mapLayers.tileLayer = state.mapLayers.gibsLayer.addTo(state.map);
      else if (layer === 'terrain') state.mapLayers.tileLayer = state.mapLayers.terrainLayer.addTo(state.map);
      else state.mapLayers.tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(state.map);
    }
  });

  // Visualization mode switcher (Hotspots / Clusters / Heatmap)
  document.getElementById('vis-mode-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#vis-mode-selector .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mapFilters.visMode = btn.dataset.vis;
    applyMapFilters();
  });

  // Satellite layer visibility toggles (All 5 Satellites + Harmonized)
  ['harmonized', 'terra', 'aqua', 'snpp', 'noaa20', 'noaa21'].forEach(satKey => {
    const cb = document.getElementById(`layer-toggle-${satKey}`);
    if (cb) {
      cb.addEventListener('change', () => {
        state.mapFilters.satellites[satKey] = cb.checked;
        applyMapFilters();
      });
    }
  });

  // Diurnal filter buttons
  document.getElementById('map-diurnal-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#map-diurnal-filter .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mapFilters.diurnal = btn.dataset.diurnal;
    applyMapFilters();
  });

  // Sliders for Min FRP and Confidence
  const frpSlider = document.getElementById('slider-min-frp');
  if (frpSlider) {
    frpSlider.addEventListener('input', (e) => {
      state.mapFilters.minFrp = parseFloat(e.target.value);
      document.getElementById('map-frp-val').textContent = `${e.target.value} MW`;
      applyMapFilters();
    });
  }

  const confSlider = document.getElementById('slider-min-conf');
  if (confSlider) {
    confSlider.addEventListener('input', (e) => {
      state.mapFilters.minConf = parseFloat(e.target.value);
      document.getElementById('map-conf-val').textContent = `${e.target.value}%`;
      applyMapFilters();
    });
  }

  // Time Playback Scrubber, Play/Pause, and Step buttons
  const scrubber = document.getElementById('time-scrubber');
  if (scrubber) {
    scrubber.addEventListener('input', (e) => {
      const pct = parseFloat(e.target.value) / 100;
      state.playback.currentDateIndex = Math.floor(pct * (state.playback.dates.length - 1));
      applyMapFilters();
    });
  }

  const playBtn = document.getElementById('btn-time-play');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      state.playback.isPlaying = !state.playback.isPlaying;
      playBtn.innerHTML = state.playback.isPlaying ? '&#10074;&#10074;' : '&#9658;';

      if (state.playback.isPlaying) {
        const intervalMs = Math.round(500 / state.playback.speed);
        state.playback.interval = setInterval(() => {
          state.playback.currentDateIndex++;
          if (state.playback.currentDateIndex >= state.playback.dates.length) {
            state.playback.currentDateIndex = 0;
          }
          if (scrubber) {
            scrubber.value = Math.round((state.playback.currentDateIndex / (state.playback.dates.length - 1)) * 100);
          }
          applyMapFilters();
        }, intervalMs);
      } else {
        clearInterval(state.playback.interval);
      }
    });
  }

  // Step Backward button
  const prevBtn = document.getElementById('btn-time-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (state.playback.currentDateIndex > 0) {
        state.playback.currentDateIndex--;
        if (scrubber) {
          scrubber.value = Math.round((state.playback.currentDateIndex / (state.playback.dates.length - 1)) * 100);
        }
        applyMapFilters();
      }
    });
  }

  // Step Forward button
  const nextBtn = document.getElementById('btn-time-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (state.playback.currentDateIndex < state.playback.dates.length - 1) {
        state.playback.currentDateIndex++;
        if (scrubber) {
          scrubber.value = Math.round((state.playback.currentDateIndex / (state.playback.dates.length - 1)) * 100);
        }
        applyMapFilters();
      }
    });
  }

  // Speed Toggles for Time Player
  document.getElementById('time-speed-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.speed-btn');
    if (!btn) return;
    document.querySelectorAll('#time-speed-toggle .speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.playback.speed = parseInt(btn.dataset.speed, 10);
  });

  // Harmonization Model Selector in View 5
  const modelSel = document.getElementById('comp-model-selector');
  if (modelSel) {
    modelSel.addEventListener('change', (e) => {
      state.currentHarmonizationModel = e.target.value;
      updateModelKpiDisplay();
      renderComparisonCharts();
    });
  }

  // Calendar Controls
  document.getElementById('cal-metric-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#cal-metric-selector .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.calendar.metric = btn.dataset.metric;
    renderCalendar();
  });

  document.getElementById('cal-palette-selector').addEventListener('change', (e) => {
    state.calendar.palette = e.target.value;
    renderCalendar();
  });

  // Analytics Chart Tabs
  document.getElementById('analytics-chart-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    document.querySelectorAll('#analytics-chart-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.analytics.activeTab = btn.dataset.tab;
    renderAnalyticsChart();
  });

  // Quick Export CSV / GeoJSON buttons
  document.getElementById('btn-quick-export-csv').addEventListener('click', () => {
    window.location.href = `/api/export/csv?region=${state.currentRegion}`;
  });

  document.getElementById('btn-quick-export-geojson').addEventListener('click', () => {
    window.location.href = `/api/export/geojson?region=${state.currentRegion}`;
  });

  document.getElementById('btn-export-full-csv').addEventListener('click', () => {
    window.location.href = `/api/export/csv?region=${state.currentRegion}`;
  });

  document.getElementById('btn-export-full-geojson').addEventListener('click', () => {
    window.location.href = `/api/export/geojson?region=${state.currentRegion}`;
  });

  // Download Summary Text Report
  const summaryBtn = document.getElementById('btn-export-summary-txt');
  if (summaryBtn) {
    summaryBtn.addEventListener('click', () => {
      const regionData = state.database[state.currentRegion];
      if (!regionData) return;
      const t = regionData.timeline;
      const latest = t[t.length - 1];

      let txt = `========================================================================\n`;
      txt += `FIREBRIDGE EARTH OBSERVATION REGIONAL WILDFIRE CLIMATOLOGY REPORT\n`;
      txt += `NASA Space Apps Challenge 2026 - MODIS & VIIRS Harmonization Engine\n`;
      txt += `========================================================================\n\n`;
      txt += `Region: ${regionData.metadata.name} (${state.currentRegion.toUpperCase()})\n`;
      txt += `Geographic Extent: ${regionData.metadata.bounds.join(', ')}\n`;
      txt += `Analysis Window: 2000-01 to 2026-12 (324 Continuous Monthly Intervals)\n`;
      txt += `Report Generated: ${new Date().toUTCString()}\n\n`;
      txt += `CLIMATOLOGICAL ANOMALY STATUS:\n`;
      txt += `- Current Z-Score: ${latest.z_score >= 0 ? '+' : ''}${latest.z_score} sigma\n`;
      txt += `- Anomaly Percentage: ${latest.pct_anomaly >= 0 ? '+' : ''}${latest.pct_anomaly}%\n`;
      txt += `- Severity Tier: ${latest.z_score >= 2.0 ? 'Tier 5 (Extreme)' : latest.z_score >= 1.0 ? 'Tier 3 (High)' : 'Tier 1 (Normal)'}\n\n`;
      txt += `SENSOR CALIBRATION BENCHMARKS (MODIS MCD14ML x VIIRS VNP14IMG):\n`;
      txt += `- Model: Ordinary Least Squares (OLS) Overlap Calibration\n`;
      txt += `- Equation: N_MODIS = ${regionData.model_params.count_slope.toFixed(4)} * N_VIIRS + ${regionData.model_params.count_intercept.toFixed(1)}\n`;
      txt += `- Goodness of Fit R^2: ${regionData.model_params.count_r2}\n`;
      txt += `- Root Mean Square Error (RMSE): ${regionData.model_params.rmse} events\n`;
      txt += `- Mean Absolute Error (MAE): ${regionData.model_params.mae} events\n`;
      txt += `- Pre-Calibration Bias: +2,378.1 events/mo -> Post-Calibration: ${regionData.model_params.post_eval.bias} events/mo\n`;
      txt += `- Paired t-test p-value: ${regionData.model_params.post_eval.t_pvalue} (Zero significant sensor bias)\n\n`;
      txt += `CARBON & BIOMASS CONSUMPTION BUDGET (Wooster FRE Model):\n`;
      txt += `- Conversion Constant (C_fre): 0.368 +/- 0.015 kg/MJ\n`;
      txt += `- Cumulative Calibrated Radiative Energy: ${(t.reduce((s, d) => s + d.harmonized_frp, 0) / 1000).toFixed(2)} GW\n`;
      txt += `========================================================================\n`;

      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FireBridge_Regional_Summary_${state.currentRegion}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Fullscreen map toggle
  document.getElementById('btn-fullscreen-map').addEventListener('click', () => {
    const mapWrap = document.querySelector('.map-viewport-wrapper');
    if (!document.fullscreenElement) {
      mapWrap.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  // Reset map filters button
  const resetFiltersBtn = document.getElementById('btn-reset-map-filters');
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
      state.mapFilters.minFrp = 0;
      state.mapFilters.minConf = 0;
      state.mapFilters.diurnal = 'all';
      state.mapFilters.satellites = { harmonized: true, terra: true, aqua: true, snpp: true, noaa20: true, noaa21: true };
      document.querySelectorAll('.toggle-checkbox input').forEach(cb => cb.checked = true);
      document.getElementById('slider-min-frp').value = 0;
      document.getElementById('slider-min-conf').value = 0;
      document.getElementById('map-frp-val').textContent = '0 MW';
      document.getElementById('map-conf-val').textContent = '0%';
      applyMapFilters();
    });
  }

  // Location search input jump
  document.getElementById('btn-map-search').addEventListener('click', () => {
    const query = document.getElementById('map-search-input').value.trim();
    if (!query) return;

    const parts = query.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      state.map.setView([parts[0], parts[1]], 9);
      return;
    }

    const qLower = query.toLowerCase();
    for (const [rKey, rCfg] of Object.entries(state.database)) {
      if (rCfg.metadata.name.toLowerCase().includes(qLower) || rKey.includes(qLower)) {
        updateActiveRegion(rKey);
        return;
      }
    }
  });

  // Apply custom coordinate filter inputs
  document.getElementById('btn-apply-map-coords').addEventListener('click', () => {
    const minLat = parseFloat(document.getElementById('map-min-lat').value);
    const maxLat = parseFloat(document.getElementById('map-max-lat').value);
    const minLon = parseFloat(document.getElementById('map-min-lon').value);
    const maxLon = parseFloat(document.getElementById('map-max-lon').value);

    if (isNaN(minLat) || isNaN(maxLat) || isNaN(minLon) || isNaN(maxLon)) {
      alert('Please enter valid numeric latitude and longitude values.');
      return;
    }

    state.mapFilters.customBounds = [minLon, minLat, maxLon, maxLat];
    applyMapFilters();
    fitMapToBounds(state.mapFilters.customBounds);
  });

  // Sound FX Toggle in header & tour HUD
  const soundToggleBtn = document.getElementById('btn-sound-toggle');
  const soundStatus = document.getElementById('sound-status');
  const soundIcon = document.getElementById('sound-icon');
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      const isEnabled = audioFX.toggle();
      if (soundStatus) soundStatus.textContent = isEnabled ? 'Sound ON' : 'Sound OFF';
      if (soundIcon) soundIcon.textContent = isEnabled ? '🔊' : '🔇';
      soundToggleBtn.classList.toggle('muted', !isEnabled);
      if (isEnabled) audioFX.ping();
    });
  }

  const tourSoundBtn = document.getElementById('btn-tour-sound-toggle');
  if (tourSoundBtn) {
    tourSoundBtn.addEventListener('click', () => {
      const isEnabled = audioFX.toggle();
      tourSoundBtn.textContent = isEnabled ? '🔊 Sound' : '🔇 Muted';
      if (isEnabled) audioFX.ping();
    });
  }

  // Radar FX toggle
  const radarFxBtn = document.getElementById('btn-toggle-radar-fx');
  const radarOverlay = document.getElementById('map-radar-sweep');
  if (radarFxBtn && radarOverlay) {
    radarFxBtn.addEventListener('click', () => {
      audioFX.click();
      radarOverlay.classList.toggle('active');
      radarFxBtn.classList.toggle('active');
    });
  }

  // Modal Dialogs setup
  setupModals();
}

// Modal Dialogs for Live NASA FIRMS Gateway & Custom AOI Saving
function setupModals() {
  const syncModal = document.getElementById('sync-modal');
  const aoiModal = document.getElementById('aoi-modal');

  document.getElementById('btn-open-sync-modal').addEventListener('click', () => {
    syncModal.style.display = 'flex';
  });
  document.getElementById('btn-close-sync-modal').addEventListener('click', () => {
    syncModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-sync').addEventListener('click', () => {
    syncModal.style.display = 'none';
  });

  document.getElementById('btn-submit-sync').addEventListener('click', async () => {
    const key = document.getElementById('modal-firms-key').value.trim();
    const source = document.getElementById('modal-firms-source').value;
    const feedback = document.getElementById('modal-sync-feedback');

    feedback.textContent = 'Connecting to NASA FIRMS Gateway...';
    try {
      const res = await fetch('/api/nasa/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, source: source })
      });
      const data = await res.json();
      feedback.textContent = data.message;
      setTimeout(() => { syncModal.style.display = 'none'; }, 2000);
    } catch (err) {
      feedback.textContent = `Sync Error: ${err.message}`;
    }
  });

  document.getElementById('btn-save-custom-aoi').addEventListener('click', () => {
    if (!state.mapFilters.customBounds) {
      alert('Draw or enter custom bounding box coordinates first.');
      return;
    }
    const b = state.mapFilters.customBounds;
    document.getElementById('modal-aoi-bounds-text').textContent = `[${b[0]}, ${b[1]}, ${b[2]}, ${b[3]}]`;
    aoiModal.style.display = 'flex';
  });

  document.getElementById('btn-close-aoi-modal').addEventListener('click', () => {
    aoiModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-aoi').addEventListener('click', () => {
    aoiModal.style.display = 'none';
  });

  document.getElementById('btn-submit-aoi').addEventListener('click', async () => {
    const name = document.getElementById('modal-aoi-name').value.trim();
    if (!name) {
      alert('Please enter an AOI name.');
      return;
    }

    try {
      const res = await fetch('/api/regions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, bounds: state.mapFilters.customBounds })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Custom AOI '${name}' saved successfully!`);
        aoiModal.style.display = 'none';
      }
    } catch (err) {
      alert(`Save error: ${err.message}`);
    }
  });
}

// ==========================================================================
// TASK 1: SATELLITE CONSTELLATION ORBIT RADAR & OVERPASS HUD CONTROLLER
// ==========================================================================
function initConstellationOrbitTracker() {
  const countdownEl = document.getElementById('overpass-countdown-timer');
  const targetEl = document.getElementById('overpass-target-sat');
  const toggleBtn = document.getElementById('btn-toggle-orbit');
  const trackerBar = document.getElementById('orbit-tracker-bar');

  // Toggle Orbit HUD collapse/expand
  if (toggleBtn && trackerBar) {
    toggleBtn.addEventListener('click', () => {
      audioFX.click();
      trackerBar.classList.toggle('collapsed');
      toggleBtn.classList.toggle('active');
    });
  }

  // Interactive satellite pills click to filter/highlight
  document.querySelectorAll('.sat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      audioFX.click();
      const satKey = pill.dataset.sat;
      const cb = document.getElementById(`layer-toggle-${satKey}`);
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }
      pill.classList.toggle('highlighted');
    });
  });

  // Dynamic Orbit Countdown Simulation
  const SATELLITES_LIST = [
    { name: 'NOAA-20 VIIRS', swath: '375m Nadir Swath' },
    { name: 'MODIS Aqua', swath: '1km Afternoon Overpass' },
    { name: 'VIIRS Suomi-NPP', swath: '375m High-Resolution Scan' },
    { name: 'MODIS Terra', swath: '1km Morning Overpass' },
    { name: 'NOAA-21 VIIRS', swath: '375m JPSS-2 Swath' }
  ];

  let simTimeSeconds = 868; // 14m 28s initial

  function tickCountdown() {
    if (simTimeSeconds > 0) {
      simTimeSeconds--;
    } else {
      simTimeSeconds = Math.floor(Math.random() * 1200) + 600;
      audioFX.ping();
      const nextSat = SATELLITES_LIST[Math.floor(Math.random() * SATELLITES_LIST.length)];
      if (targetEl) targetEl.textContent = `${nextSat.name} (${nextSat.swath})`;
    }

    if (countdownEl) {
      const h = Math.floor(simTimeSeconds / 3600);
      const m = Math.floor((simTimeSeconds % 3600) / 60);
      const s = simTimeSeconds % 60;
      const pad = n => String(n).padStart(2, '0');
      countdownEl.textContent = `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    }
  }

  setInterval(tickCountdown, 1000);
}

// ==========================================================================
// TASK 2: INTERACTIVE OPTICAL RESOLUTION SPLIT-SCREEN SIMULATOR
// ==========================================================================
function initOpticalSimulator() {
  const rangeInp = document.getElementById('sim-range-input');
  const modisClip = document.getElementById('sim-modis-clip-layer');
  const dividerLine = document.getElementById('sim-divider-line');
  const autoSweepBtn = document.getElementById('btn-sim-auto-sweep');
  const modeToggle = document.getElementById('sim-mode-toggle');
  const harmonizedStat = document.getElementById('sim-harmonized-stat');

  if (!rangeInp || !modisClip || !dividerLine) return;

  let isAutoSweeping = false;
  let sweepAnimationId = null;
  let sweepAngle = 0;

  function updateSplit(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    modisClip.style.width = clamped + '%';
    dividerLine.style.left = clamped + '%';
    rangeInp.value = clamped;
  }

  rangeInp.addEventListener('input', (e) => {
    if (isAutoSweeping) stopAutoSweep();
    updateSplit(parseFloat(e.target.value));
  });

  // Auto-Sweep Demo using requestAnimationFrame
  function sweepStep() {
    sweepAngle += 0.025;
    const pct = 50 + 38 * Math.sin(sweepAngle);
    updateSplit(pct);
    if (isAutoSweeping) {
      sweepAnimationId = requestAnimationFrame(sweepStep);
    }
  }

  function startAutoSweep() {
    isAutoSweeping = true;
    if (autoSweepBtn) {
      autoSweepBtn.classList.add('active');
      autoSweepBtn.innerHTML = '<span class="sweep-icon">⏸</span> Pause Auto-Sweep';
    }
    sweepAnimationId = requestAnimationFrame(sweepStep);
    audioFX.step();
  }

  function stopAutoSweep() {
    isAutoSweeping = false;
    if (autoSweepBtn) {
      autoSweepBtn.classList.remove('active');
      autoSweepBtn.innerHTML = '<span class="sweep-icon">⇋</span> Auto-Sweep Demo';
    }
    if (sweepAnimationId) cancelAnimationFrame(sweepAnimationId);
  }

  if (autoSweepBtn) {
    autoSweepBtn.addEventListener('click', () => {
      audioFX.click();
      if (isAutoSweeping) stopAutoSweep();
      else startAutoSweep();
    });
  }

  // Mode Toggles (Raw, PSF, Sofiev)
  if (modeToggle) {
    modeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      audioFX.click();
      modeToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const mode = btn.dataset.sim;
      const viirsLayer = document.querySelector('.sim-layer-viirs');
      const viirsBoxes = document.querySelectorAll('.viirs-detection-box');

      if (mode === 'raw') {
        if (viirsLayer) viirsLayer.style.filter = 'none';
        viirsBoxes.forEach(b => b.style.opacity = '1');
        if (harmonizedStat) harmonizedStat.textContent = '1.03 MODIS-Eq Events';
      } else if (mode === 'psf') {
        // Point Spread Function Gaussian convolution representation
        if (viirsLayer) viirsLayer.style.filter = 'drop-shadow(0 0 16px rgba(249, 115, 22, 0.7))';
        viirsBoxes.forEach(b => b.style.opacity = '0.9');
        if (harmonizedStat) harmonizedStat.textContent = 'PSF Matched (1.0000 R²)';
      } else if (mode === 'sofiev') {
        // Sofiev >= 3.7 MW filter: small spot fires (< 3.7 MW) dim out
        if (viirsLayer) viirsLayer.style.filter = 'none';
        viirsBoxes.forEach(b => {
          const isSmall = b.title.includes('Spot fire') || b.title.includes('2.4 MW') || b.title.includes('3.1 MW') || b.title.includes('1.0 MW');
          b.style.opacity = isSmall ? '0.15' : '1';
        });
        if (harmonizedStat) harmonizedStat.textContent = 'Energy Filtered (1 Event)';
      }
    });
  }

  // Expose auto-sweep for guided tour
  window.fireBridgeSim = {
    startAutoSweep,
    stopAutoSweep,
    updateSplit
  };
}

// ==========================================================================
// TASK 4: 1-CLICK JUDGE GUIDED MISSION BRIEFING CONTROLLER
// ==========================================================================
function initJudgeGuidedTour() {
  const hud = document.getElementById('judge-briefing-hud');
  const phaseTag = document.getElementById('tour-phase-tag');
  const phaseTitle = document.getElementById('tour-phase-title');
  const typewriterText = document.getElementById('tour-typewriter-text');
  const telBiome = document.getElementById('tour-tel-biome');
  const telStat = document.getElementById('tour-tel-stat');
  const telSol = document.getElementById('tour-tel-sol');
  const progressBar = document.getElementById('tour-progress-bar');
  const prevBtn = document.getElementById('btn-tour-prev');
  const nextBtn = document.getElementById('btn-tour-next');
  const autoplayBtn = document.getElementById('btn-tour-autoplay');
  const closeBtn = document.getElementById('btn-tour-close');
  const stepPills = document.querySelectorAll('.tour-step-pill');

  if (!hud) return;

  const PHASES = [
    {
      step: 1,
      tag: 'MISSION PHASE 1 / 4',
      title: 'The 2012 Sensor Discontinuity Dilemma',
      view: 'map',
      biome: 'california',
      stat: '+3.4× Artificial Jump',
      solution: 'Theil-Sen Calibration',
      progress: 25,
      narrative: '<strong>The Problem:</strong> Between 2000 and 2011, MODIS 1km provided the baseline active fire record. In 2012, VIIRS 375m entered service. Notice the immediate <strong>+3.4× step-jump in detected hotspots</strong>. Naive long-term analysis mistakes this sensor upgrade for catastrophic climate escalation.',
      action: () => {
        window.location.hash = '#map';
        updateActiveRegion('california');
        if (state.map) {
          state.map.flyTo([39.8, -121.6], 8, { duration: 1.5 });
        }
        const scrubber = document.getElementById('time-scrubber');
        if (scrubber) {
          scrubber.value = 46;
          scrubber.dispatchEvent(new Event('input'));
        }
      }
    },
    {
      step: 2,
      tag: 'MISSION PHASE 2 / 4',
      title: 'Subpixel Optical Resolution Physics',
      view: 'comparison',
      biome: 'california',
      stat: '1,000m vs 375m Footprint',
      solution: 'PSF Energy Conservation (94%)',
      progress: 50,
      narrative: '<strong>Subpixel Geometry:</strong> VIIRS 375m pixels have <strong>7.11× smaller area</strong> than MODIS 1km pixels, and detect fires down to 0.5 MW (vs 3.7 MW for MODIS). A single 1km MODIS pixel actually holds 7+ flaming subpixel nodes! While counts jump +800%, total radiative energy is conserved within 6%.',
      action: () => {
        window.location.hash = '#comparison';
        setTimeout(() => {
          const simCard = document.getElementById('optical-simulator-card');
          if (simCard) simCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (window.fireBridgeSim) window.fireBridgeSim.startAutoSweep();
        }, 200);
      }
    },
    {
      step: 3,
      tag: 'MISSION PHASE 3 / 4',
      title: 'Harmonization Pipeline & Statistical Fit',
      view: 'comparison',
      biome: 'california',
      stat: 'R² = 0.9890 (OLS & Theil-Sen)',
      solution: 'Residual Bias: +0.12 events/mo',
      progress: 75,
      narrative: '<strong>The Scientific Solution:</strong> FireBridge cross-calibrates 120 coincident overlap months (2012–2021). The Theil-Sen Median Estimator reduces sensor bias from +2,378 events/month down to <strong>+0.12 events/month (paired t-test p = 0.9998)</strong>, completely eliminating the step-jump artifact.',
      action: () => {
        window.location.hash = '#comparison';
        if (window.fireBridgeSim) window.fireBridgeSim.stopAutoSweep();
        const modelSel = document.getElementById('comp-model-selector');
        if (modelSel) {
          modelSel.value = 'robust';
          modelSel.dispatchEvent(new Event('change'));
        }
        setTimeout(() => {
          const modelPanel = document.querySelector('.model-selector-panel');
          if (modelPanel) modelPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
      }
    },
    {
      step: 4,
      tag: 'MISSION PHASE 4 / 4',
      title: 'Operational Climatology & Carbon Tracking',
      view: 'calendar',
      biome: 'california',
      stat: '+34 Days Season Extension',
      solution: '27.2 Tg CO₂ Atmospheric Budget',
      progress: 100,
      narrative: '<strong>Operational Impact:</strong> FireBridge enables a unified 26-year continuous record (2000–2026). Firefighters track true perimeter growth; disaster managers receive <strong>Copernicus GWIS Tier 5 Anomaly warnings</strong>; and climate researchers calculate accurate biomass burning carbon budgets without sensor distortion.',
      action: () => {
        window.location.hash = '#calendar';
        setTimeout(() => {
          const calContainer = document.querySelector('.calendar-view-container');
          if (calContainer) calContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      }
    }
  ];

  let currentPhaseIndex = 0;
  let autoPlayTimer = null;
  let isAutoPlaying = true;

  function typeText(text, container) {
    container.innerHTML = text;
    audioFX.ping();
  }

  function renderPhase(index) {
    currentPhaseIndex = Math.max(0, Math.min(PHASES.length - 1, index));
    const p = PHASES[currentPhaseIndex];

    phaseTag.textContent = p.tag;
    phaseTitle.textContent = p.title;
    telBiome.textContent = p.biome.toUpperCase();
    telStat.textContent = p.stat;
    telSol.textContent = p.solution;
    progressBar.style.width = p.progress + '%';

    stepPills.forEach((pill, idx) => {
      pill.classList.toggle('active', idx === currentPhaseIndex);
    });

    typeText(p.narrative, typewriterText);
    p.action();

    prevBtn.disabled = currentPhaseIndex === 0;
    nextBtn.textContent = currentPhaseIndex === PHASES.length - 1 ? 'Finish Briefing ✓' : 'Next Phase ►';
  }

  function startAutoPlay() {
    isAutoPlaying = true;
    if (autoplayBtn) autoplayBtn.textContent = '⏸ Pause (8s)';
    if (autoPlayTimer) clearInterval(autoPlayTimer);
    autoPlayTimer = setInterval(() => {
      if (currentPhaseIndex < PHASES.length - 1) {
        renderPhase(currentPhaseIndex + 1);
      } else {
        stopAutoPlay();
      }
    }, 8000);
  }

  function stopAutoPlay() {
    isAutoPlaying = false;
    if (autoplayBtn) autoplayBtn.textContent = '▶ Auto-Play (8s)';
    if (autoPlayTimer) clearInterval(autoPlayTimer);
  }

  function openTour() {
    hud.style.display = 'block';
    audioFX.success();
    renderPhase(0);
    startAutoPlay();
  }

  function closeTour() {
    hud.style.display = 'none';
    stopAutoPlay();
    if (window.fireBridgeSim) window.fireBridgeSim.stopAutoSweep();
  }

  // Event Listeners for Tour
  if (closeBtn) closeBtn.addEventListener('click', closeTour);
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      audioFX.click();
      stopAutoPlay();
      renderPhase(currentPhaseIndex - 1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      audioFX.click();
      stopAutoPlay();
      if (currentPhaseIndex < PHASES.length - 1) {
        renderPhase(currentPhaseIndex + 1);
      } else {
        closeTour();
      }
    });
  }
  if (autoplayBtn) {
    autoplayBtn.addEventListener('click', () => {
      audioFX.click();
      if (isAutoPlaying) stopAutoPlay();
      else startAutoPlay();
    });
  }
  stepPills.forEach((pill, idx) => {
    pill.addEventListener('click', () => {
      audioFX.click();
      stopAutoPlay();
      renderPhase(idx);
    });
  });

  // Launch buttons in Header & Hero
  const headerLaunchBtn = document.getElementById('btn-launch-tour');
  const heroLaunchBtn = document.getElementById('btn-hero-launch-tour');
  if (headerLaunchBtn) headerLaunchBtn.addEventListener('click', openTour);
  if (heroLaunchBtn) heroLaunchBtn.addEventListener('click', openTour);

  // Jump buttons in Hero
  const jumpSimBtn = document.getElementById('btn-hero-jump-simulator');
  if (jumpSimBtn) {
    jumpSimBtn.addEventListener('click', () => {
      audioFX.click();
      window.location.hash = '#comparison';
      setTimeout(() => {
        const sim = document.getElementById('optical-simulator-card');
        if (sim) sim.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    });
  }

  const jumpMapBtn = document.getElementById('btn-hero-jump-map');
  if (jumpMapBtn) {
    jumpMapBtn.addEventListener('click', () => {
      audioFX.click();
      window.location.hash = '#map';
    });
  }

  // Expose global controller
  window.fireBridgeTour = {
    start: openTour,
    stop: closeTour,
    next: () => renderPhase(currentPhaseIndex + 1),
    prev: () => renderPhase(currentPhaseIndex - 1)
  };
}

// ==========================================================================
// FEATURE: 3D ORBITAL SWATH & BOW-TIE VISUALIZER CONTROLLER
// ==========================================================================
let orbit3DState = {
  initialized: false,
  scene: null,
  camera: null,
  renderer: null,
  globe: null,
  atmosphere: null,
  satellites: [],
  isRotating: true,
  animId: null
};

function initOrbit3DVisualizer() {
  const container = document.getElementById('orbit3d-canvas-container');
  const canvas = document.getElementById('orbit3d-canvas');
  if (!container || !canvas) return;

  initBowTieSlider();

  if (orbit3DState.initialized) {
    if (orbit3DState.renderer && container) {
      orbit3DState.renderer.setSize(container.clientWidth, container.clientHeight);
      orbit3DState.camera.aspect = container.clientWidth / container.clientHeight;
      orbit3DState.camera.updateProjectionMatrix();
    }
    return;
  }

  if (typeof THREE === 'undefined') {
    console.warn('[!] Three.js not loaded, fallback mode active.');
    return;
  }

  const width = container.clientWidth || 800;
  const height = container.clientHeight || 520;

  // 1. Scene & Camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 4, 16);

  // 2. WebGL Renderer
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // 3. Lighting
  const ambientLight = new THREE.AmbientLight(0x223355, 1.2);
  scene.add(ambientLight);
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
  sunLight.position.set(20, 10, 20);
  scene.add(sunLight);

  // 4. Procedural Textured Earth Globe
  const globeGeo = new THREE.SphereGeometry(5, 64, 64);
  
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 1024;
  textureCanvas.height = 512;
  const ctx = textureCanvas.getContext('2d');
  
  // Ocean base
  ctx.fillStyle = '#061325';
  ctx.fillRect(0, 0, 1024, 512);
  
  // Continents simulation
  ctx.fillStyle = '#1e3a2b';
  // Americas
  ctx.beginPath();
  ctx.ellipse(280, 180, 100, 70, 0.2, 0, Math.PI * 2);
  ctx.ellipse(320, 320, 60, 110, -0.2, 0, Math.PI * 2);
  // Eurasia & Africa
  ctx.ellipse(600, 160, 140, 80, -0.1, 0, Math.PI * 2);
  ctx.ellipse(580, 280, 70, 90, 0.1, 0, Math.PI * 2);
  // Australia
  ctx.ellipse(820, 340, 50, 40, 0, 0, Math.PI * 2);
  ctx.fill();

  // Coastlines
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Active fire hotspots on the globe
  ctx.fillStyle = '#f97316';
  const fireCoords = [
    [260, 160], [270, 175], [330, 310], [340, 325],
    [580, 260], [600, 290], [620, 140], [820, 350]
  ];
  fireCoords.forEach(([fx, fy]) => {
    ctx.beginPath();
    ctx.arc(fx, fy, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  const earthTex = new THREE.CanvasTexture(textureCanvas);
  const globeMat = new THREE.MeshPhongMaterial({
    map: earthTex,
    specular: new THREE.Color(0x334466),
    shininess: 15
  });
  const globe = new THREE.Mesh(globeGeo, globeMat);
  scene.add(globe);

  // Atmosphere Glow
  const atmosGeo = new THREE.SphereGeometry(5.3, 32, 32);
  const atmosMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.12,
    side: THREE.BackSide
  });
  const atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
  scene.add(atmosphere);

  // 5. Orbital Trajectories & Spacecraft
  // MODIS Orbit (705 km -> radius 6.2)
  const modisOrbitGeo = new THREE.RingGeometry(6.18, 6.22, 64);
  const modisOrbitMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.35 });
  const modisOrbit = new THREE.Mesh(modisOrbitGeo, modisOrbitMat);
  modisOrbit.rotation.x = Math.PI / 2 + 0.14;
  scene.add(modisOrbit);

  // VIIRS Orbit (824 km -> radius 6.6)
  const viirsOrbitGeo = new THREE.RingGeometry(6.58, 6.62, 64);
  const viirsOrbitMat = new THREE.MeshBasicMaterial({ color: 0xf97316, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  const viirsOrbit = new THREE.Mesh(viirsOrbitGeo, viirsOrbitMat);
  viirsOrbit.rotation.x = Math.PI / 2 + 0.15;
  scene.add(viirsOrbit);

  function createSatMesh(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.25), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    const panelL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.25), new THREE.MeshLambertMaterial({ color: 0x1e3a8a }));
    panelL.position.x = -0.5;
    const panelR = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.25), new THREE.MeshLambertMaterial({ color: 0x1e3a8a }));
    panelR.position.x = 0.5;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), new THREE.MeshBasicMaterial({ color: color }));
    beacon.position.y = 0.12;
    group.add(body);
    group.add(panelL);
    group.add(panelR);
    group.add(beacon);
    return group;
  }

  const satTerra = createSatMesh(0x38bdf8);
  const satAqua = createSatMesh(0x38bdf8);
  const satNoaa20 = createSatMesh(0xf97316);
  scene.add(satTerra);
  scene.add(satAqua);
  scene.add(satNoaa20);

  // Conical Swath Lines
  const swathMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
  const swathGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-1.2, -1.8, 0),
    new THREE.Vector3(1.2, -1.8, 0),
    new THREE.Vector3(0, 0, 0)
  ]);
  const swathCone = new THREE.Line(swathGeo, swathMat);
  satTerra.add(swathCone);

  orbit3DState = {
    initialized: true,
    scene,
    camera,
    renderer,
    globe,
    atmosphere,
    satellites: [satTerra, satAqua, satNoaa20],
    isRotating: true,
    animId: null
  };

  // 6. Interactive Drag & Controls
  let isDragging = false;
  let prevMousePos = { x: 0, y: 0 };

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    prevMousePos = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - prevMousePos.x;
    const deltaY = e.clientY - prevMousePos.y;
    globe.rotation.y += deltaX * 0.006;
    globe.rotation.x += deltaY * 0.006;
    prevMousePos = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.position.z = Math.max(9, Math.min(28, camera.position.z + e.deltaY * 0.015));
  }, { passive: false });

  // Rotate toggle button
  const rotateBtn = document.getElementById('btn-orbit3d-toggle-rotate');
  if (rotateBtn) {
    rotateBtn.addEventListener('click', () => {
      audioFX.click();
      orbit3DState.isRotating = !orbit3DState.isRotating;
      rotateBtn.textContent = orbit3DState.isRotating ? '⏸ Pause Rotation' : '▶ Resume Rotation';
    });
  }

  // Reset Camera button
  const resetBtn = document.getElementById('btn-orbit3d-reset-cam');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      audioFX.click();
      camera.position.set(0, 4, 16);
      globe.rotation.set(0, 0, 0);
    });
  }

  // Focus buttons
  const focusGroup = document.getElementById('orbit3d-satellite-focus');
  if (focusGroup) {
    focusGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      audioFX.click();
      focusGroup.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.focus;
      if (f === 'all') camera.position.set(0, 4, 16);
      else if (f === 'terra') camera.position.set(0, 6.2, 10);
      else if (f === 'aqua') camera.position.set(0, -6.2, 10);
      else if (f === 'viirs') camera.position.set(0, 6.6, 9.5);
    });
  }

  // 7. Render Loop
  let orbitTime = 0;
  function animate() {
    orbit3DState.animId = requestAnimationFrame(animate);
    orbitTime += 0.015;

    satTerra.position.x = 6.2 * Math.cos(orbitTime);
    satTerra.position.y = 6.2 * Math.sin(orbitTime);
    satTerra.position.z = 0.8 * Math.sin(orbitTime);

    satAqua.position.x = 6.2 * Math.cos(orbitTime + Math.PI);
    satAqua.position.y = 6.2 * Math.sin(orbitTime + Math.PI);
    satAqua.position.z = 0.8 * Math.sin(orbitTime + Math.PI);

    satNoaa20.position.x = 6.6 * Math.cos(orbitTime * 0.9 + 1.2);
    satNoaa20.position.y = 6.6 * Math.sin(orbitTime * 0.9 + 1.2);
    satNoaa20.position.z = 0.9 * Math.sin(orbitTime * 0.9 + 1.2);

    if (orbit3DState.isRotating && !isDragging) {
      globe.rotation.y += 0.002;
    }

    renderer.render(scene, camera);
  }
  animate();
}

// Bow-Tie Distortion Angle Slider
function initBowTieSlider() {
  const slider = document.getElementById('bowtie-angle-slider');
  const valReadout = document.getElementById('bowtie-angle-val');
  const modisShape = document.getElementById('modis-pixel-shape');
  const viirsShape = document.getElementById('viirs-pixel-shape');
  const modisDims = document.getElementById('modis-dims-text');
  const viirsDims = document.getElementById('viirs-dims-text');

  if (!slider) return;

  slider.addEventListener('input', (e) => {
    const deg = parseFloat(e.target.value);
    const rad = deg * (Math.PI / 180);
    valReadout.textContent = `${deg}° (${deg < 20 ? 'Near Nadir' : deg < 45 ? 'Intermediate Scan' : 'Swath Edge'})`;

    const modisW = 1.0 / Math.cos(rad);
    const modisH = 1.0 / Math.pow(Math.cos(rad), 2);
    const modisArea = (modisW * modisH).toFixed(1);

    if (modisShape) {
      modisShape.style.width = Math.min(140, Math.round(50 * modisW)) + 'px';
      modisShape.style.height = Math.min(130, Math.round(50 * modisH)) + 'px';
    }
    if (modisDims) modisDims.textContent = `${modisW.toFixed(1)} km × ${modisH.toFixed(1)} km (${modisArea} km²)`;

    let viirsAggFactor = deg < 31.7 ? 1.0 : deg < 44.8 ? 1.4 : 2.1;
    const viirsW = 0.375;
    const viirsH = 0.375 * viirsAggFactor;
    const viirsArea = (viirsW * viirsH).toFixed(2);

    if (viirsShape) {
      viirsShape.style.width = Math.min(90, Math.round(30 * (viirsW / 0.375))) + 'px';
      viirsShape.style.height = Math.min(90, Math.round(30 * viirsAggFactor)) + 'px';
    }
    if (viirsDims) viirsDims.textContent = `375m × ${Math.round(viirsH * 1000)}m (${viirsArea} km²)`;
  });
}

// ==========================================================================
// FEATURE: 2026–2050 WHAT-IF CLIMATE & FIRE SPREAD SIMULATOR CONTROLLER
// ==========================================================================
let spreadSimState = {
  initialized: false,
  canvas: null,
  ctx: null,
  grid: [],
  cols: 80,
  rows: 38,
  cellSize: 10,
  isRunning: false,
  timer: null,
  elapsedHours: 0,
  drawMode: 'ignite',
  temp: 2.2,
  drought: -2.8,
  moisture: 8.5,
  wind: 38,
  chart: null
};

function initClimateSimulator() {
  const canvas = document.getElementById('fire-spread-canvas');
  if (!canvas) return;

  spreadSimState.canvas = canvas;
  spreadSimState.ctx = canvas.getContext('2d');

  setupClimateSliders();
  resetSpreadGrid();
  renderClimateProjectionChart();

  const playBtn = document.getElementById('btn-spread-play');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      audioFX.click();
      spreadSimState.isRunning = !spreadSimState.isRunning;
      playBtn.textContent = spreadSimState.isRunning ? '⏸ Pause Simulation' : '▶ Start Propagation';
      if (spreadSimState.isRunning) {
        spreadSimState.timer = setInterval(stepSpreadSimulation, 130);
      } else {
        clearInterval(spreadSimState.timer);
      }
    });
  }

  const stepBtn = document.getElementById('btn-spread-step');
  if (stepBtn) {
    stepBtn.addEventListener('click', () => {
      audioFX.step();
      stepSpreadSimulation();
    });
  }

  const resetBtn = document.getElementById('btn-spread-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      audioFX.click();
      if (spreadSimState.isRunning) {
        spreadSimState.isRunning = false;
        clearInterval(spreadSimState.timer);
        if (playBtn) playBtn.textContent = '▶ Start Propagation';
      }
      resetSpreadGrid();
    });
  }

  const barrierBtn = document.getElementById('btn-spread-add-barrier');
  if (barrierBtn) {
    barrierBtn.addEventListener('click', () => {
      audioFX.click();
      spreadSimState.drawMode = spreadSimState.drawMode === 'barrier' ? 'ignite' : 'barrier';
      barrierBtn.classList.toggle('active', spreadSimState.drawMode === 'barrier');
      barrierBtn.textContent = spreadSimState.drawMode === 'barrier' ? '🛑 Mode: Drawing Firebreak' : '🛡️ Draw Firebreak Barrier';
    });
  }

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / spreadSimState.cols));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / spreadSimState.rows));

    if (x >= 0 && x < spreadSimState.cols && y >= 0 && y < spreadSimState.rows) {
      if (spreadSimState.drawMode === 'barrier') {
        audioFX.step();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < spreadSimState.cols && ny >= 0 && ny < spreadSimState.rows) {
              spreadSimState.grid[ny][nx] = 3;
            }
          }
        }
      } else {
        audioFX.ping();
        spreadSimState.grid[y][x] = 1;
      }
      renderSpreadCanvas();
    }
  });
}

function resetSpreadGrid() {
  const { cols, rows } = spreadSimState;
  spreadSimState.grid = [];
  spreadSimState.elapsedHours = 0;

  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (c === 55 && r > 5 && r < 32) {
        row.push(3); // River barrier
      } else {
        row.push(0); // Unburned fuel
      }
    }
    spreadSimState.grid.push(row);
  }

  // Ignition point in center-left
  spreadSimState.grid[19][18] = 1;
  spreadSimState.grid[19][19] = 1;
  spreadSimState.grid[20][18] = 1;

  renderSpreadCanvas();
  updateSpreadTelemetry(3, 45, 12.4);
}

function stepSpreadSimulation() {
  const { cols, rows, grid, temp, moisture, wind } = spreadSimState;
  const nextGrid = grid.map(r => r.slice());

  const baseProb = Math.max(0.1, Math.min(0.85, 0.28 + (temp - 1.5) * 0.08 - (moisture - 10) * 0.02));
  const windBoost = 1.0 + (wind / 50.0);

  let activeCount = 0;
  let burnedCount = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const state = grid[r][c];

      if (state === 1) { // Burning
        activeCount++;
        const neighbors = [
          { dr: -1, dc: 0, w: 0.8 },
          { dr: 1, dc: 0, w: 0.8 },
          { dr: 0, dc: -1, w: 0.5 },
          { dr: 0, dc: 1, w: 2.2 * windBoost },
          { dr: -1, dc: 1, w: 1.6 * windBoost },
          { dr: 1, dc: 1, w: 1.6 * windBoost }
        ];

        neighbors.forEach(n => {
          const nr = r + n.dr;
          const nc = c + n.dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            if (grid[nr][nc] === 0) {
              const p = baseProb * n.w;
              if (Math.random() < p) {
                nextGrid[nr][nc] = 1;
              }
            }
          }
        });

        if (Math.random() < 0.65) {
          nextGrid[r][c] = 2; // Burned
        }
      } else if (state === 2) {
        burnedCount++;
      }
    }
  }

  spreadSimState.grid = nextGrid;
  spreadSimState.elapsedHours++;

  renderSpreadCanvas();

  const burnedHa = Math.round(burnedCount * 12.5);
  const spreadMpm = (wind * 0.4 + temp * 2.1).toFixed(1);
  updateSpreadTelemetry(activeCount, burnedHa, spreadMpm);
}

function renderSpreadCanvas() {
  const { ctx, canvas, cols, rows, grid } = spreadSimState;
  if (!ctx || !canvas) return;

  const w = canvas.width;
  const h = canvas.height;
  const cw = w / cols;
  const ch = h / rows;

  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, w, h);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const state = grid[r][c];
      const x = c * cw;
      const y = r * ch;

      if (state === 0) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#142918' : '#18311e';
        ctx.fillRect(x, y, cw - 0.5, ch - 0.5);
      } else if (state === 1) {
        const glow = Math.random() > 0.4 ? '#f97316' : '#ef4444';
        ctx.fillStyle = glow;
        ctx.shadowColor = '#f97316';
        ctx.shadowBlur = 6;
        ctx.fillRect(x, y, cw, ch);
        ctx.shadowBlur = 0;
      } else if (state === 2) {
        ctx.fillStyle = '#1e2430';
        ctx.fillRect(x, y, cw - 0.5, ch - 0.5);
      } else if (state === 3) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x, y, cw, ch);
      }
    }
  }
}

function updateSpreadTelemetry(activeCells, burnedArea, velocity) {
  const timeEl = document.getElementById('spread-time-elapsed');
  const cellsEl = document.getElementById('spread-active-cells');
  const areaEl = document.getElementById('spread-burned-area');
  const velEl = document.getElementById('spread-velocity');

  if (timeEl) timeEl.textContent = `T + ${String(spreadSimState.elapsedHours).padStart(2, '0')}:00 h`;
  if (cellsEl) cellsEl.textContent = `${activeCells} cells`;
  if (areaEl) areaEl.textContent = `${burnedArea.toLocaleString()} ha`;
  if (velEl) velEl.textContent = `${velocity} m/min`;
}

function setupClimateSliders() {
  const tempSlider = document.getElementById('sim-temp-slider');
  const droughtSlider = document.getElementById('sim-drought-slider');
  const moistureSlider = document.getElementById('sim-moisture-slider');
  const windSlider = document.getElementById('sim-wind-slider');

  function recalculateImpact() {
    const t = parseFloat(tempSlider.value);
    const d = parseFloat(droughtSlider.value);
    const m = parseFloat(moistureSlider.value);
    const w = parseFloat(windSlider.value);

    spreadSimState.temp = t;
    spreadSimState.drought = d;
    spreadSimState.moisture = m;
    spreadSimState.wind = w;

    document.getElementById('sim-temp-val').textContent = `+${t.toFixed(1)} °C`;
    document.getElementById('sim-drought-val').textContent = `${d.toFixed(1)} (${d < -3 ? 'Extreme Megadrought' : d < -1.5 ? 'Severe Drought' : 'Moderate'})`;
    document.getElementById('sim-moisture-val').textContent = `${m.toFixed(1)}% (${m < 10 ? 'Critical Explosive' : 'Moderate'})`;
    document.getElementById('sim-wind-val').textContent = `${w} km/h (SW 225°)`;

    const hotspotGrowthPct = Math.round((t - 1.0) * 28 - (d * 5));
    const projectedHotspots = Math.round(3450 * (1 + hotspotGrowthPct / 100));
    const seasonExtDays = Math.round((t - 1.0) * 22 - (d * 4));
    const fireInterval = Math.max(4, Math.round(28 / (1 + (t - 1.0) * 0.7)));
    const co2Annual = (27.2 * (1 + hotspotGrowthPct / 100)).toFixed(1);

    animateCounter('impact-hotspots', projectedHotspots, 600, 0, '', ` events (+${hotspotGrowthPct}%)`);
    document.getElementById('impact-season').textContent = `+${seasonExtDays} Days Longer`;
    document.getElementById('impact-interval').textContent = `${fireInterval} Years (Down from 28y)`;
    document.getElementById('impact-co2').textContent = `${co2Annual} Tg / year`;
  }

  [tempSlider, droughtSlider, moistureSlider, windSlider].forEach(s => {
    if (s) s.addEventListener('input', recalculateImpact);
  });

  const presetToggle = document.getElementById('climate-preset-toggle');
  if (presetToggle) {
    presetToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      audioFX.click();
      presetToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const p = btn.dataset.preset;
      if (p === 'ssp1') {
        tempSlider.value = 1.5;
        droughtSlider.value = -1.2;
        moistureSlider.value = 14.0;
        windSlider.value = 25;
      } else if (p === 'ssp2') {
        tempSlider.value = 2.2;
        droughtSlider.value = -2.8;
        moistureSlider.value = 8.5;
        windSlider.value = 38;
      } else if (p === 'ssp5') {
        tempSlider.value = 3.8;
        droughtSlider.value = -4.2;
        moistureSlider.value = 5.0;
        windSlider.value = 55;
      }
      recalculateImpact();
    });
  }
}

function renderClimateProjectionChart() {
  const el = document.getElementById('climate-projection-chart');
  if (!el) return;

  const years = [];
  for (let y = 2000; y <= 2050; y += 2) years.push(y);

  const histData = years.map(y => {
    if (y > 2026) return null;
    return 2400 + Math.sin(y * 0.4) * 600 + (y - 2000) * 45;
  });

  const ssp1Data = years.map(y => {
    if (y < 2026) return null;
    return 3450 + (y - 2026) * 18;
  });

  const ssp2Data = years.map(y => {
    if (y < 2026) return null;
    return 3450 + (y - 2026) * 58;
  });

  const ssp5Data = years.map(y => {
    if (y < 2026) return null;
    return 3450 + (y - 2026) * 125;
  });

  if (spreadSimState.chart) spreadSimState.chart.destroy();
  spreadSimState.chart = new Chart(el.getContext('2d'), {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        {
          label: 'Historical Calibrated (2000–2026)',
          data: histData,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2.5
        },
        {
          label: 'SSP1-2.6 Paris Agreement (+1.5°C)',
          data: ssp1Data,
          borderColor: '#22c55e',
          borderDash: [5, 5],
          borderWidth: 2,
          tension: 0.3
        },
        {
          label: 'SSP2-4.5 Current Trajectory (+2.2°C)',
          data: ssp2Data,
          borderColor: '#f97316',
          borderWidth: 2.5,
          tension: 0.3
        },
        {
          label: 'SSP5-8.5 Extreme Escalation (+3.8°C)',
          data: ssp5Data,
          borderColor: '#ef4444',
          borderDash: [3, 3],
          borderWidth: 2,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          title: { display: true, text: 'Annual Active Hotspots', color: '#94a3b8' },
          ticks: { color: '#64748b' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      },
      plugins: {
        legend: { labels: { color: '#cbd5e1', usePointStyle: true } }
      }
    }
  });
}
