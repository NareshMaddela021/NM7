import { createContext, useContext, useState } from 'react';

export const ROLE_MAX = 60;

/** Shared state for the Scan → Checkout → Track journey. The scanned file stays in memory (never uploaded). */
const FlowCtx = createContext(null);

export function FlowProvider({ children }) {
  const [role, setRoleRaw] = useState('Data Analyst');
  const [upload, setUpload] = useState(null); // File to scan next, or 'sample'
  const [report, setReport] = useState(null); // the last scan report (includes the builder-ready resume)
  const [orderId, setOrderId] = useState(null);
  const [addon, setAddon] = useState(false);
  const setRole = (v) => setRoleRaw(String(v ?? '').slice(0, ROLE_MAX));
  return (
    <FlowCtx.Provider value={{ role, setRole, upload, setUpload, report, setReport, orderId, setOrderId, addon, setAddon }}>
      {children}
    </FlowCtx.Provider>
  );
}

export const useFlow = () => useContext(FlowCtx);
