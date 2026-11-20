  // The generated file must boot in ES2020-capable browsers that predate
  // Array.prototype.toSorted/toReversed. TypeScript's lib setting only types
  // these calls; it does not provide the methods at runtime.
  if(typeof (Array.prototype as any).toSorted !== 'function'){
    Object.defineProperty(Array.prototype, 'toSorted', {
      configurable: true, writable: true,
      value: function(compareFn?: (a: any, b: any) => number){
        return Array.prototype.slice.call(this).sort(compareFn);
      }
    });
  }
  if(typeof (Array.prototype as any).toReversed !== 'function'){
    Object.defineProperty(Array.prototype, 'toReversed', {
      configurable: true, writable: true,
      value: function(){ return Array.prototype.slice.call(this).reverse(); }
    });
  }
