// Output limits and provider "end_turn" are not proof of a complete sentence.
export function looksUnfinished(text, format='prose') {
  const value=String(text || '').trim();
  if(!value || /[.!?…][\s"'”’)\]*_`]*$/.test(value) || /[`}>\]]$/.test(value))return false;
  const line=value.split('\n').at(-1).trim();
  if(/^(?:#{1,6}\s|```|\|)/.test(line))return false;
  const words=value.split(/\s+/).length;
  if(words>=3 && /\b(?:would|could|should|will|shall|must)\s+(?:be|have)$/i.test(line))return true;
  const dangling=/\b(?:a|an|the|and|or|but|because|although|while|which|whose|that|with|without|of|for|from|to|by|at|into|than|would|could|should|will|shall|must|be|being|been|is|are|was|were|has|have|had|its|their|your|my|our|his|her)$/i;
  if(words>12 && dangling.test(line))return true;
  return format==='prose' && words>45 && line.split(/\s+/).length>10 &&
    !/^(?:[-*•]\s|\d+[.)]\s)/.test(line) && !/[:"'”’]$/.test(line);
}

export function needsResponseCompletion(reason,text,format,request='') {
  const exact=/^\s*(?:please\s+)?(?:reply|respond|return|output|say|write)\s+(?:with\s+)?(?:exactly|only|verbatim)\b/i.test(request) ||
    /\b(?:end|finish)\s+(?:your|the)\s+(?:answer|response)\s+with\b/i.test(String(request).slice(0,600));
  return reason==='max_tokens' || reason==='stream_interrupted' ||
    (reason==='end_turn' && !exact && looksUnfinished(text,format));
}

export function joinCompletion(original,addition) {
  if(!addition)return original;
  // Remove only verbatim overlap, never rewrite the original answer.
  let overlap=0;
  for(let n=Math.min(original.length,addition.length,800);n>=12;n--) {
    if(original.endsWith(addition.slice(0,n))){overlap=n;break;}
  }
  const suffix=addition.slice(overlap);
  if(!suffix)return original;
  const space=/[\p{L}\p{N}]$/u.test(original) && /^[\p{L}\p{N}]/u.test(suffix)?' ':'';
  return original+space+suffix;
}

export function completionMessages(messages,text) {
  return [...messages,{role:'assistant',content:text},{role:'user',content:
    'The previous response stopped before its ending was complete. Continue exactly from its final words. '+
    'Finish only the unfinished sentence or thought, then conclude and STOP within 80 words. '+
    'Do not restart, repeat the answer, add sections, or expand the subject. '+
    'Use only facts supported by the supplied conversation and sources; do not invent a missing conclusion. '+
    'Return only the missing ending, not an explanation of the interruption.'}];
}
