import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'

type Block =
  | { type: 'spacer' }
  | { type: 'rule' }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; num: string; text: string }
  | { type: 'paragraph'; text: string }

function parseBriefAiContent(raw: string): Block[] {
  const lines = raw.split(/\r?\n/)
  const blocks: Block[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      blocks.push({ type: 'spacer' })
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'rule' })
      continue
    }
    const hMatch = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (hMatch) {
      const level = Math.min(hMatch[1].length, 3) as 1 | 2 | 3
      blocks.push({ type: 'heading', level, text: hMatch[2].trim() })
      continue
    }
    if (/^[-*•]\s+/.test(trimmed)) {
      blocks.push({ type: 'bullet', text: trimmed.replace(/^[-*•]\s+/, '') })
      continue
    }
    const numMatch = trimmed.match(/^(\d{1,3})\.\s+(.*)$/)
    if (numMatch) {
      blocks.push({ type: 'numbered', num: numMatch[1], text: numMatch[2].trim() })
      continue
    }
    blocks.push({ type: 'paragraph', text: trimmed })
  }

  return blocks
}

function InlineText({ text, baseStyle }: { text: string; baseStyle: object }) {
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

export function BriefAiFormattedOutput({ content }: { content: string }) {
  const blocks = useMemo(() => parseBriefAiContent(content), [content])

  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        const key = `b-${i}`
        switch (b.type) {
          case 'spacer':
            return <View key={key} style={styles.spacer} />
          case 'rule':
            return <View key={key} style={styles.rule} />
          case 'heading':
            return (
              <View key={key} style={styles.headingMargin}>
                <InlineText
                  text={b.text}
                  baseStyle={b.level === 1 ? styles.h1 : b.level === 2 ? styles.h2 : styles.h3}
                />
              </View>
            )
          case 'bullet':
            return (
              <View key={key} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <View style={styles.bulletBody}>
                  <InlineText text={b.text} baseStyle={styles.body} />
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
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {},
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
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
    paddingLeft: 2,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFDC00',
    marginTop: 8,
    opacity: 0.95,
  },
  bulletBody: { flex: 1 },
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
})
