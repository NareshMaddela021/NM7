// The builder's templates as the home page needs them (name and filters only), so Home never loads builder code.
// templateMeta.test.js keeps this list identical to TEMPLATE_PRESETS in builder/design.js: add a template there and
// the test says to add it here (and to run scripts/home-images/make.mjs for its thumbnail).
export const TEMPLATES = [
  { id: "fresher", name: "Fresher First", level: "fresher", ind: ["tech", "sales"], photo: false },
  { id: "campus", name: "Campus", level: "fresher", ind: ["tech", "govt", "care"], photo: false },
  { id: "starter", name: "Starter", level: "fresher", ind: ["sales", "govt", "care"], photo: false },
  { id: "work", name: "Work-first", level: "all", ind: ["sales", "care"], photo: false },
  { id: "kio", name: "Kio", level: "fresher", ind: ["govt"], photo: false },
  { id: "classic", name: "Classic", level: "all", ind: ["govt", "mgmt"], photo: false },
  { id: "formal", name: "Formal", level: "all", ind: ["govt"], photo: false },
  { id: "modern", name: "Modern", level: "experienced", ind: ["tech", "sales"], photo: false },
  { id: "stack", name: "Stack", level: "all", ind: ["tech"], photo: false },
  { id: "mono", name: "Minimal Mono", level: "all", ind: ["tech", "creative"], photo: false },
  { id: "compact", name: "Compact", level: "experienced", ind: ["tech", "mgmt"], photo: false },
  { id: "impact", name: "Impact", level: "experienced", ind: ["sales", "mgmt"], photo: false },
  { id: "executive", name: "Executive", level: "experienced", ind: ["mgmt"], photo: false },
  { id: "accent", name: "Accent", level: "all", ind: ["creative", "sales"], photo: false },
  { id: "twocol", name: "Two Column Light", level: "experienced", ind: ["tech", "creative"], photo: false },
  { id: "sidebar", name: "Sidebar", level: "experienced", ind: ["tech"], photo: false },
  { id: "care", name: "Care", level: "all", ind: ["care"], photo: false },
  { id: "portrait", name: "Portrait", level: "all", ind: ["creative", "care", "sales"], photo: true },
];
export const TEMPLATE_COUNT = TEMPLATES.length;
