// "Keep fixing it myself": opens the builder with the user's own scanned resume mapped into sections,
// or an empty builder when nothing was scanned (or only the sample). Never the sample person.
import { Navigate } from 'react-router-dom';
import { useFlow } from '../lib/flow';

export default function Editor() {
  const { report } = useFlow();
  const own = report && !report.sample && report.resume;
  const state = own ? { open: 'build', scanImport: report.resume, fileName: report.file } : { open: 'build', blank: true };
  return <Navigate to="/builder" replace state={state} />;
}
