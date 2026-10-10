// Host-facing test ports only. No change to repository/Production config or
// container-internal PostgreSQL port5432. Optional SMTP ports stay optional.
export const isolatedSupabasePortSettings = Object.freeze([
  {section: 'db', key: 'port', port: 25432},
  {section: 'db', key: 'shadow_port', port: 25430},
  {section: 'api', key: 'port', port: 25431},
  {section: 'studio', key: 'port', port: 25433},
  {section: 'local_smtp', key: 'port', port: 25434},
  {section: 'local_smtp', key: 'smtp_port', port: 25435, optional: true},
  {section: 'local_smtp', key: 'pop3_port', port: 25436, optional: true},
  {section: 'analytics', key: 'port', port: 25437},
  {section: 'edge_runtime', key: 'inspector_port', port: 25438},
  {section: 'db.pooler', key: 'port', port: 25439},
].map(setting => Object.freeze(setting)));

export function withIsolatedSupabasePorts(source) {
  const lines = source.split(/\r?\n/u);
  for (const setting of isolatedSupabasePortSettings) {
    const headers = lines.flatMap((line, index) => {
      const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
      return match?.[1] === setting.section ? [index] : [];
    });
    if (headers.length > 1) throw new Error('DUPLICATE_ISOLATED_PORT_SECTION');
    if (!headers.length) {
      if (!setting.optional) lines.push('', `[${setting.section}]`, `${setting.key} = ${setting.port}`);
      continue;
    }
    const start = headers[0];
    const next = lines.findIndex((line, index) => index > start && /^\s*\[/u.test(line));
    const end = next < 0 ? lines.length : next;
    const declarations = lines.flatMap((line, index) =>
      index > start && index < end && new RegExp(`^\\s*${setting.key}\\s*=`, 'u').test(line) ? [index] : []);
    if (declarations.length > 1) throw new Error('DUPLICATE_ISOLATED_PORT_KEY');
    if (declarations.length) lines[declarations[0]] = `${setting.key} = ${setting.port}`;
    else if (!setting.optional) lines.splice(end, 0, `${setting.key} = ${setting.port}`);
  }
  return lines.join('\n');
}
