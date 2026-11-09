// Source-only, fail-closed resolution. Types and arbitrary strings are not proof
// of the values that can reach an RPC sink.
import ts from 'typescript';

function choices(node){
 if(!node)return null;
 if(ts.isParenthesizedExpression(node))return choices(node.expression);
 if(ts.isStringLiteralLike(node))return [node.text];
 if(ts.isConditionalExpression(node)){
  const yes=choices(node.whenTrue),no=choices(node.whenFalse);
  return yes&&no?[...new Set([...yes,...no])]:null;
 }
 return null;
}
const bindingName=node=>(ts.isVariableDeclaration(node)||ts.isParameter(node)||ts.isFunctionDeclaration(node))&&node.name&&ts.isIdentifier(node.name)?node.name.text:null;

export function boundedRpcNames(sourceFile,sink){
 const argument=sink.arguments[0],direct=choices(argument);
 const evidence=(names,node)=>names.map(name=>({name,callsite:sourceFile.fileName+':'+(sourceFile.getLineAndCharacterOfPosition(node.getStart()).line+1),source:node.getText(sourceFile)}));
 if(direct)return evidence(direct,sink);
 // Only an inline, expression-bodied callback passed directly to a uniquely
 // named local function is understood. Shadowed, escaped or indirect callbacks
 // remain unresolved instead of silently dropping a possible function name.
 const callback=sink.parent;
 if(!argument||!ts.isIdentifier(argument)||!ts.isArrowFunction(callback)||callback.body!==sink)return null;
 const first=callback.parameters[0];
 if(!first||!ts.isIdentifier(first.name)||first.name.text!==argument.text||first.initializer||first.dotDotDotToken)return null;
 const invocation=callback.parent;
 if(!ts.isCallExpression(invocation)||!ts.isIdentifier(invocation.expression))return null;
 const index=invocation.arguments.indexOf(callback);if(index<0)return null;
 const declarations=[],references=[];
 const find=node=>{if(bindingName(node)===invocation.expression.text)declarations.push(node);if(ts.isIdentifier(node)&&node.text===invocation.expression.text)references.push(node);ts.forEachChild(node,find);};find(sourceFile);
 if(declarations.length!==1||!ts.isFunctionDeclaration(declarations[0])||declarations[0].parent!==sourceFile)return null;
 const target=declarations[0],parameter=target.parameters[index];
 if(references.some(node=>node!==target.name&&(!ts.isCallExpression(node.parent)||node.parent.expression!==node)))return null;
 if(!target.body||!parameter||!ts.isIdentifier(parameter.name)||parameter.initializer||parameter.dotDotDotToken)return null;
 const parameterName=parameter.name.text,resolved=[];let invalid=false;
 const inspect=node=>{
  if(bindingName(node)===parameterName)invalid=true;
  if(ts.isIdentifier(node)&&node.text===parameterName){
   const call=node.parent;
   if(!ts.isCallExpression(call)||call.expression!==node){invalid=true;return;}
   const names=choices(call.arguments[0]);if(!names){invalid=true;return;}
   resolved.push(...evidence(names,call));
  }
  ts.forEachChild(node,inspect);
 };inspect(target.body);
 return !invalid&&resolved.length?resolved:null;
}
