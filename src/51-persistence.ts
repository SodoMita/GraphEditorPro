  function saveSoon(){
    if(!state.settings.autosave) return;
    clearTimeout(saveTimer); saveTimer = setTimeout(() => { try{ localStorage.setItem(STORAGE_KEY, snapshot()); }catch{} }, 250);
  }
  function loadSaved(){
    try{ const saved = localStorage.getItem(STORAGE_KEY); if(saved) { state = {...state, ...sanitizeState(JSON.parse(saved)), selected:null}; } }catch{}
  }
  function toast(message){
    const el = document.createElement('div'); el.className='toast'; el.textContent=message; $('#toastStack').appendChild(el); setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(6px)'; setTimeout(()=>el.remove(), 180); }, 2300);
  }
  async function copyText(text){
    try{ await navigator.clipboard.writeText(text); toast(I18N.t('copied')); }
    catch{ const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(I18N.t('copied')); }
  }

  // === Copy-to-clipboard for every export format ===
  function copyJson(){ copyText(exportJsonText()); }
  function copyDot(){ copyText(exportDotText()); }
  function copyGraphml(){ copyText(exportGraphmlText()); }
  function copyEdgeCsv(){ copyText(edgeCsv().replace(/^\ufeff/,'')); }
  function copyMatrixCsv(){ copyText(matrixCsv().replace(/^\ufeff/,'')); }
  function copyNodesCsv(){ copyText(nodeCsv().replace(/^\ufeff/,'')); }
