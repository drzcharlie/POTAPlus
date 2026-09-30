# POTAPlus Hunter Beta v0.36.6

## Current beta release

This release is the first GitHub-ready package of the current POTAPlus Hunter Helper test line.

### Propagation

- Browser-local ITU-R P.533-14 / ITURHFProp WebAssembly calculation.
- Corrected P.533 transmit-power units to dB relative to 1 kW.
- User-adjustable station power, default 100 W.
- User-adjustable assumed POTA activator power, default 75 W.
- QRP inputs below 1 W are supported.
- Live SFI, Kp, A-index, and GOES X-ray class are displayed.
- SFI is fed into the P.533 solar input without an additional artificial SFI boost.

### POTA integration

- POTA.app's native Band and Mode filters control which spots are shown.
- POTAPlus uses each visible spot's actual frequency and mode.
- POTA park coordinates are obtained from the POTA API.

### Interface

- Movable, resizable, collapsible POTAPlus panel.
- Optional spot-card color overlay and TX/RX percentage bubbles.
- Persistent prediction popup opens beside a TX/RX bubble.
- Prediction popup stays open until the user presses the minus (−) button.
- Larger "Press" help prompt next to the information control.

### Notes

This remains a beta. Propagation values are decision aids, not guarantees of a QSO.
