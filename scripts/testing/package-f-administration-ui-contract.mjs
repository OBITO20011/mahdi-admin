import ts from 'typescript';
import {sourceBeforeTrialW} from '../audit/source-before-trial-owner-w.mjs';
import {createHash} from 'node:crypto';
import {financialUiContract} from './package-f-financial-ui-contract.mjs';

/** Display evidence only. The single named date formatter is not a business guard. */
export function administrationUiContract(file,source){
 source=sourceBeforeTrialW(file,source);
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const printer=ts.createPrinter({removeComments:true});
 const policies=[];let displayDate;
 function visit(n){
  if(ts.isFunctionDeclaration(n)&&n.name?.text==='formatDate')displayDate=n;
  if(ts.isVariableDeclaration(n)&&['roleLabels','defaultRole','isOwner','isEditing','currentRolePermissions'].includes(n.name.getText(ast)))
   policies.push(printer.printNode(ts.EmitHint.Unspecified,n,ast));
  ts.forEachChild(n,visit);
 }
 visit(ast);
 const businessSource=displayDate?source.slice(0,displayDate.pos)+'\nfunction formatDate(value?: string): string { return "<display-date>"; }'+source.slice(displayDate.end):source;
 return {...financialUiContract(file,businessSource),policyHash:createHash('sha256').update(JSON.stringify(policies.sort())).digest('hex')};
}
