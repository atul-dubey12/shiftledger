import { jsPDF } from 'jspdf';
import { categoryMeta, isoDate } from './ledger';
import { WeeklyPayout, weeklySummary } from './weekly-summary';

/** Canvas text preserves rupee signs and user notes using the browser's Unicode fonts. */
export async function downloadWeeklyPdf(summary: ReturnType<typeof weeklySummary>, payout: WeeklyPayout | null, incomplete: boolean, onDevice = false) {
  await document.fonts.ready;
  const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = [
    `Week: ${summary.key} to ${isoDate(summary.end)}`,
    incomplete ? 'PROVISIONAL — saved or pending entries; sync to confirm totals.' : 'Based on entries recorded in ShiftLedger.',
    '',
    `Recorded earnings: ${money(summary.totals.income)}`,
    `Riding expenses: ${money(summary.totals.expenses)}`,
    `Net earnings after expenses: ${money(summary.totals.net)}`,
    `Actual bank payout: ${payout ? money(payout.amount) + ' · received ' + payout.date : 'Not entered / pending'}`,
    ...(payout ? [`Payout minus recorded earnings: ${money(payout.amount - summary.totals.income)}`] : []),
    'Bank payout is separate from earnings. COD deductions and adjustments can change the bank credit.',
    `${summary.totals.shifts} days worked · ${summary.totals.orders} orders · ${summary.totals.hours} hours · ${summary.totals.km} km`,
    '', 'EXPENSE BREAKDOWN',
    ...summary.categories.map(c => `${c.label}: ${money(c.amount)}`),
    ...(summary.expenses.length ? [] : ['No expenses recorded.']),
    '', 'ALL WEEKLY ENTRIES (oldest first)',
    ...summary.items.flatMap(e => [
      `${e.date} | ${e.type === 'EXPENSE' ? categoryMeta(e.category).label : e.type === 'INCOME' ? 'Earnings' : 'COD settlement'} | ${money(e.amount)}`,
      ...(e.type === 'EXPENSE' ? [`Paid from: ${e.paidFrom === 'COD_CASH' ? 'COD cash' : 'Own money'}`] : []),
      ...(e.codAmount ? [`COD collected: ${money(e.codAmount)} (not earnings)`] : []),
      ...(e.type === 'COD_SETTLEMENT' ? [e.settlementMethod === 'DEDUCTED_FROM_PAYOUT' ? 'Deducted from payout' : 'Deposited'] : []),
      ...(e.note ? [e.note] : []), '',
    ]),
    onDevice ? 'Payout entered manually and saved on this device.' : 'Payout entered manually. Confirm account sync before treating this report as final.',
  ];
  await downloadReportPdf('Weekly summary', `Week ${summary.key}`, lines, `shiftledger-week-${summary.key}.pdf`);
}

export async function downloadReportPdf(title: string, footer: string, lines: string[], filename: string) {
  await document.fonts.ready;
  const pdf = new jsPDF();
  const canvas = document.createElement('canvas'); canvas.width = 1240; canvas.height = 1754;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  let y = 0, page = 0;
  const start = () => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#267d66'; ctx.font = 'bold 38px sans-serif'; ctx.fillText(`ShiftLedger | ${title}`, 80, 95);
    ctx.fillStyle = '#1b302d'; ctx.font = '24px sans-serif'; y = 160;
  };
  const finish = () => {
    ctx.fillStyle = '#6f7e79'; ctx.font = '20px sans-serif'; ctx.fillText(`${footer} · Page ${++page}`, 80, 1695);
    if (page > 1) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297);
  };
  const write = (line: string) => {
    if (y > 1620) { finish(); start(); }
    ctx.fillText(line, 80, y); y += 36;
  };
  start();
  for (const text of lines) {
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      // Wrap even unbroken notes without truncating any expense details.
      for (const char of paragraph) {
        if (ctx.measureText(line + char).width > 1080) { write(line); line = ''; }
        line += char;
      }
      write(line);
    }
  }
  finish();
  pdf.save(filename);
}
