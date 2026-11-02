# Changelog

Changes are grouped by user-facing releases. Earlier patch-by-patch logs are available in the v29 source archive.

## v32 — Compact top-bar icon spacing

- Reduce the horizontal padding on Zumi's own panel button to 6px per side.
- Keep the 19px Beacon vector icon and existing click/menu behavior unchanged.
- Do not modify the spacing of other GNOME panel buttons.

## v31 — Crisp GNOME tray icon

- Replace the 17px Cairo widget with scale-aware `St.Icon` loading vector SVGs.
- Restore contrast in light/dark panel themes; the menu uses an explicit blue SVG.
- Keep Beacon geometry while enlarging the center diamond for small sizes.

## v30 — Beacon icon visibility

- Render the top-bar and menu Beacon mark using GNOME Shell theme foreground color, avoiding black `currentColor` from direct SVG file loads.
- Refresh the icon on shell theme changes without timers.

## v29 — Vietnamese/English OCR
- Recognize Vietnamese and English with installed Tesseract `vie+eng` models.
- Keep the selected screen area visible during recognition and highlight words with bounding boxes.
- Add explicit **Copy All**, close and cancel controls; OCR runs locally and asynchronously.

## v28 — Beacon identity
- Introduce the Beacon focus-ring app icon and symbolic GNOME panel icon.
- Preserve the existing extension UUID and GSettings preferences.

## v24–v23 — Zumi branding and countdown
- Rename the user-facing app to Zumi without resetting existing configuration.
- Add a floating countdown with GNOME Dark/Light support and a blue progress ring.

## v19–v20 — Usability
- Restore first-click panel menu, show keyboard shortcuts, and add cursor highlight.
- Make Zoom transitions smoother and simplify countdown controls.

## v13–v18 — Performance and reliability
- Lazy-load optional features and avoid doing unused work at login.
- Fix async screen-capture / recording lifecycle and prevent screenshot overwrites.
- Split drawing into cached finished strokes and live strokes; reduce Undo/Redo memory growth.

> Compatibility: source and metadata target GNOME Shell 50. A full desktop benchmark is not included with the repository.
