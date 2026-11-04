/**
 * FireBridge Automated Test Runner
 * Boots server in-process, runs tests against local endpoints, outputs results, and exits cleanly.
 */

const { fork } = require('child_process');
const path = require('path');

const serverProc = fork(path.join(__dirname, 'server.js'), [], {
  env: { ...process.env, PORT: '3001' }
});

let serverReady = false;

serverProc.on('message', (msg) => {
  // IPC if needed
});

// Wait for server to bind
setTimeout(() => {
  console.log('[*] Test server spawned on port 3001. Running test suite...\n');
  const testProc = fork(path.join(__dirname, 'test_api.js'), [], {
    env: { ...process.env, PORT: '3001' }
  });

  testProc.on('exit', (code) => {
    console.log(`[*] Test execution finished with code ${code}. Stopping test server...`);
    serverProc.kill();
    process.exit(code);
  });
}, 1500);
