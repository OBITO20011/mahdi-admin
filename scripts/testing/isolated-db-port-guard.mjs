import {createServer} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';

const exec = promisify(execFile);
const runDiagnostic = async (command, args, options) => {
  const {stdout} = await exec(command, args, options);
  return {stdout: String(stdout)};
};

export async function readLinuxEphemeralPortRange(read = file => readFile(file, 'utf8')) {
  const source = '/proc/sys/net/ipv4/ip_local_port_range';
  try {
    const values = (await read(source)).trim().split(/\s+/u).map(Number);
    if (values.length !== 2 || values.some(port => !Number.isInteger(port) || port < 1 || port > 65535)
      || values[0] > values[1]) throw new Error('INVALID_EPHEMERAL_RANGE');
    return {source, first: values[0], last: values[1]};
  } catch (error) {return {source, unavailable: error.code || error.message};}
}
function validPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_DB_PORT');
  return port;
}

// Supabase CLI defaults, overridden only by the actual isolated [db] config.
export function databasePortsFromConfig(config) {
  const ports = {port: 54322, shadow_port: 54320};
  let inDatabase = false;
  for (const line of config.split(/\r?\n/u)) {
    if (/^\s*\[/u.test(line)) inDatabase = /^\s*\[db\]\s*(?:#.*)?$/u.test(line);
    if (!inDatabase || !/^\s*(?:port|shadow_port)\s*=/u.test(line)) continue;
    const match = line.match(/^\s*(port|shadow_port)\s*=\s*(\d+)\s*(?:#.*)?$/u);
    if (!match) throw new Error('INVALID_DB_PORT_CONFIG');
    ports[match[1]] = validPort(Number(match[2]));
  }
  if (ports.port === ports.shadow_port) throw new Error('DUPLICATE_DB_PORT');
  return Object.values(ports);
}

function bind(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else if (host.includes(':') && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) resolve(true);
      else reject(new Error(`PORT_PROBE_FAILED ${port} ${host}: ${error.code}`, {cause: error}));
    });
    server.listen({port, host, exclusive: true, ipv6Only: host.includes(':')}, () => {
      server.close(error => error ? reject(error) : resolve(true));
    });
  });
}

export async function probeTcpPort(port) {
  validPort(port);
  // A container inventory is not proof that the host socket is released.
  // Windows can bind a wildcard while an explicit loopback listener exists.
  // Check both,including IPv6;do not turn a successful wildcard into a false green.
  for (const host of ['0.0.0.0', '127.0.0.1', '::', '::1']) if (!await bind(port, host)) return false;
  return true;
}

export async function describePortHolders(ports, run = runDiagnostic) {
  const report = [];
  for (const port of ports) {
    validPort(port);
    const entry = {port};
    try {
      const {stdout} = await run('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.ID}}\t{{.Names}}\t{{.Ports}}'],
        {windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024});
      entry.docker = stdout.trim() || 'No published container found';
    } catch (error) {entry.docker = `Diagnostic unavailable: ${error.code}`;}
    report.push(entry);
  }
  try {
    const {stdout} = await run('ss', ['-tanp'], {windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024});
    for (const entry of report) entry.ss = stdout.split(/\r?\n/u)
      // ss -tanp:State,Recv-Q,Send-Q,LOCAL endpoint,peer endpoint,process.
      // A peer port match must not impersonate a local-port owner.
      .filter(line => {
        const local = line.trim().split(/\s+/u)[3];
        return local && new RegExp(`:${entry.port}$`, 'u').test(local);
      }).join('\n') || 'No local socket found';
  } catch (error) {for (const entry of report) entry.ss = `Diagnostic unavailable: ${error.code}`;}
  const ephemeralPortRange = await readLinuxEphemeralPortRange();
  for (const entry of report) entry.ephemeralPortRange = ephemeralPortRange;
  return report;
}

export async function waitForDatabasePorts(ports, {
  timeoutMs = 60000, pollMs = 250, probe = probeTcpPort, holders = describePortHolders,
  now = () => performance.now(), pause = ms => delay(ms),
} = {}) {
  if (!ports.length || new Set(ports).size !== ports.length) throw new Error('INVALID_DB_PORT_LIST');
  ports.forEach(validPort);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60000
    || !Number.isFinite(pollMs) || pollMs <= 0 || pollMs > 1000) throw new Error('INVALID_PORT_WAIT_BOUND');
  const started = now();
  let probes = 0, waitedForRelease = false;
  for (;;) {
    const occupied = [];
    for (const port of ports) if (!await probe(port)) occupied.push(port);
    probes += 1;
    const elapsedMs = Math.round(now() - started);
    if (!occupied.length) return {ports, probes, elapsedMs, waitedForRelease,
      releaseWaitMs: waitedForRelease ? elapsedMs : 0};
    waitedForRelease = true;
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) {
      const details = {ports: occupied, elapsedMs, probes, holders: await holders(occupied)};
      const error = new Error(`PORT_STILL_BOUND ${JSON.stringify(details)}`);
      error.code = 'PORT_STILL_BOUND';
      error.details = details;
      throw error;
    }
    // Condition polling only; no unconditional startup sleep or test retry.
    await pause(Math.min(pollMs, remaining));
  }
}
