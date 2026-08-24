import type { DecodeResult, Node, Reading } from './types';

/**
 * Renders the decomposition as a disclosure tree.
 *
 * Two things drive the layout. First, the raw bytes are the point of the tool, so every row shows
 * its own bytes without needing a click. Second, on the wire a length-delimited field could be a
 * string, a sub-message or packed scalars with no way to tell them apart — so each row leads with
 * the most likely reading and keeps the alternatives one click away rather than picking silently.
 *
 * A schema settles that second question, and the rows say so: a named field leads with its name and
 * declared type, and the readings behind it shrink to the one the schema asked for. What it cannot
 * settle it flags — a field the schema does not declare, or bytes that are not what it says.
 */
export function renderTree(container: Element, result: DecodeResult): void {
  container.replaceChildren();

  // how much the labels below can be trusted, said where the labels are. A guess that another
  // message fits just as well is a coin toss, and reads as a warning rather than a remark.
  if (result.schemaNote) {
    container.append(note(result.rootAlternatives?.length ? 'warning' : 'info', result.schemaNote));
  }

  if (result.nodes.length === 0 && !result.error) {
    container.append(note('info', 'No fields found — the payload is empty.'));
    return;
  }

  const list = document.createElement('ul');
  list.className = 'tree-root';
  for (const node of result.nodes) list.append(renderNode(node));
  container.append(list);

  if (result.error) {
    container.append(
      note('error', `Stopped after ${result.consumedBytes} of ${result.totalBytes} bytes: ${result.error}`),
    );
  }
  if (result.truncated) {
    container.append(
      note('warning', 'Output truncated — this payload has more nodes than the display budget.'),
    );
  }
}

function renderNode(node: Node): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'tree-node';

  const alternatives = alternativeReadings(node);
  const hasChildren = !!node.children?.length;
  const expandable = hasChildren || alternatives.length > 0 || !!node.note || !!node.mismatch;

  if (!expandable) {
    const row = buildRow(node, false);
    row.classList.add('leaf');
    item.append(row);
    return item;
  }

  const details = document.createElement('details');
  details.className = 'node';
  // a speculative sub-message reading is a guess; don't open it over the user's head
  details.open = hasChildren && !node.speculative;

  const summary = document.createElement('summary');
  summary.append(...buildRow(node, true).childNodes);
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'node-body';

  // the bytes and the schema disagreeing is usually the thing being looked for, so it leads
  if (node.mismatch) body.append(note('warning', node.mismatch));

  if (node.messageType && hasChildren) {
    const read = document.createElement('div');
    read.className = 'alternatives';
    read.append(label('read as'), readingValue(node.messageType));
    body.append(read);
  }

  if (alternatives.length > 0) {
    const alt = document.createElement('div');
    alt.className = 'alternatives';
    alt.append(label('also reads as'));
    for (const reading of alternatives) alt.append(readingChip(reading));
    body.append(alt);
  }

  if (node.note) body.append(note('warning', node.note));

  if (hasChildren) {
    if (node.speculative) {
      body.append(
        note(
          'info',
          'These bytes are valid UTF-8 text and also parse as a message; the nested reading below is a guess.',
        ),
      );
    }
    const list = document.createElement('ul');
    list.className = 'tree-children';
    for (const child of node.children!) list.append(renderNode(child));
    body.append(list);
  }

  details.append(body);
  item.append(details);
  return item;
}

function buildRow(node: Node, expandable: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'node-row';

  const twisty = document.createElement('span');
  twisty.className = expandable ? 'twisty' : 'twisty empty';
  twisty.setAttribute('aria-hidden', 'true');
  row.append(twisty);

  row.append(chip('field', `#${node.field}`));

  // what the schema calls this, when there is one; the wire type stays either way, because the
  // wire type is what this tool is for
  if (node.name) row.append(chip('name', node.name));
  if (node.declared) row.append(chip('type', node.declared));
  if (node.oneOf) row.append(chip('oneof', `oneof ${node.oneOf}`));
  if (node.extension) row.append(chip('extension', 'extension'));
  if (node.unknown) row.append(chip('unknown', 'not in the schema'));
  if (node.mismatch) row.append(chip('mismatch', 'not as declared'));

  row.append(chip('wire', node.wireType), primaryValue(node));
  row.append(hexInline(node), chip('offset', `${node.start}–${node.end}`));
  return row;
}

/** The reading the walker considers most likely, rendered inline in the row. */
function primaryValue(node: Node): HTMLElement {
  const span = document.createElement('span');
  span.className = 'primary';

  if (node.primary === 'message' || node.primary === 'group') {
    span.classList.add('structural');
    const count = node.children?.length ?? 0;
    span.textContent = `${node.primary} · ${count} field${count === 1 ? '' : 's'}`;
    return span;
  }

  const reading = pickPrimaryReading(node);
  if (!reading) {
    span.classList.add('structural');
    span.textContent = node.length !== undefined ? `${node.length} bytes` : '';
    return span;
  }

  if (reading.kind === 'string') {
    span.classList.add('string');
    span.textContent = `"${reading.value}"${reading.truncated ? '…' : ''}`;
    if (reading.truncated && reading.fullLength !== undefined) {
      span.title = `${reading.fullLength} characters in total; tick "show full strings" to see it all`;
    }
    return span;
  }

  span.textContent = reading.value;
  // the declared type is already on the row; repeating it after every value is noise
  if (!node.declared) span.append(kindTag(reading.kind));
  return span;
}

function pickPrimaryReading(node: Node): Reading | undefined {
  if (node.primary === 'string') return node.readings.find((r) => r.kind === 'string');
  return node.readings[0];
}

function alternativeReadings(node: Node): Reading[] {
  const primary = pickPrimaryReading(node);
  return node.readings.filter((r) => r !== primary);
}

/** Bytes are shown on every row rather than hidden behind the disclosure — they are the point. */
function hexInline(node: Node): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'hex-inline';
  wrap.append(hexPart('tag', node.tagHex));
  if (node.lenPrefixHex) wrap.append(hexPart('len', node.lenPrefixHex));
  if (node.valueHex) wrap.append(hexPart('value', node.valueHex));
  if (node.endGroupHex) wrap.append(hexPart('end', node.endGroupHex));
  return wrap;
}

function hexPart(kind: string, hex: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `hex hex-${kind}`;
  span.title = kind === 'len' ? 'length prefix' : kind;
  span.textContent = hex;
  return span;
}

function readingChip(reading: Reading): HTMLElement {
  const span = document.createElement('span');
  span.className = 'reading';
  const kind = document.createElement('em');
  kind.textContent = reading.kind;
  span.append(kind, document.createTextNode(` ${reading.value}`));
  return span;
}

/** A bare value styled like a reading, for the things that are not one — a type name, say. */
function readingValue(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'reading';
  span.textContent = text;
  return span;
}

function kindTag(kind: string): HTMLElement {
  const tag = document.createElement('em');
  tag.className = 'kind';
  tag.textContent = kind;
  return tag;
}

function chip(kind: string, text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `chip chip-${kind}`;
  span.textContent = text;
  return span;
}

function label(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'label';
  span.textContent = text;
  return span;
}

function note(kind: 'info' | 'warning' | 'error', text: string): HTMLElement {
  const div = document.createElement('div');
  div.className = `message ${kind}`;
  div.textContent = text;
  return div;
}

export function setAllOpen(container: Element, open: boolean): void {
  for (const details of container.querySelectorAll('details')) details.open = open;
}
