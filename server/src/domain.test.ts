import test from 'node:test'; import assert from 'node:assert/strict'; import { approve, assets, dashboard, detectRightsConflicts, projectSummary, rightsConflicts, type Asset } from './domain.js';
test('budget summary exposes forecast variance and high risk lines', () => { const summary = projectSummary('PRJ-001'); assert.equal(summary.lines.length, 4); assert.ok(summary.forecast > summary.planned); assert.equal(summary.highRiskLines.length, 1); });
test('rights conflict engine detects overlapping licensed assets', () => { const conflicts = rightsConflicts('PRJ-001'); assert.ok(conflicts.length >= 1); assert.ok(conflicts.some(item => item.reason.includes('音乐-同步许可'))); });
test('approval changes are auditable and stateful', () => { const result = approve('APR-01', 'approved', '预算已复核'); assert.equal(result?.status, 'approved'); assert.equal(result?.comment, '预算已复核'); });

// 版权冲突判定的合成夹具：默认标签/地域/日期均重叠，仅平台不相交，
// 各用例按需覆盖单个维度，确保不会因为修复平台维度而漏掉既有规则。
function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return { id: 'AST-T1', projectId: 'PRJ-T', name: '授权记录甲', type: 'master', version: 1, status: 'approved', owner: '发行部', checksum: 'sha256:test', territories: ['CN'], platforms: ['影院'], availableFrom: '2026-01-01', availableTo: '2026-06-30', rightsTags: ['发行-窗口授权'], ...overrides };
}
function pair(bOverrides: Partial<Asset> = {}, aOverrides: Partial<Asset> = {}) {
  return [makeAsset(aOverrides), makeAsset({ id: 'AST-T2', name: '授权记录乙', ...bOverrides })];
}

test('同标签同地域同窗口但平台互不相交（影院 vs 短视频）不产生冲突', () => {
  assert.equal(detectRightsConflicts(pair({ platforms: ['短视频'] })).length, 0);
});

test('多平台授权仅在平台范围确实相交时才产生风险', () => {
  assert.equal(detectRightsConflicts(pair({ platforms: ['短视频', '流媒体'] })).length, 0);
  const conflicts = detectRightsConflicts(pair({ platforms: ['短视频', '影院'] }));
  assert.equal(conflicts.length, 1);
  assert.ok(conflicts[0].reason.includes('影院'));
  assert.equal(conflicts[0].severity, 'warning');
});

test('全局平台范围（全平台）与任意具体平台相交都会产生风险', () => {
  assert.equal(detectRightsConflicts(pair({ platforms: ['全平台'] })).length, 1);
  assert.equal(detectRightsConflicts(pair({ platforms: ['全平台', '短视频'] }, { platforms: ['影院'] })).length, 1);
  assert.equal(detectRightsConflicts(pair({ platforms: ['全平台'] }, { platforms: ['短视频'] })).length, 1);
});

test('全局地域（全球）仍按既有规则与任意地域相交', () => {
  assert.equal(detectRightsConflicts(pair({ territories: ['US', 'CA'] })).length, 0);
  assert.equal(detectRightsConflicts(pair({ territories: ['全球'] })).length, 1);
  assert.equal(detectRightsConflicts(pair({ territories: ['CN'] }, { territories: ['全球'] })).length, 1);
});

test('日期窗口边界：端点相接算重叠，隔一天不算重叠', () => {
  // availableTo 与对方 availableFrom 同一天 -> 仍有交集
  assert.equal(detectRightsConflicts(pair({ availableFrom: '2026-06-30', availableTo: '2026-12-31' })).length, 1);
  // 窗口之间存在一天空档 -> 无交集
  assert.equal(detectRightsConflicts(pair({ availableFrom: '2026-07-01', availableTo: '2026-12-31' })).length, 0);
});

test('授权标签不同或地域不相交时即使平台相同也不冲突（既有规则不回退）', () => {
  assert.equal(detectRightsConflicts(pair({ rightsTags: ['音乐-同步许可'] })).length, 0);
  assert.equal(detectRightsConflicts(pair({ territories: ['US'] })).length, 0);
});

test('任一方处于 locked 状态时冲突级别为 critical，否则为 warning', () => {
  assert.equal(detectRightsConflicts(pair({ status: 'locked' }))[0]?.severity, 'critical');
  assert.equal(detectRightsConflicts(pair({}, { status: 'locked' }))[0]?.severity, 'critical');
  assert.equal(detectRightsConflicts(pair({ status: 'review' }))[0]?.severity, 'warning');
});

test('项目接口中影院/短视频两条发行授权不会被标为冲突，而真实冲突保留且为锁定 critical', () => {
  const conflicts = rightsConflicts('PRJ-001');
  assert.ok(!conflicts.some(c => (c.assetA.includes('院线发行') && c.assetB.includes('短视频宣发')) || (c.assetA.includes('短视频宣发') && c.assetB.includes('院线发行'))));
  const music = conflicts.filter(c => c.reason.includes('音乐-同步许可'));
  assert.equal(music.length, 1);
  assert.equal(music[0].severity, 'critical');
});

test('驾驶舱风险计数与版权冲突接口保持一致，且两条发行授权已纳入资产登记', () => {
  const apiCount = rightsConflicts('PRJ-001').length;
  const prj001 = dashboard().find(item => item.id === 'PRJ-001');
  assert.equal(prj001?.rightsConflicts, apiCount);
  assert.ok(assets.some(a => a.id === 'AST-005' && a.platforms.includes('影院')));
  assert.ok(assets.some(a => a.id === 'AST-006' && a.platforms.includes('短视频')));
});
