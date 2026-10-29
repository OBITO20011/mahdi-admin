// Vite content hashes are resource identities, not SEO data. Keep checking
// every other byte, including inline scripts, metadata and resource queries.
export function hasPrivateSeoFields(html) {
  const content = html.replace(/<(script|link)\b[^>]*>/giu, (tag, name) => {
    const attribute = name.toLowerCase() === 'script' ? 'src' : 'href';
    const resource = new RegExp(`(\\s${attribute}\\s*=\\s*)(["'])/assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\\.(?:js|css)\\2`, 'giu');
    return tag.replace(resource, '$1""');
  });
  return /wac|supplier|reservedQuantity|availableQuantity/iu.test(content);
}
