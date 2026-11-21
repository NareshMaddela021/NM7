// One "Saved" number everywhere (Batch C item 19): the tracker's saved applications plus the jobs saved on the job
// board that have no application yet. The dashboard's Applications card and the Applications page both use it.
import { useEffect, useState } from 'react';
import { http } from '../../services/http';

/** The jobs saved on the job board (GET /api/me/saved-jobs), [] until they load or when the request fails. */
export function useBoardSaved() {
  const [items, setItems] = useState([]);
  useEffect(() => { let on = true; http('/api/me/saved-jobs').then((r) => on && setItems(r.items || []), () => {}); return () => { on = false; }; }, []);
  return items;
}

/** Board-saved jobs not already in the tracker (an application with that job counts once, in its own column). */
export const savedOnBoard = (apps, board) => {
  const inTracker = new Set(apps.map((a) => a.jobId).filter(Boolean));
  return board.filter((j) => !inTracker.has(j.id));
};

/** How many applications are in a stage; "saved" adds the job board's saved jobs. */
export const stageCount = (apps, board, k) => apps.filter((a) => a.status === k).length + (k === 'saved' ? savedOnBoard(apps, board).length : 0);
