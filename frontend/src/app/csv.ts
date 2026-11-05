import { EntryDraft, EntryType, ExpenseCategory, LedgerEntry, PaidFrom, SettlementMethod } from './entry.model';
import { validate } from './validation';

export interface CsvError { row: number; message: string; }
export interface ParsedCsv { drafts: EntryDraft[]; errors: CsvError[]; }

const TYPES = new Set<string>(['INCOME', 'EXPENSE', 'COD_SETTLEMENT']);
const CATEGORIES = new Set<string>(['FUEL', 'FOOD', 'BIKE_SERVICE', 'PHONE_RECHARGE', 'BIKE_EMI', 'OTHER']);
const PAID_FROM = new Set<string>(['OWN', 'COD_CASH']);
const SETTLEMENTS = new Set<string>(['DEPOSITED', 'DEDUCTED_FROM_PAYOUT']);

const numKey = (value: number | null | undefined): string => (value == null || Number.isNaN(Number(value)) ? '' : String(Number(value)));

/** Trimmed the same way DeviceStore stores a note, so a backup matches the entry it came from. */
export function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim().slice(0, 180);
  return trimmed ? trimmed : null;
}

export function duplicateKey(d: EntryDraft): string {
  return [
    d.date ?? '', d.type ?? '', d.category ?? '', numKey(d.amount), numKey(d.orderCount), numKey(d.hoursWorked), numKey(d.distanceKm),
    cleanNote(d.note) ?? '', numKey(d.codAmount), d.paidFrom ?? '', d.settlementMethod ?? '',
  ].join('\u001f');
}

/** Skip a row only while an existing entry still has an unused copy of its key. Identical new rows both stay. */
export function classifyImport(drafts: EntryDraft[], existing: EntryDraft[]): { fresh: EntryDraft[]; duplicates: number } {
  const counts = new Map<string, number>();
  for (const entry of existing) counts.set(duplicateKey(entry), (counts.get(duplicateKey(entry)) ?? 0) + 1);
  const fresh: EntryDraft[] = [];
  let duplicates = 0;
  for (const draft of drafts) {
    const key = duplicateKey(draft);
    const left = counts.get(key) ?? 0;
    if (left > 0) { counts.set(key, left - 1); duplicates++; }
    else fresh.push(draft);
  }
  return { fresh, duplicates };
}

const csvCell = (value: string | null | undefined): string =>
  value ? `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"` : '';

/** Newest-first rows already chosen by the caller. Matches the on-device export. */
export function formatCsv(entries: LedgerEntry[]): string {
  const rows = entries.map((e) =>
    [e.date, e.type, e.category ?? '', e.amount, e.orderCount ?? '', e.hoursWorked ?? '', e.distanceKm ?? '', csvCell(e.note),
      e.codAmount ?? '', e.paidFrom ?? '', e.settlementMethod ?? ''].join(','));
  return ['Date,Type,Category,Amount,Orders,Hours,Km,Note,COD,PaidFrom,SettlementMethod', ...rows].join('\n') + '\n';
}

interface Record { cells: string[]; line: number; }

function parseRecords(text: string): Record[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records: Record[] = [];
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const startLine = line;
    const cells: string[] = [];
    let field = '';
    let inQuotes = false;
    let started = false;
    for (;;) {
      if (i >= text.length) {
        if (started || field.length > 0 || cells.length > 0) {
          cells.push(field);
          records.push({ cells, line: startLine });
        }
        return records;
      }
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false;
          i++;
          continue;
        }
        if (c === '\r') {
          field += '\r';
          i++;
          if (text[i] === '\n') { field += '\n'; i++; }
          line++;
          continue;
        }
        if (c === '\n') { field += '\n'; i++; line++; continue; }
        field += c;
        i++;
        continue;
      }
      if (c === '"') { inQuotes = true; started = true; i++; continue; }
      if (c === ',') { cells.push(field); field = ''; started = true; i++; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i += 2;
        else i++;
        line++;
        if (started || field.length > 0 || cells.length > 0) {
          cells.push(field);
          records.push({ cells, line: startLine });
        }
        break;
      }
      field += c;
      started = true;
      i++;
    }
  }
  return records;
}

/** Drop the leading apostrophe the exporter adds so a spreadsheet won't treat the note as a formula. */
function unguard(value: string): string {
  return value.length >= 2 && value[0] === "'" && '=+-@'.includes(value[1]) ? value.slice(1) : value;
}

function blank(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = unguard(value).trim();
  return trimmed === '' ? null : trimmed;
}

function cell(cells: string[], index: Map<string, number>, name: string): string | null {
  const at = index.get(name);
  if (at == null || at >= cells.length) return null;
  return blank(cells[at]);
}

function numberCell(raw: string | null, label: string): { value: number | null; error?: string } {
  if (raw == null) return { value: null };
  const value = Number(raw);
  if (Number.isNaN(value)) return { value: null, error: `${label} is not a number.` };
  return { value };
}

function oneOf<T extends string>(raw: string | null, allowed: Set<string>, label: string): { value: T | null; error?: string } {
  if (raw == null) return { value: null };
  if (!allowed.has(raw)) return { value: null, error: `Unknown ${label}.` };
  return { value: raw as T };
}

function dateCell(raw: string | null): { value: string | null; error?: string } {
  if (raw == null) return { value: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return { value: null, error: 'Date must be yyyy-MM-dd.' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { value: null, error: 'Date must be yyyy-MM-dd.' };
  }
  return { value: raw };
}

export function parseCsv(text: string): ParsedCsv {
  const records = parseRecords(text);
  if (records.length === 0) return { drafts: [], errors: [{ row: 1, message: 'This file has no header row.' }] };
  const header = new Map<string, number>();
  records[0].cells.forEach((name, index) => { const trimmed = name.trim(); if (trimmed) header.set(trimmed, index); });
  for (const required of ['Date', 'Type', 'Amount']) {
    if (!header.has(required)) return { drafts: [], errors: [{ row: records[0].line, message: 'The header must include Date, Type, and Amount.' }] };
  }

  const errors: CsvError[] = [];
  const drafts: EntryDraft[] = [];
  for (const record of records.slice(1)) {
    if (record.cells.every((value) => value.trim() === '')) continue;
    const problem = readRow(record.cells, header);
    if (typeof problem === 'string') errors.push({ row: record.line, message: problem });
    else drafts.push(problem);
  }
  drafts.reverse();
  drafts.sort((a, b) => a.date.localeCompare(b.date));
  return { drafts, errors };
}

function readRow(cells: string[], header: Map<string, number>): EntryDraft | string {
  const date = dateCell(cell(cells, header, 'Date'));
  if (date.error) return date.error;
  const type = oneOf<EntryType>(cell(cells, header, 'Type'), TYPES, 'type');
  if (type.error) return type.error;
  const category = oneOf<ExpenseCategory>(cell(cells, header, 'Category'), CATEGORIES, 'category');
  if (category.error) return category.error;
  const amount = numberCell(cell(cells, header, 'Amount'), 'Amount');
  if (amount.error) return amount.error;
  const orderCount = numberCell(cell(cells, header, 'Orders'), 'Orders');
  if (orderCount.error) return orderCount.error;
  const hoursWorked = numberCell(cell(cells, header, 'Hours'), 'Hours');
  if (hoursWorked.error) return hoursWorked.error;
  const distanceKm = numberCell(cell(cells, header, 'Km'), 'Distance');
  if (distanceKm.error) return distanceKm.error;
  const codAmount = numberCell(cell(cells, header, 'COD'), 'COD cash');
  if (codAmount.error) return codAmount.error;
  const paidFrom = oneOf<PaidFrom>(cell(cells, header, 'PaidFrom'), PAID_FROM, 'paid-from value');
  if (paidFrom.error) return paidFrom.error;
  const settlementMethod = oneOf<SettlementMethod>(cell(cells, header, 'SettlementMethod'), SETTLEMENTS, 'settlement method');
  if (settlementMethod.error) return settlementMethod.error;

  const draft: EntryDraft = {
    type: type.value as EntryType,
    category: category.value,
    amount: amount.value as number,
    date: date.value as string,
    note: cleanNote(cell(cells, header, 'Note')),
    orderCount: orderCount.value,
    hoursWorked: hoursWorked.value,
    distanceKm: distanceKm.value,
    codAmount: codAmount.value,
    paidFrom: paidFrom.value,
    settlementMethod: settlementMethod.value,
  };
  return validate(draft) ?? draft;
}
