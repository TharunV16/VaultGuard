import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  parseChromeExport,
  parseBitwardenExport,
  parseLastpassExport,
  parseGenericExport,
  parseImport,
} from '../lib/importParser.js';

// ── Sample CSVs ───────────────────────────────────────────────────────────────

const CHROME_CSV = `name,url,username,password
GitHub,https://github.com,alice@example.com,securepass1
Google,https://google.com,alice,mypassword`;

const BITWARDEN_LOGIN_CSV = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
Work,0,login,GitHub,,,,https://github.com,alice@example.com,gh-secret,
,0,note,Secret Note,This is a secure note,,,,,,`;

const LASTPASS_CSV = `url,username,password,totp,extra,name,grouping,fav
https://github.com,alice,lp-pass,,note here,GitHub,Work,0
http://sn,,,,my note content,Secure Note,Personal,0`;

const GENERIC_CSV = `title,website,email,pass,comment
MyBank,https://bank.com,alice@bank.com,bankpassword123,primary account`;

// ── detectFormat ─────────────────────────────────────────────────────────────

describe('importParser: detectFormat', () => {
  it('detects Chrome format', () => {
    expect(detectFormat(CHROME_CSV)).toBe('chrome');
  });

  it('detects Bitwarden format', () => {
    expect(detectFormat(BITWARDEN_LOGIN_CSV)).toBe('bitwarden');
  });

  it('detects LastPass format', () => {
    expect(detectFormat(LASTPASS_CSV)).toBe('lastpass');
  });

  it('detects generic format for unknown CSV', () => {
    expect(detectFormat(GENERIC_CSV)).toBe('generic');
  });
});

// ── parseChromeExport ─────────────────────────────────────────────────────────

describe('importParser: parseChromeExport', () => {
  it('parses all rows and extracts fields', async () => {
    const items = await parseChromeExport(CHROME_CSV);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('GitHub');
    expect(items[0].username).toBe('alice@example.com');
    expect(items[0].password).toBe('securepass1');
    expect(items[0].uris).toEqual(['https://github.com']);
    expect(items[0].type).toBe('login');
  });

  it('sets type to login for all items', async () => {
    const items = await parseChromeExport(CHROME_CSV);
    for (const item of items) {
      expect(item.type).toBe('login');
    }
  });
});

// ── parseBitwardenExport ──────────────────────────────────────────────────────

describe('importParser: parseBitwardenExport', () => {
  it('parses login items correctly', async () => {
    const items = await parseBitwardenExport(BITWARDEN_LOGIN_CSV);
    const login = items.find((i) => i.type === 'login');
    expect(login).toBeDefined();
    expect(login.name).toBe('GitHub');
    expect(login.username).toBe('alice@example.com');
    expect(login.password).toBe('gh-secret');
    expect(login.uris).toContain('https://github.com');
  });

  it('parses note items with type note', async () => {
    const items = await parseBitwardenExport(BITWARDEN_LOGIN_CSV);
    const note = items.find((i) => i.type === 'note');
    expect(note).toBeDefined();
    expect(note.name).toBe('Secret Note');
    expect(note.notes).toBe('This is a secure note');
  });

  it('preserves folder field', async () => {
    const items = await parseBitwardenExport(BITWARDEN_LOGIN_CSV);
    const login = items.find((i) => i.type === 'login');
    expect(login.folder).toBe('Work');
  });
});

// ── parseLastpassExport ───────────────────────────────────────────────────────

describe('importParser: parseLastpassExport', () => {
  it('parses login items with url and credentials', async () => {
    const items = await parseLastpassExport(LASTPASS_CSV);
    const gh = items.find((i) => i.name === 'GitHub');
    expect(gh).toBeDefined();
    expect(gh.username).toBe('alice');
    expect(gh.password).toBe('lp-pass');
    expect(gh.uris).toContain('https://github.com');
    expect(gh.folder).toBe('Work');
  });

  it('filters out http://sn secure note URLs', async () => {
    const items = await parseLastpassExport(LASTPASS_CSV);
    const note = items.find((i) => i.name === 'Secure Note');
    if (note) {
      expect(note.uris).not.toContain('http://sn');
    }
  });
});

// ── parseGenericExport ────────────────────────────────────────────────────────

describe('importParser: parseGenericExport', () => {
  it('maps non-standard column names via best-effort matching', async () => {
    const items = await parseGenericExport(GENERIC_CSV);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('MyBank');
    expect(items[0].username).toBe('alice@bank.com');
    expect(items[0].password).toBe('bankpassword123');
  });
});

// ── parseImport (auto-detect) ─────────────────────────────────────────────────

describe('importParser: parseImport auto-detect', () => {
  it('auto-detects and parses Chrome CSV', async () => {
    const result = await parseImport(CHROME_CSV);
    expect(result.format).toBe('chrome');
    expect(result.count).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it('auto-detects and parses Bitwarden CSV', async () => {
    const result = await parseImport(BITWARDEN_LOGIN_CSV);
    expect(result.format).toBe('bitwarden');
    expect(result.count).toBeGreaterThan(0);
  });

  it('throws on empty input', async () => {
    await expect(parseImport('')).rejects.toThrow();
  });

  it('throws on null input', async () => {
    await expect(parseImport(null)).rejects.toThrow();
  });
});
