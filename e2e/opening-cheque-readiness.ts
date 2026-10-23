import {expect,type Page} from './isolated-test';

/** The cheque read settles after the sibling branch card's initial effects.
 * A synthetic select fired before that mount completes can be overwritten by
 * its initial controlled-value reconciliation. Wait for actual UI readiness. */
export async function chooseOpeningMainBranch(page:Page){
  await expect(page.getByTestId('go-live-card-cheques')).toContainText('وارد قيد الانتظار:');
  const card=page.getByTestId('go-live-main-branch'),select=card.getByRole('combobox');
  await select.selectOption('golive-branch');
  await expect(select).toHaveValue('golive-branch');
  await expect(card.getByRole('button')).toBeEnabled();
  await card.getByRole('button').click();
}
