  function init(){
    // Загрузить язык и применить переводы до рендеринга
    I18N.load(); I18N.applyAll();
    wireUi(); loadSaved(); syncControls(); syncHotkeyInputs(); syncCameraInputs(); document.title = state.title + ' · ' + (I18N.t('brand_name')); resetHistory(); queueRender(true);
  }
  init();
