# Changelog

## 0.36.6 — 2026-09-30

- Added persistent near-bubble prediction popup with explicit minus-button close.
- Preserved popup independently of the main POTAPlus panel.
- Retained corrected P.533 power units and user/activator power inputs.
- Retained POTA.app-driven Band/Mode filtering.
- Retained live solar/geomagnetic indicators.

## 0.36.2–0.36.5

- Corrected ITU-R P.533 transmit-power input from dB(W) to dB(kW).
- Fixed UI state, bubble-click handling, and selected-prediction visibility.
- Aligned power input controls and updated displayed version text.

## 0.36.0–0.36.1

- Added user TX power and assumed activator power inputs.
- Added visible SFI/Kp/A/X-ray information.
- Removed redundant POTAPlus mode buttons; POTA.app filters now drive the visible spot set.

## 0.34.0–0.35.x

- Replaced remote propagation-calculation experiments with a browser-local P.533 WASM engine.
- Added POTAPlus NOW display, prediction detail information, and no-blink UI refinements.
