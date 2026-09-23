import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Destructive demo actions are restricted to an explicitly named isolated container.
const container = process.env.ACCEPTANCE_CONTAINER;
const base = process.env.ACCEPTANCE_URL;
assert(container?.startsWith('career-quest-five-checks-'));
assert(base && ['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(process.env.ACCEPTANCE_OUTPUT || '.data/five-checks');
fs.mkdirSync(output, { recursive: true });
const accounts = JSON.parse(execFileSync('docker', ['exec', container, 'cat', '/app/.data/initial-access.json'], { encoding: 'utf8' })).accounts;
const hr = accounts.find(a => a.role === 'hr');
const username = 'jury-final-' + randomBytes(4).toString('hex');
const password = randomBytes(24).toString('base64url');
const employeeId = 'JURY_DEMO_001';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const report = { sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), base, mode: 'production-browser-and-http-fallback-not-live-ai', checks: [] };
const record = (name, result) => { report.checks.push({ name, ...result }); console.log(JSON.stringify({ name, ...result })); };
async function api(url, options = {}) {
  const response = await context.request.fetch(base + url, options);
  return { status: response.status(), body: await response.json() };
}
async function login(user, secret) {
  await page.locator('#login-username').fill(user);
  await page.locator('#login-password').fill(secret);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).waitFor();
}
async function upload(file) {
  await page.getByRole('button', { name: 'Загрузить данные', exact: true }).click();
  await page.getByLabel('Файл для загрузки').setInputFiles(path.resolve(file));
  const response = page.waitForResponse(r => r.url().endsWith('/api/import') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Загрузить', exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 201);
  const body = await result.json();
  await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
  return body.data;
}
try {
  const initial = await api('/api/health');
  assert.deepEqual(initial.body.data.counts, { skills: 60, roleProfiles: 32, employees: 200, events: 40, activityHistory: 2743 }, 'Use a fresh isolated demo volume');
  record('initial-health', initial.body.data);
  await page.goto(base);
  assert.equal(await page.getByText('Демо-режим:', { exact: false }).count(), 0);
  await login(hr.username, hr.password);
  record('ui-import-profile', await upload('docs/fixtures/jury-employee.json'));
  record('ui-import-history', await upload('docs/fixtures/jury-history.csv'));
  const imported = (await api(`/api/employees/${employeeId}`)).body.data;
  assert.equal(imported.readiness, 74.1);
  assert.equal(imported.activityHistory.length, 2);
  const repeated = await upload('docs/fixtures/jury-history.csv');
  assert.equal(repeated.historyInserted, 0);
  assert.equal(repeated.historySkipped, 2);
  assert.deepEqual((await api(`/api/employees/${employeeId}`)).body.data, imported);
  record('reimport-no-growth', repeated);
  await page.getByRole('button', { name: 'Доступ сотрудников', exact: true }).click();
  await page.locator('#account-employee').selectOption(employeeId);
  await page.locator('#account-username').fill(username);
  await page.locator('#account-password').fill(password);
  await page.getByRole('checkbox').check();
  const createdResponse = page.waitForResponse(r => r.url().endsWith('/api/hr/accounts') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Создать доступ', exact: true }).click();
  assert.equal((await createdResponse).status(), 201);
  await page.getByRole('button', { name: 'Закрыть доступ сотрудников', exact: true }).click();
  const hrCounts = (await api('/api/hr/accounts')).body.data.items.length;
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await login(username, password);
  await page.locator('.recommendation-card').first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Доступ сотрудников', exact: true }).count(), 0);
  const session = (await api('/api/auth/session')).body.data;
  const headers = { Origin: base, 'X-CSRF-Token': session.csrfToken };
  const countsBefore = (await api('/api/health')).body;
  const ownBefore = (await api(`/api/employees/${employeeId}`)).body.data;
  const forbidden = [
    ['/api/employees/E0178', {}],
    ['/api/employees/E0178/recommendations', {}],
    ['/api/hr/summary', {}],
    ['/api/hr/accounts', {}],
    ['/api/hr/accounts', { method: 'POST', headers, data: { username: 'forbidden-final', password, employeeId } }],
    ['/api/import', { method: 'POST', headers, multipart: { employees: { name: 'employees.json', mimeType: 'application/json', buffer: fs.readFileSync('docs/fixtures/jury-employee.json') } } }],
  ];
  for (const [url, options] of forbidden) {
    const result = await api(url, options);
    assert.equal(result.status, 403, url);
    assert.equal(result.body.error.code, 'FORBIDDEN', url);
    assert.equal(result.body.data, undefined);
    record('forbidden', { url, method: options.method || 'GET', status: result.status, code: result.body.error.code });
  }
  assert.deepEqual((await api('/api/health')).body, countsBefore);
  assert.deepEqual((await api(`/api/employees/${employeeId}`)).body.data, ownBefore);
  const started = performance.now();
  const enriched = (await api(`/api/employees/${employeeId}/recommendations`)).body.data;
  assert.deepEqual(enriched, ownBefore);
  assert(enriched.recommendations.length >= 1 && enriched.recommendations.length <= 3);
  assert(enriched.recommendations.every(r => r.explanationSource === 'fallback'));
  record('external-ai-disabled', { elapsedMs: Math.round(performance.now() - started), eventIds: enriched.recommendations.map(r => r.eventId) });
  const screenText = await page.locator('body').innerText();
  assert(screenText.includes(ownBefore.target.role));
  assert(screenText.includes(ownBefore.target.grade));
  for (const rec of ownBefore.recommendations) {
    const card = page.locator('.recommendation-card').filter({ has: page.getByRole('heading', { name: rec.title, exact: true }) });
    const text = await card.innerText();
    assert(text.includes(rec.historySignal));
    assert(text.includes(rec.deterministicExplanation));
    for (const effect of rec.expectedChanges) {
      const skill = ownBefore.skillGaps.find(g => g.skillId === effect.skillId);
      if (skill) assert(text.includes(skill.name));
      assert(text.includes(String(effect.before)) && text.includes(String(effect.after)));
    }
  }
  await page.screenshot({ path: path.join(output, 'imported-profile-fallback.png'), fullPage: true });
  const next = ownBefore.recommendations[0];
  const card = page.locator('.recommendation-card').filter({ has: page.getByRole('heading', { name: next.title, exact: true }) });
  const completionResponse = page.waitForResponse(r => r.url().includes(`/activities/${next.eventId}/complete`));
  await card.locator('button.complete-button').click();
  const completed = await completionResponse;
  assert.equal(completed.status(), 201);
  const outcome = (await completed.json()).data;
  assert(outcome.progress.delta > 0);
  assert.equal(outcome.view.activityHistory.length, 3);
  for (const [id, level] of Object.entries(ownBefore.effectiveSkills)) assert((outcome.view.effectiveSkills[id] ?? 0) >= level);
  await page.reload();
  await page.locator('.recommendation-card').first().waitFor();
  assert.deepEqual((await api(`/api/employees/${employeeId}`)).body.data, outcome.view);
  record('completion-and-reload', { eventId: next.eventId, ...outcome.progress, history: outcome.view.activityHistory.length });
  execFileSync('docker', ['restart', container], { stdio: 'pipe' });
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await api('/api/health')).status === 200) break; } catch { /* Wait for production startup. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.deepEqual((await api(`/api/employees/${employeeId}`)).body.data, outcome.view);
  record('restart-persistence', { passed: true });
  await page.reload();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await login(hr.username, hr.password);
  assert.equal((await api('/api/hr/accounts')).body.data.items.length, hrCounts);
  const summary = (await api('/api/hr/summary?department=Jury%20Demo')).body.data;
  assert.equal(summary.population, 1);
  assert.equal(summary.totalActivities, 3);
  record('hr-and-no-forbidden-account-write', { population: summary.population, totalActivities: summary.totalActivities, accountCount: hrCounts });
  report.status = 'passed';
} catch {
  report.status = 'failed';
  process.exitCode = 1;
  // Browser errors may contain credential-entry arguments. Never print them.
  console.error('Acceptance failed. Inspect the last safe check in report.json; credentials are not logged.');
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
