import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {authUiContract} from '../scripts/testing/package-f-auth-ui-contract.mjs';
import {strictProductLegacySource} from './strict-product-legacy-source';
const baseline=[
 {
  "file": "src/features/auth/LoginView.tsx",
  "calls": 3,
  "callHash": "b85fa8bba15653fd6174130231ab5c28252c90100e04a18700d8d9e4296d661a",
  "bindings": 10,
  "bindingHash": "89c783fa57ead492158d8c10553ca1d082d347b9cb0afc2fe4a5b4b4e57e60a9",
  "native": 24,
  "nativeHash": "ee6b6458c0aae357c6268016ef8d56782ab3db9de0e281da29b36bce4c564d27",
  "functionHash": "95d11e496142c7ce15f049813728a3259755d42a32812d923c39713c82fc7585",
  "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "stateHash": "2c08c06f578c04500b6dda6f3940235f77abd3fe0ee38c1dfd545c8e0e4c3945",
  "conditionHash": "a78d3a214ce099b4f82cdd27bcc3bb31a95481bd643389dbb53296281370578f"
 },
 {
  "file": "src/features/auth/TurnstileWidget.tsx",
  "calls": 0,
  "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "bindings": 0,
  "bindingHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "native": 0,
  "nativeHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "functionHash": "ff2d41301fe0126f6fb596a6e7ff05b7d05fe44a9221ae76cd2db19083b5b94e",
  "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "stateHash": "cec04ca4c8addb1e86960f1a1430976c8dff4c5775fe610a46fb4c4c707dfd94",
  "conditionHash": "b811ac938f592d6e15356bf0cfbce3a7a46bba9a627e8ae375aa26cec24ba7e9"
 },
 {
  "file": "src/components/layout/IPhoneContainer.tsx",
  "calls": 4,
  "callHash": "0c6c123fbd64c9eb99b0915acc277e3e71096ef30f6e0617c74372f9d8a0c912",
  "bindings": 9,
  "bindingHash": "e19b785e1b945623c365bb2300624d88ef79f420f541a6d1f7112da4b3669c6f",
  "native": 20,
  "nativeHash": "806e9257948ccdc0225c5b1382c5688c01966f381abd30e85e42adfdc3bfa1d9",
  "functionHash": "ca4bbb0a36d7c194b4ffc43dca24d9173af616a14d4671c7015e50a413b697af",
  "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "stateHash": "037169086fbdfa910829149431e35be3acdfa6e7638f02adee0ff9252f4ea267",
  "conditionHash": "87e926561abce0f6371276fbea751a1fd572cb3f038d084be1f2c64777bf484a"
 },
 {
  "file": "src/features/assistant/AdminAssistantView.tsx",
  "calls": 1,
  "callHash": "eaa1dfdc826ff1d74161a18795f5e8db655de2aef147346a36467e0cc9c066c8",
  "bindings": 5,
  "bindingHash": "95fb8222eb5b91b8dcea535d991a23672f786f239dec322bbf68342168aa77a5",
  "native": 11,
  "nativeHash": "27cf65536dfc38990feee8a86ca14636311a0a1e0980bc4de30c46daa773e05d",
  "functionHash": "32a639d76ec96008df933e793753785c27b25a5e075cb4b069c2fcd257e40812",
  "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "stateHash": "a8cb21d4ce98ed32927c8f93d125675b231f293f49faf05eb63328f0453f8c13",
  "conditionHash": "fb2245cbf9e7ca3522d465cbefcdbeeb6af5968c8df83019d3949e08ea274d3b"
 },
 {
  "file": "src/App.tsx",
  "calls": 0,
  "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "bindings": 0,
  "bindingHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "native": 0,
  "nativeHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  // Re-pinned for the owner-approved go-live setup route (lazy view + one tab case);
  // calls, bindings, guards and conditions are unchanged.
  "functionHash": "80661c02a4107040cb917a3983376bd327635ada9f28fe73322c4cee42dc73bd",
  "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "stateHash": "a5a74ddbdfc6016c14fa60fe87a82be9b737dba759d50c95cf6a3173e7b5a0b0",
  "conditionHash": "a85d300cd773db70175af52e9d069daea7160ca8e7b64c4229f96eb6bb4eacee"
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
  "stateHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "conditionHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
 },
 {
  "file": "src/features/products/ProductFormModal.tsx",
  "calls": 13,
  "callHash": "3aa8347b9e4a6b2a8a5b068b75edab07aed2be3bbc5f8a6d576f9db498792999",
  "bindings": 36,
  "bindingHash": "ee4d3a4b6bda3d9557bf721c61af6830ac4e605900dcf9c137ddd61b07aaf8f0",
  "native": 85,
  "nativeHash": "8a7b7428af33057ef9673a4423345ae99689a0e951f7a6effb638ff9104e8dbe",
  "functionHash": "b83bee11080febbb2b9bdfd42889b391617400c241751ab26da426d7a80fef92",
  "guardHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "stateHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "conditionHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
 }
];
const security=[
 {
  "file": "src/stores/useAuthStore.ts",
  "sha": "148ffcd627c153c4afbec1516ca9c51190fffccaf6f3e5c75d7804594a1775a4"
 },
 {
  "file": "src/stores/useAppStore.ts",
  "sha": "04f45f57e14ae06610fc5aec16ee5f9396eb8a7928c97afc7d1593ea1539afe9"
 },
 {
  "file": "src/services/sessionSecurity.service.ts",
  "sha": "923504f53fe0cace7485fbae008ac4e6896191dc5f02263677d35d15f80c2744"
 },
 {
  "file": "src/services/supabase/adminAssistant.service.ts",
  "sha": "f2a8fded6743960d9c611dea6a9e5cd10b5c3a2d23c3229c0c99680536ef3da3"
 },
 {
  "file": "src/components/layout/sideNavigationModel.ts",
  // Re-pinned: one rail label for the owner-only go-live item; isVisibleToRole is unchanged.
  "sha": "c934fa1e992c882ae6611b9badaa0d132286a5423007ef33db974cd97fd1b020"
 }
];
for(const expected of baseline)test('Batch6 presentation preserves all business/auth AST: '+expected.file,()=>{
 assert.deepEqual(authUiContract(expected.file,strictProductLegacySource(expected.file,readFileSync(expected.file,'utf8'))),expected);
});
for(const expected of security)test('Batch6 security source remains exact except approved erased cleanup type: '+expected.file,()=>{
 let source=strictProductLegacySource(expected.file,readFileSync(expected.file,'utf8'));
 if(expected.file==='src/stores/useAppStore.ts'){
  const annotation='const unsubscribe: () => void = storeEngine.subscribe';
  assert.equal(source.split(annotation).length-1,1);
  source=source.replace(annotation,'const unsubscribe = storeEngine.subscribe');
 }
 assert.equal(createHash('sha256').update(source).digest('hex'),expected.sha);
});
test('Batch6 screens use semantic tokens without fixed legacy colours',()=>{
 for(const {file} of baseline.slice(0,5))assert.doesNotMatch(readFileSync(file,'utf8'),/(?:bg|text|border|ring|from|via|to)-(?:slate|blue|gray|violet|indigo|emerald|red|rose|amber)-\d/u,file);
});
test('Switch track is visual only and preserves distinct solid state tokens',()=>{
 const source=readFileSync('src/components/ui/SwitchTrack.tsx','utf8');
 assert.match(source,/enabled \? 'bg-nw-ok' : 'bg-nw-muted'/u);
 assert.doesNotMatch(source,/onClick|useEffect|\.rpc|localStorage/u);
 for(const file of ['src/features/more/StorefrontSettingsModal.tsx','src/features/products/ProductFormModal.tsx'])assert.match(readFileSync(file,'utf8'),/<SwitchTrack enabled=/u);
});
