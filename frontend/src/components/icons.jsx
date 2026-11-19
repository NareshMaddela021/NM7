// Nm7 line icons: one set for the whole app (24 px grid, thin 1.75 stroke, round caps, colour from `currentColor`, so
// a parent's colour token decides it: navy text, purple accent). Each icon is its own named export so a page's chunk
// carries only the icons it uses (tree-shaken). Use these instead of emoji or symbol characters (a test fails on
// emoji in frontend/src). Decorative by default (aria-hidden); pass `label` when the icon alone carries meaning.
const Svg = ({ size = 18, label, className, children, ...rest }) => (
  <svg
    className={className ? `ic ${className}` : 'ic'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true', focusable: 'false' })}
    {...rest}
  >
    {children}
  </svg>
);

const make = (body) => {
  const I = (p) => <Svg {...p}>{body}</Svg>;
  return I;
};

export const IcArrowRight = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IcArrowLeft = make(<path d="M19 12H5M11 6l-6 6 6 6" />);
export const IcArrowUp = make(<path d="M12 19V5M6 11l6-6 6 6" />);
export const IcArrowDown = make(<path d="M12 5v14M6 13l6 6 6-6" />);
export const IcExternal = make(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />);
export const IcChevronRight = make(<path d="M9 6l6 6-6 6" />);
export const IcChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const IcCheck = make(<path d="M5 12l5 5L20 7" />);
export const IcCheckCircle = make(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>);
export const IcX = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IcPlus = make(<path d="M12 5v14M5 12h14" />);
export const IcEdit = make(<path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16zM13.5 6.5l4 4" />);
export const IcMail = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>);
export const IcStar = make(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />);
export const IcAlert = make(<><path d="M12 4L2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></>);
export const IcInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IcLock = make(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>);
export const IcShield = make(<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />);
export const IcMic = make(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>);
export const IcVolume = make(<><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" /></>);
export const IcRefresh = make(<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />);
export const IcSearch = make(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const IcUser = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>);
export const IcUsers = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6" /></>);
export const IcBriefcase = make(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M3 13h18" /></>);
export const IcFile = make(<><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>);
export const IcChart = make(<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8" />);
export const IcTrend = make(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />);
export const IcCalendar = make(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
export const IcClock = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IcSettings = make(<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 00-2-1.2L14 3h-4l-.5 2.5a7 7 0 00-2 1.2l-2.4-.9-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-.9a7 7 0 002 1.2L10 21h4l.5-2.5a7 7 0 002-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></>);
export const IcHome = make(<path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z" />);
export const IcMenu = make(<path d="M4 6h16M4 12h16M4 18h16" />);
export const IcBell = make(<path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0" />);
export const IcGlobe = make(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" /></>);
export const IcPhone = make(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z" />);
export const IcCamera = make(<><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /><circle cx="12" cy="13" r="3.5" /></>);
export const IcPin = make(<><path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>);
export const IcTarget = make(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>);
export const IcCap = make(<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6" />);
export const IcBook = make(<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M8 7h7" />);
export const IcSpark = make(<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />);
export const IcBolt = make(<path d="M13 3L5 13h6l-1 8 8-10h-6z" />);
export const IcMessage = make(<path d="M4 5h16v11H9l-5 4z" />);
export const IcDownload = make(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />);
export const IcUpload = make(<path d="M12 16V5M7 10l5-5 5 5M5 20h14" />);
export const IcLink = make(<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7L11.5 7M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.5-1.5" />);
export const IcTrash = make(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />);
export const IcEye = make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IcFilter = make(<path d="M4 5h16l-6 8v6l-4-2v-4z" />);
export const IcPlay = make(<path d="M7 5v14l12-7z" />);
export const IcStop = make(<rect x="6" y="6" width="12" height="12" rx="1.5" />);
export const IcSwap = make(<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />);
export const IcFlag = make(<path d="M5 21V4M5 4h11l-2 4 2 4H5" />);
export const IcScale = make(<path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 006 0zM19 8l-3 6a3 3 0 006 0z" />);
export const IcKey = make(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></>);
export const IcHeart = make(<path d="M12 20s-8-4.7-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 9c0 6.3-8 11-8 11z" />);
export const IcThumb = make(<path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 012 2v4h6a2 2 0 012 2.3l-1.2 7A2 2 0 0117.8 20H7" />);
export const IcPrint = make(<><path d="M7 9V3h10v6M7 17H4v-7a1 1 0 011-1h14a1 1 0 011 1v7h-3" /><rect x="7" y="14" width="10" height="7" /></>);
export const IcGrid = make(<><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>);
export const IcLogOut = make(<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 8l-4 4 4 4M6 12h11" />);
export const IcBuilding = make(<path d="M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16M15 9h4a1 1 0 011 1v11M3 21h18M8 8h3M8 12h3M8 16h3" />);
export const IcWallet = make(<><path d="M4 7a2 2 0 012-2h12v4M4 7v11a2 2 0 002 2h14V9H6a2 2 0 01-2-2z" /><circle cx="16" cy="14.5" r="1" /></>);
export const IcRobot = make(<><rect x="5" y="8" width="14" height="11" rx="2" /><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6" /></>);

// Icons added during the emoji sweep go in the owner's section below (keeps parallel edits from colliding).
// --- section A (Easy dashboard, individual pages, shared components) ---
// (end of section A)

export const IcDot = make(<circle cx="12" cy="12" r="3" />);
export const IcMinus = make(<path d="M5 12h14" />);
export const IcSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IcMoon = make(<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />);

// --- section B (admin, company, college, expert, recruiter, kiosk) ---
// (end of section B)

export const IcCopy = make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h8" /></>);
export const IcClip = make(<path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7" />);
export const IcHelp = make(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01" /></>);
export const IcPause = make(<path d="M8 5v14M16 5v14" />);

// --- section C (builder, public and other pages, lib) ---
// (end of section C)
