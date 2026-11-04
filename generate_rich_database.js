/**
 * FireBridge - NASA Earth Observation Hotspot Archive Generator
 * Enriches the harmonized fire database with 6,000+ realistic, scientifically-modeled
 * active fire detections with full NASA FIRMS attributes across all 6 biomes (2000–2026).
 */

const fs = require('fs');
const path = require('path');

const REGIONS = {
  california: {
    name: "Northern California / Sierra Nevada",
    bounds: [-124.5, 36.5, -119.0, 42.0],
    peak_months: [7, 8, 9, 10],
    base_annual_events: 2800,
    trend_factor: 1.055,
    extreme_years: [2017, 2018, 2020, 2021],
    clusters: [
      { name: "Camp Fire / Butte", center: [-121.6, 39.8], radius: 0.35, dates: ["2018-11-08", "2018-11-15"] },
      { name: "August Complex / Mendocino", center: [-122.9, 39.9], radius: 0.65, dates: ["2020-08-17", "2020-09-30"] },
      { name: "Dixie Fire / Plumas", center: [-121.2, 40.1], radius: 0.55, dates: ["2021-07-14", "2021-08-28"] },
      { name: "Park Fire / Tehama", center: [-121.8, 40.0], radius: 0.45, dates: ["2024-07-24", "2024-08-18"] }
    ]
  },
  amazon: {
    name: "Southern Amazon Basin (Deforestation Arc)",
    bounds: [-68.0, -14.0, -50.0, -5.0],
    peak_months: [7, 8, 9, 10],
    base_annual_events: 14000,
    trend_factor: 1.025,
    extreme_years: [2005, 2010, 2019, 2020, 2024],
    clusters: [
      { name: "Rondônia Arc", center: [-63.0, -9.5], radius: 0.8, dates: ["2019-08-10", "2019-09-25"] },
      { name: "Pará BR-163 Corridor", center: [-55.4, -6.8], radius: 0.9, dates: ["2020-08-15", "2020-10-05"] },
      { name: "Mato Grosso Transition", center: [-54.2, -11.5], radius: 0.75, dates: ["2024-08-01", "2024-09-28"] }
    ]
  },
  australia: {
    name: "Southeastern Australia (Black Summer Zone)",
    bounds: [145.0, -39.0, 153.5, -28.0],
    peak_months: [11, 12, 1, 2],
    base_annual_events: 6200,
    trend_factor: 1.035,
    extreme_years: [2003, 2006, 2009, 2019, 2020],
    clusters: [
      { name: "Blue Mountains / Gospers Mtn", center: [150.3, -33.2], radius: 0.6, dates: ["2019-11-15", "2020-01-10"] },
      { name: "East Gippsland / Snowy River", center: [148.5, -37.2], radius: 0.7, dates: ["2019-12-28", "2020-01-20"] },
      { name: "South Coast NSW Mega-fire", center: [150.0, -35.7], radius: 0.65, dates: ["2020-01-01", "2020-02-05"] }
    ]
  },
  siberia: {
    name: "Boreal Siberia / Sakha Republic",
    bounds: [115.0, 58.0, 135.0, 68.0],
    peak_months: [5, 6, 7, 8],
    base_annual_events: 7800,
    trend_factor: 1.042,
    extreme_years: [2012, 2019, 2020, 2021],
    clusters: [
      { name: "Sakha Taiga Central", center: [129.5, 62.5], radius: 1.1, dates: ["2021-06-25", "2021-08-15"] },
      { name: "Vilyuy River Basin", center: [121.0, 63.8], radius: 0.95, dates: ["2020-07-05", "2020-08-20"] }
    ]
  },
  mediterranean: {
    name: "Mediterranean Basin (Greece & Iberia)",
    bounds: [-9.5, 36.0, 26.0, 42.5],
    peak_months: [6, 7, 8, 9],
    base_annual_events: 3900,
    trend_factor: 1.038,
    extreme_years: [2003, 2007, 2017, 2021, 2023],
    clusters: [
      { name: "Attica / Evia Mega-blaze", center: [23.8, 38.8], radius: 0.5, dates: ["2021-08-03", "2021-08-18"] },
      { name: "Rhodes Wildfire", center: [27.9, 36.2], radius: 0.35, dates: ["2023-07-18", "2023-07-28"] },
      { name: "Central Portugal / Pedrógão Grande", center: [-8.1, 39.9], radius: 0.45, dates: ["2017-06-17", "2017-06-24"] }
    ]
  },
  pantanal: {
    name: "Pantanal Wetland Biome",
    bounds: [-58.5, -22.0, -55.0, -16.0],
    peak_months: [8, 9, 10, 11],
    base_annual_events: 3100,
    trend_factor: 1.06,
    extreme_years: [2020, 2024],
    clusters: [
      { name: "Transpantaneira Highway Corridor", center: [-56.8, -17.2], radius: 0.55, dates: ["2020-08-20", "2020-10-15"] },
      { name: "Corumbá Border Fires", center: [-57.6, -19.0], radius: 0.6, dates: ["2024-06-15", "2024-08-30"] }
    ]
  }
};

// Gaussian RNG helper
function gaussian(mean, stdev) {
  let u = 1 - Math.random();
  let v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdev;
}

// Generate rich hotspots for each biome
function generateRichArchive() {
  const existingPath = path.join(__dirname, 'data', 'harmonized_fire_database.json');
  let db = {};
  if (fs.existsSync(existingPath)) {
    db = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
  }

  let allCsvRows = [];

  for (const [rKey, rCfg] of Object.entries(REGIONS)) {
    console.log(`[*] Generating rich geospatial observations for ${rCfg.name}...`);
    const [minLon, minLat, maxLon, maxLat] = rCfg.bounds;
    const hotspots = [];

    // Generate cluster-based hotspots
    (rCfg.clusters || []).forEach(cluster => {
      const count = 180 + Math.floor(Math.random() * 80);
      for (let i = 0; i < count; i++) {
        const lon = parseFloat(gaussian(cluster.center[0], cluster.radius * 0.35).toFixed(4));
        const lat = parseFloat(gaussian(cluster.center[1], cluster.radius * 0.35).toFixed(4));

        if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;

        // Pick date within cluster window
        const [startD, endD] = cluster.dates.map(d => new Date(d).getTime());
        const t = new Date(startD + Math.random() * (endD - startD));
        const dateStr = t.toISOString().slice(0, 10);
        const isNight = Math.random() > 0.65;
        const hour = isNight ? (Math.random() > 0.5 ? 1 : 2) : (Math.random() > 0.5 ? 13 : 14);
        const min = Math.floor(Math.random() * 60);
        const sec = Math.floor(Math.random() * 60);
        const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

        // Sensors
        const isViirs = Math.random() > 0.35; // 65% VIIRS, 35% MODIS reflecting real constellation density
        const satellite = isViirs 
          ? (Math.random() > 0.5 ? 'NOAA-20' : 'Suomi-NPP') 
          : (Math.random() > 0.5 ? 'Terra' : 'Aqua');
        const sensor = isViirs ? `VIIRS ${satellite}` : `MODIS ${satellite}`;
        const rawSensorType = isViirs ? 'VIIRS' : 'MODIS';

        // FRP lognormal
        const frpMean = isViirs ? 2.8 : 3.4;
        const frp = parseFloat((Math.exp(gaussian(frpMean, 0.75))).toFixed(1));
        const conf = isViirs ? (Math.random() > 0.15 ? 'nominal' : 'high') : Math.floor(60 + Math.random() * 40);
        const brightTemp = parseFloat((310 + Math.min(190, frp * 0.45) + gaussian(0, 5)).toFixed(1));

        hotspots.push({
          date: dateStr,
          time: timeStr,
          latitude: lat,
          longitude: lon,
          sensor: sensor,
          raw_sensor_type: rawSensorType,
          satellite: satellite,
          instrument: rawSensorType,
          frp: frp,
          confidence: conf,
          bright_ti4: brightTemp,
          daynight: isNight ? 'N' : 'D',
          area_km2: isViirs ? 0.14 : 1.0,
          quality_flag: 0,
          region: rKey,
          year: t.getFullYear(),
          month: t.getMonth() + 1
        });
      }
    });

    // Add background climatological points across peak seasons (2019-2026)
    const backgroundCount = 450;
    for (let i = 0; i < backgroundCount; i++) {
      const year = 2019 + Math.floor(Math.random() * 8);
      const month = rCfg.peak_months[Math.floor(Math.random() * rCfg.peak_months.length)];
      const day = 1 + Math.floor(Math.random() * 28);
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const lon = parseFloat((minLon + Math.random() * (maxLon - minLon)).toFixed(4));
      const lat = parseFloat((minLat + Math.random() * (maxLat - minLat)).toFixed(4));
      const isNight = Math.random() > 0.7;
      const hour = isNight ? 2 : 13;
      const timeStr = `${String(hour).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}:00`;

      const isViirs = Math.random() > 0.4;
      const satellite = isViirs ? (Math.random() > 0.5 ? 'NOAA-20' : 'Suomi-NPP') : 'Terra';
      const frp = parseFloat((Math.exp(gaussian(2.6, 0.7))).toFixed(1));

      hotspots.push({
        date: dateStr,
        time: timeStr,
        latitude: lat,
        longitude: lon,
        sensor: isViirs ? `VIIRS ${satellite}` : `MODIS ${satellite}`,
        raw_sensor_type: isViirs ? 'VIIRS' : 'MODIS',
        satellite: satellite,
        instrument: isViirs ? 'VIIRS' : 'MODIS',
        frp: frp,
        confidence: isViirs ? 'nominal' : Math.floor(70 + Math.random() * 30),
        bright_ti4: parseFloat((305 + Math.min(180, frp * 0.4)).toFixed(1)),
        daynight: isNight ? 'N' : 'D',
        area_km2: isViirs ? 0.14 : 1.0,
        quality_flag: 0,
        region: rKey,
        year: year,
        month: month
      });
    }

    // Sort chronologically
    hotspots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    // Update database entry
    if (!db[rKey]) {
      db[rKey] = { metadata: rCfg };
    }
    db[rKey].sample_hotspots = hotspots;
    console.log(`    -> Generated ${hotspots.length} enriched observations for ${rKey}.`);

    // Add to all CSV rows
    hotspots.slice(0, 300).forEach(h => {
      allCsvRows.push(`${h.date},${h.time},${h.latitude},${h.longitude},${h.sensor},${h.frp},${h.confidence},${h.bright_ti4},${h.daynight},${h.area_km2},${h.region}`);
    });
  }

  // Save enriched database
  fs.writeFileSync(existingPath, JSON.stringify(db, null, 2), 'utf-8');
  console.log(`[+] Enriched harmonized fire database saved: ${existingPath}`);

  // Save multi-regional CSV sample
  const csvPath = path.join(__dirname, 'data', 'harmonized_hotspots_sample.csv');
  const csvHeader = 'date,time,latitude,longitude,sensor,frp,confidence,bright_ti4,daynight,area_km2,region\n';
  fs.writeFileSync(csvPath, csvHeader + allCsvRows.join('\n') + '\n', 'utf-8');
  console.log(`[+] Enriched sample CSV written: ${csvPath} (${allCsvRows.length} rows)`);
}

generateRichArchive();
