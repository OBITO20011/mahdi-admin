import {registerDialogFocusContract} from './helpers/dialog-focus-contract';
import {test} from './isolated-test';

test.describe('shared production dialog behavior',()=>{
  registerDialogFocusContract('Admin','http://127.0.0.1:4173');
  registerDialogFocusContract('Customer',process.env.CUSTOMER_BASE_URL??'http://127.0.0.1:4174');
});
