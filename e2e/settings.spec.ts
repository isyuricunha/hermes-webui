import { expect, test } from '@playwright/test';

/**
 * Settings E2E: search finds the acceptance-criteria dotpaths and the field
 * editor changes the REAL config (save -> confirmed by re-read -> restore).
 */
test.describe('settings', () => {
  test('search finds memory.nudge_interval by label and dotpath', async ({ page }) => {
    await page.goto('/settings/models');
    const search = page.getByLabel('Search settings');
    await search.fill('nudge');
    await expect(page.getByText('memory.nudge_interval')).toBeVisible();
    await search.fill('memory.nudge_interval');
    await expect(page.getByText('memory.nudge_interval').first()).toBeVisible();
  });

  test('edits memory.nudge_interval on the real config and restores it', async ({ page }) => {
    await page.goto('/settings/field?path=memory.nudge_interval');

    const input = page.getByLabel('Value for memory.nudge_interval');
    await expect(input).toBeVisible();
    const original = await input.inputValue();
    const changed = original === '36' ? '35' : '36';

    await input.fill(changed);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved and confirmed by re-read.')).toBeVisible({ timeout: 30_000 });

    // Restore the original value.
    await input.fill(original);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved and confirmed by re-read.')).toBeVisible({ timeout: 30_000 });
  });

  test('raw config editor loads and validates', async ({ page }) => {
    await page.goto('/settings/advanced/config');
    const editor = page.getByLabel('Raw config.yaml');
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor).toHaveValue(/model:/, { timeout: 30_000 });
  });

  test('mcp servers list renders', async ({ page }) => {
    await page.goto('/settings/mcp');
    await expect(page.getByText('cloudflare').first()).toBeVisible({ timeout: 30_000 });
  });

  test('system page shows hermes running', async ({ page }) => {
    await page.goto('/settings/system');
    await expect(page.getByText(/Running · 0\.21\.3/)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('cli bridge', () => {
  test('runs an allowed command and blocks hermes update', async ({ page }) => {
    await page.goto('/settings/advanced/cli');

    await page.getByRole('button', { name: 'Run' }).first().click();
    await expect(page.getByText(/exit 0/).first()).toBeVisible({ timeout: 60_000 });

    await page.getByLabel('Hermes command').fill('hermes update');
    await page.getByRole('button', { name: 'Run', exact: true }).last().click();
    await expect(page.getByText('This command is not on the read-only allowlist')).toBeVisible();
  });
});
