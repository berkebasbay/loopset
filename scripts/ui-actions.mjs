import assert from 'node:assert/strict';

// Shared current-studio navigation for isolated browser regressions. These are
// explicit product paths: missing controls fail instead of trying older UIs.
const toolPanels = new Set(['model', 'experiments', 'budget', 'history', 'worlds', 'help']);
const panelNames = {
  model: 'Model editor', experiments: 'Run experiments.', budget: 'Run limits',
  history: 'Action history', worlds: 'Choose a world', help: 'Help',
  insights: 'Run insights', compare: 'Compare plans', data: 'Files & reports',
};

export async function panelOpener(page, panel) {
  if (!Object.hasOwn(panelNames, panel)) throw new Error(`Unknown studio panel: ${panel}`);
  if (toolPanels.has(panel)) {
    await page.locator('.studio-rail').getByRole('button', { name: 'Tools', exact: true }).click();
  }
  const opener = page.locator(`[data-panel-opener="${panel}"]`);
  await opener.waitFor({ state: 'visible' });
  return opener;
}

export async function openPanel(page, panel) {
  const opener = await panelOpener(page, panel);
  await opener.click();
  await page.getByRole('dialog', { name: panelNames[panel], exact: true }).waitFor();
  return opener;
}

export function primaryRunButton(page) {
  return page.locator('.studio-command-actions').getByRole('button', { name: /^Run (simulation|& compare)$/ });
}

export async function runPlan(page) {
  const button = primaryRunButton(page);
  const compares = (await button.innerText()) === 'Run & compare';
  await button.click();
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text?.() || '{}');
    return !state.running && state.result?.status === 'completed' && !state.result.stale;
  });
  if (compares) {
    const dialog = page.getByRole('dialog', { name: 'Compare plans', exact: true });
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  }
}

export function headerProjectInput(page) {
  return page.getByLabel('Open project file', { exact: true });
}

export async function openReviewedProject(page, file) {
  await openPanel(page, 'data');
  const draft = () => page.evaluate(() => {
    const { revision, world, model } = JSON.parse(window.render_game_to_text());
    return { revision, world, model };
  });
  const beforeReview = await draft();
  await page.getByLabel('Open project JSON file', { exact: true }).setInputFiles(file);
  await page.locator('.ql-import-preview').waitFor();
  assert.deepEqual(await draft(), beforeReview, 'Reviewing a project file must leave the current draft in place until Open.');
  await page.getByRole('button', { name: 'Open this project', exact: true }).click();
  await page.getByText('Project opened. Run it to calculate results from its model.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
}

export async function showSavedScenarios(page) {
  const disclosure = page.locator('details.comparison-disclosure').filter({ has: page.locator('summary').filter({ hasText: /^Save and compare more plans$/ }) });
  if (!await disclosure.evaluate(element => element.open)) await disclosure.locator('summary').click();
  await page.getByRole('textbox', { name: 'Scenario name', exact: true }).waitFor();
}
