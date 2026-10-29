import { api, type Analysis, type AnalysisStatus, type RunStats } from '../api';
import { formatDuration, SECTION_LABELS, SECTION_ORDER, TEAMS } from '../format';

export type LogEntry = { seq: number; kind: string; text: string };

const MAX_LOG = 500;

/**
 * One analysis: its stored state, then its event stream (SSE). The stream
 * replays every stored event first, so the log is complete for finished runs
 * too, and ends with the run. Call destroy() when the run is no longer shown.
 */
export class RunStream {
  readonly id: string;
  readonly ready: Promise<void>;

  analysis = $state<Analysis | null>(null);
  loadError = $state('');
  status = $state<AnalysisStatus>('queued');
  agents = $state<Record<string, string>>({});
  reports = $state<Record<string, string>>({});
  stats = $state<RunStats | null>(null);
  rating = $state<string | null>(null);
  error = $state<string | null>(null);
  log = $state<LogEntry[]>([]);
  busy = $state(false);
  now = $state(Date.now());

  live = $derived(this.status === 'queued' || this.status === 'running');
  ticker = $derived(this.analysis?.ticker ?? '');
  sections = $derived(SECTION_ORDER.filter((s) => this.reports[s] && s !== 'final_trade_decision'));
  decision = $derived(this.reports.final_trade_decision ?? '');
  teams = $derived(
    TEAMS.map((t) => ({ ...t, agents: t.agents.filter((a) => a in this.agents) })).filter((t) => t.agents.length),
  );
  agentCount = $derived(Object.keys(this.agents).length);
  agentsDone = $derived(Object.values(this.agents).filter((s) => s === 'completed').length);
  elapsed = $derived.by(() => {
    void this.now; // ticks every second while running
    return formatDuration(this.analysis?.startedAt ?? null, this.live ? null : (this.analysis?.finishedAt ?? null));
  });

  #source: EventSource | null = null;
  #clock: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  #onEnd?: (run: RunStream) => void;

  constructor(id: string, onEnd?: (run: RunStream) => void) {
    this.id = id;
    this.#onEnd = onEnd;
    this.ready = this.#start();
  }

  async #start() {
    try {
      await this.refresh();
    } catch (e) {
      this.loadError = (e as Error).message;
      return;
    }
    if (this.#closed) return;
    this.#connect();
    if (this.live) this.#clock = setInterval(() => (this.now = Date.now()), 1000);
  }

  async refresh() {
    const a = await api.get(this.id);
    this.analysis = a;
    this.status = a.status;
    this.agents = a.agents;
    this.reports = a.reports;
    this.stats = a.stats;
    this.rating = a.rating;
    this.error = a.error;
  }

  #push(entry: LogEntry) {
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  #connect() {
    const source = (this.#source = new EventSource(api.eventsUrl(this.id)));
    const on = (type: string, handle: (data: any) => void) =>
      source.addEventListener(type, (e) => {
        // The browser fires its own "error" event on connection trouble, without data.
        if (!(e instanceof MessageEvent) || !e.data) return;
        handle(JSON.parse(e.data));
      });

    on('started', (d) => {
      this.status = 'running';
      if (this.analysis && !this.analysis.startedAt) this.analysis.startedAt = new Date().toISOString();
      this.#push({ seq: d.seq, kind: 'System', text: `Mulai: ${d.ticker} (${d.assetType}) · ${d.date} · analis: ${d.analysts.join(', ')}` });
    });
    on('status', (d) => (this.agents = d.agents));
    on('report', (d) => {
      this.reports[d.section] = d.content;
      this.#push({ seq: d.seq, kind: 'Report', text: `Laporan diperbarui: ${SECTION_LABELS[d.section] ?? d.section}` });
    });
    on('message', (d) => this.#push({ seq: d.seq, kind: d.kind, text: d.content }));
    on('tool_call', (d) =>
      this.#push({
        seq: d.seq,
        kind: 'Tool',
        text: `${d.name}(${Object.entries(d.args ?? {})
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(', ')})`,
      }),
    );
    on('stats', (d) => (this.stats = d));
    on('done', (d) => (this.rating = d.rating));
    on('error', (d) => {
      this.error = d.message;
      this.#push({ seq: d.seq, kind: 'Error', text: d.message });
    });
    on('end', async (d) => {
      source.close();
      this.#source = null;
      clearInterval(this.#clock);
      const wasLive = this.live;
      this.status = d.status;
      this.error = d.error;
      await this.refresh().catch(() => {});
      if (wasLive && !this.#closed) this.#onEnd?.(this);
    });
  }

  async cancel() {
    this.busy = true;
    try {
      await api.cancel(this.id);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  /** Deletes the analysis; false when the user backed out or the server refused. */
  async remove(): Promise<boolean> {
    if (!confirm(`Hapus analisa ${this.ticker || ''} dari riwayat?`)) return false;
    this.busy = true;
    try {
      await api.remove(this.id);
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    } finally {
      this.busy = false;
    }
  }

  destroy() {
    this.#closed = true;
    this.#source?.close();
    this.#source = null;
    clearInterval(this.#clock);
  }
}
