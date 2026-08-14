// Система переводов для Graph Editor Pro
// Поддерживаемые языки: en, ru
window.I18N = {
  // === Статические тексты HTML (по data-i18n ключу) ===
  strings: {
    // --- Topbar / toolbar ---
    'brand_name': { en: 'Graph Editor Pro', ru: 'Graph Editor Pro' },
    'doc_title': { en: 'untitled', ru: 'безымянный' },
    'view_graph': { en: 'Graph', ru: 'Граф' },
    'view_matrix': { en: 'Matrix', ru: 'Матрица' },
    'view_edges': { en: 'Edges', ru: 'Рёбра' },
    'orient_toggle': { en: 'Toggle split orientation (vertical/horizontal)', ru: 'Переключить ориентацию разделения (вертикально/горизонтально)' },
    'presets_open': { en: 'Open style presets overlay', ru: 'Открыть пресеты стилей' },
    'undo': { en: 'Undo', ru: 'Отменить' },
    'redo': { en: 'Redo', ru: 'Повторить' },
    'sample': { en: 'Sample', ru: 'Пример' },
    'delete': { en: 'Delete', ru: 'Удалить' },
    'clear': { en: 'Clear', ru: 'Очистить' },
    'lang_switch': { en: 'Switch language', ru: 'Сменить язык' },
    'delete_selected': { en: 'Delete selected', ru: 'Удалить выбранное' },
    'clear_graph': { en: 'Clear graph', ru: 'Очистить граф' },
    'add_sample': { en: 'Add sample graph', ru: 'Добавить пример графа' },

    // --- Tabs ---
    'tab_edit': { en: 'Edit', ru: 'Правка' },
    'tab_style': { en: 'Style', ru: 'Стиль' },
    'tab_algo': { en: 'Algo', ru: 'Алго' },
    'tab_data': { en: 'Data', ru: 'Данные' },
    'tab_help': { en: 'Help', ru: 'Справка' },

    // --- Edit tab: Mode ---
    'mode_title': { en: 'Mode', ru: 'Режим' },
    'mode_select': { en: '↖ Select', ru: '↖ Выбор' },
    'mode_move': { en: '✋ Move', ru: '✋ Перемещение' },
    'mode_node': { en: '＋ Node', ru: '＋ Узел' },
    'mode_edge': { en: '↔ Edge', ru: '↔ Ребро' },
    'mode_select_title': { en: 'Select and move nodes', ru: 'Выбирать и перемещать узлы' },
    'mode_move_title': { en: 'Pan the canvas by dragging', ru: 'Панорамировать холст перетаскиванием' },
    'mode_node_title': { en: 'Click canvas to add nodes', ru: 'Клик по холсту добавляет узлы' },
    'mode_edge_title': { en: 'Drag from node to node', ru: 'Перетащить от узла к узлу' },
    'mode_tip': { en: 'Tip: use Move mode or hold Space to pan. Pinch the canvas to zoom/pan on touch screens.', ru: 'Подсказка: используйте режим Перемещение или удерживайте Пробел для панорамирования. Щипок для зума на сенсорных экранах.' },

    // --- Edit tab: Selection ---
    'canvas_selection': { en: 'Canvas selection', ru: 'Выделение на холсте' },
    'sel_single': { en: 'Single', ru: 'Одиночное' },
    'sel_rect': { en: 'Rect', ru: 'Прямоуг' },
    'sel_brush': { en: 'Brush', ru: 'Кисть' },
    'sel_lasso': { en: 'Lasso', ru: 'Лассо' },
    'sel_line': { en: 'Line', ru: 'Линия' },
    'sel_polygon': { en: 'Polygon', ru: 'Многоугольник' },
    'sel_adjacent': { en: 'Adjacent', ru: 'Смежные' },
    'sel_directed_adj': { en: 'Directed adjacent', ru: 'Напр. смежные' },
    'sel_result': { en: 'Selection result', ru: 'Результат выделения' },
    'sel_override': { en: 'Override', ru: 'Замена' },
    'sel_add': { en: 'Add', ru: 'Добавить' },
    'sel_subtract': { en: 'Subtract', ru: 'Вычесть' },
    'brush_diameter': { en: 'Brush diameter', ru: 'Диаметр кисти' },
    'sel_tip': { en: 'Selection tools work in Select mode. Use Override/Add/Subtract; Shift temporarily adds to the current selection. Polygon uses clicks; click the first point or double-click to close.', ru: 'Инструменты выделения работают в режиме Выбора. Используйте Замена/Добавить/Вычесть; Shift временно добавляет к текущему выделению. Многоугольник — кликами; клик по первой точке или двойной клик для замыкания.' },

    // --- Edit tab: Node placement ---
    'node_placement': { en: 'Node placement', ru: 'Размещение узла' },
    'node_placement_sub': { en: '(values for newly added nodes)', ru: '(значения для новых узлов)' },
    'shape': { en: 'Shape', ru: 'Форма' },
    'color': { en: 'Color', ru: 'Цвет' },
    'width': { en: 'Width', ru: 'Ширина' },
    'height': { en: 'Height', ru: 'Высота' },
    'stroke_color': { en: 'Stroke color', ru: 'Цвет обводки' },
    'stroke_size': { en: 'Stroke size', ru: 'Размер обводки' },
    'stroke_style': { en: 'Stroke style', ru: 'Стиль обводки' },
    'type': { en: 'Type', ru: 'Тип' },
    'label_prefix': { en: 'Label prefix / exact label', ru: 'Префикс метки / точная метка' },
    'label_color': { en: 'Label color', ru: 'Цвет метки' },
    'label_font': { en: 'Label font', ru: 'Шрифт метки' },
    'label_size': { en: 'Label size', ru: 'Размер метки' },
    'label_pos': { en: 'Label position', ru: 'Позиция метки' },
    'inherit_defaults': { en: 'New nodes inherit Style-tab defaults (unset visual properties)', ru: 'Новые узлы наследуют умолчания вкладки Стиль (визуальные свойства не заданы)' },
    'inherit_defaults_desc': { en: 'When on, new nodes have unset visual properties and follow Style-tab defaults dynamically. Turn off to bake the values above into each new node.', ru: 'Когда включено, новые узлы имеют незаданные визуальные свойства и динамически следуют умолчаниям вкладки Стиль. Выключите, чтобы зафиксировать значения выше в каждом новом узле.' },
    'no_label': { en: 'Create nodes with no label (empty label — no text shown on canvas)', ru: 'Создавать узлы без метки (пустая метка — текст на холсте не отображается)' },
    'snap_grid': { en: 'Snap nodes to grid', ru: 'Привязка узлов к сетке' },
    'snap_x': { en: 'Snap X to other nodes', ru: 'Привязка X к другим узлам' },
    'snap_y': { en: 'Snap Y to other nodes', ru: 'Привязка Y к другим узлам' },
    'grid_width': { en: 'Grid width', ru: 'Ширина сетки' },
    'grid_height': { en: 'Grid height', ru: 'Высота сетки' },
    'grid_desc': { en: 'The visual grid uses these dimensions, and grid snap follows them.', ru: 'Визуальная сетка использует эти размеры, привязка к сетке следует им.' },

    // --- Shapes ---
    'shape_circle': { en: 'Circle', ru: 'Круг' },
    'shape_square': { en: 'Square', ru: 'Квадрат' },
    'shape_diamond': { en: 'Diamond', ru: 'Ромб' },
    'shape_triangleUp': { en: 'Triangle Up', ru: 'Треугольник вверх' },
    'shape_triangleDown': { en: 'Triangle Down', ru: 'Треугольник вниз' },
    'shape_hexagon': { en: 'Hexagon', ru: 'Шестиугольник' },

    // --- Stroke styles ---
    'stroke_solid': { en: 'Solid', ru: 'Сплошная' },
    'stroke_dashed': { en: 'Dashed', ru: 'Штриховая' },
    'stroke_dotted': { en: 'Dotted', ru: 'Пунктирная' },
    'stroke_inherit': { en: 'Inherit', ru: 'Наследовать' },

    // --- Label positions ---
    'pos_center': { en: 'Center', ru: 'Центр' },
    'pos_top': { en: 'Top', ru: 'Сверху' },
    'pos_bottom': { en: 'Bottom', ru: 'Снизу' },
    'pos_left': { en: 'Left', ru: 'Слева' },
    'pos_right': { en: 'Right', ru: 'Справа' },

    // --- Edit tab: Edge defaults ---
    'edge_defaults': { en: 'New edge defaults', ru: 'Умолчания для новых рёбер' },
    'weight': { en: 'Weight', ru: 'Вес' },
    'label': { en: 'Label', ru: 'Метка' },
    'directed_edge': { en: 'Directed edge', ru: 'Направленное ребро' },
    'none_placeholder': { en: 'none', ru: 'нет' },

    // --- Edit tab: Selection panel ---
    'selection': { en: 'Selection', ru: 'Выделение' },
    'nothing_selected': { en: 'Nothing selected.', ru: 'Ничего не выбрано.' },
    'adjacent': { en: 'Adjacent', ru: 'Смежные' },
    'directed_adj_short': { en: 'Directed adj.', ru: 'Напр. смежн.' },
    'clear_sel': { en: 'Clear', ru: 'Очистить' },
    'delete_sel': { en: 'Delete', ru: 'Удалить' },
    'applies_to_all': { en: 'applies to all', ru: 'применить ко всем' },
    'style_blank_inherit': { en: 'Style', ru: 'Стиль' },
    'blank_inherit': { en: '(blank = inherit)', ru: '(пусто = наследовать)' },
    'reset_style': { en: 'Reset style', ru: 'Сбросить стиль' },
    'delete_edge': { en: 'Delete edge', ru: 'Удалить ребро' },
    'drag_hint': { en: 'Drag the ⇆ handle next to a number to scrub the value (Shift = fine).', ru: 'Перетаскивайте рукоятку ⇆ рядом с числом для изменения значения (Shift = точно).' },
    'order': { en: 'Order', ru: 'Порядок' },
    'keep': { en: '(keep)', ru: '(сохранить)' },
    'directed': { en: 'Directed', ru: 'Направленное' },
    'directed_edge_short': { en: 'Directed', ru: 'Направленное' },
    'undirected_edge_short': { en: 'Undirected', ru: 'Ненаправленное' },
    'reset_style_title': { en: 'Clear all per-item style overrides', ru: 'Очистить все переопределения стиля элемента' },
    'reset_edge_style_title': { en: 'Clear all per-edge style overrides', ru: 'Очистить все переопределения стиля ребра' },
    'x_coord': { en: 'X', ru: 'X' },
    'y_coord': { en: 'Y', ru: 'Y' },
    'id_label': { en: 'ID', ru: 'ID' },

    // --- Style tab ---
    'graph_defaults': { en: 'Graph defaults', ru: 'Умолчания графа' },
    'labels_policy': { en: 'Labels policy', ru: 'Политика меток' },
    'labels_auto': { en: 'Auto (hide when many nodes)', ru: 'Авто (скрывать при множестве узлов)' },
    'labels_on': { en: 'On (always show)', ru: 'Вкл (всегда показывать)' },
    'labels_off': { en: 'Off (never show)', ru: 'Выкл (никогда не показывать)' },
    'labels_policy_desc': { en: 'Auto hides labels when more than 30 nodes exist. Imported QVGE graphs with no labels stay unlabeled.', ru: 'Авто скрывает метки при более 30 узлах. Импортированные графы QVGE без меток остаются без меток.' },
    'edge_weight_viz': { en: 'Edge weight visualization', ru: 'Визуализация веса рёбер' },
    'ew_number': { en: 'Show weight as number', ru: 'Показывать вес как число' },
    'ew_color': { en: 'Color gradient by weight', ru: 'Цветовой градиент по весу' },
    'ew_width': { en: 'Edge width by weight', ru: 'Толщина ребра по весу' },
    'ew_none': { en: 'No weight visualization', ru: 'Без визуализации веса' },
    'weight_range_min': { en: 'Weight range min', ru: 'Мин веса' },
    'weight_range_max': { en: 'Weight range max', ru: 'Макс веса' },
    'invert_note': { en: 'Min > max is valid — inverts the mapping (lower values give higher width/color).', ru: 'Мин > макс допустимо — инвертирует отображение (меньшие значения дают большую толщину/цвет).' },
    'corr_func': { en: 'Correlation function', ru: 'Функция корреляции' },
    'corr_linear': { en: 'Linear', ru: 'Линейная' },
    'corr_log': { en: 'Logarithmic', ru: 'Логарифмическая' },
    'corr_exp': { en: 'Exponential', ru: 'Экспоненциальная' },
    'corr_sqrt': { en: 'Square root', ru: 'Квадратный корень' },
    'edge_width_min': { en: 'Edge width min', ru: 'Мин толщина' },
    'edge_width_max': { en: 'Edge width max', ru: 'Макс толщина' },
    'gradient_low': { en: 'Gradient low color', ru: 'Цвет градиента (низ)' },
    'gradient_high': { en: 'Gradient high color', ru: 'Цвет градиента (верх)' },
    'range_clamp_note': { en: 'In color/width mode, weights outside the range are clamped; the number is shown as text fallback.', ru: 'В режиме цвет/толщина веса вне диапазона ограничиваются; число показывается как текст.' },
    'canvas_bg': { en: 'Canvas background', ru: 'Фон холста' },
    'grid_minor_color': { en: 'Grid minor color', ru: 'Цвет малой сетки' },
    'grid_minor_alpha': { en: 'Grid minor alpha', ru: 'Прозрачность малой сетки' },
    'grid_major_color': { en: 'Grid major color', ru: 'Цвет главной сетки' },
    'grid_major_alpha': { en: 'Grid major alpha', ru: 'Прозрачность главной сетки' },

    'node_defaults': { en: 'Node defaults', ru: 'Умолчания узлов' },
    'edge_defaults_style': { en: 'Edge defaults', ru: 'Умолчания рёбер' },
    'apply_to_all_nodes': { en: 'Apply defaults to all nodes', ru: 'Применить умолчания ко всем узлам' },
    'apply_to_all_edges': { en: 'Apply defaults to all edges', ru: 'Применить умолчания ко всем рёбрам' },
    'type_styles_sub': { en: '(per-type overrides)', ru: '(переопределения по типу)' },
    'type_styles_desc': { en: 'Type a name, set style, then Save. Nodes with this type (and no per-node override) will use these visuals. Use "Clear per-node" to force type style to take effect.', ru: 'Введите имя, задайте стиль, затем Сохранить. Узлы этого типа (без покрывающих переопределений) будут использовать этот вид. Используйте "Очистить покр. узлы" для применения стиля типа.' },
    'type_styles_desc_edge': { en: 'Type a name, set style, then Save. Edges with this type (and no per-edge override) will use these visuals.', ru: 'Введите имя, задайте стиль, затем Сохранить. Рёбра этого типа (без покрывающих переопределений) будут использовать этот вид.' },
    'enter_type_name': { en: 'Type', ru: 'Тип' },
    'enter_type_placeholder': { en: 'enter type name', ru: 'введите имя типа' },
    'save': { en: 'Save', ru: 'Сохранить' },
    'delete_btn': { en: 'Delete', ru: 'Удалить' },
    'clear_per_node': { en: 'Clear per-node', ru: 'Очистить покр. узлы' },
    'clear_per_node_title': { en: 'Clear per-node color/shape overrides so type style takes effect', ru: 'Очистить покрывающие цвет/форму узлов, чтобы стиль типа вступил в силу' },
    'clear_per_edge': { en: 'Clear per-edge', ru: 'Очистить покр. рёбра' },
    'clear_per_edge_title': { en: 'Clear per-edge color overrides so type style takes effect', ru: 'Очистить покрывающие цвета рёбер, чтобы стиль типа вступил в силу' },
    'node_type_styles': { en: 'Node type styles', ru: 'Стили типов узлов' },
    'edge_type_styles': { en: 'Edge type styles', ru: 'Стили типов рёбер' },

    // --- Algo tab ---
    'run_algorithms': { en: 'Run algorithms', ru: 'Запуск алгоритмов' },
    'start_node': { en: 'Start node', ru: 'Стартовый узел' },
    'no_nodes': { en: 'No nodes', ru: 'Нет узлов' },
    'results': { en: 'Results', ru: 'Результаты' },
    'copy': { en: 'Copy', ru: 'Копировать' },
    'algo_output_init': { en: 'Create a graph, choose a start node, then run an algorithm.', ru: 'Создайте граф, выберите стартовый узел, затем запустите алгоритм.' },

    // --- Data tab ---
    'import_export': { en: 'Import / export', ru: 'Импорт / экспорт' },
    'append_mode': { en: 'Append to current graph (keep existing nodes/edges, styles, and background)', ru: 'Добавить к текущему графу (сохранить узлы/рёбра, стили и фон)' },
    'export_json': { en: 'Export JSON', ru: 'Экспорт JSON' },
    'copy_json': { en: 'Copy JSON', ru: 'Копировать JSON' },
    'paste_json': { en: 'Paste JSON', ru: 'Вставить JSON' },
    'import_json': { en: 'Import JSON', ru: 'Импорт JSON' },
    'export_dot': { en: 'Export DOT', ru: 'Экспорт DOT' },
    'copy_dot': { en: 'Copy DOT', ru: 'Копировать DOT' },
    'paste_dot': { en: 'Paste DOT', ru: 'Вставить DOT' },
    'import_dot': { en: 'Import DOT', ru: 'Импорт DOT' },
    'graphml': { en: 'GraphML', ru: 'GraphML' },
    'copy_graphml': { en: 'Copy GraphML', ru: 'Копировать GraphML' },
    'paste_graphml': { en: 'Paste GraphML', ru: 'Вставить GraphML' },
    'import_graphml': { en: 'Import GraphML', ru: 'Импорт GraphML' },
    'export_edges_csv': { en: 'Edges CSV', ru: 'Рёбра CSV' },
    'copy_edges': { en: 'Copy Edges', ru: 'Копировать рёбра' },
    'paste_edges': { en: 'Paste Edges', ru: 'Вставить рёбра' },
    'export_matrix_csv': { en: 'Matrix CSV', ru: 'Матрица CSV' },
    'copy_matrix': { en: 'Copy Matrix', ru: 'Копировать матрицу' },
    'paste_matrix': { en: 'Paste Matrix', ru: 'Вставить матрицу' },
    'export_nodes_csv': { en: 'Nodes CSV', ru: 'Узлы CSV' },
    'copy_nodes': { en: 'Copy Nodes', ru: 'Копировать узлы' },
    'paste_nodes': { en: 'Paste Nodes', ru: 'Вставить узлы' },
    'import_export_desc': { en: 'Every format supports export (preview + copy + download), clipboard copy, clipboard paste, and file import. Use "Append" to merge imported nodes/edges into the current graph without changing styles or background.', ru: 'Каждый формат поддерживает экспорт (предпросмотр + копирование + скачивание), копирование в буфер, вставку из буфера и импорт файла. Используйте "Добавить" для слияния импортированных узлов/рёбер с текущим графом без изменения стилей и фона.' },
    'layout_view': { en: 'Layout and view', ru: 'Раскладка и вид' },
    'circle': { en: 'Circle', ru: 'Круг' },
    'grid': { en: 'Grid', ru: 'Сетка' },
    'relax': { en: 'Relax', ru: 'Расслабить' },
    'fit_view': { en: 'Fit view', ru: 'Вписать' },
    'center_on_sel': { en: 'Center on sel.', ru: 'Центр на выбр.' },
    'center_on_sel_title': { en: 'Center the view on the single selected node', ru: 'Центрировать вид на выбранном узле' },
    'camera_position': { en: 'Camera position', ru: 'Позиция камеры' },
    'center_x': { en: 'Center X', ru: 'Центр X' },
    'center_y': { en: 'Center Y', ru: 'Центр Y' },
    'apply': { en: 'Apply', ru: 'Применить' },
    'fit': { en: 'Fit', ru: 'Вписать' },
    'reset_100': { en: 'Reset 100%', ru: 'Сброс 100%' },
    'camera_width': { en: 'Width', ru: 'Ширина' },
    'camera_height': { en: 'Height', ru: 'Высота' },
    'camera_hint': { en: 'Width/Height control zoom (smaller = zoomed in). Apply pans and zooms precisely.', ru: 'Ширина/Высота управляют зумом (меньше = ближе). Применить точно панорамирует и зумирует.' },
    'reliability_options': { en: 'Reliability options', ru: 'Настройки надёжности' },
    'autosave': { en: 'Autosave to this browser', ru: 'Автосохранение в этом браузере' },
    'matrix_limit': { en: 'Matrix limit', ru: 'Лимит матрицы' },

    // --- Help tab ---
    'quick_help': { en: 'Quick help', ru: 'Краткая справка' },
    'help_node': { en: '<b>Node:</b> choose Node mode, then click the canvas. In Node mode you can also drag existing nodes to reposition them (Blender-style).', ru: '<b>Узел:</b> выберите режим Узел, затем кликните по холсту. В режиме Узел можно также перетаскивать существующие узлы (в стиле Blender).' },
    'help_edge': { en: '<b>Edge:</b> choose Edge mode, then drag from a source node to a target node. On touch screens, tap a source node, then tap a target node.', ru: '<b>Ребро:</b> выберите режим Ребро, затем перетащите от исходного узла к целевому. На сенсорных экранах — нажмите исходный, затем целевой узел.' },
    'help_move_nodes': { en: '<b>Move nodes:</b> choose Select or Node mode and drag nodes.', ru: '<b>Перемещение узлов:</b> выберите режим Выбор или Узел и перетаскивайте узлы.' },
    'help_move_canvas': { en: '<b>Move canvas:</b> choose Move mode, hold <span class="kbd">Space</span>, or drag with <span class="kbd">RMB</span>/<span class="kbd">MMB</span> in any mode. On touch screens, pinch to zoom and pan.', ru: '<b>Перемещение холста:</b> выберите режим Перемещение, удерживайте <span class="kbd">Пробел</span> или перетаскивайте <span class="kbd">ПКМ</span>/<span class="kbd">СКМ</span> в любом режиме. На сенсорных — щипок для зума и панорамирования.' },
    'help_center_edge': { en: '<b>Center on edge:</b> in Move mode, click an edge — the view centers on whichever endpoint is further from the current view center.', ru: '<b>Центр на ребре:</b> в режиме Перемещение кликните по ребру — вид центрируется на более удалённой от центра конечной точке.' },
    'help_adjust_numbers': { en: '<b>Adjust numbers:</b> hover any numeric field with a ⇆ handle and drag horizontally to change the value (Shift = fine). Type directly to enter an exact value.', ru: '<b>Изменение чисел:</b> наведите на числовое поле с рукояткой ⇆ и перетаскивайте по горизонтали (Shift = точно). Ввод напрямую для точного значения.' },
    'help_matrix_editing': { en: '<b>Matrix editing:</b> click a cell once to select it without triggering the keyboard; click again to edit it. This lets you select on mobile without the on-screen keyboard popping up.', ru: '<b>Редактирование матрицы:</b> кликните по ячейке один раз для выбора без вызова клавиатуры; кликните снова для редактирования. Это позволяет выбирать на мобильных без всплывающей клавиатуры.' },
    'help_zoom': { en: '<b>Zoom:</b> mouse wheel / trackpad over the canvas, or pinch on mobile/tablet. Camera position can also be set numerically in the Data tab.', ru: '<b>Зум:</b> колёсико мыши / трекпад над холстом или щипок на мобильных. Позицию камеры можно задать численно во вкладке Данные.' },
    'help_exports': { en: '<b>Exports:</b> every format (JSON, DOT, GraphML, Edges/Matrix/Nodes CSV) supports both file download and copy-to-clipboard.', ru: '<b>Экспорт:</b> каждый формат (JSON, DOT, GraphML, Рёбра/Матрица/Узлы CSV) поддерживает скачивание файла и копирование в буфер.' },
    'hotkeys': { en: 'Hotkeys', ru: 'Горячие клавиши' },
    'reset_defaults': { en: 'Reset to defaults', ru: 'Сбросить к умолчаниям' },
    'hotkeys_desc': { en: 'Click a key field, then press any key. Backspace/Delete clears. Escape cancels. Undo/Redo are prefixed with Ctrl/⌘ automatically.', ru: 'Кликните по полю клавиши, затем нажмите любую клавишу. Backspace/Delete очищает. Escape отменяет. Undo/Redo автоматически дополняются Ctrl/⌘.' },
    'hk_select': { en: 'Select mode', ru: 'Режим выбора' },
    'hk_move': { en: 'Move mode', ru: 'Режим перемещения' },
    'hk_node': { en: 'Node mode', ru: 'Режим узла' },
    'hk_edge': { en: 'Edge mode', ru: 'Режим ребра' },
    'hk_delete': { en: 'Delete selection', ru: 'Удалить выбранное' },
    'hk_pan': { en: 'Pan (hold)', ru: 'Панор. (удерж.)' },
    'hk_undo': { en: 'Undo (Ctrl+)', ru: 'Отменить (Ctrl+)' },
    'hk_redo': { en: 'Redo (Ctrl+)', ru: 'Повторить (Ctrl+)' },
    'whats_improved': { en: "What's improved", ru: 'Что улучшено' },
    'improved_1': { en: 'Single-file/offline preview: no external fonts, CSS, or icons required.', ru: 'Однофайловый/офлайн предпросмотр: не требуются внешние шрифты, CSS и иконки.' },
    'improved_2': { en: 'Robust undo/redo, autosave, import validation, and safe CSV downloads.', ru: 'Надёжные undo/redo, автосохранение, валидация импорта и безопасное скачивание CSV.' },
    'improved_3': { en: 'Pan/zoom canvas, snap-to-grid, fit view, and layout helpers.', ru: 'Панорамирование/зум холста, привязка к сетке, вписывание и помощники раскладки.' },
    'improved_4': { en: 'CSV exports for edges, nodes, and adjacency matrix; copy-to-clipboard for every format.', ru: 'CSV-экспорт рёбер, узлов и матрицы смежности; копирование в буфер для каждого формата.' },
    'improved_5': { en: 'Blender-style drag-to-change numeric inputs for node coordinates.', ru: 'Перетаскивание для изменения чисел в стиле Blender для координат узлов.' },
    'improved_6': { en: 'Configurable hotkeys, camera position inputs, and center-on-selection.', ru: 'Настраиваемые горячие клавиши, ввод позиции камеры и центрирование на выделении.' },
    'improved_7': { en: 'Matrix cells require a selection click before editing — no more mobile-keyboard surprises.', ru: 'Ячейки матрицы требуют клика выбора перед редактированием — больше никаких сюрпризов с мобильной клавиатурой.' },

    // --- Canvas HUD ---
    'ready': { en: 'Ready', ru: 'Готово' },
    'zoom_in': { en: 'Zoom in', ru: 'Приблизить' },
    'zoom_out': { en: 'Zoom out', ru: 'Отдалить' },
    'reset_zoom': { en: 'Reset zoom', ru: 'Сбросить зум' },
    'empty_hint': { en: 'Start by selecting Node mode and clicking the canvas, or press Sample.', ru: 'Начните с выбора режима Узел и клика по холсту, либо нажмите Пример.' },

    // --- Matrix panel ---
    'adjacency_matrix': { en: 'Adjacency matrix', ru: 'Матрица смежности' },
    'matrix_view': { en: 'Matrix view', ru: 'Вид матрицы' },
    'matrix_view_title': { en: 'Set visible matrix dimension. Smaller values do not delete graph nodes.', ru: 'Задать видимую размерность матрицы. Меньшие значения не удаляют узлы графа.' },
    'set_dimensions': { en: 'Set dimensions', ru: 'Задать размерность' },
    'set_dim_title': { en: 'Resize matrix view without deleting or rearranging existing graph', ru: 'Изменить размер матрицы без удаления или перестановки графа' },
    'add_node': { en: 'Add node', ru: 'Добавить узел' },
    'insert_before_sel': { en: 'Insert before selected', ru: 'Вставить перед выбр.' },
    'insert_title': { en: 'Insert a new node before each selected node', ru: 'Вставить новый узел перед каждым выбранным' },
    'sort_by_id': { en: 'Sort by ID', ru: 'Сорт. по ID' },
    'sort_by_id_title': { en: 'Sort nodes by ID', ru: 'Сортировать узлы по ID' },
    'sort_by_label': { en: 'Sort by label', ru: 'Сорт. по метке' },
    'sort_by_label_title': { en: 'Sort nodes by label', ru: 'Сортировать узлы по метке' },
    'renumber_order': { en: 'Renumber order', ru: 'Перенумеровать' },
    'renumber_title': { en: 'Renumber node order sequentially (0,1,2,...) by current position', ru: 'Перенумеровать порядок узлов (0,1,2,...) по текущей позиции' },
    'clear_edges': { en: 'Clear edges', ru: 'Очистить рёбра' },
    'visible_range': { en: 'Visible range (by order):', ru: 'Видимый диапазон (по порядку):' },
    'range_start': { en: 'Start', ru: 'Начало' },
    'range_end': { en: 'End', ru: 'Конец' },
    'range_start_title': { en: 'Start of visible node order range', ru: 'Начало видимого диапазона порядка узлов' },
    'range_end_title': { en: 'End of visible node order range (inclusive)', ru: 'Конец видимого диапазона порядка узлов (включительно)' },
    'apply_range_title': { en: 'Apply visible range filter to matrix, edge list, and graph', ru: 'Применить фильтр видимого диапазона к матрице, списку рёбер и графу' },
    'show_all': { en: 'Show all', ru: 'Показать все' },
    'show_all_title': { en: 'Show all nodes (clear visible range)', ru: 'Показать все узлы (очистить видимый диапазон)' },
    'no_nodes_yet': { en: 'No nodes yet.', ru: 'Узлов пока нет.' },
    'no_edges_yet': { en: 'No edges yet.', ru: 'Рёбер пока нет.' },
    'no_nodes_range': { en: 'No nodes in visible range.', ru: 'Нет узлов в видимом диапазоне.' },
    'no_edges_range': { en: 'No edges in visible range.', ru: 'Нет рёбер в видимом диапазоне.' },
    'n_edges': { en: '{n} edge(s)', ru: '{n} ребр(о)' },
    'n_edges_filtered': { en: '{n}/{m} edge(s) (filtered by visible range)', ru: '{n}/{m} ребр(о) (фильтр по диапазону)' },

    // --- Edge list ---
    'edge_list': { en: 'Edge list', ru: 'Список рёбер' },
    'col_num': { en: '#', ru: '№' },
    'col_id': { en: 'ID', ru: 'ID' },
    'col_from': { en: 'From', ru: 'От' },
    'col_to': { en: 'To', ru: 'К' },
    'col_weight': { en: 'Weight', ru: 'Вес' },
    'col_label': { en: 'Label', ru: 'Метка' },
    'col_type': { en: 'Type', ru: 'Тип' },
    'col_dir': { en: 'Dir', ru: 'Напр' },
    'col_stroke': { en: 'Stroke', ru: 'Обводка' },
    'move_up': { en: 'Move up', ru: 'Переместить вверх' },
    'move_down': { en: 'Move down', ru: 'Переместить вниз' },
    'sort_edge_id': { en: 'Sort by ID', ru: 'Сорт. по ID' },
    'sort_edge_from': { en: 'Sort by from', ru: 'Сорт. по источнику' },
    'sort_edge_to': { en: 'Sort by to', ru: 'Сорт. по цели' },
    'sort_edge_id_title': { en: 'Sort edges by ID', ru: 'Сортировать рёбра по ID' },
    'sort_edge_from_title': { en: 'Sort edges by source node order', ru: 'Сортировать рёбра по порядку источника' },
    'sort_edge_to_title': { en: 'Sort edges by target node order', ru: 'Сортировать рёбра по порядку цели' },

    // --- Presets overlay ---
    'style_presets': { en: 'Style presets', ru: 'Пресеты стилей' },
    'save_from_sel': { en: 'Save from selection', ru: 'Сохранить из выделения' },
    'close': { en: 'Close', ru: 'Закрыть' },
    'presets_desc': { en: 'Click a preset to apply its style to the current selection. Use "Save from selection" with a node or edge selected to create a new preset.', ru: 'Кликните по пресету для применения стиля к выделению. Используйте "Сохранить из выделения" с выбранным узлом или ребром для создания нового пресета.' },
    'no_presets': { en: 'No presets yet. Select a node or edge and click "Save from selection".', ru: 'Пресетов пока нет. Выберите узел или ребро и нажмите "Сохранить из выделения".' },

    // --- Export modal ---
    'append': { en: 'Append', ru: 'Добавить' },
    'import_btn': { en: 'Import', ru: 'Импорт' },
    'download': { en: 'Download', ru: 'Скачать' },
    'export_modal_desc': { en: 'Editable — modify the text, or paste content here when clipboard read is blocked, then click Import.', ru: 'Редактируемо — измените текст или вставьте содержимое здесь при блокировке чтения буфера, затем нажмите Импорт.' },

    // --- Multi-select panel ---
    'selected_n_m': { en: 'Selected {n} node(s) and {m} edge(s).', ru: 'Выбрано {n} узл(ов) и {m} ребр(о).' },
    'nodes_n': { en: 'Nodes ({n})', ru: 'Узлы ({n})' },
    'edges_n': { en: 'Edges ({n})', ru: 'Рёбра ({n})' },
  },

  // === Динамические строки (toast, prompt, и т.д.) ===
  dynamic: {
    'undone': { en: 'Undone', ru: 'Отменено' },
    'redone': { en: 'Redone', ru: 'Повторено' },
    'node_added_circle': { en: 'Node added on circle', ru: 'Узел добавлен по кругу' },
    'inserted_n_before': { en: 'Inserted {n} node(s) before selected, arranged in a circle', ru: 'Вставлено {n} узл(ов) перед выбранными по кругу' },
    'matrix_expanded': { en: 'Matrix expanded to {n}×{n}; existing graph preserved', ru: 'Матрица расширена до {n}×{n}; существующий граф сохранён' },
    'matrix_view_set': { en: 'Matrix view set to {n}×{n}; existing {m}-node graph preserved', ru: 'Вид матрицы установлен {n}×{n}; существующий {m}-узл. граф сохранён' },
    'matrix_unchanged': { en: 'Matrix set to {n}×{n}; graph unchanged', ru: 'Матрица установлена {n}×{n}; граф без изменений' },
    'node_order_renumbered': { en: 'Node order renumbered', ru: 'Порядок узлов перенумерован' },
    'nodes_sorted_id': { en: 'Nodes sorted by ID', ru: 'Узлы отсортированы по ID' },
    'nodes_sorted_label': { en: 'Nodes sorted by label', ru: 'Узлы отсортированы по метке' },
    'edges_sorted_id': { en: 'Edges sorted by ID', ru: 'Рёбра отсортированы по ID' },
    'edges_sorted_from': { en: 'Edges sorted by source', ru: 'Рёбра отсортированы по источнику' },
    'edges_sorted_to': { en: 'Edges sorted by target', ru: 'Рёбра отсортированы по цели' },
    'deleted_n_m': { en: 'Deleted {n} node(s) and {m} edge(s)', ru: 'Удалено {n} узл(ов) и {m} ребр(о)' },
    'selected_n_m': { en: 'Selected {n} node(s) and {m} edge(s)', ru: 'Выбрано {n} узл(ов) и {m} ребр(о)' },
    'polygon_selected': { en: 'Polygon selected {n} node(s) and {m} edge(s)', ru: 'Многоугольником выбрано {n} узл(ов) и {m} ребр(о)' },
    'polygon_needs_3': { en: 'Polygon needs at least 3 points', ru: 'Многоугольнику нужно минимум 3 точки' },
    'select_at_least_one': { en: 'Select at least one node first.', ru: 'Сначала выберите хотя бы один узел.' },
    'selected_adjacent': { en: 'Selected adjacent items', ru: 'Выбраны смежные элементы' },
    'selected_directed_adj': { en: 'Selected directed adjacent items', ru: 'Выбраны направленные смежные элементы' },
    'imported': { en: '{label} imported', ru: '{label} импортирован' },
    'imported_n_edges': { en: 'Imported {n} edge(s)', ru: 'Импортировано {n} ребр(о)' },
    'imported_n_nodes': { en: 'Imported {n} node(s)', ru: 'Импортировано {n} узл(ов)' },
    'no_edge_data': { en: 'No edge data', ru: 'Нет данных рёбер' },
    'no_matrix_data': { en: 'No matrix data', ru: 'Нет данных матрицы' },
    'no_node_data': { en: 'No node data', ru: 'Нет данных узлов' },
    'csv_needs_cols': { en: 'CSV needs source_id and target_id columns', ru: 'CSV требует колонки source_id и target_id' },
    'clipboard_empty': { en: 'Clipboard is empty', ru: 'Буфер обмена пуст' },
    'paste_failed': { en: 'Paste failed: {msg}', ru: 'Ошибка вставки: {msg}' },
    'import_failed': { en: 'Import failed: {msg}', ru: 'Ошибка импорта: {msg}' },
    'could_not_import': { en: 'Could not import file: {msg}', ru: 'Не удалось импортировать файл: {msg}' },
    'copied': { en: 'Copied', ru: 'Скопировано' },
    'download_hint': { en: 'Download "{name}" — if nothing happened, tap "Copy" instead', ru: 'Скачивание "{name}" — если ничего не произошло, нажмите "Копировать"' },
    'textarea_empty': { en: 'Textarea is empty', ru: 'Поле пусто' },
    'sample_loaded': { en: 'Sample graph loaded', ru: 'Загружен пример графа' },
    'replace_with_sample': { en: 'Replace current graph with a sample?', ru: 'Заменить текущий граф примером?' },
    'replace_with_import': { en: 'Replace current graph with imported file?', ru: 'Заменить текущий граф импортированным файлом?' },
    'clear_entire': { en: 'Clear the entire graph?', ru: 'Очистить весь граф?' },
    'clear_matrix_edges': { en: 'Clear all edges in the adjacency matrix?', ru: 'Очистить все рёбра в матрице смежности?' },
    'node_defaults_applied': { en: 'Node defaults applied to all', ru: 'Умолчания узлов применены ко всем' },
    'edge_defaults_applied': { en: 'Edge defaults applied to all', ru: 'Умолчания рёбер применены ко всем' },
    'saved_style_type': { en: 'Saved style for type "{type}"', ru: 'Сохранён стиль для типа "{type}"' },
    'deleted_style_type': { en: 'Deleted style for type "{type}"', ru: 'Удалён стиль для типа "{type}"' },
    'cleared_overrides_n': { en: 'Cleared overrides on {n} node(s)', ru: 'Очищены переопределения на {n} узл(ах)' },
    'no_nodes_type': { en: 'No nodes with that type', ru: 'Нет узлов этого типа' },
    'cleared_overrides_e': { en: 'Cleared overrides on {n} edge(s)', ru: 'Очищены переопределения на {n} ребр(ах)' },
    'no_edges_type': { en: 'No edges with that type', ru: 'Нет рёбер этого типа' },
    'enter_type_first': { en: 'Enter a type name first', ru: 'Сначала введите имя типа' },
    'select_nodes_edges': { en: 'Select nodes or edges first', ru: 'Сначала выберите узлы или рёбра' },
    'select_node_edge': { en: 'Select a node or edge first', ru: 'Сначала выберите узел или ребро' },
    'preset_applied': { en: 'Preset "{name}" applied to {what}', ru: 'Пресет "{name}" применён к {what}' },
    'preset_saved': { en: 'Preset "{name}" saved', ru: 'Пресет "{name}" сохранён' },
    'preset_name': { en: 'Preset name:', ru: 'Имя пресета:' },
    'preset': { en: 'preset', ru: 'пресет' },
    'camera_updated': { en: 'Camera updated', ru: 'Камера обновлена' },
    'camera_reset': { en: 'Camera reset to 100%', ru: 'Камера сброшена на 100%' },
    'centered_on': { en: 'Centered on {name}', ru: 'Центр на {name}' },
    'select_single_node': { en: 'Select a single node first to center on it', ru: 'Сначала выберите один узел для центрирования' },
    'hotkeys_reset': { en: 'Hotkeys reset to defaults', ru: 'Горячие клавиши сброшены' },
    'source_selected': { en: 'Source {name} selected: tap target', ru: 'Источник {name} выбран: нажмите цель' },
    'source_tap_target': { en: 'Source selected. Tap a target node.', ru: 'Источник выбран. Нажмите целевой узел.' },
    'node_label_prompt': { en: 'Node label:', ru: 'Метка узла:' },
    'edge_weight_prompt': { en: 'Edge weight:', ru: 'Вес ребра:' },
    'drag_to_target': { en: 'Drag to a target node…', ru: 'Перетащите к целевому узлу…' },
    'pinch_zoom_pan': { en: 'Pinch: zoom and pan', ru: 'Щипок: зум и панор.' },
    'pan_mode': { en: 'Pan mode', ru: 'Режим панор.' },
    'move_mode_drag': { en: 'Move mode: drag canvas to pan', ru: 'Режим перемещения: перетащите холст' },
    'node_mode_click': { en: 'Node mode: click canvas to add', ru: 'Режим узла: клик по холсту' },
    'edge_mode_drag': { en: 'Edge mode: drag node to node', ru: 'Режим ребра: перетащите узел к узлу' },
    'select_mode': { en: 'Select mode', ru: 'Режим выбора' },
    'select_tool_mode': { en: '{tool} select mode', ru: 'Режим выбора {tool}' },
    'selection_tool': { en: '{tool} selection…', ru: 'Выделение {tool}…' },
    'n_nodes_m_edges': { en: '{n} node(s) · {m} edge(s)', ru: '{n} узл(ов) · {m} ребр(о)' },
    'no_start_node': { en: 'No start node.', ru: 'Нет стартового узла.' },
    'bfs_order': { en: 'BFS order:', ru: 'Порядок BFS:' },
    'dfs_order': { en: 'DFS order:', ru: 'Порядок DFS:' },
    'dijkstra_from': { en: 'Dijkstra distances from {name}:', ru: 'Расстояния Дейкстры от {name}:' },
    'components_n': { en: 'Weakly connected components ({n}):', ru: 'Слабо связные компоненты ({n}):' },
    'topo_order': { en: 'Topological order:', ru: 'Топологический порядок:' },
    'topo_cycle': { en: 'The directed graph has at least one cycle; no topological ordering exists.', ru: 'Ориентированный граф имеет цикл; топологическая сортировка невозможна.' },
    'topo_undirected': { en: 'Topological sort requires all edges to be directed.', ru: 'Топологическая сортировка требует все рёбра направленные.' },
    'graph_statistics': { en: 'Graph statistics', ru: 'Статистика графа' },
    'nodes_label': { en: 'Nodes:', ru: 'Узлы:' },
    'edges_label': { en: 'Edges:', ru: 'Рёбра:' },
    'density': { en: 'Density:', ru: 'Плотность:' },
    'highest_degree': { en: 'Highest degree:', ru: 'Наибольшая степень:' },
    'na': { en: 'n/a', ru: 'н/д' },
    'language_switched': { en: 'Language: English', ru: 'Язык: Русский' },
  },

  // Текущий язык
  current: 'en',

  // Получить перевод строки по ключу
  t(key, params = {}) {
    const entry = this.strings[key] || this.dynamic[key];
    if (!entry) return key;
    let s = entry[this.current] || entry.en || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
      }
    }
    return s;
  },

  // Применить переводы ко всем элементам с data-i18n
  applyAll() {
    document.documentElement.lang = this.current;
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = this.t(key);
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      el.setAttribute('title', this.t(key));
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      el.setAttribute('placeholder', this.t(key));
    });
    document.querySelectorAll<HTMLElement>('[data-i18n-value]').forEach(el => {
      const key = el.dataset.i18nValue;
      el.setAttribute('value', this.t(key));
    });
    // HTML translations (for elements with inline formatting like <b> tags)
    document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
      const key = el.dataset.i18nHtml;
      el.innerHTML = this.t(key);
    });
    // Обновить кнопку языка
    const btn = document.getElementById('btnLang');
    if (btn) btn.textContent = '🌐 ' + (this.current === 'en' ? 'RU' : 'EN');
    // Обновить title документа
    const titleInput = document.getElementById('docTitleInput') as HTMLInputElement | null;
    if (titleInput && (titleInput.value === 'untitled' || titleInput.value === 'безымянный')) {
      titleInput.value = this.t('doc_title');
    }
  },

  // Переключить язык
  toggle() {
    this.current = this.current === 'en' ? 'ru' : 'en';
    try { localStorage.setItem('graph-editor-lang', this.current); } catch {}
    this.applyAll();
    // Триггерим перерисовку для динамического контента
    window.dispatchEvent(new Event('i18n-change'));
  },

  // Загрузить сохранённый язык
  load() {
    try {
      const saved = localStorage.getItem('graph-editor-lang');
      if (saved === 'ru' || saved === 'en') this.current = saved;
    } catch {}
  }
};
