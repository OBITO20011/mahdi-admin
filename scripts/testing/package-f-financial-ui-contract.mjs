import ts from 'typescript';
import {createHash} from 'node:crypto';

/** Presentation migration evidence only; never executed by business code. */
export function financialUiContract(file, source) {
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const printer=ts.createPrinter({removeComments:true});
 const print=n=>printer.printNode(ts.EmitHint.Unspecified,n,ast);
 const calls=[],bindings=[],native=[],functions=[],guards=[];
 const hash=v=>createHash('sha256').update(JSON.stringify(v.sort())).digest('hex');
 const hasJsx=n=>{let yes=false;function walk(p){if(ts.isJsxElement(p)||ts.isJsxSelfClosingElement(p)||ts.isJsxFragment(p)){yes=true;return;}ts.forEachChild(p,walk);}walk(n);return yes;};
 function visit(n){
  if(ts.isAwaitExpression(n)||ts.isCallExpression(n)&&/(?:FromSupabase|InSupabase|Service|\.rpc$|^run[A-Z]|^openModal$|^fetch[A-Z]|^previewSupplierReceiptCancellation$|window\.(?:prompt|confirm|print)$)/u.test(n.expression.getText(ast)))calls.push(print(n));
  if(ts.isJsxAttribute(n)&&/^on[A-Z]/u.test(n.name.getText(ast))&&n.initializer)bindings.push(print(n));
  if(ts.isJsxAttribute(n)&&/^(value|checked|disabled|required|readOnly|inputMode|autoComplete|min|max|step|pattern|aria-busy|data-unsaved)$/u.test(n.name.getText(ast))&&n.parent.parent.tagName?.getText(ast)!=='KpiCard')native.push(print(n));
  if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
   const tag=n.tagName.getText(ast),type=n.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='type');
   if(tag==='button'||tag==='UiButton'){
    let inForm=false;for(let p=n.parent;p;p=p.parent)if(ts.isJsxElement(p)&&p.openingElement.tagName.getText(ast)==='form'){inForm=true;break;}
    native.push('button-effective-type:'+(type?type.initializer.getText(ast):JSON.stringify(inForm?'submit':'button')));
   }else if(type)native.push(print(type));
  }
  if(ts.isVariableDeclaration(n)&&n.initializer&&/^(isValid|numericAmount|cashTotal|cliqTotal)$/u.test(n.name.getText(ast)))guards.push(print(n));
  if((ts.isArrowFunction(n)||ts.isFunctionExpression(n)||ts.isFunctionDeclaration(n))&&n.body&&!hasJsx(n.body)){
   // Only the named monetary DISPLAY formatter is migrated to shared formatJod.
   const moneyDisplay=ts.isVariableDeclaration(n.parent)&&n.parent.name.getText(ast)==='money';
   if(!moneyDisplay){
    const normalized=print(n).replace(/(['"])([^'"]*(?:bg|text|border)-(?:nw-[\w-]+|(?:slate|gray|blue|indigo|purple|violet|emerald|green|teal|amber|orange|rose|pink|red|cyan|yellow)-\d+)[^'"]*)\1/gu,'"<presentation-colours>"');
    functions.push(normalized);
   }
  }
  ts.forEachChild(n,visit);
 }
 visit(ast);
 return {file,calls:calls.length,callHash:hash(calls),bindings:bindings.length,bindingHash:hash(bindings),native:native.length,nativeHash:hash(native),functionHash:hash(functions),guardHash:hash(guards)};
}
