  function matrixNodes(){
    const dim = clamp(parseInt(String(state.settings.matrixDimension),10) || 0, 0, 300);
    const sorted = visibleNodes();
    return dim > 0 ? sorted.slice(0, Math.min(dim, sorted.length)) : sorted;
  }
  // Hard cap on rendered matrix cells — 150×150 = 22,500 cells is the safe ceiling
  // before browsers freeze on a single innerHTML call. 300×300 = 90,000 cells would lock the UI.
  const MATRIX_RENDER_CAP = 150;
  function renderMatrixAndList(){
    const visNodes = matrixNodes();
    const n = visNodes.length, total = state.nodes.length, limit = state.settings.matrixLimit;
    const renderCap = Math.min(limit, MATRIX_RENDER_CAP);
    const sizeInput = $('#matrixSize'); if(sizeInput) sizeInput.value = state.settings.matrixDimension || total;
    const note = $('#matrixNote');
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    if(total === 0){ $('#matrixHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_nodes_yet') + '</div>'; $('#edgeListHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_edges_yet') + '</div>'; note.textContent=''; return; }
    if(n === 0){ $('#matrixHost').innerHTML = '<div class="tiny muted">' + I18N.t('no_nodes_range') + '</div>'; note.textContent = `0 / ${total}`; }
    else if(n > MATRIX_RENDER_CAP){
      // Above 150×150 — never render the grid (would create >22k elements and freeze the UI)
      $('#matrixHost').innerHTML = '<div class="tiny muted">' + (I18N.current === 'ru' ? `Матрица скрыта для производительности (${n}×${n} = ${n*n} ячеек).<br>Используйте экспорт <b>Matrix CSV</b> во вкладке Данные для просмотра полной матрицы, или сузьте видимый диапазон до ≤${MATRIX_RENDER_CAP} узлов.` : `Matrix hidden for performance (${n}×${n} = ${n*n} cells).<br>Use <b>Matrix CSV</b> export in the Data tab to view the full matrix, or narrow the visible range to ≤${MATRIX_RENDER_CAP} nodes.`) + '</div>';
      note.textContent = I18N.current === 'ru' ? `скрыто (${n}×${n} > лимит ${MATRIX_RENDER_CAP}²)` : `hidden (${n}×${n} > ${MATRIX_RENDER_CAP}² cap)`;
    }
    else if(n > limit){ $('#matrixHost').innerHTML = '<div class="tiny muted">' + (I18N.current === 'ru' ? `Матрица скрыта для производительности (${n} узлов > лимит ${limit}). Используйте экспорт Matrix CSV или увеличьте лимит.` : `Matrix hidden for performance (${n} nodes > limit ${limit}). Use Matrix CSV export or increase the limit.`) + '</div>'; note.textContent = I18N.current === 'ru' ? `скрыто (${n} из ${total} узлов)` : `hidden (${n} of ${total} nodes)`; }
    else {
      $('#matrixHost').innerHTML = adjacencyMatrixHtml(visNodes);
      note.textContent = rangeActive
        ? `${n}×${n} (` + (I18N.current === 'ru' ? 'диапазон ' : 'range ') + `${vr.start >= 0 ? vr.start : 0}–${vr.end >= 0 ? vr.end : (I18N.current === 'ru' ? 'конец' : 'end')} ` + (I18N.current === 'ru' ? 'из' : 'of') + ` ${total})`
        : n === total ? `${n}×${n}` : `${n}×${n} ` + (I18N.current === 'ru' ? `вид ${total} узлов` : `view of ${total} nodes`);
    }
    $('#edgeListHost').innerHTML = edgeListHtml();
  }
  function adjacencyMatrix(nodes=state.nodes){
    const index = new Map(nodes.map((n,i) => [n.id,i]));
    const m = Array.from({length:nodes.length}, () => Array.from({length:nodes.length}, () => []));
    for(const e of state.edges){
      const i=index.get(e.from), j=index.get(e.to); if(i == null || j == null) continue;
      const w = (e.weight != null && e.weight !== '') ? e.weight : '';
      m[i][j].push(w);
      if(!e.directed && i !== j) m[j][i].push(w);
    }
    return m;
  }
  function matrixCellEdgeIds(from, to){
    return state.edges
      .filter(e => (e.from === from && e.to === to) || (!e.directed && e.from === to && e.to === from))
      .map(e => e.id);
  }
  function adjacencyMatrixHtml(nodes=matrixNodes()){
    const m = adjacencyMatrix(nodes);
    const edgeSel = selectedEdgeIds();
    const header = nodes.map(n => `<th><input class="matrix-label-input${isNodeSelected(n.id)?' matrix-selected':''}" data-node-label="${esc(n.id)}" value="${esc(n.label || n.id)}" readonly title="Click to select node; click again to rename"></th>`).join('');
    let html = '<table><thead><tr><th></th>' + header + '</tr></thead><tbody>';
    nodes.forEach((row,i) => {
      html += `<tr><th class="row-head"><input class="matrix-label-input${isNodeSelected(row.id)?' matrix-selected':''}" data-node-label="${esc(row.id)}" value="${esc(row.label || row.id)}" readonly title="Click to select node; click again to rename"></th>` +
        m[i].map((cell,j) => {
          const to = nodes[j].id;
          const ids = matrixCellEdgeIds(row.id, to);
          const selected = ids.some(id => edgeSel.has(id));
          return `<td><input class="matrix-input${selected?' matrix-selected':''}" data-cell-from="${esc(row.id)}" data-cell-to="${esc(to)}" data-cell-edges="${esc(ids.join(','))}" value="${esc(cell.join(';') || '')}" placeholder="0" readonly title="Click to select edge(s); click again to edit weights"></td>`;
        }).join('') + '</tr>';
    });
    return html + '</tbody></table>';
  }
  function edgeListHtml(){
    if(!state.edges.length){ if($('#edgeListNote')) $('#edgeListNote').textContent = ''; return '<div class="tiny muted">' + I18N.t('no_edges_yet') + '</div>'; }
    // Filter edges by visible range (if set): only show edges where BOTH endpoints are visible
    const vr = state.settings.visibleRange || {start:-1, end:-1};
    const rangeActive = vr.start >= 0 || vr.end >= 0;
    const visIds = rangeActive ? visibleNodeIds() : null;
    const filteredEdges = rangeActive
      ? state.edges.filter(e => visIds.has(e.from) && visIds.has(e.to))
      : state.edges;
    if($('#edgeListNote')){
      const total = state.edges.length, shown = filteredEdges.length;
      $('#edgeListNote').textContent = rangeActive
        ? I18N.t('n_edges_filtered', {n: shown, m: total})
        : I18N.t('n_edges', {n: total});
    }
    if(!filteredEdges.length) return '<div class="tiny muted">' + I18N.t('no_edges_range') + '</div>';
    let html = '<table><thead><tr><th></th><th>' + I18N.t('col_num') + '</th><th>' + I18N.t('col_id') + '</th><th>' + I18N.t('col_from') + '</th><th>' + I18N.t('col_to') + '</th><th>' + I18N.t('weight') + '</th><th>' + I18N.t('label') + '</th><th>' + I18N.t('type') + '</th><th>' + I18N.t('col_dir') + '</th><th>' + I18N.t('color') + '</th><th>' + I18N.t('col_stroke') + '</th></tr></thead><tbody>';
    filteredEdges.forEach((e,i) => {
      const a = nodeById(e.from), b = nodeById(e.to);
      const sel = isEdgeSelected(e.id) ? ' matrix-selected' : '';
      const strokeOpts = '<option value=""></option>' + STROKE_STYLES.map(s => `<option value="${s}"${e.strokeStyle===s?' selected':''}>${I18N.t('stroke_' + s)}</option>`).join('');
      html += `<tr>
        <td style="white-space:nowrap">
          <button class="btn small icon edge-up" data-edge-id="${esc(e.id)}" title="Move up" style="min-height:26px;width:24px;padding:0">↑</button>
          <button class="btn small icon edge-down" data-edge-id="${esc(e.id)}" title="Move down" style="min-height:26px;width:24px;padding:0">↓</button>
        </td>
        <td>${i+1}</td>
        <td><input class="matrix-input edge-id" data-edge-id="${esc(e.id)}" value="${esc(e.id)}" title="Click to select edge; edit to change ID" style="width:60px"></td>
        <td><input class="matrix-input edge-from" data-edge-id="${esc(e.id)}" value="${esc(a?.label || e.from)}" title="Source: ${esc(e.from)} — type node label or ID to reassign" style="width:64px"></td>
        <td><input class="matrix-input edge-to" data-edge-id="${esc(e.id)}" value="${esc(b?.label || e.to)}" title="Target: ${esc(e.to)} — type node label or ID to reassign" style="width:64px"></td>
        <td><input class="matrix-input edge-weight${sel}" data-edge-id="${esc(e.id)}" value="${esc(e.weight)}" title="Edit weight" style="width:52px"></td>
        <td><input class="matrix-input edge-elabel" data-edge-id="${esc(e.id)}" value="${esc(e.label)}" title="Edit label" style="width:72px"></td>
        <td><input class="matrix-input edge-type" data-edge-id="${esc(e.id)}" value="${esc(e.type)}" placeholder="none" data-i18n-placeholder="none_placeholder" title="Edit type" style="width:64px"></td>
        <td><input type="checkbox" class="edge-directed" data-edge-id="${esc(e.id)}" ${e.directed?'checked':''} title="Directed"></td>
        <td><input type="color" class="edge-color" data-edge-id="${esc(e.id)}" value="${esc(edgeVisual(e).color)}" title="Edge color" style="width:32px;height:26px;padding:2px"></td>
        <td><select class="matrix-input edge-stroke-style" data-edge-id="${esc(e.id)}" style="width:68px">${strokeOpts}</select></td>
      </tr>`;
    });
    return html + '</tbody></table>';
  }

