import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {administrationUiContract} from '../scripts/testing/package-f-administration-ui-contract.mjs';
const baseline=[
  {
    "file": "src/features/users/UsersView.tsx",
    "calls": 8,
    "callHash": "13e9066f135128170513ace8be2d737da5691f305e198c979af272c51b69ab18",
    "bindings": 15,
    "bindingHash": "3050a4b37535609377df7ee053ae5227140c97080c9c50bb15dc1949b491a41b",
    "native": 21,
    "nativeHash": "f64b42dffcd13639a87d9189954b51372cfe2c2e6221cbb6d01efe95918fe570",
    "functionHash": "0bf99224af8f99acb692db18f581d9da18b75eaad446e9d94650d2655fbe10db",
    "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "policyHash": "1738bdf07eff01e2f610679adb236a66afbc5a5f487cac052805f0130dd8adac"
  },
  {
    "file": "src/features/users/UserFormModal.tsx",
    "calls": 4,
    "callHash": "d5ac7bd05eebd2b67591a945471be8604fce6ab4b3805fbfba4ab70025866440",
    "bindings": 9,
    "bindingHash": "741fd438c668404f05051ac5cffe71adce89a26dbdfdb8e5451f839e5ba66a94",
    "native": 25,
    "nativeHash": "683d8312f5c2947c6b64a42a2eafe635adc7944435e81c6bd0894db0f7a07de7",
    "functionHash": "8830b95d84c23d9b840c4d0e025c53e094157e0120e3c8015f943f0c241efb54",
    "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "policyHash": "4618e18bd193b9d7a501a7adb435b0f751f849ba7356d395c9a3c72af3114e9e"
  },
  {
    "file": "src/features/more/MonitoringDashboardModal.tsx",
    "calls": 1,
    "callHash": "0b10df701ee9c78d9722630d14a9a7b2185f207db71ebeeb40d578006505612c",
    "bindings": 2,
    "bindingHash": "85c98f2b0c944272c4c600635eaf2869e5f04a77b6e4e3d6afe932f9c50b1880",
    "native": 2,
    "nativeHash": "4f1b96411d3f9c7058c1365d2f4d9b1ecc7ba530d88a63d164074dd1330aacbc",
    "functionHash": "4d339fc54670f97eea24dcdad173d628bac711b9f144ad4c4ebdee9c459a51a9",
    "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "policyHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  },
  {
    "file": "src/features/more/StorefrontSettingsModal.tsx",
    "calls": 5,
    "callHash": "91501bf8bb1694d9379ecea9c2147db78bd1624ade2921296a27f0902f09f6b8",
    "bindings": 19,
    "bindingHash": "d4cd3bcb2440be3c979d94df7511b5194e4e87826fbe3e4b5a9dc8ccf2f41e82",
    "native": 30,
    "nativeHash": "2f3b5857390a149b5403984bfe5bab7b0ab3d8109ce89641e02e2987b32d43b0",
    "functionHash": "14fbc1ae506fb819e1bebd130bfd2d24d2686de37d4519fc218d86bc57e3f854",
    "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "policyHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  },
  {
    "file": "src/features/more/PromotionCodesModal.tsx",
    "calls": 7,
    "callHash": "adee6d41cbd060edf7d8b56cb75c426d28c283475b913dec8a9c4bd271c14777",
    "bindings": 16,
    "bindingHash": "84d99c6c37a91a01a5845c851f028633bc92830150c14156a9044323fb26fb10",
    "native": 40,
    "nativeHash": "ad8c78e69b9ead0fb4bf2bc02496f4338900ef980064fee1d8790d506bfda043",
    "functionHash": "879e1b82eab56c5f6b4a6e55eb12905df29ff5190bb3a31256c39f4c64604d7a",
    "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "policyHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
  }
];

test('batch5 preserves all calls,payloads,events,input guards and role policy ASTs',()=>{
 for(const expected of baseline)assert.deepEqual(administrationUiContract(expected.file,readFileSync(expected.file,'utf8')),expected,expected.file);
});
test('batch5 display uses shared token controls and no old colours',()=>{
 for(const expected of baseline){
  const source=readFileSync(expected.file,'utf8');
  assert.doesNotMatch(source,/(?:bg|text|border|ring|divide|accent)-(?:slate|gray|blue|violet|emerald|rose|red|amber|orange)-\d/u);
  assert.match(source,/FormFields/u);assert.match(source,/UiButton/u);assert.match(source,/<Card/u);
 }
 const form=readFileSync(baseline[1].file,'utf8');
 for(const id of ['staff-name','staff-phone','staff-email','staff-password','staff-job','staff-branch','staff-role']){
  assert.match(form,new RegExp('htmlFor="'+id+'"'));assert.match(form,new RegExp('id="'+id+'"'));
 }
 assert.match(readFileSync(baseline[4].file,'utf8'),/function formatDate\(value\?: string\): string \{\s+if \(!value\) return 'مفتوح';\s+return formatUiDate\(value, \{\s+dateStyle: 'short',\s+timeStyle: 'short',\s+\}\);\s+\}/u);
});
