// TradingView's widgets run in a cross-origin iframe and open their
// largeChartUrl (this app, with #/?tvwidgetsymbol=…) in a new tab; nothing on
// this page can stop that. So the new tab hands the symbol to a TradingAgents
// tab that is already open, which switches to it in place, and the new tab
// closes itself. With no other tab open, the new tab simply carries on.

const CHANNEL = 'tradingagents-tabs';

type Message =
  | { type: 'who'; ask: string }
  | { type: 'here'; ask: string; tab: string; focusedAt: number }
  | { type: 'open'; ask: string; tab: string; symbol: string }
  | { type: 'done'; ask: string };

const supported = typeof BroadcastChannel !== 'undefined';
// How long a new tab waits for open tabs to answer, then for the chosen one to switch.
const ASK_MS = 250;
const SWITCH_MS = 1500;

/** In a tab showing the workspace: answer new tabs, and switch to the symbol they hand over. */
export function acceptHandoffs(open: (symbol: string) => void) {
  if (!supported) return;
  const tab = crypto.randomUUID();
  let focusedAt = document.hasFocus() ? Date.now() : 0;
  addEventListener('focus', () => (focusedAt = Date.now()));
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    if (data.type === 'who') {
      channel.postMessage({ type: 'here', ask: data.ask, tab, focusedAt } satisfies Message);
    } else if (data.type === 'open' && data.tab === tab) {
      open(data.symbol);
      channel.postMessage({ type: 'done', ask: data.ask } satisfies Message);
    }
  };
}

/** In a tab a widget just opened: give the symbol to the open tab used most recently. True when one took it. */
export function handOff(symbol: string): Promise<boolean> {
  if (!supported) return Promise.resolve(false);
  return new Promise((resolve) => {
    const ask = crypto.randomUUID();
    const channel = new BroadcastChannel(CHANNEL);
    const tabs: { tab: string; focusedAt: number }[] = [];
    let timer: ReturnType<typeof setTimeout>;
    const finish = (taken: boolean) => {
      clearTimeout(timer);
      channel.close();
      resolve(taken);
    };
    channel.onmessage = ({ data }: MessageEvent<Message>) => {
      if (!('ask' in data) || data.ask !== ask) return;
      if (data.type === 'here') tabs.push({ tab: data.tab, focusedAt: data.focusedAt });
      else if (data.type === 'done') finish(true);
    };
    channel.postMessage({ type: 'who', ask } satisfies Message);
    timer = setTimeout(() => {
      if (!tabs.length) return finish(false);
      const chosen = tabs.sort((a, b) => b.focusedAt - a.focusedAt)[0];
      channel.postMessage({ type: 'open', ask, tab: chosen.tab, symbol } satisfies Message);
      timer = setTimeout(() => finish(false), SWITCH_MS);
    }, ASK_MS);
  });
}
