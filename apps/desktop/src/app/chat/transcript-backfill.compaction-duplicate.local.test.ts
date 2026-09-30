import { expect, it } from 'vitest'

import { preserveLocalPendingTurnMessages } from '@/app/session/hooks/use-session-actions/utils'
import { type ChatMessage, chatMessageText, toChatMessages } from '@/lib/chat-messages'
import type { SessionMessage } from '@/types/hermes'

import { graftRefreshedTailOntoBackfill } from './transcript-backfill'

it('does not show a carried reply twice after compaction renumbers its stored rows', () => {
  const row = (id: number, role: 'assistant' | 'user', content: string, timestamp: number): SessionMessage => ({
    id,
    role,
    content,
    timestamp
  })

  const original = [
    row(1, 'user', 'earlier question', 10),
    row(2, 'assistant', 'earlier answer', 11),
    row(3, 'user', 'question', 20),
    row(4, 'assistant', 'answer', 21)
  ]

  const retained = toChatMessages(original.slice(1))

  const refreshed = toChatMessages([
    ...original.slice(0, 2),
    { ...row(5, 'user', 'context summary', 30), display_kind: 'hidden' },
    row(6, 'user', 'question', 20),
    row(7, 'assistant', 'answer', 21),
    row(8, 'user', 'next question', 40)
  ])

  const result = graftRefreshedTailOntoBackfill(refreshed, retained)
  expect(result.map(message => `${message.role}:${chatMessageText(message)}`)).toEqual([
    'user:earlier question',
    'assistant:earlier answer',
    'user:question',
    'assistant:answer',
    'user:next question'
  ])
})

it('replaces a settled live reply with its committed row during an overlapping refresh', () => {
  const local = [
    ...toChatMessages([{ id: 2, role: 'assistant', content: 'old answer', timestamp: 2 }]),
    { id: 'user-optimistic', role: 'user' as const, parts: [{ type: 'text' as const, text: 'new question' }] },
    {
      id: 'assistant-stream-live',
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: 'new answer' }],
      pending: false
    }
  ]

  const page = toChatMessages([
    { id: 1, role: 'user', content: 'old question', timestamp: 1 },
    { id: 2, role: 'assistant', content: 'old answer', timestamp: 2 },
    { id: 3, role: 'user', content: 'new question', timestamp: 3 },
    { id: 4, role: 'assistant', content: 'new answer', timestamp: 4 }
  ])

  const merged = preserveLocalPendingTurnMessages(graftRefreshedTailOntoBackfill(page, local), local)
  expect(merged.map(message => `${message.role}:${chatMessageText(message)}`)).toEqual([
    'user:old question',
    'assistant:old answer',
    'user:new question',
    'assistant:new answer'
  ])
})

it('keeps distinct tool-bearing and plain replies that share visible text and timestamp', () => {
  const oldToolReply: ChatMessage = {
    id: 'old-tool-reply',
    role: 'assistant',
    rowId: 3,
    timestamp: 20,
    parts: [
      { type: 'text', text: 'answer' },
      { type: 'tool-call', toolCallId: 'call-3', toolName: 'read_file', args: {} }
    ]
  }

  const previous = [...toChatMessages([{ id: 2, role: 'assistant', content: 'anchor', timestamp: 2 }]), oldToolReply]

  const refreshed = toChatMessages([
    { id: 1, role: 'user', content: 'before', timestamp: 1 },
    { id: 2, role: 'assistant', content: 'anchor', timestamp: 2 },
    { id: 4, role: 'assistant', content: 'answer', timestamp: 20 }
  ])

  expect(graftRefreshedTailOntoBackfill(refreshed, previous).map(message => message.rowId)).toEqual([1, 2, 3, 4])
})
