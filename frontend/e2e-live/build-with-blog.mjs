// Production build for the CSP test with the blog pre-rendered from the Hygraph stand-in (e2e-live/hygraph-mock.mjs).
import { spawn } from 'node:child_process';
import { startHygraphMock } from './hygraph-mock.mjs';

const server = await startHygraphMock(5199);
const code = await new Promise((resolve) => {
  spawn('npx', ['vite', 'build', '--logLevel', 'error'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_API_BASE: 'http://localhost:8001', VITE_HYGRAPH_ENDPOINT: 'http://localhost:5199/content', HYGRAPH_BUILD_ENDPOINT: 'http://localhost:5199/content' },
  }).on('exit', resolve);
});
server.close();
process.exit(code ?? 1);
