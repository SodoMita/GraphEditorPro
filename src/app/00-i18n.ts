// Система переводов для Graph Editor Pro
// Поддерживаемые языки: en, ru
const I18N: I18nService = {
  // === Счётные существительные (склонение по числу) ===
  // Строки вида '{n:node}' подставляют число вместе с правильной формой слова:
  // en → 1 node / 3 nodes, ru → 1 узел / 3 узла / 5 узлов.
  nouns: {
    en: {
      node: ['node', 'nodes'],
      edge: ['edge', 'edges'],
      pass: ['pass', 'passes'],
      point: ['point', 'points'],
    },
    ru: {
      node: ['узел', 'узла', 'узлов'],
      edge: ['ребро', 'ребра', 'рёбер'],
      pass: ['проход', 'прохода', 'проходов'],
      point: ['точка', 'точки', 'точек'],
    },
  },

  // === Статические тексты HTML (по data-i18n ключу) ===
  strings: {
    // --- Topbar / toolbar ---
    'brand_name': { en: 'Graph Editor Pro', ru: 'Graph Editor Pro' },
    'doc_title': { en: 'untitled', ru: 'безымянный' },
    'view_graph': { en: 'Graph', ru: 'Граф' },
    'view_matrix': { en: 'Matrix', ru: 'Матрица' },
    'view_edges': { en: 'Edges', ru: 'Рёбра' },
    'view_graph_title': { en: 'Show/hide graph canvas', ru: 'Показать/скрыть холст' },
    'view_matrix_title': { en: 'Show/hide adjacency matrix', ru: 'Показать/скрыть матрицу смежности' },
    'view_edges_title': { en: 'Show/hide edge list', ru: 'Показать/скрыть список рёбер' },
    'view_keep_last': { en: 'At least one view must stay visible', ru: 'Хотя бы один вид должен оставаться видимым' },
    'orient_toggle': { en: 'Toggle split orientation (vertical/horizontal)', ru: 'Переключить ориентацию разделения (вертикально/горизонтально)' },
    'orient_to_h': { en: 'Switch to horizontal split (canvas left, panels right)', ru: 'Горизонтальное разделение (холст слева, панели справа)' },
    'orient_to_v': { en: 'Switch to vertical split (canvas on top, panels below)', ru: 'Вертикальное разделение (холст сверху, панели снизу)' },
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
    'tab_algo': { en: 'Algo', ru: 'Алгоритмы' },
    'tab_data': { en: 'Data', ru: 'Данные' },
    'tab_help': { en: 'Help', ru: 'Справка' },

    // --- Navigation ---
    'menu_open': { en: 'Open tools and properties', ru: 'Открыть инструменты и свойства' },
    'panel_close': { en: 'Close panels', ru: 'Закрыть панели' },
    'tools_panel': { en: 'Tools and properties', ru: 'Инструменты и свойства' },
    'behavior_grid': { en: 'Behavior & grid', ru: 'Поведение и сетка' },
    // --- Groups / landmarks (aria-labels, подписи областей) ---
    'group_doc_name': { en: 'Document name', ru: 'Имя документа' },
    'group_doc_commands': { en: 'Document commands', ru: 'Команды документа' },
    'group_view_switcher': { en: 'View switcher', ru: 'Переключение видов' },
    'group_tool_panels': { en: 'Tool panels', ru: 'Панели инструментов' },
    'group_zoom_controls': { en: 'Zoom controls', ru: 'Управление масштабом' },
    'group_edit_modes': { en: 'Edit modes', ru: 'Режимы редактирования' },
    'group_edge_tools': { en: 'Edge tools', ru: 'Инструменты рёбер' },
    'group_selection_tools': { en: 'Selection tools', ru: 'Инструменты выделения' },

    // --- Algo tab: buttons ---
    'algo_components': { en: 'Components', ru: 'Компоненты' },
    'algo_topological': { en: 'Topological', ru: 'Топология' },
    'algo_stats': { en: 'Stats', ru: 'Статистика' },
    'algo_bfs_title': { en: 'Breadth-first search order from the start node', ru: 'Обход в ширину (BFS) от стартового узла' },
    'algo_dfs_title': { en: 'Depth-first search order from the start node', ru: 'Обход в глубину (DFS) от стартового узла' },
    'algo_dijkstra_title': { en: 'Shortest-path distances from the start node', ru: 'Кратчайшие расстояния от стартового узла (Дейкстра)' },

    // --- Style tab: weight-range field labels ---
    'weight_min': { en: 'Weight min', ru: 'Мин. вес' },
    'weight_max': { en: 'Weight max', ru: 'Макс. вес' },

    // --- Edit tab: Mode ---
    'mode_title': { en: 'Mode', ru: 'Режим' },
    'mode_select': { en: 'Select', ru: 'Выбор' },
    'mode_move': { en: 'Move', ru: 'Перемещение' },
    'mode_node': { en: 'Node', ru: 'Узел' },
    'mode_edge': { en: 'Edge', ru: 'Ребро' },
    'mode_select_title': { en: 'Select and move nodes', ru: 'Выбирать и перемещать узлы' },
    'mode_move_title': { en: 'Pan the canvas by dragging', ru: 'Панорамировать холст перетаскиванием' },
    'mode_node_title': { en: 'Click canvas to add nodes', ru: 'Клик по холсту добавляет узлы' },
    'mode_edge_title': { en: 'Drag from a node to another node or empty canvas', ru: 'Перетащить от узла к другому узлу или на пустой холст' },
    'flip_selected_edges': { en: 'Flip selected directed edges', ru: 'Развернуть выбранные направленные рёбра' },
    'mode_tip': { en: 'Tip: use Move mode or hold Space to pan. Pinch the canvas to zoom/pan on touch screens.', ru: 'Подсказка: панорамируйте в режиме «Перемещение» или удерживая Пробел. На сенсорных экранах масштабируйте щипком.' },

    // --- Edit tab: Selection ---
    'canvas_selection': { en: 'Canvas selection', ru: 'Выделение на холсте' },
    'sel_single': { en: 'Single', ru: 'Одиночное выделение' },
    'sel_rect': { en: 'Rect', ru: 'Прямоугольник' },
    'sel_brush': { en: 'Brush', ru: 'Кисть' },
    'sel_lasso': { en: 'Lasso', ru: 'Лассо' },
    'sel_line': { en: 'Line', ru: 'Линия' },
    'sel_polygon': { en: 'Polygon', ru: 'Многоугольник' },
    'sel_adjacent': { en: 'Adjacent', ru: 'Смежные' },
    'sel_directed_adj': { en: 'Directed adjacent', ru: 'Смежные по направлению' },
    'sel_result': { en: 'Selection result', ru: 'Результат выделения' },
    'sel_override': { en: 'Override', ru: 'Замена' },
    'sel_add': { en: 'Add', ru: 'Добавить' },
    'sel_subtract': { en: 'Subtract', ru: 'Вычесть' },
    'sel_override_title': { en: 'Replace current selection', ru: 'Заменить текущее выделение' },
    'sel_add_title': { en: 'Add to current selection', ru: 'Добавить к текущему выделению' },
    'sel_subtract_title': { en: 'Remove from current selection', ru: 'Вычесть из текущего выделения' },
    'brush_diameter': { en: 'Brush diameter', ru: 'Диаметр кисти' },
    'hit_test': { en: 'Selection hit target', ru: 'Зона срабатывания' },
    'hit_any': { en: 'Any part', ru: 'Любая часть' },
    'hit_center': { en: 'Centres', ru: 'Центры' },
    'hit_any_title': { en: 'Select nodes or edges by any part', ru: 'Выбирать узлы и рёбра по любой части' },
    'hit_center_title': { en: 'Select only at exact centres', ru: 'Выбирать только по точным центрам' },
    'sel_tip': { en: 'Selection tools work in Select mode. Use Override/Add/Subtract; Shift temporarily adds to the current selection. Polygon uses clicks; click the first point or double-click to close.', ru: 'Инструменты выделения работают в режиме «Выбор». Режим «Результат выделения» задаёт, что делать с текущим выделением: заменить, добавить или вычесть; Shift временно добавляет к выделению. Многоугольник строится кликами — замкните его кликом по первой точке или двойным кликом.' },
    // --- Selection transform gizmo ---
    'gizmo_tools': { en: 'Transform gizmo tools', ru: 'Инструменты гизмо трансформации' },
    'gizmo_move': { en: 'Translate selected nodes: drag the arrows or the centre', ru: 'Перемещение выбранных узлов: тяните стрелки или центр' },
    'gizmo_rotate': { en: 'Rotate selected nodes around the pivot (Shift = 15° steps)', ru: 'Вращение выбранных узлов вокруг точки опоры (Shift = шаг 15°)' },
    'gizmo_scale': { en: 'Scale selected node positions from the pivot (node sizes unchanged)', ru: 'Масштаб позиций выбранных узлов от точки опоры (размеры узлов не меняются)' },
    'gizmo_rect': { en: 'Rect: stretch selected node positions with the bounding box (Alt = from centre, Shift = keep aspect)', ru: 'Прямоугольник: растягивать позиции выбранных узлов рамкой (Alt = от центра, Shift = сохранять пропорции)' },
    'gizmo_enabled': { en: 'Show transform gizmo for the selection (translate / rotate / scale / rect — positions only)', ru: 'Показывать гизмо трансформации выделения (перемещение / вращение / масштаб / рамка — только позиции)' },
    'gizmo_pivot': { en: 'Pivot — drag to move the rotation/scale centre, double-click to reset', ru: 'Точка опоры — перетащите, чтобы сместить центр вращения/масштаба, двойной клик — сброс' },
    'gizmo_section': { en: 'Transform gizmo', ru: 'Гизмо трансформации' },
    'gizmo_section_sub': { en: '(positions only)', ru: '(только позиции)' },
    'gizmo_move_label': { en: 'Move', ru: 'Перемещение' },
    'gizmo_rotate_label': { en: 'Rotate', ru: 'Вращение' },
    'gizmo_scale_label': { en: 'Scale', ru: 'Масштаб' },
    'gizmo_rect_label': { en: 'Rect', ru: 'Рамка' },
    'gizmo_note': { en: 'Drag the on-canvas handles to transform the selected nodes (or a selected edge’s endpoints). Only positions change; sizes, shapes, labels, colours and edge styles stay untouched.', ru: 'Перетаскивайте маркеры на холсте, чтобы преобразовать выбранные узлы (или концы выбранного ребра). Меняются только позиции; размеры, формы, подписи, цвета и стили рёбер не затрагиваются.' },
    'gizmo_keys': { en: 'Keys 1–4 choose a tool; G shows/hides the gizmo. Drag the white pivot in Rotate/Scale/Rect to move the transform centre (double-click resets). Shift snaps rotation and locks proportions; Alt rect-stretches from the centre; Esc cancels; arrows nudge.', ru: 'Клавиши 1–4 выбирают инструмент; G показывает/скрывает гизмо. Белую точку опоры в Вращении/Масштабе/Рамке можно перетаскивать (двойной клик — сброс). Shift — шаг поворота и пропорции; Alt — рамка от центра; Esc — отмена; стрелки сдвигают выделение.' },
    'gizmo_active': { en: 'Active: {mode} · {n} target node(s) · positions only', ru: 'Активно: {mode} · затронуто {n:node} · только позиции' },
    'gizmo_no_selection': { en: 'Select nodes (or an edge) in Select mode to transform their positions.', ru: 'Выделите узлы (или ребро) в режиме Выбора, чтобы изменить их позиции.' },
    'gizmo_hidden': { en: 'Gizmo hidden — press G or enable “Show transform gizmo”.', ru: 'Гизмо скрыто — нажмите G или включите «Показывать гизмо трансформации».' },

    // --- Edit tab: Node placement ---
    'node_placement': { en: 'Node placement', ru: 'Размещение узлов' },
    'node_placement_sub': { en: '(values for newly added nodes)', ru: '(значения для новых узлов)' },
    'shape': { en: 'Shape', ru: 'Форма' },
    'color': { en: 'Color', ru: 'Цвет' },
    'width': { en: 'Width', ru: 'Ширина' },
    'height': { en: 'Height', ru: 'Высота' },
    'stroke_color': { en: 'Stroke color', ru: 'Цвет обводки' },
    'stroke_size': { en: 'Stroke size', ru: 'Толщина обводки' },
    'stroke_style': { en: 'Stroke style', ru: 'Стиль обводки' },
    'type': { en: 'Type', ru: 'Тип' },
    'label_prefix': { en: 'Label prefix / exact label', ru: 'Префикс метки / точная метка' },
    'label_color': { en: 'Label color', ru: 'Цвет метки' },
    'label_font': { en: 'Label font', ru: 'Шрифт метки' },
    'label_size': { en: 'Label size', ru: 'Размер метки' },
    'label_pos': { en: 'Label position', ru: 'Положение метки' },
    'inherit_defaults': { en: 'New nodes inherit Style-tab defaults (unset visual properties)', ru: 'Новые узлы наследуют значения вкладки «Стиль» (визуальные свойства не заданы)' },
    'inherit_defaults_desc': { en: 'When on, new nodes have unset visual properties and follow Style-tab defaults dynamically. Turn off to bake the values above into each new node.', ru: 'Когда включено, новые узлы не имеют собственных визуальных свойств и следуют значениям вкладки «Стиль». Выключите, чтобы закрепить значения выше за каждым новым узлом.' },
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
    'shape_triangleUp': { en: 'Triangle up', ru: 'Треугольник вверх' },
    'shape_triangleDown': { en: 'Triangle down', ru: 'Треугольник вниз' },
    'shape_hexagon': { en: 'Hexagon', ru: 'Шестиугольник' },

    // --- Stroke styles --- (QVGE-compatible: CUtils::penStyleToText)
    'stroke_solid': { en: 'Solid', ru: 'Сплошная' },
    'stroke_dashed': { en: 'Dashed', ru: 'Штриховая' },
    'stroke_dotted': { en: 'Dotted', ru: 'Пунктирная' },
    'stroke_dashdot': { en: 'Dash-dot', ru: 'Штрих-пунктирная' },
    'stroke_dashdotdot': { en: 'Dash-dot-dot', ru: 'Штрих-два пунктира' },
    'stroke_none': { en: 'None', ru: 'Без обводки' },
    'stroke_inherit': { en: 'Inherit', ru: 'Наследовать' },

    // --- Label positions ---
    'pos_center': { en: 'Center', ru: 'Центр' },
    'pos_top': { en: 'Top', ru: 'Сверху' },
    'pos_bottom': { en: 'Bottom', ru: 'Снизу' },
    'pos_left': { en: 'Left', ru: 'Слева' },
    'pos_right': { en: 'Right', ru: 'Справа' },

    // --- Edit tab: Edge defaults ---
    'edge_defaults': { en: 'New edge defaults', ru: 'Новые рёбра по умолчанию' },
    'weight': { en: 'Weight', ru: 'Вес' },
    'label': { en: 'Label', ru: 'Метка' },
    'directed_edge': { en: 'Directed edge', ru: 'Направленное ребро' },
    'none_placeholder': { en: 'none', ru: 'нет' },
    'auto_label_placeholder': { en: 'Auto: A, B, C…', ru: 'Авто: A, B, C…' },
    'optional_placeholder': { en: 'Optional', ru: 'Необязательно' },
    'end_placeholder': { en: 'end', ru: 'конец' },

    // --- Edit tab: Selection panel ---
    'selection': { en: 'Selection', ru: 'Выделение' },
    'nothing_selected': { en: 'Nothing selected.', ru: 'Ничего не выбрано.' },
    'adjacent': { en: 'Adjacent', ru: 'Смежные' },
    'directed_adj_short': { en: 'Directed adj.', ru: 'Смежные по выходу' },
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
    'graph_defaults': { en: 'Graph defaults', ru: 'Граф по умолчанию' },
    'labels_policy': { en: 'Labels policy', ru: 'Отображение меток' },
    'label_outline': { en: 'Label outline', ru: 'Контур меток' },
    'label_outline_mode_outline': { en: 'Outline', ru: 'Контур' },
    'label_outline_mode_plate': { en: 'Background plate', ru: 'Подложка' },
    'label_outline_mode_none': { en: 'None', ru: 'Без контура' },
    'label_outline_color': { en: 'Outline color', ru: 'Цвет контура' },
    'label_outline_width': { en: 'Outline width', ru: 'Толщина контура' },
    'labels_auto': { en: 'Auto (hide when many nodes)', ru: 'Авто (скрывать, если узлов много)' },
    'labels_on': { en: 'On (always show)', ru: 'Вкл (всегда показывать)' },
    'labels_off': { en: 'Off (never show)', ru: 'Выкл (никогда не показывать)' },
    'labels_policy_desc': { en: 'Auto hides labels when more than 30 nodes exist. Imported QVGE graphs with no labels stay unlabeled.', ru: 'В режиме «Авто» метки скрываются, если узлов больше 30. Импортированные графы QVGE без подписей остаются без подписей.' },
    'edge_weight_viz': { en: 'Edge weight visualization', ru: 'Визуализация веса рёбер' },
    'ew_number': { en: 'Show weight as number', ru: 'Показывать вес как число' },
    'ew_color': { en: 'Color gradient by weight', ru: 'Цветовой градиент по весу' },
    'ew_width': { en: 'Edge width by weight', ru: 'Толщина ребра по весу' },
    'ew_none': { en: 'No weight visualization', ru: 'Без визуализации веса' },
    'weight_range_min': { en: 'Weight range min', ru: 'Мин. вес' },
    'weight_range_max': { en: 'Weight range max', ru: 'Макс. вес' },
    'invert_note': { en: 'Min > max is valid — inverts the mapping (lower values give higher width/color).', ru: 'Мин. больше макс. — это допустимо: отображение инвертируется, и меньшие значения дают большую толщину и более яркий цвет.' },
    'corr_func': { en: 'Correlation function', ru: 'Функция корреляции' },
    'corr_linear': { en: 'Linear', ru: 'Линейная' },
    'corr_log': { en: 'Logarithmic', ru: 'Логарифмическая' },
    'corr_exp': { en: 'Exponential', ru: 'Экспоненциальная' },
    'corr_sqrt': { en: 'Square root', ru: 'Квадратный корень' },
    'edge_width_min': { en: 'Edge width min', ru: 'Мин. толщина' },
    'edge_width_max': { en: 'Edge width max', ru: 'Макс. толщина' },
    'gradient_low': { en: 'Gradient low color', ru: 'Цвет градиента (низ)' },
    'gradient_high': { en: 'Gradient high color', ru: 'Цвет градиента (верх)' },
    'range_clamp_note': { en: 'In color/width mode, weights outside the range are clamped; the number is shown as text fallback.', ru: 'В режимах «Цвет» и «Толщина» веса вне диапазона ограничиваются его границами; число показывается как текст.' },
    'canvas_bg': { en: 'Canvas background', ru: 'Фон холста' },
    'grid_minor_color': { en: 'Grid minor color', ru: 'Цвет мелкой сетки' },
    'grid_minor_alpha': { en: 'Grid minor alpha', ru: 'Прозрачность мелкой сетки' },
    'grid_major_color': { en: 'Grid major color', ru: 'Цвет крупной сетки' },
    'grid_major_alpha': { en: 'Grid major alpha', ru: 'Прозрачность крупной сетки' },

    'node_defaults': { en: 'Node defaults', ru: 'Узлы по умолчанию' },
    'edge_defaults_style': { en: 'Edge defaults', ru: 'Рёбра по умолчанию' },
    'apply_to_all_nodes': { en: 'Apply defaults to all nodes', ru: 'Применить ко всем узлам' },
    'apply_to_sel_nodes': { en: 'Apply defaults to selected', ru: 'Применить к выделению' },
    'apply_to_all_edges': { en: 'Apply defaults to all edges', ru: 'Применить ко всем рёбрам' },
    'apply_to_sel_edges': { en: 'Apply defaults to selected', ru: 'Применить к выделению' },
    'node_defaults_applied_sel': { en: 'Node defaults applied to {count:node}', ru: 'Значения по умолчанию применены: {count:node}' },
    'edge_defaults_applied_sel': { en: 'Edge defaults applied to {count:edge}', ru: 'Значения по умолчанию применены: {count:edge}' },
    'no_nodes_selected': { en: 'No nodes selected', ru: 'Нет выбранных узлов' },
    'no_edges_selected': { en: 'No edges selected', ru: 'Нет выбранных рёбер' },
    'type_styles_sub': { en: '(per-type overrides)', ru: '(переопределения по типу)' },
    'type_styles_desc': { en: 'Type a name, set style, then Save. Nodes with this type (and no per-node override) will use these visuals. Use "Clear per-node" to force type style to take effect.', ru: 'Введите имя, задайте стиль, затем Сохранить. Узлы этого типа (без своих переопределений) будут использовать этот вид. Используйте "Сбросить стиль узлов", чтобы применить стиль типа.' },
    'type_styles_desc_edge': { en: 'Type a name, set style, then Save. Edges with this type (and no per-edge override) will use these visuals.', ru: 'Введите имя, задайте стиль, затем Сохранить. Рёбра этого типа (без своих переопределений) будут использовать этот вид.' },
    'enter_type_name': { en: 'Type', ru: 'Тип' },
    'enter_type_placeholder': { en: 'enter type name', ru: 'введите имя типа' },
    'save': { en: 'Save', ru: 'Сохранить' },
    'delete_btn': { en: 'Delete', ru: 'Удалить' },
    'clear_per_node': { en: 'Clear per-node', ru: 'Сбросить стиль узлов' },
    'clear_per_node_title': { en: 'Clear per-node color/shape overrides so type style takes effect', ru: 'Сбросить переопределения цвета и формы узлов, чтобы применился стиль типа' },
    'clear_per_edge': { en: 'Clear per-edge', ru: 'Сбросить стиль рёбер' },
    'clear_per_edge_title': { en: 'Clear per-edge color overrides so type style takes effect', ru: 'Сбросить переопределения цвета рёбер, чтобы применился стиль типа' },
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
    'custom_attributes': { en: 'Custom attributes', ru: 'Пользовательские атрибуты' },
    'custom_attributes_help': { en: 'Define GraphML attributes for the graph, nodes, or edges.', ru: 'Определите атрибуты GraphML для графа, узлов или рёбер.' },
    'attribute_id': { en: 'Attribute ID (required)', ru: 'ID атрибута (обязательно)' },
    'attribute_scope': { en: 'Applies to', ru: 'Объект' },
    'attribute_type': { en: 'Type', ru: 'Тип' },
    'scope_graph': { en: 'Graph', ru: 'Граф' },
    'scope_node': { en: 'Node', ru: 'Узел' },
    'scope_edge': { en: 'Edge', ru: 'Ребро' },
    'add_attribute': { en: 'Add attribute', ru: 'Добавить атрибут' },
    'save_attribute': { en: 'Save', ru: 'Сохранить' },
    'attribute_id_empty': { en: 'Attribute ID cannot be empty.', ru: 'ID атрибута не может быть пустым.' },
    'attribute_id_duplicate': { en: 'An attribute with this ID already exists.', ru: 'Атрибут с таким ID уже существует.' },
    'attribute_id_reserved': { en: 'This ID is reserved for a built-in GraphML attribute.', ru: 'Этот ID зарезервирован встроенным атрибутом GraphML.' },
    'attribute_added': { en: 'Custom attribute added', ru: 'Пользовательский атрибут добавлен' },
    'attribute_updated': { en: 'Custom attribute updated', ru: 'Пользовательский атрибут изменён' },
    'attribute_deleted': { en: 'Custom attribute deleted', ru: 'Пользовательский атрибут удалён' },
    'import_export': { en: 'Import / export', ru: 'Импорт / экспорт' },
    'append_mode': { en: 'Append to current graph (keep existing nodes/edges, styles, and background)', ru: 'Добавить к текущему графу (сохранить существующие узлы, рёбра, стили и фон)' },
    'export_json': { en: 'Export JSON', ru: 'Экспорт JSON' },
    'copy_json': { en: 'Copy JSON', ru: 'Копировать JSON' },
    'paste_json': { en: 'Paste JSON', ru: 'Вставить JSON' },
    'import_json': { en: 'Import JSON', ru: 'Импорт JSON' },
    'export_dot': { en: 'Export DOT', ru: 'Экспорт DOT' },
    'copy_dot': { en: 'Copy DOT', ru: 'Копировать DOT' },
    'paste_dot': { en: 'Paste DOT', ru: 'Вставить DOT' },
    'import_dot': { en: 'Import DOT', ru: 'Импорт DOT' },
    'graphml': { en: 'GraphML', ru: 'GraphML' },
    'export_graphml': { en: 'Export GraphML', ru: 'Экспорт GraphML' },
    'copy_graphml': { en: 'Copy GraphML', ru: 'Копировать GraphML' },
    'paste_graphml': { en: 'Paste GraphML', ru: 'Вставить GraphML' },
    'import_graphml': { en: 'Import GraphML', ru: 'Импорт GraphML' },
    'edges_csv': { en: 'Edges CSV', ru: 'Рёбра CSV' },
    'export_edges_csv': { en: 'Export Edges CSV', ru: 'Экспорт рёбер CSV' },
    'copy_edges': { en: 'Copy Edges', ru: 'Копировать рёбра' },
    'paste_edges': { en: 'Paste Edges', ru: 'Вставить рёбра' },
    'matrix_csv': { en: 'Matrix CSV', ru: 'Матрица CSV' },
    'export_matrix_csv': { en: 'Export Matrix CSV', ru: 'Экспорт матрицы CSV' },
    'copy_matrix': { en: 'Copy Matrix', ru: 'Копировать матрицу' },
    'paste_matrix': { en: 'Paste Matrix', ru: 'Вставить матрицу' },
    'nodes_csv': { en: 'Nodes CSV', ru: 'Узлы CSV' },
    'export_nodes_csv': { en: 'Export Nodes CSV', ru: 'Экспорт узлов CSV' },
    'copy_nodes': { en: 'Copy Nodes', ru: 'Копировать узлы' },
    'paste_nodes': { en: 'Paste Nodes', ru: 'Вставить узлы' },
    'import_export_desc': { en: 'Every format supports export (preview + copy + download), clipboard copy, clipboard paste, and file import. Use "Append" to merge imported nodes/edges into the current graph without changing styles or background.', ru: 'Каждый формат поддерживает экспорт (предпросмотр + копирование + скачивание), копирование в буфер, вставку из буфера и импорт файла. Включите «Добавить», чтобы влить импортированные узлы и рёбра в текущий граф без изменения стилей и фона.' },
    'layout_view': { en: 'Layout and view', ru: 'Раскладка и вид' },
    'layout_circle': { en: 'Circle', ru: 'Круг' },
    'grid': { en: 'Grid', ru: 'Сетка' },
    'relax': { en: 'Relax', ru: 'Силовая' },
    'fit_view': { en: 'Fit view', ru: 'Вписать' },
    'center_on_sel': { en: 'Center on sel.', ru: 'Центрировать' },
    'center_on_sel_title': { en: 'Center the view on the single selected node', ru: 'Центрировать вид на выбранном узле' },
    'camera_position': { en: 'Camera position', ru: 'Позиция камеры' },
    'center_x': { en: 'Center X', ru: 'Центр X' },
    'center_y': { en: 'Center Y', ru: 'Центр Y' },
    'apply': { en: 'Apply', ru: 'Применить' },
    'fit': { en: 'Fit', ru: 'Вписать' },
    'reset_100': { en: 'Reset 100%', ru: 'Сброс до 100%' },
    'camera_width': { en: 'Width', ru: 'Ширина' },
    'camera_height': { en: 'Height', ru: 'Высота' },
    'camera_hint': { en: 'Width/Height control zoom (smaller = zoomed in). Apply pans and zooms precisely.', ru: 'Ширина и высота задают масштаб (меньше — ближе). «Применить» точно переносит и масштабирует вид.' },
    'reliability_options': { en: 'Reliability options', ru: 'Настройки надёжности' },
    'autosave': { en: 'Autosave to this browser', ru: 'Автосохранение в этом браузере' },
    'matrix_limit': { en: 'Matrix render limit', ru: 'Лимит отображения матрицы' },
    'edge_list_page_size': { en: 'Edge rows per page', ru: 'Строк рёбер на страницу' },
    'performance_limits_desc': { en: 'Raise these limits on faster computers. Large editable tables can temporarily block the browser.', ru: 'Увеличьте лимиты на быстрых компьютерах. Большие редактируемые таблицы могут временно заблокировать браузер.' },

    // --- Help tab ---
    'quick_help': { en: 'Quick help', ru: 'Краткая справка' },
    'help_node': { en: '<b>Node:</b> choose Node mode, then click the canvas. In Node mode you can also drag existing nodes to reposition them (Blender-style).', ru: '<b>Узел:</b> выберите режим Узел, затем кликните по холсту. В режиме Узел можно также перетаскивать существующие узлы (в стиле Blender).' },
    'help_edge': { en: '<b>Edge:</b> choose Edge mode, then drag from a source node to a target node. On touch screens, tap a source node, then tap a target node.', ru: '<b>Ребро:</b> выберите режим Ребро, затем перетащите от исходного узла к целевому. На сенсорных экранах — нажмите исходный, затем целевой узел.' },
    'help_move_nodes': { en: '<b>Move nodes:</b> choose Select or Node mode and drag nodes.', ru: '<b>Перемещение узлов:</b> выберите режим Выбор или Узел и перетаскивайте узлы.' },
    'help_gizmo': { en: '<b>Transform gizmo:</b> with nodes selected in Select mode, use the gizmo row (keys <span class="kbd">1</span>–<span class="kbd">4</span>) to translate, rotate, scale or rect-stretch the <i>positions</i> of the selected nodes — node sizes and styles never change. Drag the pivot dot in Rotate/Scale to move the rotation centre (double-click resets it). <span class="kbd">Shift</span> snaps rotation to 15° and locks scale/rect proportions; <span class="kbd">Alt</span> stretches the rect from its centre; <span class="kbd">Esc</span> cancels a gizmo drag. Arrow keys nudge the selection (Shift = bigger step; grid step when snap is on). Key <span class="kbd">G</span> shows/hides the gizmo.', ru: '<b>Гизмо трансформации:</b> когда узлы выбраны в режиме Выбор, строка гизмо (клавиши <span class="kbd">1</span>–<span class="kbd">4</span>) перемещает, вращает, масштабирует или растягивает рамкой <i>позиции</i> выбранных узлов — размеры и стили узлов не меняются. Точку опоры в Вращении/Масштабе можно перетащить, чтобы сместить центр (двойной клик — сброс). <span class="kbd">Shift</span> — шаг вращения 15° и фиксация пропорций; <span class="kbd">Alt</span> — растягивание рамки от центра; <span class="kbd">Esc</span> — отмена перетаскивания гизмо. Стрелки сдвигают выделение (Shift = больший шаг; при привязке — шаг сетки). Клавиша <span class="kbd">G</span> показывает/скрывает гизмо.' },
    'help_move_canvas': { en: '<b>Move canvas:</b> choose Move mode, hold <span class="kbd">Space</span>, or drag with <span class="kbd">RMB</span>/<span class="kbd">MMB</span> in any mode. On touch screens, pinch to zoom and pan.', ru: '<b>Перемещение холста:</b> выберите режим «Перемещение», удерживайте <span class="kbd">Пробел</span> или перетаскивайте холст <span class="kbd">ПКМ</span>/<span class="kbd">СКМ</span> в любом режиме. На сенсорных экранах масштабируйте и панорамируйте щипком.' },
    'help_center_edge': { en: '<b>Center on edge:</b> in Move mode, click an edge — the view centers on whichever endpoint is further from the current view center.', ru: '<b>Центрирование по ребру:</b> в режиме «Перемещение» нажмите на ребро — вид центрируется на том его конце, который дальше от центра экрана.' },
    'help_adjust_numbers': { en: '<b>Adjust numbers:</b> hover any numeric field with a ⇆ handle and drag horizontally to change the value (Shift = fine). Type directly to enter an exact value.', ru: '<b>Изменение чисел:</b> наведите на числовое поле с рукояткой ⇆ и тяните по горизонтали, чтобы изменить значение (Shift — точнее). Точное значение можно ввести вручную.' },
    'help_matrix_editing': { en: '<b>Matrix editing:</b> click a cell once to select it without triggering the keyboard; click again to edit it. This lets you select on mobile without the on-screen keyboard popping up.', ru: '<b>Редактирование матрицы:</b> кликните по ячейке один раз для выбора без вызова клавиатуры; кликните снова для редактирования. Это позволяет выбирать на мобильных без всплывающей клавиатуры.' },
    'help_zoom': { en: '<b>Zoom:</b> mouse wheel / trackpad over the canvas, or pinch on mobile/tablet. Camera position can also be set numerically in the Data tab.', ru: '<b>Масштаб:</b> колесо мыши или трекпад над холстом, щипок на мобильных и планшетах. Положение камеры можно задать числами во вкладке «Данные».' },
    'help_exports': { en: '<b>Exports:</b> every format (JSON, DOT, GraphML, Edges/Matrix/Nodes CSV) supports both file download and copy-to-clipboard.', ru: '<b>Экспорт:</b> каждый формат (JSON, DOT, GraphML, Рёбра/Матрица/Узлы CSV) поддерживает скачивание файла и копирование в буфер.' },
    'help_copy_paste': { en: '<b>Copy / paste selection:</b> <span class="kbd">Ctrl+C</span> copies the selected nodes with the edges between them, <span class="kbd">Ctrl+X</span> cuts, <span class="kbd">Ctrl+D</span> duplicates in place, <span class="kbd">Ctrl+V</span> pastes with an offset (also across tabs, via the system clipboard). Edges with only one endpoint in the selection are restored on paste when the other endpoint still exists — see "Preserve dangling edges" in the Edit tab.', ru: '<b>Копирование / вставка выделения:</b> <span class="kbd">Ctrl+C</span> копирует выбранные узлы с рёбрами между ними, <span class="kbd">Ctrl+X</span> вырезает, <span class="kbd">Ctrl+D</span> дублирует на месте, <span class="kbd">Ctrl+V</span> вставляет со смещением (также между вкладками, через системный буфер). Рёбра только с одним концом в выделении восстанавливаются при вставке, если второй конец существует — см. «Сохранять висящие рёбра» во вкладке Правка.' },
    'hotkeys': { en: 'Hotkeys', ru: 'Горячие клавиши' },
    'reset_defaults': { en: 'Reset to defaults', ru: 'Сбросить по умолчанию' },
    'hotkeys_desc': { en: 'Click a key field, then press any key. Backspace/Delete clears. Escape cancels. Undo/Redo are prefixed with Ctrl/⌘ automatically.', ru: 'Нажмите на поле клавиши и введите новую комбинацию. Backspace/Delete очищает поле, Escape отменяет ввод. К «Отменить» и «Повторить» сочетание Ctrl/⌘ добавляется автоматически.' },
    'hk_gizmo_move': { en: 'Gizmo: translate', ru: 'Гизмо: перемещение' },
    'hk_gizmo_rotate': { en: 'Gizmo: rotate', ru: 'Гизмо: вращение' },
    'hk_gizmo_scale': { en: 'Gizmo: scale', ru: 'Гизмо: масштаб' },
    'hk_gizmo_rect': { en: 'Gizmo: rect', ru: 'Гизмо: рамка' },
    'hk_gizmo_toggle': { en: 'Gizmo: show/hide', ru: 'Гизмо: показать/скрыть' },
    'hk_select': { en: 'Select mode', ru: 'Режим выбора' },
    'hk_move': { en: 'Move mode', ru: 'Режим перемещения' },
    'hk_node': { en: 'Node mode', ru: 'Режим узла' },
    'hk_edge': { en: 'Edge mode', ru: 'Режим ребра' },
    'hk_delete': { en: 'Delete selection', ru: 'Удалить выбранное' },
    'hk_pan': { en: 'Pan (hold)', ru: 'Панорамирование (удерживать)' },
    'hk_undo': { en: 'Undo (Ctrl+)', ru: 'Отменить (Ctrl/⌘)' },
    'hk_redo': { en: 'Redo (Ctrl+)', ru: 'Повторить (Ctrl/⌘)' },
    'whats_improved': { en: "What's improved", ru: 'Что улучшено' },
    'improved_1': { en: 'Single-file/offline preview: no external fonts, CSS, or icons required.', ru: 'Один файл, работа офлайн: внешние шрифты, CSS и иконки не нужны.' },
    'improved_2': { en: 'Robust undo/redo, autosave, import validation, and safe CSV downloads.', ru: 'Надёжные отмена и повтор, автосохранение, проверка импорта и безопасное скачивание CSV.' },
    'improved_3': { en: 'Pan/zoom canvas, snap-to-grid, fit view, and layout helpers.', ru: 'Панорамирование и масштабирование холста, привязка к сетке, вписывание вида и раскладки.' },
    'improved_4': { en: 'CSV exports for edges, nodes, and adjacency matrix; copy-to-clipboard for every format.', ru: 'CSV-экспорт рёбер, узлов и матрицы смежности; копирование в буфер для каждого формата.' },
    'improved_5': { en: 'Blender-style drag-to-change numeric inputs for node coordinates.', ru: 'Изменение координат узлов перетаскиванием чисел — как в Blender.' },
    'improved_6': { en: 'Configurable hotkeys, camera position inputs, and center-on-selection.', ru: 'Настраиваемые горячие клавиши, ввод позиции камеры и центрирование на выделении.' },
    'improved_7': { en: 'Matrix cells require a selection click before editing — no more mobile-keyboard surprises.', ru: 'Ячейку матрицы сначала нужно выбрать кликом и только потом править — экранная клавиатура больше не выскакивает неожиданно.' },

    // --- Canvas HUD ---
    'ready': { en: 'Ready', ru: 'Готово' },
    'graph_canvas': { en: 'Interactive graph editor canvas', ru: 'Интерактивный холст редактора графов' },
    'zoom_in': { en: 'Zoom in', ru: 'Приблизить' },
    'zoom_out': { en: 'Zoom out', ru: 'Отдалить' },
    'reset_zoom': { en: 'Reset zoom', ru: 'Сбросить масштаб' },
    'empty_hint': { en: 'Choose Node, then click the canvas — or open Help to load the sample graph.', ru: 'Выберите режим «Узел» и нажмите на холст — или откройте «Справку», чтобы загрузить пример.' },

    // --- Matrix panel ---
    'adjacency_matrix': { en: 'Adjacency matrix', ru: 'Матрица смежности' },
    'matrix_view': { en: 'Matrix view', ru: 'Вид матрицы' },
    'matrix_view_title': { en: 'Set visible matrix dimension. Smaller values do not delete graph nodes.', ru: 'Задать видимую размерность матрицы. Меньшие значения не удаляют узлы графа.' },
    'set_dimensions': { en: 'Set dimensions', ru: 'Задать размерность' },
    'set_dim_title': { en: 'Resize matrix view without deleting or rearranging existing graph', ru: 'Изменить размер матрицы без удаления или перестановки графа' },
    'add_node': { en: 'Add node', ru: 'Добавить узел' },
    'insert_before_sel': { en: 'Insert before selected', ru: 'Вставить перед выделенными' },
    'insert_title': { en: 'Insert a new node before each selected node', ru: 'Вставить новый узел перед каждым выбранным' },
    'sort_by_id': { en: 'Sort by ID', ru: 'Сортировать по ID' },
    'sort_by_id_title': { en: 'Sort nodes by ID', ru: 'Сортировать узлы по ID' },
    'sort_by_label': { en: 'Sort by label', ru: 'Сортировать по метке' },
    'sort_by_label_title': { en: 'Sort nodes by label', ru: 'Сортировать узлы по метке' },
    'renumber_order': { en: 'Renumber order', ru: 'Перенумеровать порядок' },
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
    'n_edges': { en: '{n:edge}', ru: '{n:edge}' },
    // --- Matrix / edge-list notes (inline in rendering) ---
    'matrix_note_hidden': { en: 'hidden ({n} of {total:node})', ru: 'скрыто ({n} из {total:node})' },
    'matrix_note_range': { en: '{n}×{n} (range {start}–{end} of {total})', ru: '{n}×{n} (диапазон {start}–{end} из {total})' },
    'matrix_note_end': { en: 'end', ru: 'конец' },
    'matrix_note_view': { en: '{n}×{n} view of {total:node}', ru: '{n}×{n} — вид {total:node}' },
    'edge_list_showing': { en: ' · showing {n}', ru: ' · показано {n}' },
    'edge_list_more': { en: 'Show {n} more', ru: 'Показать ещё {n}' },
    'visible_count': { en: '({n}/{total} visible)', ru: '({n}/{total} видимо)' },
    'n_edges_filtered': { en: '{n}/{m} edges (filtered by visible range)', ru: '{n}/{m} рёбер (фильтр по диапазону)' },

    // --- Edge list ---
    'edge_list': { en: 'Edge list', ru: 'Список рёбер' },
    'col_num': { en: '#', ru: '№' },
    'col_id': { en: 'ID', ru: 'ID' },
    'col_from': { en: 'From', ru: 'От' },
    'col_to': { en: 'To', ru: 'К' },
    'col_weight': { en: 'Weight', ru: 'Вес' },
    'col_label': { en: 'Label', ru: 'Метка' },
    'col_type': { en: 'Type', ru: 'Тип' },
    'col_dir': { en: 'Dir', ru: 'Направл.' },
    'col_stroke': { en: 'Stroke', ru: 'Обводка' },
    'move_up': { en: 'Move up', ru: 'Переместить вверх' },
    'move_down': { en: 'Move down', ru: 'Переместить вниз' },
    'move_left': { en: 'Move left', ru: 'Переместить влево' },
    'move_right': { en: 'Move right', ru: 'Переместить вправо' },
    'matrix_node_hint': { en: 'Click to select node; click again to rename', ru: 'Нажмите, чтобы выбрать узел; повторно — чтобы переименовать' },
    'matrix_cell_hint': { en: 'Click to select the edges in this cell; click again to edit the weights', ru: 'Нажмите, чтобы выбрать рёбра в ячейке; нажмите повторно, чтобы изменить веса' },
    'edge_id_hint': { en: 'Click to select edge; edit to change ID', ru: 'Нажмите, чтобы выбрать ребро; измените поле, чтобы сменить ID' },
    'edge_from_hint': { en: 'Source: {node} — type a node label or ID to reassign', ru: 'Источник: {node} — введите метку или ID узла, чтобы переназначить' },
    'edge_to_hint': { en: 'Target: {node} — type a node label or ID to reassign', ru: 'Цель: {node} — введите метку или ID узла, чтобы переназначить' },
    'edit_weight': { en: 'Edit weight', ru: 'Изменить вес' },
    'edit_label': { en: 'Edit label', ru: 'Изменить метку' },
    'edit_type': { en: 'Edit type', ru: 'Изменить тип' },
    'edge_color': { en: 'Edge color', ru: 'Цвет ребра' },
    'sort_edge_id': { en: 'Sort by ID', ru: 'Сортировать по ID' },
    'sort_edge_from': { en: 'Sort by from', ru: 'Сортировать по источнику' },
    'sort_edge_to': { en: 'Sort by to', ru: 'Сортировать по цели' },
    'sort_edge_id_title': { en: 'Sort edges by ID', ru: 'Сортировать рёбра по ID' },
    'sort_edge_from_title': { en: 'Sort edges by source node order', ru: 'Сортировать рёбра по порядку источника' },
    'sort_edge_to_title': { en: 'Sort edges by target node order', ru: 'Сортировать рёбра по порядку цели' },

    // --- Presets overlay ---
    'style_presets': { en: 'Style presets', ru: 'Пресеты стилей' },
    'save_from_sel': { en: 'Save from selection', ru: 'Сохранить из выделения' },
    'close': { en: 'Close', ru: 'Закрыть' },
    'presets_desc': { en: 'Click a preset to apply its style to the current selection. Use "Save from selection" with a node or edge selected to create a new preset.', ru: 'Нажмите на пресет, чтобы применить его стиль к выделению. Чтобы создать новый пресет, выберите узел или ребро и нажмите «Сохранить из выделения».' },
    'no_presets': { en: 'No presets yet. Select a node or edge and click "Save from selection".', ru: 'Пресетов пока нет. Выберите узел или ребро и нажмите «Сохранить из выделения».' },
    'delete_preset': { en: 'Delete preset', ru: 'Удалить пресет' },
    'apply_preset': { en: 'Apply preset to selection', ru: 'Применить пресет к выделению' },

    // --- Export modal ---
    'append': { en: 'Append', ru: 'Добавить' },
    'import_btn': { en: 'Import', ru: 'Импорт' },
    'download': { en: 'Download', ru: 'Скачать' },
    'export_modal_desc': { en: 'Editable — modify the text, or paste content here when clipboard read is blocked, then click Import.', ru: 'Текст можно править: измените его или вставьте содержимое здесь, если браузер блокирует чтение буфера, затем нажмите «Импорт».' },

    // --- Multi-select panel ---
    'selected_n_m': { en: 'Selected {n:node} and {m:edge}.', ru: 'Выбрано: {n:node} и {m:edge}.' },
    'copy_selected': { en: 'Copy', ru: 'Копировать' },
    'cut_selected': { en: 'Cut', ru: 'Вырезать' },
    'duplicate_selected': { en: 'Duplicate', ru: 'Дублировать' },
    'paste': { en: 'Paste', ru: 'Вставить' },
    'paste_title': { en: 'Paste copied nodes and edges (offset)', ru: 'Вставить скопированные узлы и рёбра (со смещением)' },
    'copy_title': { en: 'Copy selected nodes and internal edges (Ctrl+C)', ru: 'Копировать выбранные узлы и внутренние рёбра (Ctrl+C)' },
    'cut_title': { en: 'Cut selected (Ctrl+X)', ru: 'Вырезать выбранное (Ctrl+X)' },
    'duplicate_title': { en: 'Duplicate selected (Ctrl+D)', ru: 'Дублировать выбранное (Ctrl+D)' },
    'copy_preserve_label': { en: 'Preserve dangling edges on paste if target exists', ru: 'Сохранять висящие рёбра при вставке, если цель есть' },
    'copy_preserve_title': { en: 'When on, edges with one endpoint outside the selection are restored on paste only if the external node still exists', ru: 'Когда включено, рёбра с одним концом вне выделения восстанавливаются при вставке только если внешний узел существует' },
    'nodes_n': { en: 'Nodes ({n})', ru: 'Узлы ({n})' },
    'edges_n': { en: 'Edges ({n})', ru: 'Рёбра ({n})' },
  },

  // === Динамические строки (toast, prompt, и т.д.) ===
  dynamic: {
    'undone': { en: 'Undone', ru: 'Отменено' },
    'redone': { en: 'Redone', ru: 'Повторено' },
    'node_added_circle': { en: 'Node added on circle', ru: 'Узел добавлен по кругу' },
    'inserted_n_before': { en: 'Inserted {n:node} before the selection, arranged in a circle', ru: 'Вставлено {n:node} перед выделением, по кругу' },
    'select_matrix_labels_first': { en: 'Select one or more matrix row or column labels first.', ru: 'Сначала выберите одну или несколько меток строк или столбцов матрицы.' },
    'matrix_expanded': { en: 'Matrix expanded to {n}×{n}; the existing graph is preserved', ru: 'Матрица расширена до {n}×{n}; существующий граф сохранён' },
    'matrix_view_set': { en: 'Matrix view set to {n}×{n}; the existing graph of {m:node} is preserved', ru: 'Вид матрицы установлен {n}×{n}; существующий граф из {m:node} сохранён' },
    'matrix_unchanged': { en: 'Matrix set to {n}×{n}; graph unchanged', ru: 'Матрица установлена {n}×{n}; граф без изменений' },
    'node_order_renumbered': { en: 'Node order renumbered', ru: 'Порядок узлов перенумерован' },
    'nodes_sorted_id': { en: 'Nodes sorted by ID', ru: 'Узлы отсортированы по ID' },
    'nodes_sorted_label': { en: 'Nodes sorted by label', ru: 'Узлы отсортированы по метке' },
    'edges_sorted_id': { en: 'Edges sorted by ID', ru: 'Рёбра отсортированы по ID' },
    'edges_sorted_from': { en: 'Edges sorted by source', ru: 'Рёбра отсортированы по источнику' },
    'edges_sorted_to': { en: 'Edges sorted by target', ru: 'Рёбра отсортированы по цели' },
    'deleted_n_m': { en: 'Deleted {n:node} and {m:edge}', ru: 'Удалено: {n:node} и {m:edge}' },
    'selected_n_m': { en: 'Selected {n:node} and {m:edge}', ru: 'Выбрано: {n:node} и {m:edge}' },
    'polygon_selected': { en: 'Polygon selected {n:node} and {m:edge}', ru: 'Многоугольником выбрано: {n:node} и {m:edge}' },
    'polygon_needs_3': { en: 'Polygon needs at least 3 points', ru: 'Для многоугольника нужно минимум 3 точки' },
    'select_at_least_one': { en: 'Select at least one node first.', ru: 'Сначала выберите хотя бы один узел.' },
    'selected_adjacent': { en: 'Selected adjacent items', ru: 'Выбраны смежные элементы' },
    'selected_directed_adj': { en: 'Selected directed adjacent items', ru: 'Выбраны направленные смежные элементы' },
    'imported': { en: '{label} imported', ru: '{label}: импорт выполнен' },
    'imported_n_edges': { en: 'Imported {n:edge}', ru: 'Импортировано: {n:edge}' },
    'imported_n_nodes': { en: 'Imported {n:node}', ru: 'Импортировано: {n:node}' },
    'nothing_to_copy': { en: 'Nothing to copy', ru: 'Нечего копировать' },
    'copied_n_m': { en: 'Copied {n:node}, {m:edge}', ru: 'Скопировано: {n:node}, {m:edge}' },
    'copied_edges': { en: 'Copied {n:edge}', ru: 'Скопировано: {n:edge}' },
    'pasted_n_m': { en: 'Pasted {n:node}, {m:edge}', ru: 'Вставлено: {n:node}, {m:edge}' },
    'pasted_edges': { en: 'Pasted {n:edge}', ru: 'Вставлено: {n:edge}' },
    'nodes_reversed': { en: 'Node order reversed', ru: 'Порядок узлов обращён' },
    'nodes_shuffled': { en: 'Node order shuffled', ru: 'Порядок узлов перемешан' },
    'no_edge_data': { en: 'No edge data', ru: 'Нет данных рёбер' },
    'no_matrix_data': { en: 'No matrix data', ru: 'Нет данных матрицы' },
    'no_node_data': { en: 'No node data', ru: 'Нет данных узлов' },
    'csv_needs_cols': { en: 'CSV needs source_id and target_id columns', ru: 'CSV требует колонки source_id и target_id' },
    'clipboard_empty': { en: 'Clipboard is empty', ru: 'Буфер обмена пуст' },
    'paste_failed': { en: 'Paste failed: {msg}', ru: 'Ошибка вставки: {msg}' },
    'import_failed': { en: 'Import failed: {msg}', ru: 'Ошибка импорта: {msg}' },
    'import_too_large': { en: 'Import is too large (maximum {mb} MB)', ru: 'Файл импорта слишком большой (максимум {mb} МБ)' },
    'could_not_import': { en: 'Could not import file: {msg}', ru: 'Не удалось импортировать файл: {msg}' },
    'copied': { en: 'Copied', ru: 'Скопировано' },
    'download_hint': { en: 'Download "{name}" — if nothing happened, tap "Copy" instead', ru: 'Скачивание «{name}» — если ничего не произошло, нажмите «Копировать»' },
    'textarea_empty': { en: 'Textarea is empty', ru: 'Поле пусто' },
    'sample_loaded': { en: 'Sample graph loaded', ru: 'Загружен пример графа' },
    'replace_with_sample': { en: 'Replace current graph with a sample?', ru: 'Заменить текущий граф примером?' },
    'replace_with_import': { en: 'Replace current graph with imported file?', ru: 'Заменить текущий граф импортированным файлом?' },
    'clear_entire': { en: 'Clear the entire graph?', ru: 'Очистить весь граф?' },
    'clear_matrix_edges': { en: 'Clear all edges in the adjacency matrix?', ru: 'Очистить все рёбра в матрице смежности?' },
    'node_defaults_applied': { en: 'Node defaults applied to all', ru: 'Значения по умолчанию применены ко всем узлам' },
    'edge_defaults_applied': { en: 'Edge defaults applied to all', ru: 'Значения по умолчанию применены ко всем рёбрам' },
    'saved_style_type': { en: 'Saved style for type "{type}"', ru: 'Сохранён стиль типа «{type}»' },
    'deleted_style_type': { en: 'Deleted style for type "{type}"', ru: 'Удалён стиль типа «{type}»' },
    'cleared_overrides_n': { en: 'Cleared style overrides: {n:node}', ru: 'Очищены переопределения: {n:node}' },
    'no_nodes_type': { en: 'No nodes with that type', ru: 'Нет узлов этого типа' },
    'cleared_overrides_e': { en: 'Cleared style overrides: {n:edge}', ru: 'Очищены переопределения: {n:edge}' },
    'no_edges_type': { en: 'No edges with that type', ru: 'Нет рёбер этого типа' },
    'enter_type_first': { en: 'Enter a type name first', ru: 'Сначала введите имя типа' },
    'select_nodes_edges': { en: 'Select nodes or edges first', ru: 'Сначала выберите узлы или рёбра' },
    'select_node_edge': { en: 'Select a node or edge first', ru: 'Сначала выберите узел или ребро' },
    'preset_applied': { en: 'Preset "{name}" applied to {what}', ru: 'Пресет «{name}» применён: {what}' },
    'preset_saved': { en: 'Preset "{name}" saved', ru: 'Пресет «{name}» сохранён' },
    'preset_name': { en: 'Preset name:', ru: 'Имя пресета:' },
    'preset': { en: 'preset', ru: 'пресет' },
    'camera_updated': { en: 'Camera updated', ru: 'Камера обновлена' },
    'camera_reset': { en: 'Camera reset to 100%', ru: 'Камера сброшена на 100%' },
    'centered_on': { en: 'Centered on {name}', ru: 'Вид центрирован на «{name}»' },
    'select_single_node': { en: 'Select a single node first to center on it', ru: 'Сначала выберите один узел для центрирования' },
    'hotkeys_reset': { en: 'Hotkeys reset to defaults', ru: 'Горячие клавиши сброшены' },
    'source_selected': { en: 'Source {name} selected: tap target', ru: 'Источник «{name}» выбран: нажмите целевой узел' },
    'source_tap_target': { en: 'Source selected. Tap a target node or empty canvas.', ru: 'Источник выбран. Нажмите целевой узел или пустой холст.' },
    'node_label_prompt': { en: 'Node label:', ru: 'Метка узла:' },
    'edge_weight_prompt': { en: 'Edge weight:', ru: 'Вес ребра:' },
    'node_label_hint': { en: 'Leave empty to clear the label.', ru: 'Оставьте пустым, чтобы очистить метку.' },
    'edge_weight_hint': { en: 'Leave empty to remove the weight.', ru: 'Оставьте пустым, чтобы убрать вес.' },
    'preset_name_hint': { en: 'Shown in the preset list.', ru: 'Отображается в списке пресетов.' },
    'drag_to_target': { en: 'Drag to a target node or empty canvas…', ru: 'Перетащите к целевому узлу или на пустой холст…' },
    'pinch_zoom_pan': { en: 'Pinch: zoom and pan', ru: 'Щипок: масштаб и панорамирование' },
    'pan_mode': { en: 'Pan mode', ru: 'Режим панорамирования' },
    'move_mode_drag': { en: 'Move mode: drag canvas to pan', ru: 'Режим перемещения: перетащите холст' },
    'node_mode_click': { en: 'Node mode: click canvas to add', ru: 'Режим узла: клик по холсту' },
    'edge_mode_drag': { en: 'Edge mode: drag to a node or empty canvas', ru: 'Режим ребра: перетащите к узлу или на пустой холст' },
    'select_mode': { en: 'Select mode', ru: 'Режим выбора' },
    'select_tool_mode': { en: '{tool} select mode', ru: 'Режим выбора: {tool}' },
    'selection_tool': { en: '{tool} selection…', ru: 'Выделение: {tool}…' },
    'n_nodes_m_edges': { en: '{n:node} · {m:edge}', ru: '{n:node} · {m:edge}' },
    'no_start_node': { en: 'No start node.', ru: 'Нет стартового узла.' },
    'bfs_order': { en: 'BFS order:', ru: 'Порядок BFS:' },
    'dfs_order': { en: 'DFS order:', ru: 'Порядок DFS:' },
    'dijkstra_from': { en: 'Dijkstra distances from {name}:', ru: 'Расстояния Дейкстры от {name}:' },
    'components_n': { en: 'Weakly connected components ({n}):', ru: 'Слабо связные компоненты ({n}):' },
    'topo_order': { en: 'Topological order:', ru: 'Топологический порядок:' },
    'topo_cycle': { en: 'The directed graph has at least one cycle; no topological ordering exists.', ru: 'Ориентированный граф имеет цикл; топологическая сортировка невозможна.' },
    'topo_undirected': { en: 'Topological sort requires all edges to be directed.', ru: 'Топологическая сортировка возможна только для направленных рёбер.' },
    'graph_statistics': { en: 'Graph statistics', ru: 'Статистика графа' },
    'nodes_label': { en: 'Nodes:', ru: 'Узлы:' },
    'edges_label': { en: 'Edges:', ru: 'Рёбра:' },
    'density': { en: 'Density:', ru: 'Плотность:' },
    'highest_degree': { en: 'Highest degree:', ru: 'Наибольшая степень:' },
    'na': { en: 'n/a', ru: 'н/д' },
    'language_switched': { en: 'Language: English', ru: 'Язык: Русский' },
    // --- Audit fixes: import feedback, layout budget, autosave, a11y labels ---
    'appended_n_m': { en: '{label} appended: {n:node}, {m:edge}', ru: '{label}: добавлено {n:node}, {m:edge}' },
    'appended_n_m_discarded': { en: '{label} appended: {n:node}, {m:edge} (discarded {d:edge} with a missing endpoint)', ru: '{label}: добавлено {n:node}, {m:edge} (отброшено висячих рёбер: {d})' },
    'csv_import_capped': { en: 'Imported {imported}; {dropped} dropped — the document limit is {limit}', ru: 'Импортировано: {imported}; отброшено: {dropped} — предел документа {limit}' },
    'csv_import_skipped': { en: 'Imported {imported}; skipped {skipped} entries with unknown nodes', ru: 'Импортировано: {imported}; пропущено записей с неизвестными узлами: {skipped}' },
    'csv_nodes_replaced_edges': { en: 'Imported {n:node}; {e} old edges were dropped together with the replaced graph', ru: 'Импортировано: {n:node}; вместе с заменённым графом удалено старых рёбер: {e}' },
    'matrix_cap_reached': { en: 'The matrix renders at most {cap}×{cap} nodes; the graph was not enlarged further.', ru: 'Матрица отображает не более {cap}×{cap} узлов; граф дальше не увеличивался.' },
    'matrix_hidden_limit': { en: 'Matrix hidden for performance: {total:node} exceed the limit {limit} (the matrix renders at most {cap}). Raise the limit up to {cap}, or use the edge list / Matrix CSV export.', ru: 'Матрица скрыта для производительности: {total:node} превышают лимит {limit} (матрица отображается максимум для {cap}). Поднимите лимит до {cap} или используйте список рёбер или экспорт «Матрица CSV».' },
    'layout_force_reduced': { en: 'Large graph: force layout ran {iter:pass} instead of 180 to stay responsive', ru: 'Большой граф: раскладка выполнена за {iter:pass} вместо 180, чтобы не подвешивать интерфейс' },
    'autosave_failed': { en: 'Autosave failed: browser storage is full or unavailable. Export your graph to keep it.', ru: 'Автосохранение не удалось: хранилище браузера заполнено или недоступно. Экспортируйте граф.' },
    'matrix_corner': { en: 'Row and column nodes', ru: 'Узлы строк и столбцов' },
    'rows_reorder': { en: 'Reorder row', ru: 'Перестановка строки' },
    'dialog_ok': { en: 'OK', ru: 'ОК' },
    'dialog_cancel': { en: 'Cancel', ru: 'Отмена' },
    'dialog_confirm_title': { en: 'Confirm', ru: 'Подтверждение' },
    'no_custom_attrs': { en: 'No custom attributes defined.', ru: 'Пользовательские атрибуты не заданы.' },
    'err_not_node_clipboard': { en: 'the clipboard does not contain nodes', ru: 'в буфере обмена нет узлов' },
    'err_invalid_graphml': { en: 'invalid XML/GraphML', ru: 'некорректный XML/GraphML' },
    'camera_readout': { en: 'center ({x}, {y}) · zoom {zoom}%', ru: 'центр ({x}, {y}) · масштаб {zoom}%' },
    'preset_what_nodes': { en: '{n:node}', ru: '{n:node}' },
    'preset_what_edges': { en: '{n:edge}', ru: '{n:edge}' },
    'list_and': { en: ' and ', ru: ' и ' },
  },

  // Текущий язык
  current: 'en',

  // Форма счётного существительного для числа (ru: 1 узел, 2 узла, 5 узлов)
  plural(count, forms: readonly string[]): string {
    const n = Math.abs(Number(count) || 0);
    if (this.current !== 'ru') return n === 1 ? forms[0] : forms[1];
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
  },

  // Получить перевод строки по ключу
  t(key, params = {}) {
    const entry = this.strings[key] || this.dynamic[key];
    if (!entry) return key;
    let s = entry[this.current] || entry.en || key;
    if (params) {
      // {n:node} → "{n} узел/узла/узлов" — число и склонённое слово вместе.
      s = s.replace(/\{(\w+):(\w+)\}/g, (_match, paramName, nounName) => {
        const forms = (this.nouns[this.current] || this.nouns.en)[nounName];
        const value = Number(params[paramName]);
        if (!forms || !Number.isFinite(value)) return String(params[paramName] ?? '');
        return `${value} ${this.plural(value, forms)}`;
      });
      for (const [k, v] of Object.entries(params)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), () => String(v));
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
    document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach(el => {
      const key = el.dataset.i18nAriaLabel;
      el.setAttribute('aria-label', this.t(key));
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
    // Show the language the button will switch to without replacing its SVG.
    const langCode = document.getElementById('langCode');
    if (langCode){
      langCode.textContent = this.current === 'en' ? 'RU' : 'EN';
      // Accessible name must contain the visible label (the code shown), not
      // just the generic "Switch language" action.
      const langBtn = document.getElementById('btnLang');
      if (langBtn) langBtn.setAttribute('aria-label', this.t('lang_switch') + ': ' + langCode.textContent);
    }
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

