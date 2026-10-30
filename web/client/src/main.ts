import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { handOff } from './lib/tabs'

// A TradingView widget opened this tab for one symbol (see lib/tabs.ts). When a
// TradingAgents tab is already open it takes the symbol and this tab closes;
// otherwise this tab becomes the app.
async function start() {
  const symbol = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tvwidgetsymbol')
  if (symbol && history.length <= 1 && (await handOff(symbol))) {
    window.close()
    // Still here: this browser does not let a page close a tab it did not open.
    const target = document.getElementById('app')!
    target.innerHTML = `<main class="grid min-h-dvh place-items-center bg-base-100 p-6 text-center text-sm">
      <p class="max-w-sm">${symbol.replace(/[<>&"]/g, '')} sudah dibuka di tab TradingAgents yang lain. Tab ini boleh ditutup.</p>
    </main>`
    return
  }
  mount(App, { target: document.getElementById('app')! })
}

start()
