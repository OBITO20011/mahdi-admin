import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FormFields} from '../src/components/ui/FormFields';
import {UiButton} from '../src/components/ui/Controls';

// Captured from delivered891c9a4 BEFORE any batch1 source edits.
const baseline=[
  {"file":"src/components/ui/Controls.tsx","calls":0,"callHash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","bindings":2,"bindingHash":"25883aa9cdeb12c2472812cddac7e7324c1fc7ad888a2a8e78eb3267bf047d57","handlers":{}},
  {
    "file": "src/components/common/Modal.tsx",
    "calls": 0,
    "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "bindings": 5,
    "bindingHash": "16ac7506d5de38b1586373350b8fc286d4471d92752e5f04c67157271b2e01b7",
    "handlers": {}
  },
  {
    "file": "src/features/more/MoreMenuView.tsx",
    "calls": 3,
    "callHash": "37ee31234a5d37e7ffdbaf60976765b94b714ab5e8e37e6c8ff2929c4bb10f0d",
    "bindings": 10,
    "bindingHash": "ddb4bef8ce81b911c280f634976e58fca919cba4532ad6f9dba295164e08ec31",
    "handlers": {
      "handleBiometricToggle": {"sha256":"53c6b44fccda8ea59435cd500c1bd762c598c61fa0a2d7443dc5e1549d3afe09"},
      "handleNavigationAction": {"sha256":"53feb6e3d893269bb25bb1e9d99994c858097eb40354d6ded7688f8cbff1a675"}
    }
  },
  {
    "file": "src/features/more/ProfileModal.tsx",
    "calls": 15,
    "callHash": "d9ca6de203e5a940a7d095afdf77f3d4496f0f65dcea67fbfb57390e4337bb5e",
    "bindings": 37,
    "bindingHash": "18af376073d8158cc703548bf28ea4b13ebaada457733481f8c20a92762f763e",
    "handlers": {
      "handleBiometricToggle": {"sha256":"a6b87c1a986210c7dbddf0160da7a35c584bda8f6330e7983b38a257baedc73b"},
      "refreshMfaStatus": {"sha256":"30f350364e890590590c12dbfea8bb2bc57855d264e0358a34544d4c844aa9a9"},
      "handleBeginMfaEnrollment": {"sha256":"25fe081d5616f0ef2193a77e7b2aba6e96468068325160cde88570a0f7b3c2fd"},
      "handleVerifyMfaEnrollment": {"sha256":"c85e98733d50c8192fec50862db64f118947f95961036d8b133598c23e4e3ef8"},
      "handleCancelMfaEnrollment": {"sha256":"5f5e79d080d1cbb9ffbd799772f37307a345961aade6c81d767e745bbbf2c134"},
      "handleDisableMfa": {"sha256":"adc2b326b88a3310d264d5ae6c6a0c302b8965be8f6d110d0aa686422bbce82a"},
      "handleCopyMfaSecret": {"sha256":"a8d8072ba970dc138660e0c50831d2787937046ec171daca19970de016c7220b"},
      "handleAttemptClose": {"sha256":"ebca89a26ac47b08c49974c22e334736412366192df6bdd07c8b96e73bfd0e41"},
      "handleSaveProfile": {"sha256":"5c4102f982a2a52602149f62461b7b912f89c0e3b2234e8558ad1adec6235707"},
      "refreshResult": {"sha256":"781b3b5a24c625bb48bebe7e48a0dc9474f3c3fdd6ef9c1a49c7794ae6aee1ab"},
      "handleSavePassword": {"sha256":"2751523925dbfc771937a1a03dc0cf8a0330b830f1900f728f5abf20659185a6"},
      "handleSaveNotifications": {"sha256":"7702021bd7bb54bf78a19beddb936a5dca949cccb7d7f9cd5bc7d7bc3489e658"}
    }
  },
  {
    "file": "src/features/more/InstallAppPanel.tsx",
    "calls": 2,
    "callHash": "d346725f8caf4bb154fe49575b8fb6d10eb9c9e60b54cdb8276beea2057543c6",
    "bindings": 3,
    "bindingHash": "e1f0e3a118ed2b31d890239ed9a69f26cbe518f68526b73317fba09b6c7fa22f",
    "handlers": {
      "handleInstallPrompt": {"sha256":"a8356151d3879d8571575a7275d48ad05fcd71b3be0bd118d1a677607708e9be"},
      "handleInstalled": {"sha256":"92dff393c22be8e311f54cc173ad592cc7bf2b885616175d6dd2664959dbbaed"},
      "handleInstall": {"sha256":"f41ecdf453f32620831101d39190e8c086a09761111acec6e7ddc1ab3d1e2802"}
    }
  },
  {
    "file": "src/features/more/PushNotificationControls.tsx",
    "calls": 5,
    "callHash": "181aa06e930c3b1fb02a371fda519064f2421da27c4cb0b89753fcda155b6efe",
    "bindings": 2,
    "bindingHash": "da77ceacc41fe0255e50c3490b8c98c0b1614778689ebb80ec237ca2eb5d4a32",
    "handlers": {
      "refreshState": {"sha256":"d5e558abd02c26de71da2cc10dbb80ddf3e9691ed285f151c505e631d869092d"},
      "runAction": {"sha256":"5a5ed054574bff8e051b809cc8d578b3b223fa7d1d2a5f9c736d759de203c0eb"}
    }
  },
  {
    "file": "src/features/more/adminNavigation.config.ts",
    "calls": 0,
    "callHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "bindings": 0,
    "bindingHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    "handlers": {}
  }
] as const;
const printer=ts.createPrinter({removeComments:true});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('batch1 business calls,handlers and ALL event/value bindings match891c9a4 exactly',()=>{
  for(const expected of baseline){
    const ast=ts.createSourceFile(expected.file,readFileSync(expected.file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const calls:string[]=[],bindings:string[]=[],handlers:Record<string,{sha256:string}>={};
    function visit(n:ts.Node){
      if(ts.isAwaitExpression(n)||ts.isCallExpression(n)&&/(?:FromSupabase|Service|\.rpc$|^run[A-Z]|^openModal$)/u.test(n.expression.getText(ast)))calls.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));
      if(ts.isJsxAttribute(n)&&/^on[A-Z]/u.test(n.name.getText(ast))&&n.initializer)bindings.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));
      if(ts.isVariableDeclaration(n)&&/^handle|^refresh|^runAction$/u.test(n.name.getText(ast))&&n.initializer)handlers[n.name.getText(ast)]={sha256:hash(printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast))};
      ts.forEachChild(n,visit);
    }
    visit(ast);assert.equal(calls.length,expected.calls,expected.file);assert.equal(hash(calls.sort()),expected.callHash,expected.file);
    assert.equal(bindings.length,expected.bindings,expected.file);assert.equal(hash(bindings.sort()),expected.bindingHash,expected.file);
    assert.deepEqual(handlers,expected.handlers,expected.file);
  }
});
test('batch1 surfaces use semantic tokens;QR retains white scanner backing only',()=>{
  for(const {file} of baseline)assert.doesNotMatch(readFileSync(file,'utf8'),/(?:bg|text|border|accent|from|via|to|shadow)-(?:slate|blue|gray|red|rose|emerald|amber|purple|violet|indigo|cyan|teal)-\d/u,file);
  const modal=readFileSync('src/components/common/Modal.tsx','utf8');
  assert.match(modal,/bg-nw-side\/80/u);assert.match(modal,/data-state="opening"/u);assert.match(modal,/onAnimationComplete/u);
  assert.match(modal,/!edited.current && !closeDisabled/u);assert.match(modal,/data-unsaved/u);assert.match(modal,/<FormFields/u);
  const fields=readFileSync('src/components/ui/form-fields.css','utf8');assert.match(fields,/min-height: 44px/u);
  assert.match(fields,/var\(--nw-text\)/u);assert.match(fields,/aria-invalid/u);assert.match(fields,/border-rose-500/u);
  assert.match(readFileSync('src/components/ui/Controls.tsx','utf8'),/plain: ''/u);
  assert.doesNotMatch(readFileSync('src/index.css','utf8'),/html.theme-light \[data-navigation-id="(?:assistant-shortcut|sign-out)"\]/u);
});
test('shared fields and plain button retain native values,disabled,submit and accessibility props',()=>{
  const html=renderToStaticMarkup(React.createElement(FormFields,{'aria-busy':true,'data-unsaved':'true',className:'fixture'},
    React.createElement('input',{defaultValue:'اسم',required:true,readOnly:true,'aria-label':'الاسم'}),
    React.createElement(UiButton,{variant:'plain',type:'submit',disabled:true,'aria-label':'حفظ'},'حفظ')));
  assert.match(html,/nw-form-fields fixture/u);assert.match(html,/aria-busy="true"/u);assert.match(html,/data-unsaved="true"/u);
  assert.match(html,/value="اسم"/u);assert.match(html,/required=""/u);assert.match(html,/readOnly=""/u);
  assert.match(html,/type="submit"/u);assert.match(html,/disabled=""/u);assert.match(html,/aria-label="حفظ"/u);
  assert.doesNotMatch(html,/bg-nw-primary|bg-nw-surface/u);
});
test('all100 native input/validation/busy properties are AST-identical to891c9a4',()=>{
  const fields=[{"file":"src/components/common/Modal.tsx","count":2,"hash":"6ac2ca616dd4f6da86c49af1d3a9700fbadb653ebd9b07df66ab9b65d23f9838"},{"file":"src/components/ui/Controls.tsx","count":5,"hash":"1437bb43486f0a47e3de40b33ea084a7b946a36efde3e52eef0b4b42212e80f2"},{"file":"src/features/more/MoreMenuView.tsx","count":10,"hash":"980d42d1599a2370eda464d2dcaa1fc33e8e1eb36d4385fc73e035cd1e49c56d"},{"file":"src/features/more/ProfileModal.tsx","count":77,"hash":"ef9c906272c1db0bb6311fd5b5a81406886c610455607dc5ca214f9bef044b97"},{"file":"src/features/more/InstallAppPanel.tsx","count":2,"hash":"2dc5426f1c8b3b354876670a63f36aeeef649b40e4d6e1b8425016295e8f1e0b"},{"file":"src/features/more/PushNotificationControls.tsx","count":4,"hash":"1f93d466baa82cb58f6ddfa12461afe905e9eb547a1beab5ed2faa6276960194"}] as const;
  for(const expected of fields){
    const ast=ts.createSourceFile(expected.file,readFileSync(expected.file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),attrs:string[]=[];
    function visit(n:ts.Node){
      if(ts.isJsxAttribute(n)&&/^(value|checked|disabled|required|readOnly|type|inputMode|autoComplete|min|max|step|pattern)$/u.test(n.name.getText(ast)))attrs.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));
      ts.forEachChild(n,visit);
    }
    visit(ast);assert.equal(attrs.length,expected.count,expected.file);assert.equal(hash(attrs.sort()),expected.hash,expected.file);
  }
});
