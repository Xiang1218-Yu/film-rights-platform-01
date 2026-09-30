import test from 'node:test'; import assert from 'node:assert/strict'; import { approve, dashboard, detectRightsConflicts, projectSummary, rightsConflicts } from './domain.js'; import type { Asset } from './domain.js';
test('budget summary exposes forecast variance and high risk lines', () => { const summary = projectSummary('PRJ-001'); assert.equal(summary.lines.length, 4); assert.ok(summary.forecast > summary.planned); assert.equal(summary.highRiskLines.length, 1); });
test('rights conflict engine detects overlapping licensed assets', () => { const conflicts = rightsConflicts('PRJ-001'); assert.ok(conflicts.length >= 1); assert.ok(conflicts.some(item => item.reason.includes('音乐-同步许可'))); });
test('approval changes are auditable and stateful', () => { const result = approve('APR-01', 'approved', '预算已复核'); assert.equal(result?.status, 'approved'); assert.equal(result?.comment, '预算已复核'); });

const asset = (overrides: Partial<Asset>): Asset => ({ id: 'TST', projectId: 'PRJ-TEST', name: '测试资产', type: 'master', version: 1, status: 'approved', owner: '发行部', checksum: 'sha256:test', territories: ['CN'], platforms: ['影院'], availableFrom: '2026-01-01', availableTo: '2026-12-31', rightsTags: ['音乐-同步许可'], ...overrides });

test('disjoint platforms do not conflict even with same tag, territory and window', () => { const cinema = asset({ name: '影院授权', platforms: ['影院'] }); const shortVideo = asset({ name: '短视频授权', platforms: ['短视频'] }); assert.deepEqual(detectRightsConflicts([cinema, shortVideo]), []); });
test('multi-platform assets conflict only when platform scopes intersect', () => {
  const overlapping = detectRightsConflicts([asset({ name: 'A', platforms: ['影院', 'StreamBox'] }), asset({ name: 'B', platforms: ['StreamBox', '短视频'] })]);
  assert.equal(overlapping.length, 1); assert.ok(overlapping[0].reason.includes('StreamBox'));
  assert.deepEqual(detectRightsConflicts([asset({ platforms: ['影院'] }), asset({ platforms: ['短视频', 'OTT'] })]), []);
});
test('global territory scope still matches any territory', () => {
  assert.equal(detectRightsConflicts([asset({ territories: ['全球'] }), asset({ territories: ['CN'] })]).length, 1);
  assert.equal(detectRightsConflicts([asset({ territories: ['US'] }), asset({ territories: ['全球'] })]).length, 1);
  assert.deepEqual(detectRightsConflicts([asset({ territories: ['CN'] }), asset({ territories: ['US'] })]), []);
});
test('availability window boundaries are inclusive and gaps clear the conflict', () => {
  const first = asset({ availableFrom: '2026-01-01', availableTo: '2026-06-30' });
  assert.equal(detectRightsConflicts([first, asset({ availableFrom: '2026-06-30', availableTo: '2026-12-31' })]).length, 1);
  assert.equal(detectRightsConflicts([first, asset({ availableFrom: '2025-07-01', availableTo: '2026-01-01' })]).length, 1);
  assert.deepEqual(detectRightsConflicts([first, asset({ availableFrom: '2026-07-01', availableTo: '2026-12-31' })]), []);
  assert.deepEqual(detectRightsConflicts([first, asset({ availableFrom: '2025-01-01', availableTo: '2025-12-31' })]), []);
});
test('locked asset escalates the conflict to critical', () => {
  const locked = detectRightsConflicts([asset({ name: '锁定资产', status: 'locked' }), asset({ name: '在审资产', status: 'review' })]);
  assert.equal(locked.length, 1); assert.equal(locked[0].severity, 'critical');
  const unlocked = detectRightsConflicts([asset({ status: 'review' }), asset({ status: 'approved' })]);
  assert.equal(unlocked.length, 1); assert.equal(unlocked[0].severity, 'warning');
});
test('rights tag mismatch clears the conflict even with same platform, territory and window', () => { assert.deepEqual(detectRightsConflicts([asset({ rightsTags: ['音乐-同步许可'] }), asset({ rightsTags: ['演员-宣传许可'] })]), []); });
test('seed project keeps its real conflict and dashboard counts stay consistent with the API', () => {
  const conflicts = rightsConflicts('PRJ-001'); assert.equal(conflicts.length, 1); assert.equal(conflicts[0].severity, 'critical'); assert.ok(conflicts[0].reason.includes('音乐-同步许可'));
  for (const row of dashboard()) assert.equal(row.rightsConflicts, rightsConflicts(String(row.id)).length);
});
