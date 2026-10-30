import {
  api,
  type AgentMemory,
  type AgentMessage,
  type AgentSession,
  type AgentSkill,
  type AgentToolCall,
  type AgentTurn,
  type Drawing,
  type DrawingKind,
} from '../api';
import { catalog } from './catalog.svelte';
import { usage } from './usage.svelte';
import { ws } from './workspace.svelte';

const FORM_KEY = 'tradingagents.form';

/** Drawing layers the chart can show or hide, by drawing kind. */
export const LAYERS: { key: DrawingKind; label: string }[] = [
  { key: 'level', label: 'S/R' },
  { key: 'trendline', label: 'Trend' },
  { key: 'zone', label: 'Zona' },
  { key: 'fib', label: 'Fib' },
  { key: 'trade_plan', label: 'Rencana' },
  { key: 'note', label: 'Catatan' },
];

/** The model settings the analysis form last used, else the engine's defaults (also the Pine translator's). */
export function settings(): Omit<AgentTurn, 'message'> | null {
  let saved: Record<string, any> = {};
  try {
    saved = JSON.parse(localStorage.getItem(FORM_KEY) ?? '{}');
  } catch {
    saved = {};
  }
  const c = catalog.value;
  const provider = saved.provider ?? c?.defaults.provider;
  const quickModel = saved.quickModel ?? c?.defaults.quickModel;
  const deepModel = saved.deepModel ?? c?.defaults.deepModel;
  if (!provider || !quickModel || !deepModel) return null;
  return { provider, quickModel, deepModel, language: saved.language ?? 'Indonesian', backendUrl: saved.backendUrl || undefined };
}

/** The chart agent for the symbol in focus: its chats, its drawings, what it remembers. */
class AgentStore {
  symbol = $state<string | null>(null);
  sessions = $state<AgentSession[]>([]);
  session = $state<AgentSession | null>(null);
  messages = $state<AgentMessage[]>([]);
  drawings = $state<Drawing[]>([]);
  memories = $state<AgentMemory[]>([]);
  hidden = $state<Record<string, boolean>>({});
  sending = $state(false);
  error = $state('');
  /** Tool calls of the turn in progress, shown live. */
  liveTools = $state<AgentToolCall[]>([]);
  /** The answer as the model writes it (providers that stream); replaced by the final message. */
  liveText = $state('');
  /** Every version of every skill, newest first per name. */
  skills = $state<AgentSkill[]>([]);
  drafts = $derived(this.skills.filter((s) => s.status === 'draft'));

  async loadSkills() {
    this.skills = await api.skills().catch(() => this.skills);
  }

  async skillAction(skill: AgentSkill, action: 'approve' | 'reject' | 'disable' | 'enable' | 'restore') {
    try {
      await api.skillAction(skill.id, action);
    } catch (e) {
      this.error = (e as Error).message;
    }
    await this.loadSkills();
  }

  async deleteSkill(name: string) {
    if (!confirm(`Hapus skill ${name} beserta semua versinya?`)) return;
    await api.deleteSkill(name);
    await this.loadSkills();
  }

  visibleDrawings = $derived(this.drawings.filter((d) => !this.hidden[d.kind]));
  #abort: AbortController | null = null;

  async load(symbol: string) {
    if (this.symbol === symbol) return;
    this.symbol = symbol;
    this.session = null;
    this.messages = [];
    this.error = '';
    try {
      const [sessions, drawings, memories] = await Promise.all([api.agentSessions(symbol), api.drawings(symbol), api.memories(symbol)]);
      if (this.symbol !== symbol) return;
      this.sessions = sessions;
      this.drawings = drawings;
      this.memories = memories;
      this.loadSkills();
      if (sessions[0]) await this.open(sessions[0].id);
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  async open(id: string) {
    const s = await api.agentSession(id);
    this.session = s;
    this.messages = s.messages ?? [];
  }

  async newSession() {
    if (!this.symbol) return;
    const s = await api.createAgentSession(this.symbol);
    this.sessions = [s, ...this.sessions];
    this.session = s;
    this.messages = [];
  }

  async deleteSession() {
    if (!this.session || !confirm('Hapus sesi chat ini?')) return;
    await api.deleteAgentSession(this.session.id);
    this.sessions = this.sessions.filter((s) => s.id !== this.session!.id);
    this.session = null;
    this.messages = [];
    if (this.sessions[0]) await this.open(this.sessions[0].id);
  }

  async send(text: string) {
    const message = text.trim();
    const base = settings();
    if (!message || this.sending) return;
    if (!base) {
      this.error = 'Pilih provider dan model di Pengaturan form Analisa dulu.';
      return;
    }
    this.error = '';
    if (!this.session) await this.newSession();
    const session = this.session!;
    this.messages.push({ id: `local-${Date.now()}`, role: 'user', content: message, toolCalls: [] });
    this.sending = true;
    this.liveTools = [];
    this.liveText = '';
    this.#abort = new AbortController();
    try {
      await api.sendAgentMessage(session.id, { ...base, message }, (type, d) => this.#onEvent(type, d), this.#abort.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.error = (e as Error).message;
    } finally {
      this.sending = false;
      this.liveText = '';
      this.#abort = null;
      usage.refresh();
      this.sessions = await api.agentSessions(session.symbol).catch(() => this.sessions);
    }
  }

  stop() {
    this.#abort?.abort();
  }

  #onEvent(type: string, d: any) {
    switch (type) {
      case 'delta':
        this.liveText += d.text ?? '';
        break;
      case 'tool_call':
        // Text a step wrote before deciding to call tools is not the answer.
        this.liveText = '';
        this.liveTools.push({ name: d.name, args: d.args ?? {} });
        break;
      case 'tool_result': {
        const call = [...this.liveTools].reverse().find((t) => t.name === d.name && t.summary === undefined);
        if (call) call.summary = d.summary;
        break;
      }
      case 'drawing':
        this.drawings.push(d.drawing);
        // Show the agent's work as it draws.
        if (ws.chartView !== 'ai') ws.setChartView('ai');
        break;
      case 'memory':
        this.memories.unshift({ ...d.memory, symbol: d.memory.scope === 'symbol' ? this.symbol : null, createdAt: new Date().toISOString() });
        break;
      case 'forget':
        this.memories = this.memories.filter((m) => m.id !== d.id);
        break;
      case 'skill_proposed':
        // A new draft waits in the Skill panel for the user's approval.
        this.loadSkills();
        break;
      case 'message':
        this.messages.push({ id: `local-a-${Date.now()}`, role: 'assistant', content: d.content, toolCalls: [...this.liveTools] });
        this.liveTools = [];
        this.liveText = '';
        break;
      case 'error':
        this.error = d.message;
        break;
    }
  }

  async deleteDrawing(id: string) {
    await api.deleteDrawing(id);
    this.drawings = this.drawings.filter((d) => d.id !== id);
  }

  async clearDrawings() {
    if (!this.symbol || !confirm(`Hapus semua gambar di chart ${this.symbol}?`)) return;
    await api.clearDrawings(this.symbol);
    this.drawings = [];
  }

  async deleteMemory(id: string) {
    await api.deleteMemory(id);
    this.memories = this.memories.filter((m) => m.id !== id);
  }

  toggleLayer(kind: DrawingKind) {
    this.hidden = { ...this.hidden, [kind]: !this.hidden[kind] };
  }
}

export const agent = new AgentStore();
