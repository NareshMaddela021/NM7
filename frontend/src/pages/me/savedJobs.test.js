// Batch C item 19: the same Saved count on the dashboard and the Applications page.
import { describe, expect, it } from 'vitest';
import { savedOnBoard, stageCount } from './savedJobs';

describe('stageCount', () => {
  const apps = [{ id: 'a1', status: 'saved' }, { id: 'a2', status: 'applied', jobId: 'j2' }, { id: 'a3', status: 'saved', jobId: 'j3' }];
  const board = [{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }];
  it('adds the job board saved jobs that have no application', () => {
    expect(savedOnBoard(apps, board).map((j) => j.id)).toEqual(['j1']);
    expect(stageCount(apps, board, 'saved')).toBe(3);
    expect(stageCount(apps, board, 'applied')).toBe(1);
  });
  it('is the tracker alone before the board loads', () => {
    expect(stageCount(apps, [], 'saved')).toBe(2);
  });
});
