import ts from 'typescript';

// Measurement only: compiler options are overridden in memory; no config/source writes.
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
if(config.error)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,' '));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd());
const program=ts.createProgram(parsed.fileNames,{...parsed.options,strict:true});
const diagnostics=ts.getPreEmitDiagnostics(program);
const counts={};
for(const diagnostic of diagnostics){
  const file=diagnostic.file ? ts.sys.resolvePath(diagnostic.file.fileName).replaceAll('\\','/').replace(process.cwd().replaceAll('\\','/')+'/','') : '<config>';
  counts[file]=(counts[file]??0)+1;
}
console.log(JSON.stringify({strictMeasurementOnly:true,total:diagnostics.length,files:counts,diagnostics:diagnostics.map(d=>({
  file:d.file?.fileName.replaceAll('\\','/'),line:d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start).line+1:undefined,
  code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,' '),
}))},null,2));
