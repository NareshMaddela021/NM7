import { describe, expect, it } from 'vitest';
import { apiBase, bucketRows, countTiles, exportFilters, exportNote, joinBars, memberStatus, remindSummary, staffSummary } from './orgDashboard';

describe('organization dashboard helpers', () => {
  it('api base: admin console vs one organization', () => {
    expect(apiBase()).toBe('/api/admin');
    expect(apiBase('org 1')).toBe('/api/org/org%201');
  });

  it('dashboard aggregates → tiles, chart rows and buckets', () => {
    const counts = { joined: 12, pending: 2, approved: 9, rejected: 1, complete: 7, incomplete: 4, needsChanges: 1, ready: 5, printed: 3, readyNotPrinted: 2 };
    const tiles = countTiles(counts);
    expect(tiles.map(([l, v]) => [l, v])).toEqual([
      ['Joined', 12], ['Pending approval', 2], ['Approved', 9], ['≥ 80% complete', 7], ['Incomplete', 4],
      ['Needs changes', 1], ['Ready', 5], ['Printed', 3], ['Ready & not printed', 2],
    ]);
    expect(tiles.find(([l]) => l === 'Ready & not printed')[2]).toEqual({ readyNotPrinted: true });
    expect(tiles.find(([l]) => l === 'Pending approval')[2]).toEqual({ approval: 'pending' });
    expect(countTiles({}).every(([, v]) => v === 0)).toBe(true);
    const bars = joinBars([{ day: '2026-10-15', n: 3 }, { day: '2026-10-16', n: 0 }]);
    expect(bars).toEqual([{ label: '15 Oct', joins: 3 }, { label: '16 Oct', joins: 0 }]);
    expect(bucketRows({ low: 1, mid: 2, high: 3 })).toEqual([{ label: '0–39%', value: 1 }, { label: '40–79%', value: 2 }, { label: '80–100%', value: 3 }]);
  });

  it('export filtering: drops view-only and approval filters, adds onlyReady', () => {
    const f = { group: 'g1', approval: 'pending', q: 'asha', incomplete: false, notPrinted: true, page: 3, fieldKey: '' };
    expect(exportFilters(f)).toEqual({ group: 'g1', q: 'asha', notPrinted: true });
    expect(exportFilters(f, { onlyReady: true })).toEqual({ group: 'g1', q: 'asha', notPrinted: true, onlyReady: true });
    expect(exportFilters()).toEqual({});
  });

  it('reminder results in words', () => {
    expect(remindSummary({ sent: 41, skipped: 6, reasons: { recent: 4, optedOut: 2, overLimit: 0, failed: 0 } }))
      .toBe('Sent 41, skipped 6: 4 reminded in the last 24 h, 2 opted out');
    expect(remindSummary({ sent: 3, skipped: 0, reasons: {} })).toBe('Sent 3');
    expect(remindSummary({ emailed: 1, skipped: 0 }, 'Emailed')).toBe('Emailed 1');
  });

  it('member status', () => {
    expect(memberStatus({ approval: 'pending', reviewStatus: 'none' }).label).toBe('Pending approval');
    expect(memberStatus({ approval: 'approved', reviewStatus: 'needs_changes' }).label).toBe('Needs changes');
    expect(memberStatus({ approval: 'approved', reviewStatus: 'ready' }).label).toBe('Ready');
    expect(memberStatus({ approval: 'approved', reviewStatus: 'none' }).label).toBe('Approved');
    expect(memberStatus({ approval: 'rejected' }).label).toBe('Not approved');
  });

  it('role-accurate texts: the "You help run" card and the export note', () => {
    expect(staffSummary({ role: 'viewer', allGroups: true })).toBe('Viewer · view and print');
    expect(staffSummary({ role: 'coordinator', allGroups: true })).toBe('Coordinator · groups, approvals, reminders and printing');
    expect(staffSummary({ role: 'coordinator', allGroups: false })).toBe('Coordinator · groups, approvals, reminders and printing · some groups');
    expect(staffSummary({ role: 'viewer', allGroups: false })).toBe('Viewer · view and print · some groups');
    expect(staffSummary({ role: 'viewer' })).not.toMatch(/remind/);
    expect(exportNote('viewer')).toBe('Exports include approved members only. Combined PDF marks those resumes as printed. Exports never include ID numbers.');
    expect(exportNote('viewer')).not.toMatch(/ZIP/);
    expect(exportNote('coordinator')).toMatch('Combined PDF and ZIP mark those resumes as printed.');
    expect(exportNote('admin', true)).toMatch('the pending / rejected rows shown here are left out');
  });
});
