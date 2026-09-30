# POTAPlus Hunter Beta

POTAPlus is a Chrome/Edge browser extension that enhances the **Parks on the Air (POTA)** spot page with path-specific HF propagation estimates for hunters.

Current release: **v0.36.6**

## What it does

POTAPlus reads the POTA spots already visible in `pota.app` and overlays an estimated **TX** and **RX** path probability on each spot card. It uses a browser-local ITU-R P.533-14 / ITURHFProp WebAssembly engine together with current solar/geomagnetic data.

Highlights:

- Path-specific predictions from your Maidenhead grid to each POTA park.
- POTA.app remains in control of Band and Mode filtering; POTAPlus does not duplicate those controls.
- User-settable **My TX Power**; default 100 W.
- User-settable **Assumed POTA Activator Power**; default 75 W.
- Supports QRP inputs below 1 W, including 0.5 W.
- Displays current **SFI, Kp, A-index, and GOES X-ray class**.
- Light color overlay and TX/RX percentage bubbles on spot cards.
- Click a TX/RX bubble for a persistent prediction popup beside the card; close it with the **−** button.
- POTAPlus panel is movable, resizable, and collapsible.

## Installation

POTAPlus is currently distributed as an unpacked Chrome/Edge extension.

### Chrome

1. Download the release ZIP and choose **Extract All**.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `POTAPlus_Hunter_Beta_v0.36.6` folder.
6. Open or refresh `https://pota.app`.

### Microsoft Edge

1. Download the release ZIP and choose **Extract All**.
2. Open `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `POTAPlus_Hunter_Beta_v0.36.6` folder.
6. Open or refresh `https://pota.app`.

## Using POTAPlus

1. In POTA.app, select the **Band** and **Mode** you want to hunt.
2. In POTAPlus, confirm your Maidenhead grid and enter your normal transmit power.
3. POTAPlus evaluates the visible POTA spots.
4. Green/yellow/orange/red overlays indicate progressively weaker predicted paths.
5. Click a **TX** or **RX** bubble to see the detailed P.533 result and live-condition information. The popup remains open until you press **−**.

### TX versus RX

- **TX** uses **your entered transmit power** for the path from you to the activator.
- **RX** uses the **assumed activator power** for the return path to you.

The default activator assumption is 75 W and can be changed by the user.

## Propagation engine

The propagation calculation runs locally in the browser using bundled `p533.mjs` and `p533.wasm` files based on ITURHFProp / ITU-R P.533-14.

On first use, POTAPlus retrieves the current month's required ITU coefficient tables as **data** through OpenHamClock's P.533 data endpoint and caches them locally. The P.533 path calculation itself runs inside the extension, not on a remote propagation server.

POTAPlus uses current NOAA SWPC data for solar and geomagnetic context. Solar flux is used as an input to the P.533 model; it is not counted a second time as an artificial SFI bonus.

Predictions are statistical estimates, not guarantees of a completed QSO. Antenna systems, local noise, terrain, fading, operator timing, interference, and changing ionospheric conditions can all affect the real result.

## Data and privacy

POTAPlus uses browser location permission only when the user chooses automatic location. The resulting location/grid is stored in browser extension storage for local calculations.

The extension contacts:

- `api.pota.app` for POTA park coordinates.
- NOAA Space Weather Prediction Center for solar/geomagnetic data.
- OpenHamClock's P.533 data endpoint for monthly coefficient files.

Your station coordinates are used by the local P.533 calculation and are not sent to a remote propagation-calculation service by POTAPlus.

## Third-party components and data

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `THIRD_PARTY_LICENSES/`.

POTAPlus includes/uses work associated with:

- OpenHamClock — MIT licensed.
- ITU-R Study Group 3 `ITU-R-HF` / ITURHFProp implementation of Recommendation ITU-R P.533.
- Parks on the Air API for park information.
- NOAA Space Weather Prediction Center for live space-weather data.

## Project license

No license has yet been selected for the original POTAPlus source code. Until a project license is added, normal copyright rules apply to that code. Third-party components retain their own notices and terms.

## Release

See [RELEASE_NOTES.md](RELEASE_NOTES.md) for the current release notes.
