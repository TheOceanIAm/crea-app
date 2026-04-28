import { useMemo } from 'react'
import { View, Text, StyleSheet, ScrollView, type StyleProp, type TextStyle } from 'react-native'

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

type Block =
  | { type: 'spacer' }
  | { type: 'rule' }
  | { type: 'heading'; level: HeadingLevel; text: string }
  | { type: 'bullet'; text: string; nested?: boolean }
  | { type: 'checkbox'; checked: boolean; text: string }
  | { type: 'numbered'; num: string; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'table'; rows: string[][]; headerRow: boolean }

function splitTableCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

function looksLikeTableRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  const cells = splitTableCells(t).filter((c) => c.length > 0)
  return cells.length >= 2
}

function isTableSeparatorLine(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|')) return false
  const cells = splitTableCells(t)
  if (cells.length < 2) return false
  return cells.every((c) => /^:?-{3,}:?$/.test(c))
}

function parseBriefAiContent(raw: string): Block[] {
  const lines = raw.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      blocks.push({ type: 'spacer' })
      i += 1
      continue
    }

    if (
      looksLikeTableRow(trimmed) &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1]?.trim() ?? '')
    ) {
      const headerCells = splitTableCells(trimmed)
      i += 2 // skip separator
      const body: string[][] = [headerCells]
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim()
        if (!t || !looksLikeTableRow(t)) break
        body.push(splitTableCells(t))
        i += 1
      }
      blocks.push({ type: 'table', rows: body, headerRow: true })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }
    const hMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (hMatch) {
      const level = Math.min(hMatch[1].length, 6) as HeadingLevel
      blocks.push({ type: 'heading', level, text: hMatch[2].trim() })
      i += 1
      continue
    }
    const cbMatch = trimmed.match(/^[-*•]\s+\[([ xX])\]\s+(.*)$/)
    if (cbMatch) {
      blocks.push({
        type: 'checkbox',
        checked: cbMatch[1].trim().toLowerCase() === 'x',
        text: cbMatch[2].trim(),
      })
      i += 1
      continue
    }
    const nestMatch = line.match(/^(\s{2,}|\t+)[-*•]\s+(.+)$/)
    if (nestMatch) {
      blocks.push({ type: 'bullet', text: nestMatch[2].trim(), nested: true })
      i += 1
      continue
    }
    if (/^[-*•]\s+/.test(trimmed)) {
      blocks.push({ type: 'bullet', text: trimmed.replace(/^[-*•]\s+/, '') })
      i += 1
      continue
    }
    const numMatch = trimmed.match(/^(\d{1,3})\.\s+(.*)$/)
    if (numMatch) {
      blocks.push({ type: 'numbered', num: numMatch[1], text: numMatch[2].trim() })
      i += 1
      continue
    }
    blocks.push({ type: 'paragraph', text: trimmed })
    i += 1
  }

  return blocks
}

function blocksToSections(blocks: Block[]): { heading: string | null; blocks: Block[] }[] {
  const sections: { heading: string | null; blocks: Block[] }[] = []
  let acc: Block[] = []
  let pendingH2: string | null = null

  const push = () => {
    if (pendingH2 !== null || acc.length > 0) {
      sections.push({ heading: pendingH2, blocks: acc })
      acc = []
      pendingH2 = null
    }
  }

  for (const b of blocks) {
    if (b.type === 'heading' && b.level === 2) {
      push()
      pendingH2 = b.text
    } else {
      acc.push(b)
    }
  }
  push()
  return sections
}

function headingBaseStyle(level: HeadingLevel) {
  switch (level) {
    case 1:
      return styles.h1
    case 2:
      return styles.h2
    case 3:
      return styles.h3
    case 4:
      return styles.h4
    case 5:
      return styles.h5
    default:
      return styles.h6
  }
}

function InlineText({ text, baseStyle }: { text: string; baseStyle: StyleProp<TextStyle> }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  if (parts.length === 1) {
    return (
      <Text style={baseStyle} selectable>
        {text}
      </Text>
    )
  }
  return (
    <Text style={baseStyle} selectable>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <Text key={i} style={[baseStyle, styles.bold]}>
              {part.slice(2, -2)}
            </Text>
          )
        }
        return part
      })}
    </Text>
  )
}

function BriefTableBlock({ rows, headerRow }: { rows: string[][]; headerRow: boolean }) {
  const colCount = Math.max(1, ...rows.map((r) => r.length))
  const padded = rows.map((r) => {
    const copy = [...r]
    while (copy.length < colCount) copy.push('—')
    return copy
  })

  return (
    <View style={styles.tableOuter}>
      <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
        <View style={styles.tableInner}>
          {padded.map((row, ri) => {
            const isHeader = headerRow && ri === 0
            return (
              <View key={`r-${ri}`} style={[styles.tableRow, isHeader && styles.tableRowHeader]}>
                {row.map((cell, ci) => (
                  <View
                    key={`c-${ri}-${ci}`}
                    style={[styles.tableCell, ci === colCount - 1 && styles.tableCellLast]}
                  >
                    <InlineText
                      text={cell}
                      baseStyle={[styles.tableCellText, isHeader ? styles.tableCellTextHeader : null]}
                    />
                  </View>
                ))}
              </View>
            )
          })}
        </View>
      </ScrollView>
    </View>
  )
}

export function BriefAiFormattedOutput({
  content,
  embedded = false,
}: {
  content: string
  /** Parent already provides a card — skip extra chrome. */
  embedded?: boolean
}) {
  const blocks = useMemo(() => parseBriefAiContent(content), [content])
  const sections = useMemo(() => {
    if (embedded) {
      return [{ heading: null, blocks }]
    }
    const raw = blocksToSections(blocks)
    const filtered = raw.filter((s) => s.blocks.length > 0)
    return filtered.length > 0 ? filtered : raw
  }, [blocks, embedded])
  const flatOnly =
    sections.length === 1 && sections[0] !== undefined && sections[0].heading === null

  const renderBlock = (b: Block, key: string) => {
    switch (b.type) {
      case 'spacer':
        return <View key={key} style={styles.spacer} />
      case 'rule':
        return <View key={key} style={styles.rule} />
      case 'table':
        return <BriefTableBlock key={key} rows={b.rows} headerRow={b.headerRow} />
      case 'heading':
        return (
          <View key={key} style={styles.headingMargin}>
            <InlineText text={b.text} baseStyle={headingBaseStyle(b.level)} />
          </View>
        )
      case 'checkbox':
        return (
          <View key={key} style={styles.checkboxRow}>
            <View style={[styles.checkboxBox, b.checked && styles.checkboxBoxOn]}>
              {b.checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <View style={styles.checkboxBody}>
              <InlineText text={b.text} baseStyle={styles.body} />
            </View>
          </View>
        )
      case 'bullet':
        return (
          <View key={key} style={[styles.bulletRow, b.nested && styles.bulletRowNested]}>
            <View style={[styles.bulletDot, b.nested && styles.bulletDotNested]} />
            <View style={styles.bulletBody}>
              <InlineText text={b.text} baseStyle={[styles.body, b.nested && styles.bodyNested]} />
            </View>
          </View>
        )
      case 'numbered':
        return (
          <View key={key} style={styles.numRow}>
            <View style={styles.numBadge}>
              <Text style={styles.numBadgeText} selectable>
                {b.num}
              </Text>
            </View>
            <View style={styles.numBody}>
              <InlineText text={b.text} baseStyle={styles.body} />
            </View>
          </View>
        )
      case 'paragraph':
        return (
          <View key={key} style={styles.paraWrap}>
            <InlineText text={b.text} baseStyle={styles.body} />
          </View>
        )
      default:
        return null
    }
  }

  const rootStyle = [styles.wrap, embedded && styles.wrapEmbedded]

  if (sections.length === 0) {
    return <View style={rootStyle} />
  }

  if (flatOnly) {
    return (
      <View style={rootStyle}>
        {sections[0].blocks.map((b, i) => renderBlock(b, `b-${i}`))}
      </View>
    )
  }

  return (
    <View style={rootStyle}>
      {sections.map((sec, si) => (
        <View
          key={`sec-${si}`}
          style={[styles.sectionCard, !sec.heading && styles.sectionCardInner]}
        >
          {sec.heading ? (
            <View style={styles.sectionCardTitleRow}>
              <View style={styles.sectionAccentBar} />
              <Text style={styles.sectionCardTitle}>{sec.heading}</Text>
            </View>
          ) : null}
          {sec.blocks.map((b, bi) => renderBlock(b, `${si}-${bi}`))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 2 },
  wrapEmbedded: { paddingVertical: 0 },
  spacer: { height: 6 },
  rule: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 10,
    borderRadius: 1,
  },
  headingMargin: { marginBottom: 4 },
  h1: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFDC00',
    lineHeight: 24,
  },
  h2: {
    fontSize: 16,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.95)',
    lineHeight: 22,
  },
  h3: {
    fontSize: 14,
    fontWeight: '800',
    color: 'rgba(255,220,0,0.92)',
    letterSpacing: 0.3,
    lineHeight: 20,
  },
  h4: {
    fontSize: 14,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 20,
    marginTop: 4,
  },
  h5: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 19,
    letterSpacing: 0.2,
  },
  h6: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 17,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionCard: {
    marginBottom: 12,
    padding: 14,
    paddingTop: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(20,20,20,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sectionCardInner: {
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(17,17,17,0.5)',
  },
  sectionCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  sectionAccentBar: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 22,
    borderRadius: 2,
    backgroundColor: '#FFDC00',
    marginRight: 12,
  },
  sectionCardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 22,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
    paddingVertical: 2,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxOn: {
    borderColor: 'rgba(255,220,0,0.75)',
    backgroundColor: 'rgba(255,220,0,0.15)',
  },
  checkboxMark: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFDC00',
    lineHeight: 15,
  },
  checkboxBody: { flex: 1, minWidth: 0 },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
    paddingLeft: 2,
  },
  bulletRowNested: { paddingLeft: 14 },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFDC00',
    marginTop: 8,
    opacity: 0.95,
  },
  bulletDotNested: {
    width: 5,
    height: 5,
    marginTop: 9,
    opacity: 0.55,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  bulletBody: { flex: 1 },
  bodyNested: { fontSize: 13, color: 'rgba(255,255,255,0.78)', lineHeight: 20 },
  numRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  numBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,220,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  numBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFDC00',
  },
  numBody: { flex: 1, paddingTop: 2 },
  paraWrap: { marginBottom: 10 },
  body: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 22,
  },
  bold: { fontWeight: '800', color: 'rgba(255,255,255,0.96)' },
  tableOuter: {
    marginVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    overflow: 'hidden',
  },
  tableInner: { flexDirection: 'column' },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  tableRowHeader: {
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderBottomColor: 'rgba(255,220,0,0.2)',
  },
  tableCell: {
    minWidth: 112,
    maxWidth: 220,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
  },
  tableCellLast: { borderRightWidth: 0 },
  tableCellText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 18,
  },
  tableCellTextHeader: {
    fontWeight: '800',
    color: 'rgba(255,255,255,0.95)',
    fontSize: 12,
    letterSpacing: 0.2,
  },
})
