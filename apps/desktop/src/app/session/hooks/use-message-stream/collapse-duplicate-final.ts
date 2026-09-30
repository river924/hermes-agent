import { transcriptRowIds } from '@/app/session/hooks/use-session-actions/pending-turn-identity'
import { type ChatMessage, chatMessageText, withUniqueToolCallIdsWithinMessage } from '@/lib/chat-messages'

export interface DuplicateFinalCollapse {
  /** The surviving bubble replaces the removed stream id at completion. */
  keptId: string
  messages: ChatMessage[]
}

/** An identical final belongs to the adjacent interim, not a second tool bubble. */
export function collapseDuplicateFinalAfterToolInterim(
  messages: ChatMessage[],
  streamIndex: number,
  options: {
    completeMessage: (message: ChatMessage) => ChatMessage
    finalText: string
    hasFailure: boolean
    interimBoundaryPending: boolean
  }
): DuplicateFinalCollapse | null {
  if (streamIndex < 0 || !options.interimBoundaryPending || options.hasFailure || !options.finalText) {
    return null
  }

  const live = messages[streamIndex]

  if (!live?.parts.some(part => part.type === 'tool-call')) {
    return null
  }

  const liveText = chatMessageText(live).trim()

  if (liveText && liveText !== options.finalText) {
    return null
  }

  const priorIndex = messages.findLastIndex(
    (message, index) => index < streamIndex && (!message.hidden || message.role === 'user')
  )

  const prior = messages[priorIndex]

  if (prior?.role !== 'assistant' || !prior.interim || chatMessageText(prior).trim() !== options.finalText) {
    return null
  }

  const next = messages.slice()
  next[priorIndex] = options.completeMessage(
    withUniqueToolCallIdsWithinMessage({
      ...prior,
      parts: [...prior.parts, ...live.parts.filter(part => part.type !== 'text')]
    })
  )
  next.splice(streamIndex, 1)

  return { keptId: prior.id, messages: next }
}

/** Prefer the committed final row when a history refresh and live stream overlap. */
export function collapseLiveTwinOfPersistedFinal(
  messages: ChatMessage[],
  streamIndex: number,
  options: {
    completeMessage: (message: ChatMessage) => ChatMessage
    finalRowId: number | null
    lastUserIndex: number
  }
): DuplicateFinalCollapse | null {
  if (streamIndex < 0 || options.finalRowId === null) {
    return null
  }

  const finalRowId = options.finalRowId

  const storedIndex = messages.findIndex(
    (message, index) =>
      index > options.lastUserIndex &&
      index !== streamIndex &&
      message.role === 'assistant' &&
      transcriptRowIds(message).includes(finalRowId)
  )

  if (storedIndex < 0) {
    return null
  }

  const next = messages.slice()
  next[storedIndex] = options.completeMessage(messages[storedIndex])
  next.splice(streamIndex, 1)

  return { keptId: messages[storedIndex].id, messages: next }
}
