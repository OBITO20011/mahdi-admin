import ts from 'typescript';
import {createHash} from 'node:crypto';
import {financialUiContract} from './package-f-financial-ui-contract.mjs';

/** Pin component state/effects/handlers and rendered security guards,not presentation. */
export function authUiContract(file,source){
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const printer=ts.createPrinter({removeComments:true});
 const print=n=>printer.printNode(ts.EmitHint.Unspecified,n,ast);
 const state=[],conditions=[];
 const hash=a=>createHash('sha256').update(JSON.stringify(a)).digest('hex');
 function visit(n){
  if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isArrowFunction(n.initializer)&&ts.isBlock(n.initializer.body)&&/^(LoginView|IPhoneContainer|AdminAssistantView|TurnstileWidget|App)$/u.test(n.name.getText(ast))){
   for(const statement of n.initializer.body.statements)if(!ts.isReturnStatement(statement))state.push(print(statement).replace(/className="[^"]*"/gu,'className="<presentation>"'));
  }
  if(/(?:auth\/|IPhoneContainer|AdminAssistantView|src\/App)/u.test(file)&&ts.isJsxExpression(n)&&n.expression){
   if(ts.isConditionalExpression(n.expression))conditions.push(print(n.expression.condition));
   if(ts.isBinaryExpression(n.expression)&&n.expression.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken)conditions.push(print(n.expression.left));
  }
  ts.forEachChild(n,visit);
 }
 visit(ast);return {...financialUiContract(file,source),stateHash:hash(state),conditionHash:hash(conditions)};
}
