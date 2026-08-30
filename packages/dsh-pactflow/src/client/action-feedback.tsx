import { useCallback, useRef, useState } from 'react'
import { IconCheckOutline16, IconWarningOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'

export interface ActionFeedbackMessage {
  readonly seq: number
  readonly kind: 'success' | 'error'
  readonly text: string
}

export function useActionFeedback() {
  const sequence = useRef(0)
  const [feedback, setFeedback] = useState<ActionFeedbackMessage | null>(null)
  const showFeedback = useCallback((kind: ActionFeedbackMessage['kind'], text: string): void => {
    sequence.current += 1
    setFeedback({ seq: sequence.current, kind, text })
  }, [])
  const clearFeedback = useCallback((): void => { setFeedback(null) }, [])
  return { feedback, showFeedback, clearFeedback }
}

export function ActionFeedbackToast({ feedback, onDone }: {
  readonly feedback: ActionFeedbackMessage | null
  readonly onDone: () => void
}) {
  if (feedback === null) return null
  return <Toast
    key={feedback.seq}
    text={feedback.text}
    icon={feedback.kind === 'success' ? <IconCheckOutline16 /> : <IconWarningOutline16 />}
    holdMs={feedback.kind === 'success' ? 3000 : 6000}
    onDone={onDone}
  />
}
