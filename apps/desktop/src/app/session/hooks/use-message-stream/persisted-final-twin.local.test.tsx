import type { GatewayEventName } from '@hermes/shared'
import { act, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { graftRefreshedTailOntoBackfill } from '@/app/chat/transcript-backfill'
import { preserveLocalPendingTurnMessages } from '@/app/session/hooks/use-session-actions/utils'
import type { ClientSessionState } from '@/app/types'
import { chatMessageText, toChatMessages } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import type { SessionMessage } from '@/types/hermes'

import { renderMessageStream } from './test-harness'

afterEach(cleanup)

it('shows one answer when stored history arrives between live stream chunks', async () => {
  const sid = 'one-stored-final'
  const answer = 'Here is the answer to your question.'
  const history: SessionMessage[] = [{ id: 1, role: 'user', content: 'question', timestamp: 1 }]
  const states = new Map<string, ClientSessionState>()

  states.set(sid, { ...createClientSessionState(), messages: toChatMessages(history) })
  const stream = renderMessageStream(sid, { states })

  const send = (type: GatewayEventName, payload: Record<string, unknown> = {}) =>
    act(() => stream.handleEvent({ type, payload, session_id: sid }))

  await send('message.start')
  await send('message.delta', { text: answer.slice(0, 16) })
  await act(() => new Promise(resolve => setTimeout(resolve, 50)))

  const local = stream.state().messages
  const persisted = toChatMessages([...history, { id: 2, role: 'assistant', content: answer, timestamp: 2 }])
  const refreshed = preserveLocalPendingTurnMessages(graftRefreshedTailOntoBackfill(persisted, local), local)
  act(() => states.set(sid, { ...stream.state(), messages: refreshed }))

  await send('message.delta', { text: answer.slice(16) })
  await act(() => new Promise(resolve => setTimeout(resolve, 50)))
  await send('message.complete', {
    text: answer,
    persisted_turn: { row_ids: [1, 2], user_row_id: 1, final_assistant_row_id: 2, complete: true }
  })

  const copies = stream.state().messages.filter(message => chatMessageText(message).includes(answer))
  expect(copies).toHaveLength(1)
  expect(copies[0]).toMatchObject({ rowId: 2, pending: false, durableComplete: true })
})
