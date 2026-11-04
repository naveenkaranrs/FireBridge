/**
 * FireBridge Automated Test Suite
 * Tests REST endpoints, scientific formulas, schema validation, and CSV export.
 */

const http = require('http');

async function testEndpoint(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: res.headers['content-type']?.includes('application/json') ? JSON.parse(data) : data
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('==================================================');
  console.log('       FIREBRIDGE AUTOMATED API TEST SUITE        ');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  async function assertTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // Test 1: GET /api/health
  await assertTest('GET /api/health returns HEALTHY status', async () => {
    const res = await testEndpoint('/api/health');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (res.data.status !== 'HEALTHY') throw new Error(`Status not HEALTHY: ${res.data.status}`);
    if (!res.data.database_loaded) throw new Error('Database reported not loaded');
  });

  // Test 2: GET /api/regions
  await assertTest('GET /api/regions returns all 6 NASA biomes', async () => {
    const res = await testEndpoint('/api/regions');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (res.data.regions.length < 6) throw new Error(`Expected >= 6 regions, got ${res.data.regions.length}`);
  });

  // Test 3: GET /api/fires?region=california
  await assertTest('GET /api/fires returns hotspots with valid attributes', async () => {
    const res = await testEndpoint('/api/fires?region=california&limit=10');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (!res.data.hotspots || res.data.hotspots.length === 0) throw new Error('No hotspots returned');
    const h = res.data.hotspots[0];
    if (typeof h.latitude !== 'number' || typeof h.longitude !== 'number') throw new Error('Invalid coordinates');
    if (!h.sensor || typeof h.frp !== 'number') throw new Error('Missing sensor or frp');
  });

  // Test 4: GET /api/fires with diurnal filter
  await assertTest('GET /api/fires?diurnal=night filters correctly', async () => {
    const res = await testEndpoint('/api/fires?region=california&diurnal=night&limit=20');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    for (const h of res.data.hotspots) {
      const hr = parseInt(h.time.split(':')[0], 10);
      if (hr > 5 && hr < 20) throw new Error(`Found daytime hotspot during night filter: ${h.time}`);
    }
  });

  // Test 5: GET /api/fires/summary
  await assertTest('GET /api/fires/summary returns climatology KPIs', async () => {
    const res = await testEndpoint('/api/fires/summary?region=california');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (!res.data.total_harmonized_hotspots || !res.data.estimated_biomass_consumed_mt) {
      throw new Error('Missing KPI metrics in summary');
    }
  });

  // Test 6: GET /api/fires/calendar
  await assertTest('GET /api/fires/calendar returns 2000-2026 matrix', async () => {
    const res = await testEndpoint('/api/fires/calendar?region=california');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (res.data.timeline.length < 300) throw new Error(`Expected >= 300 monthly records, got ${res.data.timeline.length}`);
  });

  // Test 7: GET /api/quality
  await assertTest('GET /api/quality returns statistical validation benchmarks', async () => {
    const res = await testEndpoint('/api/quality?region=california');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (!res.data.validation_metrics.ols_r2) throw new Error('Missing OLS R2 in quality report');
    if (res.data.data_completeness.completeness_pct !== 100) throw new Error('Data completeness not 100%');
  });

  // Test 8: GET /api/export/csv
  await assertTest('GET /api/export/csv exports valid FIRMS CSV headers', async () => {
    const res = await testEndpoint('/api/export/csv?region=california');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (!res.data.startsWith('date,year,month,modis_count,viirs_count')) {
      throw new Error(`CSV header mismatch: ${res.data.slice(0, 50)}`);
    }
  });

  // Test 9: POST /api/regions (Custom AOI creation)
  await assertTest('POST /api/regions registers custom bounding box', async () => {
    const res = await testEndpoint('/api/regions', 'POST', {
      name: 'Test AOI Plumas',
      bounds: [-121.5, 39.8, -120.5, 40.5]
    });
    if (res.statusCode !== 201) throw new Error(`Expected 201, got ${res.statusCode}`);
    if (!res.data.id) throw new Error('Custom AOI id not returned');
  });

  // Test 10: POST /api/nasa/sync (Graceful demo mode fallback)
  await assertTest('POST /api/nasa/sync returns demo mode fallback when no key', async () => {
    const res = await testEndpoint('/api/nasa/sync', 'POST', {});
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (res.data.mode !== 'DEMO_CURATED_ARCHIVE') throw new Error(`Unexpected mode: ${res.data.mode}`);
  });

  console.log(`\n==================================================`);
  console.log(`Test Execution Complete: ${passed} passed, ${failed} failed.`);
  console.log(`==================================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
