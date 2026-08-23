import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..', '..');
const [scriptArgument, ...scriptArguments] = process.argv.slice(2);

if (!scriptArgument) {
  throw new Error('Provide the backup PowerShell script path to run.');
}

const scriptPath = path.resolve(projectRoot, scriptArgument);
const relativeScriptPath = path.relative(path.join(projectRoot, 'scripts', 'backup'), scriptPath);
if (relativeScriptPath.startsWith('..') || path.isAbsolute(relativeScriptPath) || !scriptPath.endsWith('.ps1')) {
  throw new Error('Only PowerShell scripts inside scripts/backup can be run.');
}

// npm can inherit PowerShell 7 module paths. Removing this one environment
// value lets Windows PowerShell load its matching built-in Security module for
// DPAPI-protected backup credentials.
const environment = { ...process.env };
delete environment.PSModulePath;

const child = spawn(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...scriptArguments],
  { env: environment, stdio: 'inherit', windowsHide: true }
);

child.once('error', (error) => {
  console.error(`Could not start Windows PowerShell: ${error.message}`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`Backup PowerShell process was stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
