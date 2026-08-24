import type { EditorView } from '@codemirror/view';
import { createEditor, setContent, setLanguage, showErrors, clearErrors, type LanguageName } from './editor';
import { generate, embeddedProto } from './wasm';
import { samples } from './samples';
import {
  PROTOC_LANGUAGES,
  SCHEMA_FILE,
  generateWithProtoc,
  protocLanguage,
  protocValue,
  type ProtocLanguage,
} from './protoc';
import type { GenerateRequest, GenerateResponse, GeneratedFile, SchemaError } from './types';

const LANGUAGE_VERSIONS: Record<string, string[]> = {
  csharp: ['7.1', '6', '3', '2'],
  vb: ['vb14', 'vb11', 'vb9'],
};

const DEFAULT_SCHEMA = samples[0]!.schema;

/** Small enough that regenerating on every keystroke is fine; this just avoids thrashing. */
const DEBOUNCE_MS = 250;

export function initSchemaView(): void {
  const schemaEditor = createEditor({
    parent: required('#schema-editor'),
    doc: DEFAULT_SCHEMA,
    language: 'protobuf',
    onChange: () => scheduleGenerate('edit'),
  });

  const outputEditor = createEditor({
    parent: required('#output-editor'),
    language: 'csharp',
    readOnly: true,
  });

  const optionsForm = required<HTMLFormElement>('#schema-options');
  const languageSelect = required<HTMLSelectElement>('#opt-language');
  const langverSelect = required<HTMLSelectElement>('#opt-langver');
  const protocGroup = required<HTMLOptGroupElement>('#opt-language-protoc');
  const runButton = required<HTMLButtonElement>('#run-protoc');
  const messages = required('#schema-messages');
  const fileTabs = required('#file-tabs');
  const copyButton = required<HTMLButtonElement>('#copy-output');
  const samplePicker = required<HTMLSelectElement>('#sample-picker');
  const outputPane = required('#output-pane');
  const staleBadge = required('#stale-badge');
  const privacyBadge = required('#privacy-badge');

  let files: GeneratedFile[] = [];
  let currentFile = 0;
  let timer: number | undefined;
  let generation = 0;
  let activeOutputLanguage: LanguageName = 'csharp';
  let inFlight: AbortController | undefined;

  for (const language of PROTOC_LANGUAGES) {
    const option = document.createElement('option');
    option.value = protocValue(language);
    option.textContent = language.label;
    protocGroup.append(option);
  }

  for (const sample of samples) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.label;
    samplePicker.append(option);
  }

  samplePicker.addEventListener('change', () => {
    const sample = samples.find((s) => s.id === samplePicker.value);
    samplePicker.value = '';
    if (!sample) return;

    if (sample.schema !== undefined) {
      setContent(schemaEditor, sample.schema);
      scheduleGenerate('edit');
      return;
    }
    if (sample.embedded === undefined) return;

    // read straight out of protobuf-net.Reflection's embedded resources
    void (async () => {
      try {
        setContent(schemaEditor, await embeddedProto(sample.embedded!));
      } catch (error) {
        renderMessages(messages, [], `could not load ${sample.embedded}: ${String(error)}`);
        return;
      }
      scheduleGenerate('edit');
    })();
  });

  // Picking a target is itself the decision to use it, so this generates even for a protoc target;
  // what does not happen automatically is sending the schema again on every later keystroke.
  optionsForm.addEventListener('change', () => {
    populateLanguageVersions();
    applyMode();
    scheduleGenerate('option');
  });

  runButton.addEventListener('click', () => void runGenerate());

  // the badge in the header answers "where is my schema going", and switching to the payload
  // decoder changes the answer as surely as switching language does
  window.addEventListener('hashchange', applyMode);

  copyButton.addEventListener('click', async () => {
    const file = files[currentFile];
    if (!file) return;
    await navigator.clipboard.writeText(file.text);
    copyButton.textContent = 'Copied';
    setTimeout(() => (copyButton.textContent = 'Copy'), 1200);
  });

  populateLanguageVersions();
  applyMode();
  void runGenerate();

  function populateLanguageVersions(): void {
    const language = languageSelect.value;
    const versions = LANGUAGE_VERSIONS[language] ?? [];
    const previous = langverSelect.value;
    langverSelect.replaceChildren();

    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'default';
    langverSelect.append(auto);

    for (const version of versions) {
      const option = document.createElement('option');
      option.value = version;
      option.textContent = version;
      langverSelect.append(option);
    }
    langverSelect.value = versions.includes(previous) ? previous : '';
  }

  /** Reflects where the selected target is compiled, in the options bar and in the header. */
  function applyMode(): void {
    const protoc = protocLanguage(languageSelect.value);
    optionsForm.classList.toggle('remote', protoc !== undefined);

    // switching away mid-request abandons that request, and its own reset will not fire: the
    // button would otherwise still read "Generating…" and be dead when the user came back
    if (!protoc) {
      runButton.disabled = false;
      runButton.textContent = 'Generate';
    }

    // the decoder is local whatever the schema view is set to, so it wins while it is on screen
    const remote = protoc !== undefined && location.hash.replace('#', '') !== 'decode';
    privacyBadge.textContent = remote ? 'compiled on a server' : 'runs locally';
    privacyBadge.setAttribute(
      'title',
      remote
        ? 'protoc is a native compiler and cannot run in the browser: pressing Generate sends this schema to a server'
        : 'Nothing you paste leaves your browser',
    );
  }

  function scheduleGenerate(trigger: 'edit' | 'option'): void {
    // Editing never reaches protoc.protobuf-net.dev on its own. Debounced keystrokes are fine for
    // a generator running in this tab and rude for one running on somebody's server, and "my
    // schema is uploaded as I type" is not a promise worth making on the user's behalf.
    if (trigger === 'edit' && protocLanguage(languageSelect.value)) {
      markStale('outdated — press Generate');
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void runGenerate(), DEBOUNCE_MS) as unknown as number;
  }

  async function runGenerate(): Promise<void> {
    const protoc = protocLanguage(languageSelect.value);
    if (protoc) {
      await runProtoc(protoc);
      return;
    }

    const token = ++generation;
    const request = buildRequest(optionsForm, schemaEditor);
    const response = await generate(request);

    // a later keystroke already superseded this run
    if (token !== generation) return;
    applyResponse(response, request.language === 'vb' ? 'vb' : 'csharp');
  }

  async function runProtoc(language: ProtocLanguage): Promise<void> {
    const token = ++generation;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    runButton.disabled = true;
    runButton.textContent = 'Generating…';
    try {
      const schema = schemaEditor.state.doc.toString();
      const response = await generateWithProtoc(language, schema, controller.signal);
      if (token !== generation) return;
      applyResponse(response, language.editor);
    } catch (error) {
      // an abort is this code superseding itself, and has nothing to report
      if (controller.signal.aborted || token !== generation) return;
      renderMessages(messages, [], `could not reach the protoc service: ${String(error)}`);
      markStale('outdated — press Generate');
    } finally {
      if (token === generation) {
        runButton.disabled = false;
        runButton.textContent = 'Generate';
      }
    }
  }

  function applyResponse(response: GenerateResponse, outputLanguage: LanguageName): void {
    renderMessages(messages, response.errors, response.exception);
    // diagnostics against an imported file have line numbers into that file, not this one
    showErrors(
      schemaEditor,
      response.errors.filter((error) => !error.file || error.file === SCHEMA_FILE),
    );
    if (response.errors.length === 0) clearErrors(schemaEditor);

    if (activeOutputLanguage !== outputLanguage) {
      activeOutputLanguage = outputLanguage;
      setLanguage(outputEditor, outputLanguage);
    }

    if (response.files.length > 0) {
      files = response.files;
      currentFile = Math.min(currentFile, files.length - 1);
      renderFileTabs();
      setContent(outputEditor, files[currentFile]!.text);
      copyButton.disabled = false;
      outputPane.classList.remove('stale');
    } else {
      // keep the last good output rather than blanking the pane while the user is mid-edit,
      // but mark it, so nobody copies code that no longer matches the schema on screen
      copyButton.disabled = files.length === 0;
      markStale('outdated — fix the errors below');
    }
  }

  function markStale(reason: string): void {
    if (files.length === 0) return;
    staleBadge.textContent = reason;
    outputPane.classList.add('stale');
  }

  function renderFileTabs(): void {
    fileTabs.replaceChildren();
    if (files.length <= 1) {
      const label = document.createElement('span');
      label.className = 'pane-title';
      label.textContent = files[0]?.name ?? 'generated code';
      fileTabs.append(label);
      return;
    }
    files.forEach((file, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = index === currentFile ? 'file-tab active' : 'file-tab';
      tab.textContent = file.name;
      tab.addEventListener('click', () => {
        currentFile = index;
        setContent(outputEditor, file.text);
        renderFileTabs();
      });
      fileTabs.append(tab);
    });
  }
}

function buildRequest(form: HTMLFormElement, editor: EditorView): GenerateRequest {
  const data = new FormData(form);
  const language = (data.get('language') as string) === 'vb' ? 'vb' : 'csharp';
  const version = (data.get('languageVersion') as string | null) ?? '';
  return {
    schema: editor.state.doc.toString(),
    fileName: SCHEMA_FILE,
    language,
    languageVersion: version === '' ? null : version,
    namingConvention: (data.get('namingConvention') as GenerateRequest['namingConvention']) ?? 'auto',
    services: data.has('services'),
    oneOfEnum: data.has('oneOfEnum'),
    listSet: data.has('listSet'),
    disableNullWrappers: data.has('disableNullWrappers'),
    disableCompatLevel: data.has('disableCompatLevel'),
    nullableValueType: data.has('nullableValueType'),
    repeatedAsList: data.has('repeatedAsList'),
  };
}

function renderMessages(container: Element, errors: SchemaError[], exception?: string): void {
  container.replaceChildren();

  if (exception) {
    container.append(message('error', exception));
    return;
  }
  if (errors.length === 0) return;

  for (const error of errors) {
    // protoc reports some problems against an import, and some — a missing file, say — with no
    // position at all; protobuf-net always has both, so neither prefix appears on that path
    const file = error.file && error.file !== SCHEMA_FILE ? `${error.file}: ` : '';
    const where = error.lineNumber > 0 ? `line ${error.lineNumber}, col ${error.columnNumber}: ` : '';
    container.append(
      message(error.isError ? 'error' : 'warning', `${file}${where}${error.message}`),
    );
  }
}

function message(kind: 'error' | 'warning', text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = `message ${kind}`;
  element.textContent = text;
  return element;
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}
