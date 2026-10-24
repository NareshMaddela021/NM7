// Dev-only page (vite dev server) that draws one resume for scripts/home-images/make.mjs to screenshot.
// ?sample=<key> draws a sample person; ?tpl=<template> draws the builder's own sample in that template.
import { createRoot } from 'react-dom/client';
import ResumePreview from '../../src/pages/builder/ResumePreview';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../../src/pages/builder/design';
import { INITIAL } from '../../src/pages/builder/schema';
import { layoutOf, PHOTO_PLACEHOLDER } from '../../src/pages/builder/templatePick';
import { SAMPLES } from './samples.mjs';
import { AFTER, BEFORE } from '../../src/pages/home/demoData';
import '../../src/styles/tokens.css';
import '../../src/styles/base.css';

const q = new URLSearchParams(window.location.search);
const demo = { before: BEFORE, after: AFTER }[q.get('demo')];
const s = q.get('sample') ? SAMPLES[q.get('sample')] : null;
const tpl = s ? s.template : demo ? demo.design?.preset || 'fresher' : q.get('tpl');
const L = layoutOf(tpl);
const data = demo ? { ...demo } : { ...INITIAL, ...(s?.data || {}), order: L.order, hidden: { ...L.hidden }, titles: { ...L.titles }, showPhoto: L.showPhoto, design: { ...TEMPLATE_PRESETS[tpl].design, preset: tpl } };
if (s?.data?.hobbies || s?.data?.pinfo) Object.assign(data.hidden, { hobbies: false, strengths: false, pinfo: false, decl: false });
const design = { ...DEFAULT_DESIGN, ...data.design };
if (demo) data.design = design;
function Done() { return null; }
createRoot(document.getElementById('shot')).render(
  <>
    <ResumePreview data={data} design={design} photo={data.showPhoto ? PHOTO_PLACEHOLDER : null} onPages={() => { window.__ready = true; }} />
    <Done />
  </>,
);
setTimeout(() => { window.__ready = true; }, 4000);
