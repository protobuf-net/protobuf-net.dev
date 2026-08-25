import { decode, schemaTypes } from './wasm';
import { parsePayload, formatBytes, toHex, type PayloadFormat } from './payload';
import { renderTree, setAllOpen } from './tree';
import { createEditor, setContent, showErrors, clearErrors } from './editor';
import { decodeSamples } from './decodeSamples';
import type { DecodeRequest, DecodeResult, SchemaError } from './types';

const DEBOUNCE_MS = 200;

/** Parsing a schema costs more than re-reading a payload, so it waits a little longer. */
const SCHEMA_DEBOUNCE_MS = 350;

/** Above this, hex-ifying a picked file into the textarea costs more than it helps. */
const INLINE_FILE_LIMIT = 64 * 1024;

/** The name the schema is parsed under, so its diagnostics can be matched back to this editor. */
const SCHEMA_FILE = 'payload.proto';

export function initDecodeView(): void {
  const textarea = required<HTMLTextAreaElement>('#payload-text');
  const optionsForm = required<HTMLFormElement>('#decode-options');
  const formatSelect = required<HTMLSelectElement>('#opt-format');
  const fileInput = required<HTMLInputElement>('#payload-file');
  const clearButton = required<HTMLButtonElement>('#clear-payload');
  const samplePicker = required<HTMLSelectElement>('#decode-sample-picker');
  const status = required('#payload-status');
  const tree = required('#decode-tree');
  const toolbar = required<HTMLElement>('#tree-toolbar');

  const schemaPanel = required<HTMLDetailsElement>('#decode-schema');
  const schemaOptions = required<HTMLFormElement>('#decode-schema-options');
  const rootSelect = required<HTMLSelectElement>('#opt-root-type');
  const schemaMessages = required('#decode-schema-messages');
  const schemaState = required('#decode-schema-state');
  const schemaFile = required<HTMLInputElement>('#decode-schema-file');

  const schemaEditor = createEditor({
    parent: required('#decode-schema-editor'),
    language: 'protobuf',
    onChange: () => scheduleSchema(),
  });

  // set when the payload came from a file that was too big to mirror into the textarea
  let fileBytes: Uint8Array | undefined;

  // The message the *user* picked, which is not the same thing as the one the picker is showing:
  // with nothing chosen the engine infers one from the bytes and the picker displays it, and that
  // display must never harden into a choice the user never made.
  let chosenType: string | undefined;
  let payloadTimer: number | undefined;
  let schemaTimer: number | undefined;
  let generation = 0;
  let schemaGeneration = 0;

  for (const sample of decodeSamples) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.label;
    samplePicker.append(option);
  }

  textarea.addEventListener('input', () => {
    fileBytes = undefined;
    schedule();
  });
  optionsForm.addEventListener('change', () => schedule());

  // choosing the message the payload is an instance of is the other half of supplying a schema
  schemaOptions.addEventListener('change', () => {
    chosenType = rootSelect.value || undefined;
    schedule();
  });

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
    // the schema is left alone: it describes the next payload as much as it did this one
    fileBytes = undefined;
    textarea.value = '';
    fileInput.value = '';
    textarea.placeholder = 'Paste a protobuf payload as hex (0A 02 68 69) or base-64 (CgJoaQ==)';
    status.replaceChildren();
    tree.replaceChildren();
    toolbar.hidden = true;
  });

  samplePicker.addEventListener('change', () => {
    const sample = decodeSamples.find((candidate) => candidate.id === samplePicker.value);
    samplePicker.value = '';
    if (!sample) return;

    fileBytes = undefined;
    fileInput.value = '';
    formatSelect.value = 'hex';
    textarea.value = sample.payload;
    setContent(schemaEditor, sample.schema);
    schemaPanel.open = true;

    // the sample knows its own root type, so this does not wait for the debounced edit to land
    cancelSchema();
    void (async () => {
      await refreshTypes();
      chosenType = sample.rootType;
      rootSelect.value = sample.rootType;
      await run();
    })();
  });

  // Read here in the browser, like the payload file above it: the schema names the fields for a
  // decode that is already happening locally, so opening one sends nothing anywhere.
  schemaFile.addEventListener('change', () => {
    const file = schemaFile.files?.[0];
    // so that picking the same file again reloads it, rather than being a no-op change event
    schemaFile.value = '';
    if (!file) return;

    void (async () => {
      let text: string;
      try {
        text = await file.text();
      } catch (error) {
        renderMessages(schemaMessages, [], `could not read ${file.name}: ${String(error)}`);
        return;
      }
      setContent(schemaEditor, text);
      schemaPanel.open = true;
      cancelSchema();
      await refreshSchema();
    })();
  });

  // the editor is built inside a closed disclosure, so it has nothing to measure against until
  // the panel opens; without this it renders with a collapsed gutter the first time it is shown
  schemaPanel.addEventListener('toggle', () => {
    if (schemaPanel.open) schemaEditor.requestMeasure();
  });

  required('#expand-all').addEventListener('click', () => setAllOpen(tree, true));
  required('#collapse-all').addEventListener('click', () => setAllOpen(tree, false));

  function schedule(): void {
    if (payloadTimer !== undefined) clearTimeout(payloadTimer);
    payloadTimer = setTimeout(() => void run(), DEBOUNCE_MS) as unknown as number;
  }

  function scheduleSchema(): void {
    cancelSchema();
    schemaTimer = setTimeout(() => void refreshSchema(), SCHEMA_DEBOUNCE_MS) as unknown as number;
  }

  function cancelSchema(): void {
    if (schemaTimer !== undefined) clearTimeout(schemaTimer);
    schemaTimer = undefined;
  }

  async function refreshSchema(): Promise<void> {
    await refreshTypes();
    await run();
  }

  /** Offers the messages the schema declares, keeping the user's choice if it survived the edit. */
  async function refreshTypes(): Promise<void> {
    if (schemaEditor.state.doc.toString().trim().length === 0) {
      clearErrors(schemaEditor);
      schemaMessages.replaceChildren();
      setTypeOptions([]);
      return;
    }

    const token = ++schemaGeneration;
    const result = await schemaTypes(buildRequest());
    if (token !== schemaGeneration) return;

    setTypeOptions(result.types);
    showErrors(
      schemaEditor,
      result.errors.filter((error) => !error.file || error.file === SCHEMA_FILE),
    );
    renderMessages(schemaMessages, result.errors, result.exception);
  }

  function setTypeOptions(types: string[]): void {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = types.length === 0 ? 'no messages in this schema' : 'work it out from the payload';
    rootSelect.replaceChildren(placeholder);

    for (const type of types) {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      rootSelect.append(option);
    }

    // an edit that removes the message the user picked drops the choice with it, rather than
    // leaving a selection pointing at a type the schema no longer has
    if (chosenType !== undefined && !types.includes(chosenType)) chosenType = undefined;
    rootSelect.value = chosenType ?? '';
  }

  function buildRequest(): DecodeRequest {
    const schema = schemaEditor.state.doc.toString();
    const request: DecodeRequest = {
      fullStrings: new FormData(optionsForm).has('fullStrings'),
      fileName: SCHEMA_FILE,
    };
    if (schema.trim().length > 0) request.schema = schema;
    // sending no root type is what asks the engine to work one out
    if (chosenType) request.rootType = chosenType;
    return request;
  }

  /** Says what the schema is doing while the panel is shut, where the tree cannot. */
  function showSchemaState(result?: DecodeResult): void {
    schemaState.className = 'schema-state';
    if (!buildRequest().schema) {
      schemaState.textContent = '';
      return;
    }

    const type = chosenType ?? result?.rootType;
    if (!type) {
      schemaState.textContent = 'no message fits';
      schemaState.classList.add('warn');
      return;
    }

    // an inferred type reads exactly like a chosen one unless it is marked, and an inferred type
    // that happens to be wrong is the most misleading thing this view can show
    const parts = [type];
    if (result?.rootGuessed) parts.push('guessed');
    const unknown = result?.unknownFields ?? 0;
    if (unknown > 0) parts.push(`${unknown} field${unknown === 1 ? '' : 's'} not in the schema`);

    const ambiguous = (result?.rootAlternatives?.length ?? 0) > 0;
    schemaState.textContent = `${ambiguous ? '⚠ ' : ''}${parts.join(' · ')}`;
    if (ambiguous) schemaState.classList.add('warn');
  }

  async function run(): Promise<void> {
    const token = ++generation;
    const request = buildRequest();

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
        showSchemaState();
        return;
      }
      const parsed = parsePayload(text, formatSelect.value as PayloadFormat);
      if (!parsed.bytes) {
        setStatus(status, 'error', parsed.error ?? 'could not read the payload');
        tree.replaceChildren();
        toolbar.hidden = true;
        showSchemaState();
        return;
      }
      bytes = parsed.bytes;
      setStatus(status, 'ok', `${formatBytes(bytes.length)} read as ${parsed.format}`);
    }

    const result = await decode(bytes, request);
    if (token !== generation) return;

    // show what the engine settled on, without recording it as the user's answer: chosenType stays
    // unset, so a later edit is free to arrive at a different one
    if (!chosenType) rootSelect.value = result.rootType ?? '';

    renderTree(tree, result);
    toolbar.hidden = result.nodes.length === 0;
    showSchemaState(result);
  }
}

function renderMessages(container: Element, errors: SchemaError[], exception?: string): void {
  container.replaceChildren();

  if (exception) {
    container.append(message('error', exception));
    return;
  }
  for (const error of errors) {
    const where = error.lineNumber > 0 ? `line ${error.lineNumber}, col ${error.columnNumber}: ` : '';
    container.append(message(error.isError ? 'error' : 'warning', `${where}${error.message}`));
  }
}

function message(kind: 'error' | 'warning', text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = `message ${kind}`;
  element.textContent = text;
  return element;
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
