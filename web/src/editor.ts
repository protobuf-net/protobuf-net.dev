import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { StreamLanguage, syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { highlightStyle } from './highlight';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';
import { csharp } from '@codemirror/legacy-modes/mode/clike';
import { vb } from '@codemirror/legacy-modes/mode/vb';
import type { SchemaError } from './types';

const languages = {
  protobuf: StreamLanguage.define(protobuf),
  csharp: StreamLanguage.define(csharp),
  vb: StreamLanguage.define(vb),
} as const;

export type LanguageName = keyof typeof languages;

const baseExtensions: Extension[] = [
  lineNumbers(),
  history(),
  drawSelection(),
  bracketMatching(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  syntaxHighlighting(highlightStyle, { fallback: true }),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  EditorView.lineWrapping,
];

export interface EditorOptions {
  parent: HTMLElement;
  doc?: string;
  language: LanguageName;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

/** Lets the output pane re-highlight when the target language changes, without losing the view. */
const languageCompartments = new WeakMap<EditorView, Compartment>();

export function createEditor(options: EditorOptions): EditorView {
  const languageCompartment = new Compartment();
  const extensions: Extension[] = [
    ...baseExtensions,
    languageCompartment.of(languages[options.language]),
  ];

  if (options.readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  } else {
    extensions.push(lintGutter());
    if (options.onChange) {
      const onChange = options.onChange;
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
      );
    }
  }

  const view = new EditorView({
    state: EditorState.create({ doc: options.doc ?? '', extensions }),
    parent: options.parent,
  });
  languageCompartments.set(view, languageCompartment);
  return view;
}

export function setLanguage(view: EditorView, language: LanguageName): void {
  const compartment = languageCompartments.get(view);
  if (!compartment) return;
  view.dispatch({ effects: compartment.reconfigure(languages[language]) });
}

/** Replaces the whole document without pushing the change onto the undo stack of a user edit. */
export function setContent(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

/**
 * Projects protobuf-net's errors onto the editor. protobuf-net reports 1-based line and column
 * plus the offending token's length, which maps cleanly onto CodeMirror's document offsets.
 */
export function showErrors(view: EditorView, errors: SchemaError[]): void {
  const doc = view.state.doc;
  const diagnostics: Diagnostic[] = [];

  for (const error of errors) {
    const lineNumber = Math.min(Math.max(error.lineNumber, 1), doc.lines);
    const line = doc.line(lineNumber);
    const column = Math.max(error.columnNumber - 1, 0);
    const from = Math.min(line.from + column, line.to);
    // a zero-length token would render as an invisible marker; cover at least one character
    const to = Math.min(from + Math.max(error.length, 1), line.to);

    diagnostics.push({
      from,
      to: to > from ? to : Math.min(from + 1, doc.length),
      severity: error.isError ? 'error' : 'warning',
      message: error.errorNumber > 0 ? `${error.message} (#${error.errorNumber})` : error.message,
    });
  }

  view.dispatch(setDiagnostics(view.state, diagnostics));
}

export function clearErrors(view: EditorView): void {
  view.dispatch(setDiagnostics(view.state, []));
}
