import assert from 'node:assert/strict';

export const coreBrowserGroups = Object.freeze(['chromium', 'webkit']);
const projectsByGroup = Object.freeze({
  chromium: ['desktop-chromium', 'mobile-chromium'],
  webkit: ['mobile-webkit'],
});

// Scheduling only. Original projects, devices, workers, timeouts and retries
// remain intact. A future project cannot silently disappear from delivery.
export function selectCoreBrowserProjects(projects, group) {
  if (group === undefined || group === '') return projects;
  assert.ok(coreBrowserGroups.includes(group), 'CORE_BROWSER_GROUP_INVALID');
  assert.deepEqual(projects.map(project => project.name).sort(),
    Object.values(projectsByGroup).flat().sort(), 'CORE_BROWSER_PROJECT_INVENTORY_CHANGED');
  return projects.filter(project => projectsByGroup[group].includes(project.name));
}

export function verifyCoreBrowserPartition(full, parts) {
  assert.equal(parts.length, coreBrowserGroups.length, 'CORE_BROWSER_GROUP_MISSING');
  const keys = rows => rows.map(row => row.key);
  for (const rows of [full, ...parts, parts.flat()]) {
    assert.ok(rows.length > 0, 'CORE_BROWSER_GROUP_EMPTY');
    assert.equal(new Set(keys(rows)).size, rows.length, 'CORE_BROWSER_DUPLICATE');
  }
  for (const [index, rows] of parts.entries()) {
    assert.ok(rows.every(row => projectsByGroup[coreBrowserGroups[index]].includes(row.project)),
      'CORE_BROWSER_PROJECT_MISROUTED');
  }
  assert.deepEqual(keys(parts.flat()).sort(), keys(full).sort(), 'CORE_BROWSER_COVERAGE_CHANGED');
  return Object.fromEntries(parts.map((rows, index) => [coreBrowserGroups[index], rows.length]));
}
