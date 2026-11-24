// Production build for the CSP test with the blog pre-rendered from the Hygraph stand-in (e2e-live/hygraph-mock.mjs).
// The older articles come through the real test API (e2e-live/api.sh points its HYGRAPH_ENDPOINT at the stand-in), so
// the build waits for the API to answer first.
import { spawn } from 'node:child_process';
import { startHygraphMock } from './hygraph-mock.mjs';

const server = await startHygraphMock(5199);
for (let i = 0; i < 90; i++) {
  try { if ((await fetch('http://localhost:8001/health')).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 1000));
}
const code = await new Promise((resolve) => {
  spawn('npx', ['vite', 'build', '--logLevel', 'error'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_API_BASE: 'http://localhost:8001', VITE_HYGRAPH_ENDPOINT: 'http://localhost:5199/content', HYGRAPH_BUILD_ENDPOINT: 'http://localhost:5199/content' },
  }).on('exit', resolve);
});
server.close();
process.exit(code ?? 1);
