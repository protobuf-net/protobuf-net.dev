import './styles.css';
import { initSchemaView } from './schema';
import { initDecodeView } from './decode';
import { loadInterop, engineVersion } from './wasm';

type ViewName = 'schema' | 'decode';

/** How long a boot can go quiet before the overlay says something about it. */
const SLOW_BOOT_MS = 10_000;

/**
 * Adds a line under the spinner once a boot has gone on long enough to be worth explaining.
 *
 * Additive on purpose, and not a diagnosis. From in here a slow connection and a loader waiting on
 * a file that will never arrive look the same: the runtime does not always reject when an asset is
 * missing, it can simply never finish, and a spinner has no way to tell those apart either. The
 * advice happens to be the same for both, so it does not need to know which one it is looking at —
 * and if the answer is just a slow connection, nothing has been taken away from the page.
 */
function hintIfSlow(overlay: HTMLElement | null): () => void {
  const timer = setTimeout(() => {
    const inner = overlay?.querySelector('.boot-inner');
    if (!inner) return;

    const hint = document.createElement('p');
    hint.className = 'boot-hint';
    hint.append(
      'Still going. The engine is around 1.7 MB and compiles on the first visit, so this can take ' +
        'a moment. If it never finishes, this browser may be holding an out-of-date copy — ',
    );

    // a plain reload is free to serve the same cached files again; a URL the cache has never seen
    // is not, and a fresh index.html names the current bundle and runtime
    const reload = document.createElement('a');
    const url = new URL(location.href);
    url.searchParams.set('reload', Date.now().toString(36));
    reload.href = url.href;
    reload.textContent = 'fetch the current one';
    hint.append(reload, '.');

    inner.append(hint);
  }, SLOW_BOOT_MS);

  return () => clearTimeout(timer);
}

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

  const stopHint = hintIfSlow(overlay);
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
  } finally {
    stopHint();
  }

  initSchemaView();
  initDecodeView();

  if (versionLabel) {
    versionLabel.textContent = `protobuf-net.Reflection ${await engineVersion()}`;
  }
  overlay?.remove();
}

void main();
