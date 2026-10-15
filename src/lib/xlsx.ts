/**
 * Minimal, dependency-free XLSX (Office Open XML spreadsheet) reader/writer
 * for the go-live setup templates. Reads the first worksheet's cell VALUES
 * (shared strings, inline strings, numbers, booleans); formulas are read as
 * their cached value. Writes plain right-to-left sheets with text-formatted
 * columns so barcodes and phone numbers keep their leading zeros.
 * No macros, styles beyond text format, or external links are processed.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export const XLSX_MAX_BYTES = 5 * 1024 * 1024;
export const XLSX_MAX_ROWS = 5000;
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export class XlsxError extends Error {}

// ---------------------------------------------------------------- CRC32/ZIP
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** `deflated` (raw DEFLATE of `data`) stores the entry compressed, as Excel does. */
interface ZipEntry { name: string; data: Uint8Array; deflated?: Uint8Array }

/** Stored (uncompressed) ZIP: small templates, no compression library needed. */
export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const stored = entry.deflated ?? entry.data;
    const method = entry.deflated ? 8 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, stored.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, stored);
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, method, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, stored.length, true);
    header.setUint32(24, entry.data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + stored.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads the entries we need from a ZIP via its central directory. */
export async function readZip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new XlsxError('الملف ليس ملف Excel صالحاً (xlsx).');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const result = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new XlsxError('ملف Excel تالف.');
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (!wanted(name)) continue;
    if (size > 50 * 1024 * 1024) throw new XlsxError('محتوى ملف Excel أكبر من المسموح.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    if (method === 0) result.set(name, raw);
    else if (method === 8) result.set(name, await inflateRaw(raw));
    else throw new XlsxError('طريقة ضغط غير مدعومة في ملف Excel.');
  }
  return result;
}

// ---------------------------------------------------------------- XML text
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu, (_, code: string) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    }
    return entities[code.toLowerCase()] ?? '';
  });
}
export function encodeXml(text: string): string {
  // Strip characters XML 1.0 cannot carry.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}
const textRuns = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t(?:\s[^>]*)?\/>/gu)]
  .map(match => decodeXml(match[1] ?? '')).join('');

/** Column letters → zero-based index (A=0, Z=25, AA=26). */
export function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/u.exec(reference.toUpperCase())?.[0] ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Normalizes a numeric cell to text without exponent or float noise. */
function numberText(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw.trim();
  if (Number.isInteger(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER) return String(value);
  return String(Number(value.toPrecision(15)));
}

// ---------------------------------------------------------------- read
export async function readXlsxFirstSheet(input: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > XLSX_MAX_BYTES) throw new XlsxError('حجم الملف أكبر من 5 ميغابايت.');
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new XlsxError('الملف ليس بصيغة Excel (xlsx). احفظه من Excel بصيغة .xlsx ثم أعد المحاولة.');
  }
  const files = await readZip(bytes, name => name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels'
    || name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/u.test(name));
  const workbook = files.get('xl/workbook.xml');
  if (!workbook) throw new XlsxError('الملف لا يحتوي ورقة عمل Excel.');
  const sheetTag = /<(?:\w+:)?sheet\s[^>]*>/u.exec(decoder.decode(workbook))?.[0] ?? '';
  const relationId = /\br:id="([^"]+)"/u.exec(sheetTag)?.[1] ?? /\bid="([^"]+)"/u.exec(sheetTag)?.[1];
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (relationId && rels) {
    for (const rel of decoder.decode(rels).matchAll(/<Relationship\s[^>]*>/gu)) {
      if (rel[0].includes(`Id="${relationId}"`)) {
        const target = /Target="([^"]+)"/u.exec(rel[0])?.[1] ?? '';
        sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//u, '');
      }
    }
  }
  const sheet = files.get(sheetPath);
  if (!sheet) throw new XlsxError('تعذر العثور على أول ورقة في الملف.');
  const shared = files.get('xl/sharedStrings.xml');
  const strings = shared
    ? [...decoder.decode(shared).matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/gu)].map(match => textRuns(match[1]))
    : [];
  const rows: string[][] = [];
  for (const row of decoder.decode(sheet).matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/gu)) {
    const rowNumber = Number(/\br="(\d+)"/u.exec(row[1])?.[1] ?? rows.length + 1);
    if (rowNumber > XLSX_MAX_ROWS + 1) throw new XlsxError(`الملف يحتوي أكثر من ${XLSX_MAX_ROWS} سطر؛ قسّمه إلى ملفات أصغر.`);
    const cells: string[] = [];
    let next = 0;
    for (const cell of (row[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gu)) {
      const attributes = cell[1];
      const reference = /\br="([A-Z]+)\d+"/iu.exec(attributes)?.[1];
      const index = reference ? columnIndex(reference) : next;
      next = index + 1;
      const type = /\bt="([^"]+)"/u.exec(attributes)?.[1] ?? 'n';
      const body = cell[2] ?? '';
      const raw = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/u.exec(body)?.[1];
      let value = '';
      if (type === 's') value = strings[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textRuns(body);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = decodeXml(raw ?? '');
      else if (raw !== undefined) value = numberText(decodeXml(raw));
      while (cells.length < index) cells.push('');
      cells[index] = value.trim();
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    rows[rowNumber - 1] = cells;
  }
  return rows;
}

// ---------------------------------------------------------------- write
export interface XlsxSheet {
  name: string;
  rows: readonly (readonly string[])[];
  widths?: readonly number[];
}

function sheetXml(sheet: XlsxSheet): string {
  const columns = Math.max(1, ...sheet.rows.map(row => row.length));
  const cols = Array.from({ length: columns }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${sheet.widths?.[i] ?? 22}" style="1" customWidth="1"/>`).join('');
  const rows = sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) =>
    `<c r="${columnName(c)}${r + 1}" t="inlineStr" s="${r === 0 ? 2 : 1}"><is><t xml:space="preserve">${encodeXml(value)}</t></is></c>`).join('')}</row>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

export function writeXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  const safeName = (name: string) => encodeXml(name.replace(/[\\/?*[\]:]/gu, ' ').slice(0, 31));
  const file = (name: string, text: string): ZipEntry => ({ name, data: encoder.encode(text) });
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return createZip([
    file('[Content_Types].xml', xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'),
    file('_rels/.rels', xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    file('xl/workbook.xml', xml + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map((sheet, i) => `<sheet name="${safeName(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets></workbook>'),
    file('xl/_rels/workbook.xml.rels', xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    // xf 0 default, xf 1 text (@), xf 2 bold text header.
    file('xl/styles.xml', xml + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
      + '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>'
      + '</styleSheet>'),
    ...sheets.map((sheet, i) => file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet))),
  ]);
}
