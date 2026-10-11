import ts from 'typescript';

export const legacyColourUtility = /(?:bg|text|border(?:-[trblxy])?|ring(?:-offset)?|divide|from|via|to|fill|stroke|decoration|accent|caret|outline|shadow)-(?:slate|blue|emerald|violet|cyan|gray|red|rose|amber|orange|green|purple|indigo|teal|lime|yellow|pink|fuchsia|zinc|neutral|stone)-\d{2,3}(?:\/\d+)?/gu;
// Intentionally empty: no old palette utility is needed for branding or printing.
export const legacyColourExceptions = [];

/** Full source AST parity, excluding colour/class presentation literals only. */
export function nonPresentationColourAst(file, source) {
 const ast=ts.createSourceFile(file,source.replace(/\r\n/gu,'\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const result=ts.transform(ast,[context=>root=>{
  const visit=node=>{
   if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='className')return undefined;
   if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)){
    const text=node.text;
    if(/(?:bg|text|border|ring|outline|shadow|from|via|to|accent|fill|stroke)-(?:nw-|[a-z]+-\d)/u.test(text)
      ||/^(?:#[0-9a-f]{3,8}|var\(--nw-[\w-]+\))$/iu.test(text))return ts.factory.createStringLiteral('<presentation-colour>');
   }
   return ts.visitEachChild(node,visit,context);
  };
  return ts.visitNode(root,visit);
 }]);
 try{return ts.createPrinter({removeComments:true}).printFile(result.transformed[0]);}
 finally{result.dispose();}
}
