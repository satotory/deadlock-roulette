# Музыка, Street Brawl и оригинальные фразы героев

Добавлены **шесть оригинальных музыкальных дорожек** из текущей установленной версии Deadlock: новая Title / музыка титульного меню, The Hideout, драфт Street Brawl, поиск матча, музыка после матча и классическое меню. В списке используются понятные названия сцен, а не придуманные официальные названия OST. При переключении сохранённого трека две записи плавно сменяют друг друга за 720 мс. Выключение музыки останавливает обе записи, громкость остаётся общей для всех дорожек.

Набор «Street Brawl» воспроизводит **оригинальный выстрел выпадения предмета** из `Base.UI.ItemDraft.Appear`: пять вариантов `ui_draft_item_appear_base_01..05.vsnd_c`. В режиме выпадения предмета к нему добавляется оригинальный слой его категории, который в игре назначен событиями `UI.ItemDraft.Appear.Weapon`, `.Vitality` и `.Spirit`. Это игровые записи, не синтезированный выстрел. Щелчки прокрутки следуют каждой смене слота и генерируются отдельно: оригинальная запись `UI.ItemDraft.RevolverSpin` длится около 5,2 секунды и не могла бы точно сопровождать оба темпа приложения.

События и их пути подтверждены чтением `soundevents/ui.vsndevts_c` и `soundevents/music.vsndevts_c` из локального VPK. Декодер метаданных использует описание [KV3 из ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Resource/ResourceTypes/BinaryKV3.cs). Все музыкальные и звуковые потоки извлечены целиком, без перекодирования. Проверены CRC32 архивных ресурсов, SHA-256 готовых MP3 и записи в `assets/audio/current-source.json`.

Кроме музыки в приложение включено по одной оригинальной реплике выбора для каждого из **41 героев** текущего локального каталога. Озвучка взята из установленного Deadlock, из `sounds/vo/<внутреннее имя героя>/..._select_*.vsnd_c`.

Реплики сохранены целиком, без синтеза и изменения голоса. Выбраны короткие варианты длительностью от 0,86 до 5,8 секунды. Музыка и голоса работают без Steam и интернета после сборки приложения. Язык интерфейса не меняет оригинальную озвучку.

Владельцем оригинальных записей является Valve Corporation. Эти локальные ассеты добавлены для личного приложения пользователя. Точное имя VPK, путь ресурса, размер и SHA-256 каждой записи находятся в `assets/voices/source.json`; при извлечении проверяется CRC32 оригинального ресурса.

```powershell
node scripts/extract-menu-music.mjs
node scripts/extract-hero-voices.mjs
node scripts/extract-current-audio.mjs
```

Скрипты открывают игровые архивы только для чтения. Их можно запустить с явно указанной папкой `Deadlock/game/citadel`; `--inspect` у скрипта голосов показывает найденные кандидаты без записи файлов.

Кроме нового Street Brawl сохранены пять альтернативных звуков прокрутки — «Дерево», «Револьвер», «Кристалл», «Аркада» и прежняя «Механика». Их щелчки и финальные акценты генерируются средствами Web Audio внутри приложения. Кнопка «Прослушать» проигрывает короткий замедляющийся образец при текущей громкости колеса, даже если обычные щелчки выключены. Музыка, колесо, интерфейс и фразы героев имеют независимые настройки громкости и выключатели.
# Curse accent

The app's custom curse rule uses the original Cursed Relic cast from the local game:
`soundevents/mods/tech.vsndevts_c` → `Mods.Tech.Glitch.Cast` →
`sounds/mods/tech/glitch/curse_cast.vsnd_c`. Extracted without alteration to
`assets/audio/curse.mp3` (2.426 seconds, 67,841 bytes). Archive CRC32 is verified;
SHA-256 and the archive path are recorded in `assets/audio/curse-source.json`.
Reproduce with `node scripts/extract-curse-audio.mjs`.

The accent follows the wheel sound switch and saved volume. Turning off wheel
sounds or lowering the volume to zero immediately stops it. Music, interface
feedback and hero voice switches remain independent. The app curse is a custom
rule, not a claim that the game item works this way in ordinary Deadlock matches.

