// Nm7 Apply helper: the first-run guide (opened once, right after install, by background.js). Only fills in the
// links from src/config.js; no remote code.
document.getElementById('practice').href = globalThis.NM7_CONFIG.practice;
document.getElementById('privacy').href = `${globalThis.NM7_CONFIG.site}/privacy#extension`;
