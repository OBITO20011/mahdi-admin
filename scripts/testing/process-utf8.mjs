// Attach before data listeners: retain incomplete multibyte sequences across
// chunks instead of implicitly coercing each Buffer to a separate string.
export function decodeProcessUtf8(child) {
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
}
