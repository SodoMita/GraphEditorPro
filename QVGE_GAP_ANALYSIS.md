# GraphEditorPro ↔ QVGE: полный инвентарь функциональных пробелов

**Дата:** 12 ноября 2026
**Версия отчёта:** 5 (четвёртая волна источниковой сверки + правки по формам узлов, единицам `pos`, портам GraphML, типам атрибутов и GEXF-namespace); чужой код сверен по свежему клону QVGE `a456b65`, номера строк подтверждены построчно
**GEP:** ветка `arena/ae1b20f4-grapheditorpro`, коммит `9395e39` (2026-11-11). Сборка: `npm ci` + `npm run build` → `index.html` **779 631 байт**, static-output gate пройден; `npm test` → **201/201** тест, 0 падений (~103 с).
**QVGE:** `github.com/ArsMasiuk/qvge`, ветка `0.7.dev`, HEAD `a456b65` (2025-07-01); в коде `qvgeVersionString("0.7.0")`, в `CHANGES` уже есть раздел 0.7.1.
**Метод:** построчное сравнение исходников. QVGE в песочнице не собирается (нет Qt, apt и download.qt.io недоступны), поэтому всё ниже — вывод из кода QVGE, а не из запуска. Внешние факты (формат DOT, единицы `pos`, поведение `inputscale`) сверялись по документации GraphViz — ссылки по ходу текста (§1.7).

> **Оговорка о «полноте».** В отчёт попали только те пункты, которые подтверждены конкретным местом в коде QVGE. Всё, что в QVGE заявлено, но не реализовано (или реализовано частично), вынесено в §9 — чтобы не заносить в план работ чужие баги.

---

## 0. Как читать отчёт

| Приоритет | Смысл | Почему такой ранг |
|---|---|---|
| **P1** | Файлы и документный цикл | Без этого граф нельзя нормально открыть/сохранить в чужом формате; ежедневная работа и интероп |
| **P2** | Экспорт изображений | Единственный результат, который «выходит» из редактора наружу (отчёт, презентация, печать) |
| **P3** | Структурная модель графа | Данные, которые QVGE умеет хранить, а GEP теряет или не показывает |
| **P4** | Инструменты редактирования | Скорость работы с уже открытым графом |
| **P5** | Раскладки, генераторы, режимы | Мощные, но не ежедневные операции |
| **P6** | Вид, зум, метки, клавиатура | Полировка и мышечная память |

Ссылки на файлы и строки даны для обеих сторон: для QVGE — по клону `ArsMasiuk/qvge` (HEAD `a456b65`), для GEP — по текущему дереву. Если строка не указана, пункт подтверждается названным файлом целиком. Пути QVGE даны от корня репозитория (`src/qvgelib/…`, `src/qvgeui/…`, `src/qvgeio/…`) — в самом отчёте ниже они иногда сокращены до имени файла, но полный путь всегда восстанавливается из этих трёх каталогов.

---

## 1. P1 — форматы файлов и документный цикл

### 1.1 Форматы: что читает и пишет QVGE (`src/qvge/qvgeMainWindow.cpp:40-49`)

`CDocumentFormat { name, filters, suffixes, canSave, canRead }`:

| Формат | QVGE | GEP сейчас | Разрыв |
|---|---|---|---|
| **XGR** (нативный, бинарный) | чтение + запись (QDataStream) | — | **нет**: у GEP своя сериализация, JSON |
| **GEXF** | чтение + запись (общий поднабор; есть `qvge:points` для полилиний — но с невалидным namespace, см. §9.14) | — | **нет** |
| **GraphML** | чтение + запись | чтение + запись | паритет по формату, но см. §3.3 (значения custom-атрибутов) и §3.1 (порты) |
| **GML** | чтение (через OGDF `readGML`) | — | **нет** |
| **CSV** (только `edge,start,end`) | чтение (`saveSupported()==false`) | чтение + запись (богаче QVGE) | у GEP **сильнее**; но ср. §1.5 |
| **DOT / `.dot` `.gv`** | чтение + запись | чтение + запись | паритет по формату; разрыв в опциях (§1.6), единицах `pos` (§1.7) и имени формы `hexagon` (§1.8) |
| **Plain DOT** (`.plain`, `.txt`) | чтение (вывод `dot -Tplain`) | — | **нет** |
| **`.bak.xgr`** (автобэкап) | пишет сам, открывается как обычный XGR | — | **нет** ни бэкапа, ни формата |

Следствие: файл, отданный QVGE (`.xgr`, `.gexf`, `.gml`, `.plain`), в GEP не открывается вообще — единственный вход для него GraphML/DOT/JSON.

### 1.2 Recent Files и стартовая страница

QVGE: `CMainWindow::createStartPage()` + меню `Recent Files` (`CMainWindow.cpp:224-226`), список в `QSettings("recentFiles")`, до **20** записей (`if (recentFiles.size() > 20) recentFiles.removeLast()`), обновление при открытии/сохранении, «Clean Recent Documents» на стартовой странице и удаление отдельных записей (`removeRecentDocument`).
GEP: стартовой страницы нет (сразу редактор), истории открытых файлов нет вообще — открыть «вчерашний» файл можно только заново через диалог.

**Разрыв:** нет ни Recent Files, ни стартовой страницы. В браузере это решается `IndexedDB`/`localStorage` (имена + содержимое), но требует явного решения о хранении пользовательских файлов.

### 1.3 CLI и файловые ассоциации

QVGE (`CMainWindow::processParams`, `CMainWindow.cpp:167-195`):
```
qvge create <docType>     # новый документ заданного типа
qvge open <file>
qvge <file>               # открыть переданный файл
```
плюс регистрация ассоциаций файлов в Windows (`CPlatformWin32.cpp`: `Open`/`New`/`Print` через DDE; `Print` фактически не работает — §9.13).
GEP: веб-приложение, аргументов командной строки нет. **Разрыв архитектурный** (не «забыли») — фиксируется как «нет CLI/ассоциаций», решение: PWA + File Handling API либо ярлык с URL-параметром, если это вообще нужно продукту.

### 1.4 Drag & drop файлов

QVGE: `CMainWindow::dragEnterEvent/dropEvent` — принимает **до 32 файлов** за раз, каждый открывает документ (`CMainWindow.cpp:129-165`).
GEP: обработчиков `dragover`/`drop` на документе нет вообще (строка `dataTransfer` в `src/app/*.ts` не встречается ни разу). Перетаскивание файла в окно браузера просто откроет его вместо импорта — то есть drop-событие дойдёт до браузера, а не до приложения.

**Разрыв:** нет drag&drop файлов, нет пакетного импорта. Реализуется штатно (`drop` + `DataTransfer.files` → существующий `importFile`).

### 1.5 CSV: разделитель, превью и достижимость импорта

QVGE:
- `CCSVImportDialog` (`src/qvgeioui/CCSVImportDialog.ui`): разделители `,` / `;` / `Tab` / **Custom** (свободное поле), **«Columns preview»** (таблица с чекбоксами по колонкам) и **«Raw preview»**.
- Затем — второй диалог выбора разделителя (`CExtListInputDialog`, `CImportExportUIController.cpp:199-217`); это дублирование, см. §9.
- Формат жёстко `edge,start,end` (id ребра, узел-источник, узел-приёмник).

GEP (`src/app/50-import-export.ts`):
- `parseCsv()` — **фиксированная запятая**, кавычки поддерживаются, `;` и Tab не понимаются.
- `importEdgesCsv` (колонки `id/source_id|from/target_id|to/weight/label/directed/type/color/stroke_size/stroke_style/arrow_size`), `importMatrixCsv`, `importNodesCsv` — функционально **богаче** QVGE.
- Диспетчер `importFile()` умеет `csv` с авто-детектом по имени и заголовку (`importFile`, строка 1575+), **но**: кнопки импорта CSV в интерфейсе нет, а `#fileImport` объявлен как `accept="application/json,.json,.dot,.gv,.graphml,.xml"` (`src/template.html:584`), и `chooseImport()` вызывается только для json/dot/graphml (`src/app/80-ui.ts:415-419`, `chooseImport` — строка 358).

**Разрыв двойной:**
1. файловый импорт CSV фактически недостижим из UI (есть только «вставить из буфера»);
2. нет выбора разделителя и превью — файл с `;` или Tab не прочитается.

### 1.6 DOT-экспорт: опции

QVGE `CDOTExportDialog` (`src/qvgeioui/CDOTExportDialog.ui`): **Write background**, **Write node & edge attributes**, «Write IDs && topology».
Рабочих опций две — в `CDOTExportDialog.h` есть только `writeBackground()` и `writeAttributes()`, третий чекбокс ни к чему не подключён (§9). `CFileSerializerDOT` принимает ровно два флага; `bgcolor` пишется только при `m_writeBackground`.

GEP `exportDotText()` (`src/app/50-import-export.ts:200-265`): всегда `graph [layout="neato"]`, всегда `node [style="filled"]`, всегда все атрибуты, `bgcolor` **не пишется вообще** (в списке алиасов импорта `bgcolor` есть — строка 301 — а в экспорте нет).

**Разрыв:** нет ни одного переключателя экспорта; нельзя получить «чистый» DOT только с топологией.

### 1.7 DOT: единицы координат — расхождение 72× (интероп-баг)

Правило GraphViz (документация, `inputscale`): `pos` в **выводе** — пункты, но при **вводе** в `neato`/`fdp` координаты по умолчанию трактуются как **дюймы**; чтобы подать пункты, нужен `inputscale=72` (он же `-s 72`). «If unset, no scaling is done and the units on input are treated as inches.»

- **QVGE** следует этой конвенции: пишет `pos = x/72, -y/72 !` (пункты → дюймы) и читает `x*72` (`CFileSerializerDOT.cpp:157`, `CFormatDOT.cpp:208-213`). В его коде есть и закомментированная строка `inputscale = 72;` (`CFileSerializerDOT.cpp:38-40`) — то есть автор рассматривал вариант «писать пункты», но оставил дюймы.
- **GEP** пишет `pos=` **в пикселях** как есть (`src/app/50-import-export.ts:214`) и читает обратно тоже «как есть» (строка 986: `n.x = parts[0]; n.y = -parts[1]`). При этом в той же строке атрибутов `width`/`height` он переводит **в дюймы** (`/72.0`, строка 236; `*72` на импорте, строка 984).

Два следствия, оба реальные:
1. **Внутренняя несогласованность.** В одном узле GEP пишет `width` в дюймах, а `pos` в пикселях — то есть сам файл противоречит себе: узел шириной 1.4 «дюйма» окажется в 72 раза меньше расстояния до соседа.
2. **Обмен с QVGE даёт масштаб 72×.** Файл GEP, отрендеренный через `neato`, раздувается в 72 раза (пиксели прочитаны как дюймы); файл QVGE, открытый в GEP, сжимается в 72 раза.

**Разрыв:** GEP должен либо писать дюймы (`x/72`, как QVGE и как ждёт `neato` по умолчанию), либо писать пиксели, но тогда добавлять `inputscale=72` в графовые атрибуты и читать `pos` с учётом этого атрибута (`inputscale` в GEP сейчас не упоминается ни разу — grep пуст). Второй вариант точнее (не теряет пиксельную сетку) и парсится обратно без потерь; первый — совместим «из коробки». В любом случае нужен тест round-trip GEP→QVGE→GEP.

Что QVGE последователен, видно и по его plain-DOT-читателю: там всё умножается на 72 и на масштаб графа (`x*72.0*gi.g_scale`, `width*72.0*gi.g_scale` — `src/qvgeio/CFormatPlainDOT.cpp:324-327`), т.е. одна и та же единица применяется к позиции и к размеру. В GEP к размеру применяется 72, а к позиции — нет.

### 1.8 DOT: формы узлов — один интероп-дефект

Набор форм у сторон совпадает (6 штук), но имена и правила перевода — разные.

| Смысл | GEP внутри | GEP пишет в DOT | QVGE внутри | QVGE пишет в DOT | GEP читает | QVGE читает |
|---|---|---|---|---|---|---|
| круг | `circle` | `ellipse` | `disc` | `ellipse` | `ellipse` → circle | `ellipse` → disc |
| квадрат | `square` | `box` | `square` | `rect` | `rect`/`box` → square | `rect`/`box` → square |
| ромб | `diamond` | `diamond` | `diamond` | `diamond` | `diamond` | `diamond` |
| треугольник вверх | `triangleUp` | `triangle` | `triangle` | `triangle` | `triangle` → triangleUp | `triangle` |
| треугольник вниз | `triangleDown` | `invtriangle` | `triangle2` | `invtriangle` | `invtriangle`/`triangledown` → triangleDown | `invtriangle` → triangle2 |
| шестиугольник | `hexagon` | **`polygon` + `sides=6`** | `hexagon` | `hexagon` | `hexagon`/`hex` → hexagon; `polygon`+`sides=6` → hexagon (только фолбэк, `src/app/50-import-export.ts:961-964`) | **`polygon` неизвестен → disc** |

Источники: QVGE — отрисовка `CNode.cpp:1023-1065` (ветки `square`, `diamond`, `hexagon`, `triangle`, `triangle2`, иначе disc), чтение `fromDotShape` (`CFormatDOT.cpp:69-77`: `ellipse→disc`, `rect|box→square`, `invtriangle→triangle2`, остальное без изменений), запись `toDotShape` (`CFileSerializerDOT.cpp:100-108`: `disc→ellipse`, `square→rect`, `triangle2→invtriangle`). GEP — `dotShapeName` (`src/app/50-import-export.ts:177-184`), `sides=6, regular=true` для гексагона (строка 215), `parseShape` (строки 1077-1089).

Выводы:
- **QVGE → GEP** формы переносятся без потерь: имена QVGE (`ellipse`, `rect`, `invtriangle`, `diamond`, `hexagon`, `triangle`) все покрыты `parseShape`.
- **GEP → QVGE** теряется ровно одна форма: `polygon` не входит ни в список переименований `fromDotShape`, ни в ветки отрисовки `CNode`, поэтому шестиугольник приходит **кругом** (а `sides`/`regular` у QVGE — просто лишние атрибуты). Это тот же класс дефекта, что и в §1.7: не отсутствующая фича, а расхождение соглашений в уже поддерживаемом формате.
- Ещё мелочь: сырой DOT с `shape=triangle2` (внутреннее имя QVGE в XGR/настройках) GEP разберёт как `triangleUp` — правило `includes('triangle')` стоит последним, но `triangle2` не матчится ни с одним из более ранних, т.е. направление перевернётся. На DOT-файлах QVGE это не проявляется (пишет `invtriangle`), но правило стоит ужесточить: добавить `triangle2` в ветку `triangleDown`.

**Разрыв:** писать в DOT `hexagon` (это валидная фигура GraphViz и родное имя QVGE) вместо `polygon`. Тогда `sides`/`regular` становятся мёртвыми атрибутами (они действуют только при `shape=polygon`) — их лучше перестать писать, но и вреда от них нет: любой потребитель DOT их просто проигнорирует. Чинится одной строкой в `dotShapeName` + тест round-trip; заодно в `parseShape` — добавить `triangle2` в ветку `triangleDown`.

### 1.9 Сохранение файла, dirty-guard, автобэкап

| QVGE | GEP |
|---|---|
| File → New / Open / **Save** / **Save As** с настоящим файлом и запоминанием имени | только «скачать» из модалки экспорта; File System Access API не используется (`showSaveFilePicker` в коде нет) |
| `saveOnExit()` — при закрытии с несохранёнными изменениями спрашивает | `beforeunload` отсутствует; защита только `autosave` в `localStorage` (ключ `graph-editor-pro-v2`) |
| «Back up the data every N min» (`src/qvgeui/CSceneOptionsDialog.ui`, `CNodeEditorUIController::doBackup`) → `<имя>.bak.xgr` | нет таймерного бэкапа; есть 250-мс debounce в localStorage |
| Recent Files | нет |

**Разрыв:** цикла «открыть файл → править → сохранить в тот же файл» нет; есть «импорт текста» и «скачать текст». Для браузера это осознанный трейд-офф, но в отчёте он должен стоять первым пунктом P1, потому что от него зависит вся модель работы с документами.

---

## 2. P2 — экспорт изображений

QVGE умеет вывести картинку растром (PNG/JPG/TIFF/BMP/WebP/GIF и др.), в SVG и в PDF; в GEP нет **ни одного** графического экспорта: в `src/app/*.ts` нет `toDataURL`, `XMLSerializer`, `outerHTML` (проверено grep’ом: 0 вхождений). Экспорт ограничен текстовыми форматами (JSON/DOT/GraphML/3×CSV) через модалку с `textarea`.

### 2.1 Растровые форматы

QVGE (`src/qvgelib/CImageExport.cpp:22-50`) — список фильтров формируется из `QImageWriter::supportedImageFormats()`, пересечённого со статической таблицей имён: `bmp`, `ico/cur`, `gif`, `jpg/jpeg`, `png`, `pbm/pgm/ppm`, `svg`, `tif/tiff`, `xbm/xpm`, `wbmp`, `webp`, `icns` (плюс `recodeMap` сводит `jpeg→jpg`, `tiff→tif`, `cur→ico`). Т.е. список — не «что умеет Qt», а **фиксированный набор** с проверкой поддержки; SVG в нём есть и как растровый фильтр тоже. Практически значимые: **PNG, JPG, TIFF, BMP, WebP, GIF**.

Диалог (`qvgeioui/CImageExportDialog.ui`):
- **Resolution (DPI)**: `Auto` / 75 / 96 / 150 / 300 / 600 / 1200 — редактируемый combo (`CImageExportDialog.ui:64-100`), т.е. можно ввести своё;
- **Image size (px)**: поле с текущим `0 x 0` (авто) — пересчитывается от DPI;
- **Cut to content** (по умолчанию **включено**, `CImageExportDialog.ui:129-133`) — обрезка по `itemsBoundingRect().adjusted(-20,-20,20,20)` (`CImageExportDialog.cpp:71-72`); состояние запоминается в `QSettings` под ключом `CutContent` (`:43, 52`).

GEP: ничего из этого. `downloadBlob()` (`src/app/50-import-export.ts:80-90`) скачивает Blob любого типа, но **вызывается только с текстом** — графика не генерируется нигде.

**Минимум для паритета:** PNG с DPI и «cut to content»; JPG; SVG. TIFF/BMP/WebP — по спросу (в браузере BMP пишется вручную, TIFF — нетривиально).

### 2.2 SVG

QVGE: File → Export → **SVG** (`exportSVG()`, `CSVGExport`/`QSvgGenerator`). Это **не отдельный диалог**: `exportSVG` открывает тот же `CImageExportDialog` и передаёт его `cutToContent()` и `resolution()` в конструктор `CSVGExport` (`CImportExportUIController.cpp:170-187`), так что DPI и «cut to content» работают и для SVG.

GEP: приложение само рисует в SVG, но **не отдаёт** результат файлом. Технически это самый дешёвый пункт всего отчёта: сцена уже в DOM, нужен `XMLSerializer` + инлайн-стили + `viewBox` по содержимому.

Заметка на будущее: QVGE реализует «cut to content» **не обрезкой при рендере**, а `scene.crop()` на клоне сцены (`CSVGExport.cpp:21-24`), а сам `crop()` — это `setSceneRect(itemsBoundingRect().adjusted(-20,-20,20,20))` с undo-состоянием (`CEditorScene.cpp:1168-1178`). В GEP камера и так «по содержимому», поэтому для SVG достаточно посчитать `viewBox` по `itemsBoundingRect`-эквиваленту, не заводя отдельное понятие «обрезанная область документа».

### 2.3 PDF

QVGE: File → Export → **PDF** (`CPDFExport` через `QPrinter`); диалог `CPDFExportDialog.ui` («PDF Setup»): **Page Size** (A4/Letter/Legal, строки 30-40), **Orientation** (Portrait/Landscape, 56-61), **Resolution** (`dpi`, 69-76), **Margins** (`mm`, 92-99). Настройки читаются/пишутся в `QSettings` (`CImportExportUIController.cpp:151-167`), поэтому последний выбор переживает перезапуск.

GEP: нет. В браузере честный эквивалент — либо печать в PDF средствами ОС, либо `jsPDF` (но это внешняя зависимость, а проект принципиально однофайловый и офлайновый — см. README).

---

## 3. P3 — структурная модель графа

### 3.1 Порты узлов

QVGE: `CNodePort` — `Anchor` (сторона привязки), `Id`, `X/Y offset` (−1000…1000, шаг 10), `Color`; редактор `CNodePortEditorDialog` (`src/qvgeui/CNodePortEditorDialog.ui`, спинбоксы смещения −1000…1000 с шагом 10) открывается **двойным кликом по порту** и через контекстное меню («Add Port…» / «Edit Port…»). Рёбра цепляются за порт (`setFirstNode(node, portId)`), в GraphML это `<port name color anchor x y/>` (`qvgeio/CFormatGraphML.cpp:79-90`) и `sourceport`/`endport` у ребра (`:129-132`) — причём `endport` при чтении не подхватывается, см. §9.15.

GEP: понятия порта нет вообще; ребро всегда идёт к центру узла, точка выхода считается геометрией (`nodeRadiusC`, §`edgePath` в `src/app/20-rendering.ts`).

**Разрыв:** порты, их редактор, привязка концов ребра к портам, сериализация в GraphML/GEXF. Это самый «дорогой» пункт P3: он трогает модель, рендер, hit-test и оба сериализатора.

### 3.2 Полилинии (рёбра с точками излома)

QVGE: `CPolyEdge` + `CControlPoint` — у ребра есть перетаскиваемые контрольные точки; двойной клик по ребру вставляет точку прямо под курсором и сразу начинает её drag (`CPolyEdge::onDoubleClickDrag`, `CPolyEdge.cpp:192-212`). Хранение — как обычный атрибут `points` (`CNodeEditorScene.cpp:338`, `createClassAttribute("edge","points",…, ATTR_NODEFAULT|ATTR_MAPPED|ATTR_FIXED)`), поэтому:
- GraphML/XGR: `<data key="points">…</data>` (обычный атрибут);
- GEXF: спец. тег `<qvge:points data="…"/>` (`CFileSerializerGEXF.cpp:299-309` — чтение, `:662-669` — запись);
- DOT: **не пишется** (код закомментирован, `CFileSerializerDOT.cpp:289-302`).

GEP: только прямая и «дуга» для параллельных рёбер (`Q`-сегмент при `edgeSiblingOffset`, `src/app/20-rendering.ts:1687-1700`). Изломов нет, drag контрольных точек нет, поле `points` не читается и не пишется ни в одном формате.

**Разрыв:** полноценный тип ребра «полилиния».

### 3.3 Значения custom-атрибутов и произвольные атрибуты

Это самый коварный пункт, потому что в GEP **есть определения** атрибутов и создаётся впечатление, что механизм работает.

QVGE: атрибуты хранятся **на элементе** (`CItem::m_attributes`), редактор `CAttributesEditorUI` умеет Add / Change / Remove для выделенных элементов; диалог `CNewAttributeDialog.ui` предлагает ровно шесть типов — **Integer / Real / Boolean / Color / Font / String** (строки 56-81), которые отображаются в `QVariant::Int/Double/Bool/Color/Font/String` (`CNewAttributeDialog.cpp:43-54`). GraphML пишет **все** локальные атрибуты элемента (`CFormatGraphML::writeNodes` — цикл `for (auto it = node.attrs…) writeAttribute(xsw, it.key(), it.value())`, `CFormatGraphML.cpp:92-112`; то же для рёбер; сам словарь — `CItem::m_attributes`, `CItem.h:83, 164`), а `<key>` объявляются с `attr.name` **равным id атрибута** (`:145-177`; `attr.title` с человекочитаемым именем закомментирован — в UI и в файле имя одно и то же).

GEP:
- есть `state.customAttributes` — только **определения** (`id`, `name`/`scope`, `type`, `src/app/10-core.ts:895-919`) и UI для них (`src/template.html:518-535`);
- значения по элементам **нигде не хранятся**: у `GraphNode`/`GraphEdge` (`src/app/types.d.ts:25-63`) нет поля под них (есть лишь общая сигнатура `[key: string]: any`, которая разрешает что угодно типово, но не сохраняет), а `sanitizeState()` (`src/app/10-core.ts:634-672`) переносит в состояние только перечисленные поля — всё остальное молча отбрасывается; экспорт пишет только встроенные `<data>`;
- при импорте `graphmlDataMap()` (`src/app/50-import-export.ts:1011-1034`) читает `<data>` **только** если ключ отображён на встроенное поле: `if(!Object.prototype.hasOwnProperty.call(fieldFor, slot)) continue;`.

Итог: GraphML из QVGE с `<data key="capacity">5</data>` откроется в GEP **без значения 5** (определение `capacity` при этом сохранится и уедет обратно пустым). Для файлов, где атрибуты — это данные (пропускная способность, вес, метки), это тихая потеря.

Отдельная мелочь того же узла: **тип `integer`**. QVGE объявляет целые как `attr.type="integer"` (`CFormatGraphML.cpp:161`) — это не тип GraphML (в стандарте `int`), а его чтение понимает только `integer` (`:278`), так что стандартный `attr.type="int"` от чужого экспортёра у QVGE превращается в строку. GEP принимает ровно стандартный набор `boolean/int/long/float/double/string` (`src/app/50-import-export.ts:1209`), поэтому `integer` из QVGE у него тоже падает в `string`. Пока значения не хранятся, это не видно; когда §3.3 будет закрываться — писать `int`, читать оба.

**Разрыв:** значения custom-атрибутов (хранение + UI + чтение/запись во всех форматах) и, шире, сохранение незнакомых `<data>`-ключей при round-trip.

Важно при реализации: механизм различения «своё определение» / «чужой ключ» в GEP уже есть и работает (маркер `qvge:kind="custom-attribute"` на `<key>`, маркер документа на `<graphml>`, поддержка легаси-префикса `qvge.custom.` — `src/app/50-import-export.ts:404-441, 1245-1300`). Поэтому §3.3 — это не «сделать провенанс», а «добавить третью сущность»: словарь значений на узле/ребре плюс их чтение/запись. Провенанс трогать не нужно, им и надо ограничить запись, чтобы чужие `<key>` не превращались в определения (см. §7).

### 3.4 Показ атрибутов в метке: ID, `degree`, произвольные

QVGE строит текст метки из **видимых класс-атрибутов** (`CItem::updateLabelContent`, `CItem.cpp:202-275`): `id` выводится как `[id]` первой строкой; если видима ровно одна «обычная» метка и это `label`, показывается её текст как есть, иначе каждый видимый атрибут идёт строкой `key: value`. Видимость включается/выключается (`setClassAttributeVisible`, с undo), поэтому:
- View → **Show Node Ids** / **Show Edge Ids** = включить видимость `id`;
- в метку можно вывести **любой** атрибут, включая виртуальный `degree` (`CNode.cpp:306`, `createClassAttribute("node","degree",…, ATTR_VIRTUAL)`) и `tooltip`.

GEP: метка = ровно `n.label`; ID на холсте не показывается никогда (`#selNodeId` — readonly-поле в панели свойств, `src/app/20-rendering.ts:2110`), `degree` не отображается (только в статистике алгоритмов).

**Разрыв:** механизм «показать ID / показать атрибут в метке». Не косметика: это штатный способ читать граф без кликов.

### 3.5 Z-order

QVGE: у QGraphicsItem есть `zValue()`; узел пробрасывает атрибут `z` в `setZValue` (`CNode.cpp:253` — `setAttribute`, `CNode.cpp:295` — `getAttribute`), т.е. значение живёт в элементе и участвует в порядке отрисовки QGraphicsScene. При импорте GEXF `viz:position z` читается и применяется через `setZValue` (`CFileSerializerGEXF.cpp:211-212`). **Но**: своего пункта меню «на передний/задний план» в QVGE нет (`grep -i "tofront|bringtofront|sendtoback|zorder"` по `src/qvgeui src/qvgelib src/qvge` пуст), а при экспорте в GEXF `z` не пишется (`<viz:position x y/>` без z, строка 587) — значение теряется при round-trip.

GEP: z-порядка нет; узлы рисуются в порядке `order`, и `order` — это порядок в матрице/списке, а не слой (`renderNodes()` обходит `state.nodes`).

**Разрыв (честная формулировка):** у QVGE есть *модель* слоя (`z` на элементе + чтение из GEXF), но нет *инструмента* и нет записи. Для GEP это значит: пункт «z-order» — это два независимых решения, «хранить слой» и «дать команды bring-to-front / send-to-back»; первое нужно только если планируется импорт чужих GEXF с z.

### 3.6 Многострочные метки

QVGE: редактор метки — `CTextLabelEdit : QGraphicsTextItem` с `Qt::TextEditorInteraction` (`CTextLabelEdit.cpp:26`), т.е. полноценный текстовый редактор: **Enter = перевод строки**, Esc = конец правки (`finishEdit(true)` на `QKeySequence::Cancel`, строка 56). Многострочность подтверждена и в CHANGES («fixed import of multiline labels from DOT»). Отображение — `QGraphicsSimpleTextItem`, который переносы строк рисует.

GEP: правка метки — модальный `uiPrompt(…, maxLength = 80)` с одной строкой ввода (`src/app/10-core.ts:322-325`), рендер — `<text>` c `textContent` (`src/app/20-rendering.ts:1890`), без `tspan` и без `xml:space`. Поэтому:
- ввести перенос нельзя;
- **импортированный** многострочный ярлык (DOT `\n` разворачивается при разборе строк — README это подчёркивает) на холсте схлопывается в одну строку.

**Разрыв:** многострочные метки (ввод + рендер + перенос по шире).

---

## 4. P4 — инструменты редактирования

| Возможность QVGE | GEP сейчас | Разрыв |
|---|---|---|
| **Find…** (Ctrl+F): поиск по ID, по именам атрибутов, по значениям атрибутов; Edges only / Nodes only / оба; Case sensitive; Whole words; результаты — дерево, выбор строки выделяет элемент (`CSearchDialog.ui/.cpp`) | нет никакого поиска по графу (grep `search` в `src/app/*.ts` находит только строки i18n про BFS/DFS) | полноценный Find |
| **Change node/edge Id** (контекстное меню, только для одного элемента): свободный ввод; при занятом ID — предложение свободного, **Swap Ids** или «Continue editing» (`CNodeSceneActions::editNodeId`, `CNodeSceneActions.cpp:28-68`) | ID узла менять нельзя вообще (`#selNodeId` — `readonly`, `src/app/20-rendering.ts:2110`); ID ребра правится в списке рёбер, но при коллизии ввод молча откатывается (`src/app/80-ui.ts:278-284`) | смена ID с предупреждением и swap |
| **Commutation table** (док «Topology»): Start/End в виде `node:port` (`CCommutationTable.cpp:160-180`), Edge Id, **произвольные колонки** из class-атрибутов ребра («New Column…» / «Restore Defaults…», контекстное меню колонки), сортировка включена (`sortingEnabled` в `.ui`), числовая сортировка через `NumSortItem`, двойной клик по колонке Start/End/Edge выбирает элемент в сцене (`on_Table_itemDoubleClicked`) | ниша занята матрицей смежности и пагинируемым списком рёбер (с инлайн-правкой) — это **сильнее** по редактированию, но не даёт `node:port` и произвольных колонок | таблица связей QVGE-типа (или колонки из custom-атрибутов в существующем списке) |
| **Merge узлов** перетаскиванием узла на узел (`CNode::onDroppedOn`/`merge`, `CNode.cpp:773-801`), Ctrl при drop — не сливать (подтверждено и в CHANGES 0.7.0: «pressing Ctrl while dropping node on node does not merge them», #177) | нет | слияние узлов |
| **Link / Unlink** (контекстное меню): Link — слить выделенные узлы в один; Unlink — развести связи узла на клоны, расставленные по сетке (`CNodeSceneActions.cpp:142-167`, `CNode::unlink` — `CNode.cpp:525-548`) | нет | Link/Unlink |
| **Контекстное меню по элементу** (`CSceneMenuUIController.cpp`): Change Id…, Cut/Copy/Paste/Delete, Clear Appearance, Link, Unlink, Node(s) Color…, Add/Edit Port…, Edge(s) Color…, Direction ▸ Directed/Mutual/None/Reverse | ПКМ = панорама; `contextmenu` и `auxclick` подавлены (`src/app/80-ui.ts:45-46`), меню нет | контекстное меню |
| **Ctrl+Click** — расширить/сузить выделение (штатное поведение Qt: все элементы с флагом `ItemIsSelectable` — `CNode.cpp:31`, `CEdge.cpp:33`; своего кода не требуется) | Shift = добавить; «вычесть» — только через кнопку режима Subtract (`effectiveSelectCombine`, `src/app/30-graph-editing.ts:48`) | Ctrl+Click как модификатор |
| **Select All** (Ctrl+A) / **Toggle Selection** / **Nodes Only** / **Edges Only** (меню Select, `CNodeEditorUIController.cpp:355-394`) | ничего из этого; даже Ctrl+A не обрабатывается (проверено: в `70-controls.ts` и `80-ui.ts` есть только C/X/V/D) | 4 команды выделения |
| **Ctrl+drag = клон** выделения | нет клонирования перетаскиванием (`Ctrl+D` — дубликат, но это другая операция). В QVGE подтверждено кодом: `CEditorScene::onClickDrag` при `modifiers()==Qt::ControlModifier` вызывает `selectUnderMouse` + `cloneSelectedItems` и стартует drag клона (`CEditorScene.cpp:1976-1994`) | клон при перетаскивании |
| **Shift при перетаскивании** — выравнивание по X или Y | нет (Shift меняет шаг лишь для стрелок-нуджей) | axis-lock |
| **Alt при перетаскивании** — инвертировать snap | нет | Alt-snap-toggle |
| **Uniform size** (замок width=height) в Item Properties: `NodeSizeSwitch` прячет поле Y и при включении копирует X→Y (`CNodeEdgePropertiesUI.cpp:347-381`, состояние восстанавливается по `width == height`, строка 158) | нет (`#selNodeWidth`/`#selNodeHeight` полностью независимы, `src/app/20-rendering.ts:2116-2117,2152-2153`) | мелочь, но частая |

---

## 5. P5 — раскладки, генераторы, режимы, Scene Options

### 5.1 GraphViz-раскладки

QVGE (`qvgeui/gvgraph/CGVGraphLayoutUIController.cpp:25-40`): меню **GraphViz** — Hierarchical (`dot`), Spring Energy (`neato`), Spring Force (`fdp`), Multiscaled Spring Force (`sfdp`), Radial (`twopi`), Circular (`circo`); запуск внешнего бинарника `-K<engine> -Tplain-ext` с прогрессом и **отменой**; путь к бинарникам и движок по умолчанию — в Scene Options («Path to GraphViz binaries», «Default layout engine», «Run dot…», «Test GraphViz execution»).

GEP: `btnLayoutCircle`, `btnLayoutGrid`, `btnLayoutForce` («Relax») — только три, все на JS (`src/template.html:599-601`, `src/app/60-algorithms.ts:62-84`). Force-раскладка — Фрухтерман–Рейнгольд, O(iter·n²), с бюджетом пар: на больших графах она молча уменьшает число итераций и пишет тост `layout_force_reduced`.

**Разрыв:** 6 движков GraphViz + путь/тест/движок по умолчанию. В браузере эквивалент — либо WASM-сборка GraphViz, либо собственные реализации (иерархическая, радиальная) — вопрос трудоёмкости, но пункт в отчёте обязателен.

### 5.2 OGDF-раскладки и генераторы

QVGE (`qvgeui/ogdf/COGDFLayoutUIController.cpp:35-45`): Linear, Balloon, Circular, **FMMM**, Planar, **Davidson-Harel**, **Sugiyama**; там же «Create new graph…».

Генераторы (`COGDFNewGraphDialog.cpp:14-44`): **Random**, **Simple**, **Tree**, **Round Tree**, **Planar Tree**, **Wheel**, **Petersen**, **Planar Petersen**; параметры Nodes / Edges / Jumps.

GEP: генератора нет (есть только «Add sample graph» — фиксированный демо-граф, `src/app/80-ui.ts:206`).

### 5.3 Режимы редактирования

| Режим QVGE | Что делает | GEP |
|---|---|---|
| **Select Items** | выделение | есть (`mode=select`) |
| **Create Nodes** | drag **от узла** создаёт новый узел с ребром; drag **от пустого места** создаёт сразу **два** узла и ребро между ними (`startNewConnection`, `CNodeEditorScene.cpp:398-464`) | клик в режиме Node создаёт один узел; drag от узла в режиме Edge на пустое место создаёт узел с ребром (`addConnectedNode`, `src/app/30-graph-editing.ts:419`) → частичный паритет: «двойного» создания из пустоты нет |
| **Transform** | рамка трансформации выделения; `changeSize = !m_moveOnlyMode` (`CTransformRect.cpp:345`, `CNode::transform`) → **масштабирует и размеры узлов**, и позиции | gizmo `scale`/`rect` двигает **только позиции**: `apply(s => ({x:…, y:…}))` (`src/app/45-gizmo.ts:508-542`), размеры тел не меняются (это заявлено и в справке: «node sizes and styles never change») |
| **Factor** | режим: та же рамка трансформации, но `startTransform(true, true)` → `m_moveOnlyMode`, поэтому двигаются только **позиции**, размеры не трогаются (`CNodeEditorScene.cpp:378-381`). Диалог «Factor Nodes» (X% / Y%) в `CNodesFactorDialog.ui` существует, но `factorNodes()` ни к чему не подключён — см. §9 | нет отдельного режима; гизмо `scale` даёт близкий результат, но живёт внутри Select |
| **Crop Area** | обрезать область документа по содержимому: `CEditorScene::crop()` = `setSceneRect(itemsBoundingRect().adjusted(-20,-20,20,20))` + undo (`CEditorScene.cpp:1168-1178`); тем же вызовом пользуется SVG-экспорт | нет (камера всегда «по содержимому» через Fit, но область документа не обрезается). Заметим: у GEP нет `sceneRect` как понятия — камера и есть рамка, поэтому пункт сводится к «нормализовать координаты к bounding box» |
| **Apply Colors** | применить одну из 7 цветовых схем ко всему документу (`CColorSchemesUIController`) | нет (есть per-type стили и presets, но не «схема на документ») |

Цветовые схемы QVGE: **Grayscale, Inverse Grayscale, Solarized Light, Blue & Orange, Forest, Sunny Spring, Night Sky** — задают фон, сетку, цвет/обводку/метку узлов, цвет/метку рёбер.

### 5.4 Scene Options

QVGE (`src/qvgeui/CSceneOptionsDialog.ui`):
- Scene: **Background color**;
- Grid: **Size (px)**, **Color**, **Snap to grid**, **Show grid**;
- Performance: **Enable antialiasing**, **Cache** (слайдер);
- Data security: **Back up the data every N min**;
- Extra tools: **Path to GraphViz binaries**, **Default layout engine**, **Run dot…**, **Test GraphViz execution**.

GEP: фон и цвета/альфа сетки есть (`canvasBgColor`, `gridMinorColor/Alpha`, `gridMajorColor/Alpha` — `src/template.html:376-379`), размер и snap есть; **нет** переключателя «показать сетку», антиалиасинга, кэша отрисовки, таймерного бэкапа, настроек GraphViz.

---

## 6. P6 — вид, зум, метки, клавиатура

### 6.1 Команды вида (меню View QVGE)

| Команда QVGE | GEP | Примечание |
|---|---|---|
| **Show Grid** (toggle) | нет | сетку можно только «погасить» альфой 0; это не то же самое, что выключить. У QVGE — `enableGrid` на сцене (`CNodeEditorUIController.cpp:402-406`) с сохранением в `QSettings` (`:852-870, 890`) |
| **Snap to Grid** | есть (`optSnap`, плюс раздельные Snap X / Snap Y) | паритет/лучше |
| **Show Node Ids** / **Show Edge Ids** | нет | см. §3.4. У QVGE это видимость атрибута `id` в метке, по умолчанию **включена** (`showNodeIds`/`showEdgeIds`, `CNodeEditorUIController.cpp:848-850, 864-865`) и запоминается в `QSettings` |
| **Zoom / Unzoom** | есть (кнопки ±) | паритет |
| **Reset Zoom (100%)** | **сломан**: кнопка «100%» с `title="Reset zoom"` вызывает `fitView()` (`src/app/80-ui.ts:210`). В QVGE это `m_editorView->zoomTo(1.0)` (`resetZoom()` строка 997), т.е. масштаб 1:1, а не «вписать» | вернуть собственно 100 % |
| **Fit to View** | есть (`btnFit`, `fitView`) | паритет |
| **Fit Selection** | нет | `CEditorView::fitSelectedToView` (строка 90) в GEP отсутствует; рамка Fit считается по всем узлам |
| **Zoom Back** (вернуться к зуму до последнего Fit) | нет | в QVGE `fitToView()` перед подгонкой запоминает `m_zoomBeforeFit` и `m_dxyBeforeFit`, а `zoomBack()` восстанавливает оба (`CEditorView.cpp:77-87, 113-117`); в GEP история камеры не хранится |
| **Навигатор** (`Slider2d` в углу вьюпорта: миниатюра сцены + рамка текущего вида; `CNodeEditorUIController.cpp:535-542`, создаётся в `createNavigator()`) | нет | миникарта |

Индикатор зума: у QVGE — кнопка в тулбаре с текущим `%` (`CNodeEditorUIController.cpp:977`, `resetZoomAction2->setText(QString("%1%").arg(currentZoom*100))`); у GEP строка `cameraReadout` «центр (x, y) · масштаб N %» в панели камеры (`src/app/70-controls.ts:91-93`) — **паритет по информации**, разное размещение. Вкладка Help с Quick Help у GEP тоже есть (`#panel-help`, `src/template.html:647-650`) — не пробел.

### 6.2 Клавиатура

| QVGE | GEP | Разрыв |
|---|---|---|
| **Ctrl+A** — выделить всё | нет (ни `selectAll`, ни `KeyA` в `src/app/*.ts`; проверено grep'ом). У QVGE команда есть и в меню Select с `QKeySequence::SelectAll` (`CNodeEditorUIController.cpp:361-365`), и продублирована в `CEditorScene::keyPressEvent` (`:2226-2232`) | да |
| **Ctrl+`+` / Ctrl+`-`** — зум | нет (только колесо и кнопки). У QVGE — `QKeySequence::ZoomIn`/`ZoomOut` на пунктах View → Zoom/Unzoom (`CNodeEditorUIController.cpp:428-436`) | да |
| **Alt+стрелки** — прокрутка вида | нет (стрелки = сдвиг выделения). В QVGE заявлено в `lang/en/help.htm:29` («Alt+Cursor keys → Scroll visible area»), но в коде `CEditorScene::keyPressEvent` флаг `isAlt` объявлен и не используется (`CEditorScene.cpp:2210`, единственное упоминание — закомментированная строка 2213), а `CEditorView` своего `keyPressEvent` не имеет — т. е. это **документированная, но не реализованная** комбинация; в план её вносить не обязательно (см. §9) | необязательно |
| **Ctrl+↑/↓** — размер узлов ±10 % | нет | да |
| **Ctrl+←/→** — вес рёбер ±10 % | нет | да |
| Стрелки — 1 px; Shift+стрелки — шаг сетки | есть, но шаг = шаг сетки при snap, Shift = ×5/×10 (`src/app/80-ui.ts:628-636`) | паритет по духу, разное поведение |
| Ctrl+Z / Ctrl+Y (Undo/Redo), Ctrl+C/X/V, Del, Esc | есть, плюс настраиваемые хоткеи (`70-controls.ts`) | **GEP лучше** (переназначение) |

### 6.3 Метки

| QVGE | GEP |
|---|---|
| Font family + size, **bold / italic / underline**, color (`LabelFontBold/Italic/Underline`, `CNodeEdgePropertiesUI.cpp:278-280, 546-620`; признаки живут в `QFont` атрибута `label.font`) | family/size/color есть (`labelFont`/`labelSize`/`labelColor`); **bold/italic/underline нет** — `font-weight`/`font-style`/`text-decoration` в рендере не встречаются (grep по `src/app/*.ts` даёт только `font-weight` в модалке экспорта). Шрифт хранится одной строкой семейства, начертание выразить нечем |
| Position: Center/Top/Bottom/Left/Right — **только для узлов** (для рёбер переключатель выключен, метка всегда в середине) | то же самое: enum `center/top/bottom/left/right` у узлов, у ребра — середина пути (`src/app/20-rendering.ts:1894-1897`, `labelX/labelY`) → **паритет** |
| Двойной клик по элементу — правка **метки** (у ребра тоже метки) | у узла — метка, **у ребра — вес** (`editEdgeQuick`, `src/app/40-interactions.ts:892-896`) → у ребра метка правится только в панели/списке |
| Многострочные метки (Enter) | нет (§3.6) |

---

## 7. Что есть в GEP и чего нет у QVGE

Это не «долги», а наоборот — при планировании нельзя «выравнивать» продукт по QVGE, потеряв перечисленное:

- **Визуализация веса**: режимы `number / color / width / none`, коррекции `linear / log / exp / sqrt`, диапазоны веса и ширины, две границы градиента, инверсия (min > max). У QVGE вес — только число и (косвенно) толщина пера.
- **Оформление меток**: `outline` (halo через paint-order), `plate` (подложка), `none`; цвет и толщина обводки — у QVGE только цвет метки.
- **Политика меток** auto/on/off — у QVGE есть аналог (Auto/AlwaysOn/AlwaysOff) → **паритет**, не пробел.
- **Стили по типам** узлов/рёбер с наследованием и сбросом переопределений (`btnClearNodeOverrides`), **пресеты стилей** с превью.
- **Матрица смежности** + **пагинируемый список рёбер** с инлайн-правкой id/from/to/weight/label/type/direction/color/stroke — QVGE этого не умеет вовсе (его commutation table — read-only список).
- **7 инструментов выделения**: single / rect / brush / lasso / line / polygon / adjacent(+directed) и режимы Override / Add / Subtract, centre-hit.
- **Gizmo** (move/rotate/scale/rect, пивот, Shift/Alt-модификаторы, стрелки-нудж).
- **Snap X / Snap Y** раздельно.
- **RU/EN** интерфейс (у QVGE есть только `lang/en`: других каталогов в `src/qvge/lang/` нет).
- **Autosave** в localStorage (у QVGE — только ручное сохранение + таймерный .bak).
- **Алгоритмы**: BFS, DFS, Dijkstra, компоненты, топосортировка, статистика.
- **JSON** как формат обмена и **экспорт CSV** (у QVGE CSV read-only).
- **Защита CSV от формул** при экспорте: значения, начинающиеся с `=`, `+`, `@`, Tab или CR, экранируются апострофом и снимаются при импорте (`needsFormulaGuard`/`csvUnescapeCell`, `src/app/50-import-export.ts:22-44`) — открытие выгрузки в Excel не выполняет код из метки.
- **GraphML-провенанс**: свои определения атрибутов помечаются `qvge:kind="custom-attribute"` на `<key>`, а документ целиком — `qvge:writer="graph-editor-pro"` и счётчиком ключей на `<graphml>` (`src/app/50-import-export.ts:446`), поэтому чужие `<key id="score">` не превращаются в определения и обратно (разбор и обоснование — `:1212-1234`). Заодно видно, зачем это нужно: префиксу `qvge:` доверять нельзя — QVGE пишет `<qvge:points>` в GEXF вообще **не объявляя** `xmlns:qvge` (`CFileSerializerGEXF.cpp:418-422, 669`), а его GraphML объявляет только `xmlns` и `xmlns:xsi` (`CFormatGraphML.cpp:37-39`). Поэтому «свой/чужой» определяется явной подписью, а не пространством имён. У QVGE такой границы нет: любой `<key>` без `for` трактуется одинаково.
- **Работа без установки**: один HTML-файл, офлайн, ноль зависимостей.
- **Сортировки/renumber/reverse/shuffle** узлов и рёбер, видимый диапазон по `order`.
- **201 автотест** и статический гейт сборки.

---

## 8. Ложные пробелы (проверено — паритет)

Чтобы не раздувать план:

| Возможность | Почему не пробел |
|---|---|
| 6 фигур в UI (circle/square/diamond/triangleUp/triangleDown/hexagon) | набор совпадает с QVGE 1:1, отдельного пункта «добавить фигуру» нет. Осторожно: **имена в DOT не совпадают** — это дефект, а не паритет, см. §1.8 |
| Стили обводки | Словарь совпадает полностью: `none/solid/dashed/dotted/dashdot/dashdotdot` (`CUtils::textToPenStyle`/`penStyleToText`, `CUtils.cpp:87-116`; в GEP — `parseStrokeStyle`, `src/app/50-import-export.ts:1090+` и `STROKE_STYLES` в `src/app/10-core.ts:357`). Нюанс: **выбор в UI** у QVGE уже — кнопка стиля ограничена `setUsedRange(Qt::SolidLine, Qt::DashDotDotLine)`, т.е. 5 значений без `none` (`CNodeEdgePropertiesUI.cpp:61-62`), хотя формат `none` понимает. У GEP в UI доступны все 6 → **GEP не уступает** |
| Направленность directed/mutual/undirected | есть у обоих, включая DOT `dir` |
| Undo/Redo, cut/copy/paste/Del | есть у обоих |
| Fit to View, сетка, snap | есть у обоих |
| Позиция метки Center/Top/Bottom/Left/Right | у QVGE работает только для узлов, у GEP — так же |
| Политика меток auto/on/off | у QVGE Auto/AlwaysOn/AlwaysOff |
| Отсутствие multi-doc вкладок | у обоих один документ на окно. Нюанс QVGE: у него есть меню **Window** со списком запущенных экземпляров (`CMainWindow::createWindowsMenu/fillWindowsMenu`, `getActiveInstances` через `QSettings` + `GetRunningPIDs`) — это переключение между процессами, а не вкладки; в браузере аналог не нужен |
| Отсутствие печати | у QVGE печати как команды нет: DDE-команда `Print` регистрируется, но `-print` не разбирается (§9.13); у GEP нет |
| **Align / distribute выделения** | нет ни у QVGE, ни у GEP: `grep -i "align\|distribute"` по `src/qvgeui src/qvgelib` даёт только `CNodePort::setAlign` (привязка порта к стороне узла, к выравниванию отношения не имеет), по `src/app/*.ts` — только CSS-свойства `text-align`/`align-items`. Значит это не «пробел относительно QVGE», а отсутствующая у обоих функция; в план — только если нужна продукту сама по себе |
| Портативность | GEP — один HTML-файл (даже «портативнее») |
| Context menu «Clear Appearance» | у GEP есть «Reset style» в панели выделения и сброс переопределений по типу |

---

## 9. Замечания к самой QVGE (не копировать)

Полезно, чтобы план не включал «сделать как у них» там, где у них сломано:

1. **DOT-экспорт**: третий чекбокс «Write IDs && topology» не подключён — `CDOTExportDialog.h` вообще не имеет такого аксессора, сериализатор принимает только `writeBackground`/`writeAttrs`.
2. **CSV-импорт**: `CCSVImportDialog` собирает разделитель с превью, а потом `CImportExportUIController::importCSV` **ещё раз** спрашивает разделитель через `CExtListInputDialog` и использует **второй** ответ. Двойной диалог, первый — впустую.
3. **Полилинии теряются в DOT** (код записи точек закомментирован), хотя в остальных форматах сохраняются.
4. **Метки рёбер** не перетаскиваются и всегда в середине; `LabelPosition` для рёбер принудительно выключен (`setEnabled(nodes.count())`).
5. **Метки элементов** реализованы как `QGraphicsSimpleTextItem` с `setFlags(0)` и `NoButton` — перетащить метку нельзя; «editable label positions» в CHANGES означает только enum позиций.
6. **`tooltip`** читается как атрибут, но таблица атрибутов в подсказке закомментирована.
7. **`degree`** — виртуальный атрибут, который нельзя сохранить (значение не сериализуется).
8. **QGraphicsSimpleTextItem + `label.color`** — цвет метки переводится в кисть, но эффекты вроде halo отсутствуют.
9. **Factor Nodes (диалог X%/Y%)** — `CNodesFactorDialog` написан, но `CNodeEditorUIController::factorNodes()` (строка 1003) нигде не вызывается и ни к какому пункту меню не подключён; в меню Edit от «Factor» есть только режим `EM_Factor`. То есть «масштабирование позиций на X%/Y%» доступно лишь перетаскиванием рамки.
10. **Alt+стрелки «Scroll visible area»** заявлены в `help.htm:29`, но обработчика нет: `isAlt` в `CEditorScene::keyPressEvent` объявлен и не используется, у `CEditorView` нет `keyPressEvent`. Аналогично `CDOTExportDialog` и др. — сверять справку с кодом.
11. **`CAttributesEditorUI`** — не отдельный док: это promoted-виджет внутри `CNodeEdgePropertiesUI` (`NodeAttrEditor`/`EdgeAttrEditor` в `.ui`). Редактирование локальных атрибутов есть, но живёт только в панели Item Properties, отдельной панели «атрибуты выделения» нет.
12. **`CDocumentFormat gml`**: `canSave = false`, а `saveToFile()` вообще не обрабатывает `gml` — при попытке сохранить вернёт `false` (в README при этом написано «GML (read via OGDF, write via QVGE)», что не соответствует коду).
13. **«Печать»**: `CPlatformWin32.cpp:69` регистрирует DDE-команду `Print` → `-print "%1"`, но `qvgeMainWindow.cpp` (и `processParams`) этот аргумент не разбирает, обработчика печати в коде нет. То есть системное контекстное меню «Печать» для `.xgr` откроет QVGE без печати. В §8 паритет «нет печати у обоих» остаётся верным, но не потому, что QVGE «не заявляет», а потому что заявленное не реализовано.
14. **GEXF: префикс `qvge:` без объявления namespace.** Заголовок объявляет только `xmlns`, `xmlns:viz`, `xmlns:xsi` (`CFileSerializerGEXF.cpp:418-422`), а полилинии пишутся как голый `<qvge:points …/>` (`:669`) — префикс нигде не объявлен. Строгий XML-парсер такой документ обязан отвергнуть (undeclared prefix), поэтому файл открывается только теми читателями, которые закрывают на это глаза (сам QVGE читает через `elementsByTagName("qvge:points")`, `:300`, т.е. по «сырому» имени). **Следствие для плана:** если GEP будет читать GEXF (§1.1, P1), нельзя полагаться на `DOMParser` в strict-режиме — либо читать GEXF как текст и матчить тег по строке, либо предварительно санировать документ, добавив объявление `xmlns:qvge`. Писать GEXF надо с корректным объявлением.
15. **GraphML-порты рёбер**: запись пишет атрибут `endport` (`CFormatGraphML.cpp:132`), а чтение смотрит `targetport` (`:388`). Порт на конце ребра при сохранении/открытии **теряется**, а ребро «съезжает» на центр узла. Симметрично, `sourceport` читается (`:386`). Если GEP когда-нибудь будет читать порты из QVGE-файлов, полагаться на `endport` нельзя — надо понимать оба варианта и, при записи, писать `targetport` (то, что QVGE действительно прочтёт) либо оба.

---

## 10. Сводка и предлагаемый порядок работ

Соответствие исходному восьмиблочному списку: блок 1 → **P1**, блок 2 → **P2**, блоки 3 и 7 → **P3** (и порты с полилиниями, и атрибуты/метки — это структурные данные), блок 4 → **P4**, блок 5 → **P5**, блок 6 → **P6**. Блок 8 («прочее») распался: печать и align/distribute отсутствуют у обоих и вынесены в §8 как «не пробелы», z-order — в §3.5 с оговоркой (модель есть, инструмента и записи нет).

| Блок | Пунктов | Что закрывает |
|---|---|---|
| **P1 Форматы и документ** | 11 | GEXF, GML(read), plain-DOT(read), XGR/`.bak.xgr`, Recent Files, CLI, drag&drop, CSV-разделитель+превью, DOT-опции, DOT-интероп (`pos` в §1.7 + формы в §1.8), Save/Save As + dirty-guard |
| **P2 Экспорт изображений** | 3 | PNG/JPG/TIFF/BMP + DPI + cut-to-content, SVG, PDF (page setup) |
| **P3 Структурные данные** | 6 | порты, полилинии, значения custom-атрибутов, показ ID/атрибутов в метке, z-order (только чтение из GEXF + команды), многострочные метки |
| **P4 Инструменты** | 12 | поиск, Change Id/Swap, commutation table, merge, Link/Unlink, контекстное меню, Ctrl+Click, Select All/Toggle/Nodes only/Edges only, Ctrl-drag clone, Shift axis-lock, Alt snap, uniform size |
| **P5 Раскладки и режимы** | 5 групп | GraphViz (6 движков + настройки), OGDF (7), генераторы (8), Transform с размерами / Factor / Crop / Apply Colors, Scene Options |
| **P6 Вид и клавиатура** | 9 | Show grid, Reset zoom 100 % (исправить), Fit selection, Zoom back, навигатор, Ctrl+A, Ctrl+±, Ctrl+↑↓/←→, bold/italic/underline (Alt+стрелки в QVGE только в справке — §9.10, в план не берём) |

**Порядок, который я бы предложил:**

1. **Спринт «интероп» (P1, дешёвая часть)**: CSV-разделитель + кнопка файлового импорта CSV; опции DOT; DOT-интероп — `hexagon` вместо `polygon` (одна строка) и `pos` в пикселях + `inputscale=72` (две строки + тест); drag&drop; Recent Files в localStorage. Это 5 из 11 пунктов P1 при малом риске, и три из них — правки в несколько строк (самый выгодный участок отчёта). Всё это — P1-уровень по влиянию и часы, а не дни, по трудоёмкости.
2. **Спринт «вывод» (P2)**: SVG-экспорт (дёшево, сцена уже SVG) → PNG с DPI и cut-to-content → JPG. PDF — отдельным решением (печать ОС или зависимость).
3. **Спринт «форматы» (P1, дорогая часть)**: GEXF (чтение/запись), plain-DOT и GML (чтение) — по одному, с round-trip тестами; XGR не нужен, если есть GEXF.
4. **Спринт «данные» (P3)**: значения custom-атрибутов + сохранение незнакомых `<data>`; затем показ ID/атрибутов в метке. Порты и полилинии — отдельными фичами, каждая трогает модель/рендер/сериализаторы. **Про GEXF отдельно:** файлы QVGE содержат необъявленный префикс `qvge:` (§9.14), поэтому импорт должен либо санировать документ перед `DOMParser`, либо разбирать такой тег по строке — иначе часть файлов не откроется.
5. **Спринт «инструменты» (P4)**: поиск, Select All/инверсия/тип, Ctrl+Click, контекстное меню (оно же хост для Change Id, Link/Unlink, merge и портов).
6. **Спринт «раскладки» (P5)** и **«полировка» (P6)** — по остаточному принципу.

**Отдельно, вне сравнения:** README устарел — в разделе «Build and safety guarantees» заявляет **141/141 тестов** и `index.html` **725 516 B**, фактически 201 тест и 779 631 B. `AUDIT.md` содержит те же цифры (строки 34, 300, 332, 341), но это документ с датой и ревизией (`2026-11-04`, `0461e9f`) — его числа историчны и переписывать их не нужно; обновлять стоит только README и, при желании, дописать в AUDIT строку «проверено на ревизии…».

---

## Приложение A. Как перепроверить

```bash
# GEP: сборка, тесты, артефакт
cd /home/user/GraphEditorPro && npm ci && npm run build && npm test
ls -l index.html            # 779631

# GEP: отсутствие графического экспорта и контекстного меню
grep -rn "toDataURL\|XMLSerializer\|outerHTML" src/app/*.ts     # пусто
grep -rn "contextmenu\|dragover\|drop'" src/app/*.ts            # только preventDefault

# GEP: CSV-импорт недостижим из UI (нет кнопки/accept)
grep -n "fileImport" src/template.html src/app/80-ui.ts

# GEP: 100% = fitView
sed -n '208,212p' src/app/80-ui.ts

# GEP: gizmo двигает только позиции
sed -n '505,545p' src/app/45-gizmo.ts

# QVGE: форматы и флаги
sed -n '40,50p' /tmp/qvge/src/qvge/qvgeMainWindow.cpp
grep -n "saveSupported" -A2 /tmp/qvge/src/qvgelib/CFileSerializer*.h

# QVGE: экспорт картинок, DPI, cut-to-content
sed -n '22,45p' /tmp/qvge/src/qvgelib/CImageExport.cpp
grep -n "<string>" /tmp/qvge/src/qvgeioui/CImageExportDialog.ui

# QVGE: атрибуты элемента целиком в GraphML
sed -n '63,140p' /tmp/qvge/src/qvgeio/CFormatGraphML.cpp

# QVGE: полилинии как атрибут points
grep -n "points" /tmp/qvge/src/qvgelib/CNodeEditorScene.cpp
sed -n '192,212p' /tmp/qvge/src/qvgelib/CPolyEdge.cpp

# QVGE: метки = видимые атрибуты ([id], key: value)
sed -n '202,275p' /tmp/qvge/src/qvgelib/CItem.cpp

# QVGE: единицы pos и закомментированный inputscale
sed -n '36,42p;155,160p' /tmp/qvge/src/qvgelib/CFileSerializerDOT.cpp

# QVGE: то, что заявлено но не подключено (§9)
grep -rn "factorNodes" /tmp/qvge/src/            # только объявление/определение
grep -n "isAlt" /tmp/qvge/src/qvgelib/CEditorScene.cpp   # объявлен, не используется
grep -rn "\-print" /tmp/qvge/src/qvge/qvgeMainWindow.cpp # пусто

# QVGE: Slider2d-навигатор
sed -n '535,545p' /tmp/qvge/src/qvgeui/CNodeEditorUIController.cpp

# GEP: формы в DOT — источник интероп-дефекта §1.8
sed -n '176,184p;210,216p' src/app/50-import-export.ts    # dotShapeName + sides
sed -n '1077,1089p' src/app/50-import-export.ts            # parseShape (конец — 1089)

# QVGE: формы — отрисовка и два маппинга (§1.8)
sed -n '1024,1066p' /tmp/qvge/src/qvgelib/CNode.cpp
sed -n '69,78p'   /tmp/qvge/src/qvgeio/CFormatDOT.cpp          # fromDotShape
sed -n '100,109p' /tmp/qvge/src/qvgelib/CFileSerializerDOT.cpp  # toDotShape

# QVGE: GraphML-порты пишутся как endport, читаются как targetport (§9.15)
grep -n '"endport"\|"targetport"\|"sourceport"' /tmp/qvge/src/qvgeio/CFormatGraphML.cpp

# QVGE: GEXF пишет qvge:points без объявления namespace (§9.14)
sed -n '415,425p;660,672p' /tmp/qvge/src/qvgelib/CFileSerializerGEXF.cpp

# QVGE: attr.type integer вместо int (§3.3)
grep -n 'integer' /tmp/qvge/src/qvgeio/CFormatGraphML.cpp

# QVGE: Ctrl+A и зум-хоткеи (для §6.2)
sed -n '361,365p;428,436p' /tmp/qvge/src/qvgeui/CNodeEditorUIController.cpp
sed -n '2226,2232p' /tmp/qvge/src/qvgelib/CEditorScene.cpp

# Внешний источник: единицы pos и inputscale
# https://graphviz.org/docs/attrs/inputscale/  ("units on input are treated as inches")
```
