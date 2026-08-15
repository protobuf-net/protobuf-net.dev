import './styles.css';
import { initSchemaView } from './schema';
import { initDecodeView } from './decode';
import { loadInterop, engineVersion } from './wasm';

type ViewName = 'schema' | 'decode';

function currentView(): ViewName {
  return location.hash.replace('#', '') === 'decode' ? 'decode' : 'schema';
}

function showView(view: ViewName): void {
  for (const name of ['schema', 'decode'] as const) {
    const section = document.querySelector(`#view-${name}`);
    if (section instanceof HTMLElement) section.hidden = name !== view;
  }
  for (const tab of document.querySelectorAll<HTMLAnchorElement>('#view-tabs a')) {
    tab.classList.toggle('active', tab.dataset['view'] === view);
  }
}

async function main(): Promise<void> {
  const overlay = document.querySelector<HTMLElement>('#boot-overlay');
  const versionLabel = document.querySelector('#engine-version');

  window.addEventListener('hashchange', () => showView(currentView()));
  showView(currentView());

  try {
    // one boot, shared by both views; everything after this is synchronous C# calls
    await loadInterop();
  } catch (error) {
    if (overlay) {
      overlay.innerHTML = '';
      const message = document.createElement('div');
      message.className = 'boot-inner';
      message.textContent = `Could not load the WebAssembly engine: ${String(error)}`;
      overlay.append(message);
    }
    return;
  }

  initSchemaView();
  initDecodeView();

  if (versionLabel) {
    versionLabel.textContent = `protobuf-net.Reflection ${await engineVersion()}`;
  }
  overlay?.remove();
}

void main();
