import { CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule, ArrowDownLeft, ArrowUpRight, Bike, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, CreditCard,
  Download, Flame, Fuel, Gauge, LayoutDashboard, Lightbulb, Moon, Package, Pencil, Plus, Receipt, Route, Search, Settings2, ShieldCheck,
  Smartphone, Sparkles, Sun, Target, Timer, Trash2, TrendingDown, TrendingUp, Undo2, Utensils, Wallet, Wrench, X
} from 'lucide-angular';
import { EntryDraft, EntryType, LedgerEntry } from './entry.model';
import { EntryService } from './entry.service';
import { EntryFormComponent } from './entry-form.component';
import {
  CATEGORIES, DayBar, Period, addDays, bestWeekday, categoryMeta, change, dailySeries, inRange, isoDate, parseDate, rangeFor, shiftAnchor, startOfDay, totals
} from './ledger';

interface Settings { name: string; weeklyGoal: number | null; theme: 'system' | 'light' | 'dark'; }
interface Toast { message: string; actionLabel?: string; action?: () => void; }
interface Insight { icon: keyof AppComponent['icons']; text: string; }

const SETTINGS_KEY = 'shiftledger.settings';
const PERIOD_NAMES: Record<Period, { current: string; previous: string }> = {
  day: { current: 'Today', previous: 'yesterday' },
  week: { current: 'This week', previous: 'same point last week' },
  month: { current: 'This month', previous: 'same point last month' },
};

@Component({
  selector: 'app-root',
  imports: [FormsModule, CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet, LucideAngularModule, EntryFormComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  readonly icons = {
    ArrowDownLeft, ArrowUpRight, Bike, CalendarDays, Check, ChevronLeft, ChevronRight, CircleDollarSign, CreditCard, Download, Flame, Fuel, Gauge,
    LayoutDashboard, Lightbulb, Moon, Package, Pencil, Plus, Receipt, Route, Search, Settings2, ShieldCheck, Smartphone, Sparkles, Sun, Target,
    Timer, Trash2, TrendingDown, TrendingUp, Undo2, Utensils, Wallet, Wrench, X
  };
  readonly periods: Period[] = ['day', 'week', 'month'];
  private readonly service = inject(EntryService);

  readonly onDevice = this.service.onDevice;
  readonly entries = signal<LedgerEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly period = signal<Period>('week');
  readonly anchor = signal(new Date());
  readonly activeFilter = signal<'ALL' | EntryType>('ALL');
  readonly search = signal('');
  readonly form = signal<{ type: EntryType; entry: LedgerEntry | null } | null>(null);
  readonly settingsOpen = signal(false);
  readonly toast = signal<Toast | null>(null);
  readonly settings = signal<Settings>(this.loadSettings());
  readonly hoveredDay = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;
  readonly isDark = computed(() => {
    const theme = this.settings().theme;
    return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  // ── Period ────────────────────────────────────────────────
  readonly range = computed(() => rangeFor(this.period(), this.anchor()));
  /** For the in-progress period, compare against the same elapsed stretch of the previous one (Mon–Tue vs Mon–Tue), not all of it. */
  readonly previousRange = computed(() => {
    const prev = rangeFor(this.period(), shiftAnchor(this.period(), this.anchor(), -1));
    if (!this.isCurrentPeriod() || this.period() === 'day') return prev;
    const elapsedDays = Math.round((startOfDay(new Date()).getTime() - this.range().start.getTime()) / 86_400_000) + 1;
    const end = addDays(prev.start, elapsedDays);
    return { start: prev.start, end: end < prev.end ? end : prev.end };
  });
  readonly isCurrentPeriod = computed(() => { const now = new Date(); return now >= this.range().start && now < this.range().end; });
  readonly periodName = computed(() => this.isCurrentPeriod() ? PERIOD_NAMES[this.period()].current : this.rangeLabel());
  readonly previousName = computed(() => this.isCurrentPeriod() ? PERIOD_NAMES[this.period()].previous : `previous ${this.period()}`);
  readonly rangeLabel = computed(() => {
    const { start, end } = this.range();
    if (this.period() === 'day') return start.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    if (this.period() === 'month') return start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const last = addDays(end, -1);
    return `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  });

  // ── Numbers ───────────────────────────────────────────────
  readonly periodEntries = computed(() => inRange(this.entries(), this.range()));
  readonly current = computed(() => totals(this.periodEntries()));
  readonly previous = computed(() => totals(inRange(this.entries(), this.previousRange())));
  readonly incomeChange = computed(() => change(this.current().income, this.previous().income));
  readonly expenseChange = computed(() => change(this.current().expenses, this.previous().expenses));
  readonly netChange = computed(() => change(this.current().net, this.previous().net));
  readonly keptPercent = computed(() => this.current().income ? Math.max(0, Math.round((this.current().net / this.current().income) * 100)) : 0);
  readonly perHour = computed(() => this.current().hours ? this.current().incomeWithHours / this.current().hours : null);
  readonly perOrder = computed(() => this.current().orders ? this.current().incomeWithOrders / this.current().orders : null);
  readonly fuelPerKm = computed(() => this.current().km && this.current().fuel ? this.current().fuel / this.current().km : null);
  readonly daysWorked = computed(() => new Set(this.periodEntries().filter((e) => e.type === 'INCOME').map((e) => e.date)).size);

  readonly breakdown = computed(() => {
    const total = this.current().expenses;
    return CATEGORIES.map((c) => {
      const value = this.periodEntries().filter((e) => e.category === c.key).reduce((sum, e) => sum + e.amount, 0);
      return { ...c, value, percent: total ? (value / total) * 100 : 0 };
    }).filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  });

  // ── Chart ─────────────────────────────────────────────────
  /** A single day is too thin to chart, so day view shows its week with that day highlighted. */
  readonly chartRange = computed(() => this.period() === 'day' ? rangeFor('week', this.anchor()) : this.range());
  readonly chartDays = computed(() => dailySeries(this.entries(), this.chartRange()));
  readonly chartMax = computed(() => Math.max(1, ...this.chartDays().map((d) => Math.max(d.income, d.expenses))));
  readonly bestDay = computed(() => {
    const best = this.chartDays().reduce<DayBar | null>((top, d) => d.income > (top?.income ?? 0) ? d : top, null);
    return best?.iso ?? null;
  });
  readonly todayIso = isoDate(new Date());
  readonly selectedIso = computed(() => this.period() === 'day' ? isoDate(this.range().start) : null);
  readonly hoveredBar = computed(() => this.chartDays().find((d) => d.iso === this.hoveredDay()) ?? null);

  // ── Goal & insights ───────────────────────────────────────
  readonly weekTotals = computed(() => totals(inRange(this.entries(), rangeFor('week', new Date()))));
  readonly goalProgress = computed(() => {
    const goal = this.settings().weeklyGoal;
    if (!goal) return null;
    const net = this.weekTotals().net;
    const remaining = Math.max(0, goal - net);
    const recent = totals(inRange(this.entries(), { start: addDays(new Date(), -28), end: addDays(new Date(), 1) }));
    const avgShift = recent.shifts ? recent.net / recent.shifts : 0;
    return {
      goal, net, remaining, percent: Math.min(100, Math.max(0, Math.round((net / goal) * 100))),
      shiftsNeeded: remaining > 0 && avgShift > 0 ? Math.ceil(remaining / avgShift) : null,
      daysLeft: 7 - ((new Date().getDay() + 6) % 7),
    };
  });

  readonly insights = computed<Insight[]>(() => {
    const t = this.current();
    const list: Insight[] = [];
    const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
    if (t.fuel && t.income) {
      const share = Math.round((t.fuel / t.income) * 100);
      list.push({ icon: 'Fuel', text: `Fuel took ${share}% of your earnings${this.fuelPerKm() ? ` — about ₹${this.fuelPerKm()!.toFixed(1)} per km` : ''}.` });
    }
    const top = this.breakdown()[0];
    if (top && top.key !== 'FUEL' && top.percent >= 30) list.push({ icon: 'Receipt', text: `${top.label} is your biggest cost: ${money(top.value)} (${Math.round(top.percent)}% of spending).` });
    if (this.daysWorked() > 1) list.push({ icon: 'CalendarDays', text: `You worked ${this.daysWorked()} days, averaging ${money(t.net / this.daysWorked())} take-home per day.` });
    const best = bestWeekday(this.entries());
    if (best) list.push({ icon: 'TrendingUp', text: `${best.day}s are your strongest day — ${money(best.average)} on average.` });
    if (t.shifts && !t.hours) list.push({ icon: 'Timer', text: 'Add hours and orders to your shifts to see what you earn per hour.' });
    if (!list.length) list.push({ icon: 'Lightbulb', text: 'Log shifts and costs as they happen — insights appear once there is some data.' });
    return list.slice(0, 4);
  });

  // ── Activity ──────────────────────────────────────────────
  readonly activityGroups = computed(() => {
    const query = this.search().trim().toLowerCase();
    const filtered = this.periodEntries().filter((e) =>
      (this.activeFilter() === 'ALL' || e.type === this.activeFilter()) &&
      (!query || [e.note ?? '', this.entryTitle(e), this.entrySubtitle(e), String(e.amount)].some((s) => s.toLowerCase().includes(query))));
    const groups = new Map<string, LedgerEntry[]>();
    for (const e of filtered) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
    return [...groups.entries()].map(([iso, items]) => ({ iso, date: parseDate(iso), items, net: totals(items).net }));
  });
  readonly activityCount = computed(() => this.activityGroups().reduce((n, g) => n + g.items.length, 0));

  readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part = hour < 5 ? 'Late shift' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return `${part}, ${this.settings().name || 'rider'}`;
  });

  constructor() {
    this.refresh();
    effect(() => {
      document.documentElement.dataset['theme'] = this.isDark() ? 'dark' : 'light';
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings()));
    });
  }

  refresh(): void {
    this.service.list().subscribe({
      next: (entries) => { this.entries.set(entries); this.loading.set(false); this.error.set(''); },
      error: () => { this.error.set('Could not connect to the tracker API. Start the Spring Boot server and refresh.'); this.loading.set(false); },
    });
  }

  setPeriod(period: Period): void { this.period.set(period); this.anchor.set(new Date()); }
  step(direction: number): void { if (direction > 0 && this.isCurrentPeriod()) return; this.anchor.set(shiftAnchor(this.period(), this.anchor(), direction)); }
  pickDay(iso: string): void { this.period.set('day'); this.anchor.set(parseDate(iso)); }

  openForm(type: EntryType, entry: LedgerEntry | null = null): void { this.form.set({ type, entry }); }
  onSaved(event: { entry: LedgerEntry; addAnother: boolean; edited: boolean }): void {
    if (!event.addAnother) this.form.set(null);
    this.showToast({ message: event.edited ? 'Entry updated' : `Saved ₹${event.entry.amount.toLocaleString('en-IN')} ${event.entry.type === 'INCOME' ? 'earning' : 'expense'}` });
    this.refresh();
  }

  removeEntry(entry: LedgerEntry): void {
    this.entries.update((list) => list.filter((e) => e.id !== entry.id));
    this.service.delete(entry.id).subscribe({
      next: () => this.showToast({ message: 'Entry deleted', actionLabel: 'Undo', action: () => this.restore(entry) }),
      error: () => { this.showToast({ message: 'Could not delete this entry.' }); this.refresh(); },
    });
  }
  private restore(entry: LedgerEntry): void {
    const { id, ...draft } = entry;
    this.service.create(draft as EntryDraft).subscribe({ next: () => { this.showToast({ message: 'Entry restored' }); this.refresh(); } });
  }

  showToast(toast: Toast): void {
    clearTimeout(this.toastTimer);
    this.toast.set(toast);
    this.toastTimer = setTimeout(() => this.toast.set(null), toast.action ? 6000 : 3000);
  }
  runToastAction(): void { const action = this.toast()?.action; this.toast.set(null); action?.(); }

  exportCsv(): void {
    this.service.exportCsv(isoDate(this.range().start), isoDate(addDays(this.range().end, -1)));
  }

  updateSettings(patch: Partial<Settings>): void { this.settings.update((s) => ({ ...s, ...patch })); }
  toggleTheme(): void { this.updateSettings({ theme: this.isDark() ? 'light' : 'dark' }); }
  scrollTo(id: string): void { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  entryIcon(e: LedgerEntry) { return e.type === 'INCOME' ? this.icons.Bike : this.icons[categoryMeta(e.category).icon as keyof AppComponent['icons']]; }
  entryTitle(e: LedgerEntry): string { return e.note || (e.type === 'INCOME' ? 'Delivery shift' : categoryMeta(e.category).label); }
  entrySubtitle(e: LedgerEntry): string {
    if (e.type === 'EXPENSE') return e.note ? categoryMeta(e.category).label : 'Work expense';
    const parts = [e.orderCount ? `${e.orderCount} orders` : '', e.hoursWorked ? `${e.hoursWorked} h` : '', e.distanceKm ? `${e.distanceKm} km` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Shift earning';
  }
  barHeight(value: number): number { return value ? Math.max(3, (value / this.chartMax()) * 100) : 0; }
  dayLabel(date: Date): string {
    return this.chartDays().length > 7 ? String(date.getDate()) : date.toLocaleDateString('en-IN', { weekday: 'short' });
  }
  showDayLabel(date: Date, index: number): boolean { return this.chartDays().length <= 7 || index === 0 || (date.getDate() % 5 === 0 && date.getDate() < 30); }

  private loadSettings(): Settings {
    try { return { name: '', weeklyGoal: null, theme: 'system', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; }
    catch { return { name: '', weeklyGoal: null, theme: 'system' }; }
  }
}
