import type { EditorView } from '@codemirror/view';
import { createEditor, setContent, setLanguage, showErrors, clearErrors, type LanguageName } from './editor';
import { generate } from './wasm';
import { samples } from './samples';
import type { GenerateRequest, GeneratedFile, SchemaError } from './types';

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
    onChange: () => scheduleGenerate(),
  });

  const outputEditor = createEditor({
    parent: required('#output-editor'),
    language: 'csharp',
    readOnly: true,
  });

  const optionsForm = required<HTMLFormElement>('#schema-options');
  const languageSelect = required<HTMLSelectElement>('#opt-language');
  const langverSelect = required<HTMLSelectElement>('#opt-langver');
  const messages = required('#schema-messages');
  const fileTabs = required('#file-tabs');
  const copyButton = required<HTMLButtonElement>('#copy-output');
  const samplePicker = required<HTMLSelectElement>('#sample-picker');
  const outputPane = required('#output-pane');

  let files: GeneratedFile[] = [];
  let currentFile = 0;
  let timer: number | undefined;
  let generation = 0;
  let activeOutputLanguage: LanguageName = 'csharp';

  for (const sample of samples) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.label;
    samplePicker.append(option);
  }

  samplePicker.addEventListener('change', () => {
    const sample = samples.find((s) => s.id === samplePicker.value);
    if (sample) setContent(schemaEditor, sample.schema);
    samplePicker.value = '';
    scheduleGenerate();
  });

  optionsForm.addEventListener('change', () => {
    populateLanguageVersions();
    scheduleGenerate();
  });

  copyButton.addEventListener('click', async () => {
    const file = files[currentFile];
    if (!file) return;
    await navigator.clipboard.writeText(file.text);
    copyButton.textContent = 'Copied';
    setTimeout(() => (copyButton.textContent = 'Copy'), 1200);
  });

  populateLanguageVersions();
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

  function scheduleGenerate(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void runGenerate(), DEBOUNCE_MS) as unknown as number;
  }

  async function runGenerate(): Promise<void> {
    const token = ++generation;
    const request = buildRequest(optionsForm, schemaEditor);
    const response = await generate(request);

    // a later keystroke already superseded this run
    if (token !== generation) return;

    renderMessages(messages, response.errors, response.exception);
    showErrors(schemaEditor, response.errors);
    if (response.errors.length === 0) clearErrors(schemaEditor);

    const outputLanguage: LanguageName = request.language === 'vb' ? 'vb' : 'csharp';
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
      outputPane.classList.toggle('stale', files.length > 0);
    }
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
    fileName: 'my.proto',
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
    const where = `line ${error.lineNumber}, col ${error.columnNumber}`;
    container.append(
      message(error.isError ? 'error' : 'warning', `${where}: ${error.message}`),
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
