import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * CodeMirror's bundled `defaultHighlightStyle` assumes a light background — its dark reds and
 * blues are close to unreadable on a dark one. Rather than swapping whole themes on a media
 * query (which means reconfiguring live editors), every colour here is a CSS custom property,
 * so the palette follows `prefers-color-scheme` in styles.css with no JS involved.
 */
export const highlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [tags.definitionKeyword, tags.moduleKeyword], color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.atom, tags.null], color: 'var(--syn-number)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syn-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syn-property)' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--syn-text)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syn-function)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--syn-punctuation)' },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: 'var(--syn-meta)' },
  { tag: tags.invalid, color: 'var(--error)' },
  { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
]);
