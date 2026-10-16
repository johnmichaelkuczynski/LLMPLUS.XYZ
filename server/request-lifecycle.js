// Cancellation must interrupt pending I/O, not merely set a flag checked after I/O.
export function abortable(operation, signal) {
  if (!signal) return Promise.resolve().then(operation);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(signal.reason || new DOMException('Request stopped','AbortError'));
    signal.addEventListener('abort',cancel,{once:true});
    Promise.resolve().then(()=>{signal.throwIfAborted();return operation();})
      .then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
  });
}

export function createRequestLifetime(req,res,timeoutMs=15*60*1000) {
  const controller=new AbortController();
  const stop=()=>controller.abort(new DOMException('Response stopped','AbortError'));
  const onClose=()=>{if(!res.writableEnded)stop();};
  // IncomingMessage.close also fires after an ordinary, completely received POST.
  // It is NOT a reliable indication that the response client disconnected.
  req.once('aborted',stop);
  res.once('close',onClose);
  const timer=setTimeout(()=>controller.abort(new DOMException('Response timed out; please retry','TimeoutError')),timeoutMs);
  timer.unref?.();
  let resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  return {controller,signal:controller.signal,done,stop,
    dispose(){clearTimeout(timer);req.removeListener('aborted',stop);res.removeListener('close',onClose);resolveDone();}};
}

export async function releaseGenerationLock(client,sessionId) {
  let destroy=false;
  try {
    const result=await client.query({text:'SELECT pg_advisory_unlock(hashtextextended($1,0)) AS unlocked',
      values:[sessionId],query_timeout:3000});
    destroy=result.rows[0]?.unlocked!==true;
  } catch {destroy=true;}
  finally {client.release(destroy);}
}
