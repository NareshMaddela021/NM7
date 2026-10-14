import { createContext, useContext, useState } from 'react';

/** Shared state for the Scan → Checkout → Track journey. */
const FlowCtx = createContext(null);

export function FlowProvider({ children }) {
  const [role, setRole] = useState('Data Analyst');
  const [report, setReport] = useState(null);
  const [fixed, setFixed] = useState({});
  const [orderId, setOrderId] = useState(null);
  const [addon, setAddon] = useState(false);
  return (
    <FlowCtx.Provider value={{ role, setRole, report, setReport, fixed, setFixed, orderId, setOrderId, addon, setAddon }}>
      {children}
    </FlowCtx.Provider>
  );
}

export const useFlow = () => useContext(FlowCtx);
