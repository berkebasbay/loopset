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
  return { async setInputFiles(files) {
    const dialog = page.getByRole('dialog', { name: panelNames.data, exact: true });
    if (!await dialog.count()) await openPanel(page, 'data');
    await page.getByRole('tab', { name: 'Projects', exact: true }).click();
    await page.getByLabel('Open project JSON file', { exact: true }).setInputFiles(files);
    await page.getByRole('button', { name: 'Open this project', exact: true }).click();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  } };
}

/** Pan the real canvas; object-caption buttons have their own selection behavior. */
export async function uncoveredCanvasPoint(page) {
  return page.locator('.world-scene').evaluate(host => {
    const canvas = host.querySelector('canvas'), bounds = canvas.getBoundingClientRect();
    for (const y of [.04, .12, .6, .85]) for (const x of [.45, .2, .7, .85]) {
      const point = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y };
      if (document.elementFromPoint(point.x, point.y) === canvas) return point;
    }
    throw new Error('No uncovered canvas point is available for a real pan.');
  });
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
  await page.getByRole('dialog', { name: panelNames.compare, exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Scenario name', exact: true }).waitFor();
}
