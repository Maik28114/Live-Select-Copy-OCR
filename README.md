# Live Select Copy OCR Pro

Chrome Extension zur Text/Code-Erkennung aus Google Meet Videostreams.

## Features
- Bereich per Maus markieren → OCR erkennt Text automatisch
- Tesseract.js OCR direkt im Browser (kein externer Server)
- Deutsch + Englisch Erkennung
- Image Preprocessing (Grayscale, Contrast, Binarize)
- Consent-System (Datenschutz by Design)
- Manifest V3 kompatibel

## Aktivierung
`Shift + Alt + O` auf einer Google Meet Seite

## Status
v0.2.0 — in Entwicklung

## Tech Stack
- JavaScript (Manifest V3)
- Tesseract.js (OCR, WebAssembly)
- Chrome Extension APIs (scripting, storage, clipboardWrite)
