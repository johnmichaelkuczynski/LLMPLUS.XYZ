import { abortable } from './request-lifecycle.js';
import { needsResponseCompletion, isExactOutputRequest, joinCompletion, completionMessages } from './response-completion.js';

// Each invocation owns its text, terminal state and single ending attempt.
export async function streamComparisonResponse(response, { openAI, signal, onText }) {
  let text = '', reason = 'stream_interrupted';
  if (!response.ok) throw new Error('Provider returned HTTP ' + response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  function parse(line) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return; // Transport closure is not a finish reason.
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (event.error || event.type === 'error') throw new Error('Provider stream failed');
    const choice = event.choices?.[0];
    const delta = openAI ? choice?.delta?.content :
      event.type === 'content_block_delta' && event.delta?.type === 'text_delta' ? event.delta.text : '';
    if (delta) { text += delta; onText?.(delta); }
    const stop = openAI ? choice?.finish_reason :
      event.type === 'message_delta' ? event.delta?.stop_reason : null;
    if (stop) reason = stop === 'length' ? 'max_tokens' : stop === 'stop' ? 'end_turn' : stop;
  }
  const cancel = () => { reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const chunk = await abortable(() => reader.read(), signal);
      buffer += chunk.done ? decoder.decode() + '\n' : decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) parse(line);
      if (chunk.done) break;
    }
    signal?.throwIfAborted();
    return { text, reason };
  } catch (error) {
    error.partialResponse = text;
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function runComparisonLane({ lane, model, messages, system, maxTokens, format, request,
  call, openAI, signal, send, canFit, onEnding }) {
  let text = '', reason = 'stream_interrupted', errorMessage = '', endingAttempted = false;
  const emit = event => { if (!signal?.aborted) send({ ...event, lane, model }); };
  emit({ type: 'lane_start' });
  try {
    signal?.throwIfAborted();
    const result = await streamComparisonResponse(await call(messages, system, true, maxTokens), {
      openAI, signal, onText(delta) { text += delta; emit({ type: 'text', text: delta }); }
    });
    reason = result.reason;
    // Exact-output requests may be flagged incomplete, but must not be expanded.
    if (text.trim() && !isExactOutputRequest(request) &&
        needsResponseCompletion(reason, text, format, request)) {
      const finishMessages = completionMessages(messages, text);
      const endingBudget = 256;
      if (canFit(finishMessages, system, endingBudget)) {
        signal?.throwIfAborted();
        endingAttempted = true;
        onEnding?.();
        emit({ type: 'lane_status', status: 'finishing' });
        try {
          const ending = await streamComparisonResponse(await call(finishMessages, system, true, endingBudget),
            { openAI, signal });
          text = joinCompletion(text, ending.text);
          // An empty/repeated ending cannot turn a capped/interrupted reply into success.
          if (ending.text.trim() && text !== result.text) reason = ending.reason;
          emit({ type: 'replace_text', text });
        } catch (error) {
          text = joinCompletion(text, error.partialResponse || '');
          emit({ type: 'replace_text', text });
          throw error;
        }
      }
    }
  } catch (error) {
    reason = signal?.aborted ? 'aborted' : 'error';
    errorMessage = error.message;
  }
  const status = signal?.aborted ? 'cancelled' :
    errorMessage || !text.trim() || reason !== 'end_turn' ||
    needsResponseCompletion(reason, text, format, request) ? 'incomplete' : 'completed';
  emit({ type: 'lane_end', status, stopReason: reason, endingAttempted,
    message: status === 'incomplete' ? 'Incomplete answer: ' +
      (errorMessage || 'the provider stopped before finishing. The partial answer is preserved.') : undefined });
  return { text, status, stopReason: reason, endingAttempted };
}
