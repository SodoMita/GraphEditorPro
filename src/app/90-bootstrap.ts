  function init(){
    // Загрузить язык и применить переводы до рендеринга
    I18N.load(); I18N.applyAll();
    wireUi(); loadSaved(); syncControls(); syncHotkeyInputs(); syncCameraInputs(); document.title = state.title + ' · ' + (I18N.t('brand_name')); appHistory=[snapshot()]; appHistoryIndex=0; queueRender(true);
  }
  init();
