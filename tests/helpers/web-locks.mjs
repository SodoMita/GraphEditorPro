// Minimal FIFO Web Locks mock. The callback owns the lock through its promise;
// an aborted request is removed only while waiting, like the browser API.
export function createWebLocks() {
  let held = false;
  const queue = [];
  const next = () => {
    if(held || !queue.length) return;
    const item = queue.shift();
    if(item.signal?.aborted) { item.reject(new Error('AbortError')); next(); return; }
    held = true;
    item.signal?.removeEventListener('abort', item.abort);
    Promise.resolve().then(() => item.callback({ name:item.name, mode:'exclusive' }))
      .then(item.resolve, item.reject).finally(() => { held = false; next(); });
  };
  return {
    request(name, options, callback) {
      if(typeof options === 'function') { callback = options; options = {}; }
      if(options.ifAvailable && held) return Promise.resolve().then(() => callback(null));
      return new Promise((resolve, reject) => {
        const item = { name, callback, resolve, reject, signal:options.signal };
        item.abort = () => {
          const index = queue.indexOf(item);
          if(index >= 0) { queue.splice(index, 1); reject(new Error('AbortError')); }
        };
        if(item.signal?.aborted) { reject(new Error('AbortError')); return; }
        item.signal?.addEventListener('abort', item.abort, { once:true });
        queue.push(item); next();
      });
    },
  };
}
