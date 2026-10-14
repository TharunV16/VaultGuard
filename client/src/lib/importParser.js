// @ts-check
/**
 * client/src/lib/importParser.js
 * CSV import parsers for Chrome/Edge, Bitwarden, LastPass, and generic format.
 * Uses papaparse (already in allowlist) for CSV parsing.
 * SRS IMP-01..03.
 */

/**
 * @typedef {Object} ParsedItem
 * @property {'login'|'note'|'card'|'apiKey'} type
 * @property {string} name
 * @property {string} [username]
 * @property {string} [password]
 * @property {string[]} [uris]
 * @property {string} [notes]
 * @property {string} [folder]
 */

/**
 * Parse a CSV string using papaparse (lazy-imported to keep bundle light).
 * @param {string} csv
 * @returns {Promise<Array<Record<string, string>>>}
 */
async function parseCsv(csv) {
  const Papa = (await import('papaparse')).default;
  const result = Papa.parse(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parse error: ${result.errors[0].message}`);
  }
  return result.data;
}

/** Trim a string field safely */
function s(v) {
  return (typeof v === 'string' ? v.trim() : '') || '';
}

/**
 * Detect import format from CSV header row.
 * @param {string} csv
 * @returns {'chrome'|'bitwarden'|'lastpass'|'generic'}
 */
export function detectFormat(csv) {
  const firstLine = csv.split('\n')[0].toLowerCase();
  // Bitwarden: has login_uri and login_username
  if (firstLine.includes('type') && firstLine.includes('login_uri') && firstLine.includes('login_username')) {
    return 'bitwarden';
  }
  // LastPass: has grouping field (check before Chrome since LastPass also has url/username/password/name)
  if (firstLine.includes('grouping') && firstLine.includes('username') && firstLine.includes('password') && firstLine.includes('url')) {
    return 'lastpass';
  }
  // Chrome/Edge: name,url,username,password (no type, no grouping)
  if (firstLine.includes('url') && firstLine.includes('username') && firstLine.includes('password') && firstLine.includes('name') && !firstLine.includes('type')) {
    return 'chrome';
  }
  return 'generic';
}

/**
 * Parse Chrome/Edge password export CSV.
 * Columns: name, url, username, password
 * @param {string} csv
 * @returns {Promise<ParsedItem[]>}
 */
export async function parseChromeExport(csv) {
  const rows = await parseCsv(csv);
  return rows.map((row) => ({
    type: 'login',
    name: s(row.name) || s(row.url) || 'Untitled',
    username: s(row.username),
    password: s(row.password),
    uris: s(row.url) ? [s(row.url)] : [],
    notes: '',
  })).filter((item) => item.name || item.username || item.password);
}

/**
 * Parse Bitwarden vault export CSV.
 * Columns: folder, favorite, type, name, notes, fields, reprompt, login_uri, login_username, login_password, login_totp
 * @param {string} csv
 * @returns {Promise<ParsedItem[]>}
 */
export async function parseBitwardenExport(csv) {
  const rows = await parseCsv(csv);
  return rows.map((row) => {
    const type = s(row.type);
    // Bitwarden types: 1=login, 2=note, 3=card, 4=identity
    if (type === 'note' || type === '2') {
      return {
        type: 'note',
        name: s(row.name) || 'Untitled',
        notes: s(row.notes),
        folder: s(row.folder),
      };
    }
    return {
      type: 'login',
      name: s(row.name) || 'Untitled',
      username: s(row['login_username']),
      password: s(row['login_password']),
      uris: s(row['login_uri']) ? [s(row['login_uri'])] : [],
      notes: s(row.notes),
      folder: s(row.folder),
    };
  }).filter((item) => item.name);
}

/**
 * Parse LastPass vault export CSV.
 * Columns: url, username, password, totp, extra, name, grouping, fav
 * @param {string} csv
 * @returns {Promise<ParsedItem[]>}
 */
export async function parseLastpassExport(csv) {
  const rows = await parseCsv(csv);
  return rows.map((row) => ({
    type: 'login',
    name: s(row.name) || s(row.url) || 'Untitled',
    username: s(row.username),
    password: s(row.password),
    uris: s(row.url) && row.url !== 'http://sn' ? [s(row.url)] : [],
    notes: s(row.extra),
    folder: s(row.grouping),
  })).filter((item) => item.name && item.name !== 'Untitled' || item.username || item.password);
}

/**
 * Parse generic CSV (best-effort column matching).
 * Recognizes: name/title/site, url/website/uri, username/user/email/login, password/pass, notes/note
 * @param {string} csv
 * @returns {Promise<ParsedItem[]>}
 */
export async function parseGenericExport(csv) {
  const rows = await parseCsv(csv);
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const find = (...candidates) =>
    headers.find((h) => candidates.some((c) => h.includes(c))) ?? null;

  const nameCol = find('name', 'title', 'site', 'label');
  const urlCol = find('url', 'uri', 'website', 'link');
  const userCol = find('username', 'user', 'login', 'email', 'account');
  const passCol = find('password', 'pass', 'secret');
  const notesCol = find('notes', 'note', 'comment', 'description');

  return rows.map((row) => ({
    type: 'login',
    name: (nameCol ? s(row[nameCol]) : '') || (urlCol ? s(row[urlCol]) : '') || 'Untitled',
    username: userCol ? s(row[userCol]) : '',
    password: passCol ? s(row[passCol]) : '',
    uris: urlCol && s(row[urlCol]) ? [s(row[urlCol])] : [],
    notes: notesCol ? s(row[notesCol]) : '',
  })).filter((item) => item.username || item.password);
}

/**
 * Auto-detect format and parse the CSV.
 * @param {string} csv
 * @returns {Promise<{ items: ParsedItem[], format: string, count: number }>}
 */
export async function parseImport(csv) {
  if (!csv || typeof csv !== 'string') {
    throw new Error('No CSV content provided');
  }

  const format = detectFormat(csv);

  let items;
  switch (format) {
    case 'chrome':
      items = await parseChromeExport(csv);
      break;
    case 'bitwarden':
      items = await parseBitwardenExport(csv);
      break;
    case 'lastpass':
      items = await parseLastpassExport(csv);
      break;
    default:
      items = await parseGenericExport(csv);
  }

  return { items, format, count: items.length };
}
