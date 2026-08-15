import { decode } from './wasm';
import { parsePayload, formatBytes, toHex, type PayloadFormat } from './payload';
import { renderTree, setAllOpen } from './tree';

const DEBOUNCE_MS = 200;

/** Above this, hex-ifying a picked file into the textarea costs more than it helps. */
const INLINE_FILE_LIMIT = 64 * 1024;

export function initDecodeView(): void {
  const textarea = required<HTMLTextAreaElement>('#payload-text');
  const optionsForm = required<HTMLFormElement>('#decode-options');
  const formatSelect = required<HTMLSelectElement>('#opt-format');
  const fileInput = required<HTMLInputElement>('#payload-file');
  const clearButton = required<HTMLButtonElement>('#clear-payload');
  const status = required('#payload-status');
  const tree = required('#decode-tree');
  const toolbar = required<HTMLElement>('#tree-toolbar');

  // set when the payload came from a file that was too big to mirror into the textarea
  let fileBytes: Uint8Array | undefined;
  let timer: number | undefined;
  let generation = 0;

  textarea.addEventListener('input', () => {
    fileBytes = undefined;
    schedule();
  });
  optionsForm.addEventListener('change', () => schedule());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (bytes.length <= INLINE_FILE_LIMIT) {
      fileBytes = undefined;
      textarea.value = toHex(bytes, ' ');
      formatSelect.value = 'hex';
    } else {
      fileBytes = bytes;
      textarea.value = '';
      textarea.placeholder = `${file.name} — ${formatBytes(bytes.length)} loaded from file`;
    }
    void run();
  });

  clearButton.addEventListener('click', () => {
    fileBytes = undefined;
    textarea.value = '';
    fileInput.value = '';
    textarea.placeholder = 'Paste a protobuf payload as hex (0A 02 68 69) or base-64 (CgJoaQ==)';
    status.replaceChildren();
    tree.replaceChildren();
    toolbar.hidden = true;
  });

  required('#expand-all').addEventListener('click', () => setAllOpen(tree, true));
  required('#collapse-all').addEventListener('click', () => setAllOpen(tree, false));

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void run(), DEBOUNCE_MS) as unknown as number;
  }

  async function run(): Promise<void> {
    const token = ++generation;
    const fullStrings = new FormData(optionsForm).has('fullStrings');

    let bytes: Uint8Array;
    if (fileBytes) {
      bytes = fileBytes;
      setStatus(status, 'ok', `${formatBytes(bytes.length)} from file`);
    } else {
      const text = textarea.value;
      if (text.trim().length === 0) {
        status.replaceChildren();
        tree.replaceChildren();
        toolbar.hidden = true;
        return;
      }
      const parsed = parsePayload(text, formatSelect.value as PayloadFormat);
      if (!parsed.bytes) {
        setStatus(status, 'error', parsed.error ?? 'could not read the payload');
        tree.replaceChildren();
        toolbar.hidden = true;
        return;
      }
      bytes = parsed.bytes;
      setStatus(status, 'ok', `${formatBytes(bytes.length)} read as ${parsed.format}`);
    }

    const result = await decode(bytes, fullStrings);
    if (token !== generation) return;

    renderTree(tree, result);
    toolbar.hidden = result.nodes.length === 0;
  }
}

function setStatus(container: Element, kind: 'ok' | 'error', text: string): void {
  container.replaceChildren();
  const span = document.createElement('span');
  span.className = `status ${kind}`;
  span.textContent = text;
  container.append(span);
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}
