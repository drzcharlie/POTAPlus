
(() => {
  'use strict';

  const ID = 'potaplus-root';
  const STORAGE_KEY = 'potaplusSettings';

  let settings = {
    callsign: '',
    grid: '',
    gridSource: '',
    latitude: null,
    longitude: null,
    minimized: false,
    showColors: true,
    showPercent: true,
    myTxPower: 100,
    assumedPotaPower: 75
  };

  function save() {
    chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }

  function load(cb) {
    chrome.storage.local.get([STORAGE_KEY], (r) => {
      if (r && r[STORAGE_KEY]) settings = {...settings, ...r[STORAGE_KEY]};
      // Recovery for unpacked-extension updates: if a grid survived but the
      // numeric coordinates did not, rebuild coordinates from the grid.
      if ((!Number.isFinite(Number(settings.latitude)) || !Number.isFinite(Number(settings.longitude))) && settings.grid) {
        const p = maidenheadToLatLon(settings.grid);
        if (p) {
          settings.latitude = p.lat;
          settings.longitude = p.lon;
          save();
        }
      }
      cb();
    });
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function latLonToMaidenhead(lat, lon) {
    lon += 180;
    lat += 90;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let grid = '';

    const fieldLon = Math.floor(lon / 20);
    const fieldLat = Math.floor(lat / 10);
    grid += A[fieldLon] + A[fieldLat];

    lon -= fieldLon * 20;
    lat -= fieldLat * 10;

    const squareLon = Math.floor(lon / 2);
    const squareLat = Math.floor(lat / 1);
    grid += String(squareLon) + String(squareLat);

    lon -= squareLon * 2;
    lat -= squareLat;

    const subLon = Math.floor(lon / (2/24));
    const subLat = Math.floor(lat / (1/24));
    grid += A[subLon].toLowerCase() + A[subLat].toLowerCase();

    return grid.toUpperCase();
  }

  function maidenheadToLatLon(grid) {
    const g = String(grid || '').trim().toUpperCase();
    if (g.length < 4) return null;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const a0 = A.indexOf(g[0]);
    const a1 = A.indexOf(g[1]);
    if (a0 < 0 || a1 < 0 || !/\d/.test(g[2]) || !/\d/.test(g[3])) return null;
    let lon = a0 * 20 - 180 + Number(g[2]) * 2;
    let lat = a1 * 10 - 90 + Number(g[3]);
    if (g.length >= 6) {
      const s0 = A.indexOf(g[4]);
      const s1 = A.indexOf(g[5]);
      if (s0 >= 0 && s1 >= 0) {
        lon += s0 * (2 / 24) + (2 / 24) / 2;
        lat += s1 * (1 / 24) + (1 / 24) / 2;
      }
    } else {
      lon += 1;
      lat += 0.5;
    }
    return { lat, lon };
  }

  function detectCallsignFromPage() {
    const callRe = /^[A-Z]{1,2}\d[A-Z0-9]{1,4}$/i;
    const nodes = Array.from(document.querySelectorAll('a,button,span,div'));
    const candidates = [];

    for (const n of nodes) {
      const t = (n.textContent || '').trim();
      if (!callRe.test(t)) continue;
      const r = n.getBoundingClientRect();
      if (r.top >= -5 && r.top <= 90 && r.right > window.innerWidth * 0.55) {
        candidates.push({text:t.toUpperCase(), right:r.right});
      }
    }

    candidates.sort((a,b)=>b.right-a.right);
    return candidates.length ? candidates[0].text : '';
  }

  function autoDetectCallsign() {
    const found = detectCallsignFromPage();
    const inp = document.querySelector('#pp-callsign');
    if (found && found !== settings.callsign) {
      settings.callsign = found;
      save();
      if (inp) inp.value = settings.callsign;
    } else if (inp) {
      inp.value = settings.callsign || '';
    }
  }

  function locateGrid(force=false) {
    const status = document.querySelector('#pp-grid-status');
    if (status) status.textContent = 'Locating…';

    if (!navigator.geolocation) {
      if (status) status.textContent = 'Location unavailable — enter grid manually.';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        settings.grid = latLonToMaidenhead(pos.coords.latitude, pos.coords.longitude);
        settings.gridSource = 'CURRENT LOCATION';
        settings.latitude = pos.coords.latitude;
        settings.longitude = pos.coords.longitude;
        save();
        const inp = document.querySelector('#pp-grid');
        if (inp) inp.value = settings.grid;
        if (status) status.textContent = 'Current location';
        apply();
      },
      err => {
        if (!status) return;
        status.textContent =
          err.code === 1
            ? 'Location blocked — allow location or enter grid manually.'
            : 'Could not get location — enter grid manually.';
      },
      {enableHighAccuracy:false, timeout:10000, maximumAge: force ? 0 : 300000}
    );
  }

  function uniqueParkRefs(text) {
    return [...new Set((text.toUpperCase().match(/\b[A-Z]{2,3}-\d{4,5}\b/g) || []))];
  }

  function getSpotCards() {
    // Anchor on the RE-SPOT control: each visible POTA activator card has one.
    const respotControls = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'))
      .filter(n => {
        if (!(n instanceof HTMLElement)) return false;
        const t = (n.innerText || '').trim().toUpperCase();
        return t === 'RE-SPOT' || t.startsWith('RE-SPOT ');
      });

    const cards = [];
    const seen = new Set();

    for (const control of respotControls) {
      let n = control;
      let chosen = null;

      // Walk upward until we find the smallest sensible container that
      // contains exactly one park reference and the RE-SPOT control.
      for (let depth = 0; n && depth < 10; depth++, n = n.parentElement) {
        if (!(n instanceof HTMLElement)) break;
        if (n.id === ID) break;

        const text = (n.innerText || '').trim();
        const refs = uniqueParkRefs(text);
        const r = n.getBoundingClientRect();

        const sensible =
          r.width >= 220 && r.width <= 700 &&
          r.height >= 140 && r.height <= 700;

        if (sensible && refs.length === 1 && /\bRE-?SPOT\b/i.test(text)) {
          chosen = n;
          break;
        }
      }

      if (!chosen) continue;

      // DOM identity dedupe.
      if (seen.has(chosen)) continue;

      // Visual dedupe as a second guard.
      const r = chosen.getBoundingClientRect();
      const duplicate = cards.some(existing => {
        const e = existing.getBoundingClientRect();
        return (
          Math.abs(e.left - r.left) <= 3 &&
          Math.abs(e.top - r.top) <= 3 &&
          Math.abs(e.right - r.right) <= 3 &&
          Math.abs(e.bottom - r.bottom) <= 3
        );
      });

      if (duplicate) continue;

      seen.add(chosen);
      cards.push(chosen);
    }

    return cards;
  }

  function cardMode(card) {
    const txt = (card.innerText || '').toUpperCase();
    for (const m of ['FT8','FT4','FT2','CW']) {
      if (new RegExp(`\\b${m}\\b`).test(txt)) return m;
    }
    if (/\b(PHONE|SSB|USB|LSB|AM|FM)\b/.test(txt)) return 'PHONE';
    return '';
  }

  function cardParkReference(card) {
    const txt = (card.innerText || '').toUpperCase();
    const m = txt.match(/\b[A-Z]{2,3}-\d{4,5}\b/);
    return m ? m[0] : '';
  }

  function cardFrequencyMHz(card) {
    const txt = (card.innerText || '').toUpperCase();

    let m = txt.match(/\b(\d{3,6}(?:\.\d+)?)\s*KHZ\b/);
    if (m) return Number(m[1]) / 1000;

    m = txt.match(/\b(\d{1,3}(?:\.\d+)?)\s*MHZ\b/);
    if (m) return Number(m[1]);

    return null;
  }

  function cardBand(card) {
    const txt = (card.innerText || '').toUpperCase();

    // If the POTA card explicitly includes a band, use it.
    let m = txt.match(/\b(160|80|60|40|30|20|17|15|12|10|6)\s*M\b/);
    if (m) return `${m[1]}m`;

    // Otherwise read ANY frequency shown on the card.
    // POTA commonly displays kHz, e.g. 14250 kHz for 20m phone.
    m = txt.match(/\b(\d{3,6}(?:\.\d+)?)\s*KHZ\b/);
    if (m) {
      return frequencyMHzToBand(Number(m[1]) / 1000);
    }

    // Also allow MHz if POTA changes the display format.
    m = txt.match(/\b(\d{1,3}(?:\.\d+)?)\s*MHZ\b/);
    if (m) {
      return frequencyMHzToBand(Number(m[1]));
    }

    return '';
  }

  function frequencyMHzToBand(f) {
    if (!Number.isFinite(f)) return '';

    // Amateur HF allocations broad enough for normal POTA spots.
    if (f >= 1.8   && f <= 2.0)   return '160m';
    if (f >= 3.5   && f <= 4.0)   return '80m';
    if (f >= 5.25  && f <= 5.45)  return '60m';
    if (f >= 7.0   && f <= 7.3)   return '40m';
    if (f >= 10.1  && f <= 10.15) return '30m';
    if (f >= 14.0  && f <= 14.35) return '20m';
    if (f >= 18.068 && f <= 18.168) return '17m';
    if (f >= 21.0  && f <= 21.45) return '15m';
    if (f >= 24.89 && f <= 24.99) return '12m';
    if (f >= 28.0  && f <= 29.7)  return '10m';
    if (f >= 50.0  && f <= 54.0)  return '6m';

    return '';
  }

  function p533Mode(card) {
    const m = cardMode(card);
    if (m === 'PHONE') return 'SSB';
    return m || 'SSB';
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'POTAPlus background request failed'));
          return;
        }
        resolve(response.data);
      });
    });
  }

  async function realP533ForCard(card) {
    if (!Number.isFinite(Number(settings.latitude)) || !Number.isFinite(Number(settings.longitude))) {
      throw new Error('Current location is not available');
    }

    const reference = cardParkReference(card);
    const frequencyMHz = cardFrequencyMHz(card);

    if (!reference) throw new Error('No park reference found');
    if (!Number.isFinite(frequencyMHz)) throw new Error('Frequency could not be read from the POTA card');

    const park = await sendRuntimeMessage({
      type: 'POTAPLUS_GET_PARK',
      reference
    });

    const mode = p533Mode(card);

    const [tx, rx] = await Promise.all([
      sendRuntimeMessage({
        type: 'POTAPLUS_P533',
        txLat: Number(settings.latitude),
        txLon: Number(settings.longitude),
        rxLat: park.lat,
        rxLon: park.lon,
        mode,
        power: Number(settings.myTxPower) || 100,
        frequencyMHz
      }),
      sendRuntimeMessage({
        type: 'POTAPLUS_P533',
        txLat: park.lat,
        txLon: park.lon,
        rxLat: Number(settings.latitude),
        rxLon: Number(settings.longitude),
        mode,
        power: Number(settings.assumedPotaPower) || 75,
        frequencyMHz
      })
    ]);

    rememberLiveConditions(tx);

    return {
      tx: tx.nowReliability ?? tx.reliability,
      rx: rx.nowReliability ?? rx.reliability,
      twoWay: Math.min(tx.nowReliability ?? tx.reliability, rx.nowReliability ?? rx.reliability),
      txDetail: tx,
      rxDetail: rx,
      model: tx.model,
      engine: tx.engine,
      requiredSNR: tx.requiredSNR,
      frequency: tx.frequency
    };
  }

  function fmtNum(v, digits = 0) {
    return Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : 'n/a';
  }

  function predictionTooltip(direction, d) {
    if (!d) return `${direction} POTAPlus NOW score`;
    return [
      `${direction} POTAPlus NOW: ${d.nowReliability ?? d.reliability}%`,
      `Raw P.533: ${d.rawReliability ?? 'n/a'}%`,
      `P.533 with mode-specific fade margin: ${d.robustReliability ?? 'n/a'}%`,
      `Predicted SNR: ${fmtNum(d.snr, 1)} dB`,
      `TX power used: ${fmtNum(d.txPowerWatts, 1)} W`,
      `Kp: ${fmtNum(d.kp, 2)}   A: ${fmtNum(d.aIndex, 0)}`,
      `GOES X-ray: ${d.xrayClass || 'n/a'}`,
      `Live-condition reduction: -${fmtNum(d.livePenalty, 0)} points`,
      `SFI: ${fmtNum(d.sfi, 0)}   SSN: ${fmtNum(d.ssn, 0)}`
    ].join('\n');
  }


  let latestLiveConditions = null;

  function renderLiveConditions() {
    const box = document.querySelector('#pp-live-conditions');
    if (!box) return;
    if (!latestLiveConditions) {
      box.textContent = 'Live: waiting for first prediction…';
      return;
    }
    const d = latestLiveConditions;
    box.textContent = `Live: SFI ${fmtNum(d.sfi, 0)}  |  Kp ${fmtNum(d.kp, 2)}  |  A ${fmtNum(d.aIndex, 0)}  |  X-ray ${d.xrayClass || 'n/a'}`;
  }

  function rememberLiveConditions(detail) {
    if (!detail) return;
    latestLiveConditions = detail;
    renderLiveConditions();
  }

  let selectedPrediction = null;

  function closeFloatingPrediction(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
    selectedPrediction = null;
    const old = document.querySelector('#pp-floating-prediction');
    if (old) old.remove();
  }

  function renderSelectedPrediction() {
    let box = document.querySelector('#pp-floating-prediction');

    if (!selectedPrediction) {
      if (box) box.remove();
      return;
    }

    if (!box) {
      box = el('div','pp-floating-prediction');
      box.id = 'pp-floating-prediction';
      document.body.appendChild(box);
    }
    box.innerHTML = '';

    const head = el('div','pp-selected-head');
    head.appendChild(el('strong',null,`${selectedPrediction.direction} prediction details`));
    const clear = el('button','pp-selected-close','−');
    clear.title = 'Close prediction details';
    clear.setAttribute('aria-label','Close prediction details');
    clear.addEventListener('pointerdown', closeFloatingPrediction, true);
    clear.addEventListener('click', closeFloatingPrediction, true);
    head.appendChild(clear);
    box.appendChild(head);

    if (selectedPrediction.park) {
      box.appendChild(el('div','pp-selected-park',selectedPrediction.park));
    }

    const lines = predictionTooltip(selectedPrediction.direction, selectedPrediction.detail).split('\n');
    lines.forEach((line, i) => {
      box.appendChild(el('div', i === 0 ? 'pp-selected-primary' : 'pp-selected-row', line));
    });
    box.appendChild(el('div','pp-selected-foot','This stays open until you press the − button. Clicking another TX/RX bubble moves the details to that path.'));

    const r = selectedPrediction.anchorRect;
    const gap = 8;
    const popupWidth = 255;
    const viewportW = window.innerWidth || document.documentElement.clientWidth;
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    let left = r ? r.right + gap : 12;
    let top = r ? r.top : 12;

    if (left + popupWidth > viewportW - 8 && r) {
      left = Math.max(8, r.left - popupWidth - gap);
    }
    box.style.left = `${Math.max(8, left)}px`;
    box.style.top = `${Math.max(8, Math.min(top, viewportH - 120))}px`;

    requestAnimationFrame(() => {
      const br = box.getBoundingClientRect();
      let adjustedTop = br.top;
      if (br.bottom > viewportH - 8) adjustedTop = Math.max(8, viewportH - br.height - 8);
      if (adjustedTop !== br.top) box.style.top = `${adjustedTop}px`;
    });
  }

  function openSelectedPrediction(badge) {
    if (!badge || !badge.__ppDetail) return;
    const r = badge.getBoundingClientRect();
    selectedPrediction = {
      key: `${badge.__ppPark || ''}|${badge.__ppDirection || ''}`,
      park: badge.__ppPark || '',
      direction: badge.__ppDirection || '',
      detail: badge.__ppDetail,
      anchorRect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    };
    renderSelectedPrediction();
  }

  function wirePredictionBadge(badge, direction, park) {
    badge.__ppDirection = direction;
    badge.__ppPark = park || '';

    badge.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      openSelectedPrediction(badge);
    }, true);

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
  }

  function probClass(p) {
    if (p >= 80) return 'pp-prob-green';
    if (p >= 50) return 'pp-prob-yellow';
    if (p >= 25) return 'pp-prob-orange';
    return 'pp-prob-red';
  }

  function clearCard(card) {
    card.classList.remove('pp-prob-green','pp-prob-yellow','pp-prob-orange','pp-prob-red','pp-hidden');
    card.style.removeProperty('display');
    card.querySelectorAll('.pp-badge').forEach(b => b.remove());
  }

  async function apply() {
    // IMPORTANT: POTAPlus never hides/removes/reorders native POTA cards.
    // It only removes its own decorations and redraws them.
    document.querySelectorAll('.pp-badge').forEach(b => b.remove());

    const cards = getSpotCards();

    cards.forEach(card => {
      card.classList.remove(
        'pp-prob-green',
        'pp-prob-yellow',
        'pp-prob-orange',
        'pp-prob-red',
        'pp-hidden'
      );
      card.style.removeProperty('display');

      if (settings.showPercent) {
        const tx = el('span','pp-badge pp-badge-tx','TX …');
        const rx = el('span','pp-badge pp-badge-rx','RX …');
        const parkRef = cardParkReference(card);
        wirePredictionBadge(tx, 'TX', parkRef);
        wirePredictionBadge(rx, 'RX', parkRef);
        tx.title = 'Calculating POTAPlus NOW score';
        rx.title = 'Calculating POTAPlus NOW score';
        card.appendChild(tx);
        card.appendChild(rx);
      }
    });

    const stat = document.querySelector('#pp-status');
    if (stat) stat.textContent = `${cards.length} POTA cards — calculating real P.533…`;

    let completed = 0;
    let realCount = 0;
    let lastError = '';
    const queue = cards.slice();

    const workers = Array.from({length: Math.min(1, queue.length)}, async () => {
      while (queue.length) {
        const card = queue.shift();
        if (!card || !document.contains(card)) continue;

        try {
          const p = await realP533ForCard(card);
          realCount++;

          if (settings.showColors) {
            card.classList.remove(
              'pp-prob-green',
              'pp-prob-yellow',
              'pp-prob-orange',
              'pp-prob-red'
            );
            card.classList.add(probClass(p.twoWay));
          }

          if (settings.showPercent) {
            const tx = card.querySelector('.pp-badge-tx');
            const rx = card.querySelector('.pp-badge-rx');

            if (tx) {
              tx.textContent = `TX ${p.tx}%`;
              tx.__ppDetail = p.txDetail;
              tx.title = predictionTooltip('TX', p.txDetail);
            }
            if (rx) {
              rx.textContent = `RX ${p.rx}%`;
              rx.__ppDetail = p.rxDetail;
              rx.title = predictionTooltip('RX', p.rxDetail);
            }
          }
        } catch (err) {
          lastError = err?.message || String(err);
          if (settings.showPercent) {
            const tx = card.querySelector('.pp-badge-tx');
            const rx = card.querySelector('.pp-badge-rx');
            const msg = lastError;
            const code = /Current location is not available/i.test(msg) ? 'LOC' :
              /park|coordinates/i.test(msg) ? 'PARK' : 'P533';
            if (tx) {
              tx.textContent = `TX ${code}`;
              tx.title = msg || 'P.533 result unavailable';
            }
            if (rx) {
              rx.textContent = `RX ${code}`;
              rx.title = msg || 'P.533 result unavailable';
            }
          }
        } finally {
          completed++;
          if (stat) {
            stat.textContent =
              `${realCount}/${completed} POTA cards with real P.533 results`;
          }
        }
      }
    });

    await Promise.all(workers);

    if (stat) {
      if (realCount > 0) {
        stat.textContent =
          `${realCount}/${cards.length} visible cards using POTAPlus NOW / local P.533`;
      } else if (cards.length > 0) {
        const cleanError = /coefficient|download|http|fetch|network/i.test(lastError || '')
          ? 'Local P.533 data unavailable — click Recalculate current spots to retry'
          : (lastError || 'no result returned');
        stat.textContent = `P.533 error: ${cleanError}`;
      } else {
        stat.textContent = 'No visible POTA activator cards found';
      }
    }
  }

  function showInfoModal() {
    const backdrop = document.querySelector('#pp-info-backdrop');
    if (backdrop) backdrop.style.display = 'flex';
  }

  function hideInfoModal() {
    const backdrop = document.querySelector('#pp-info-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  function buildInfoModal() {
    const backdrop = el('div','pp-info-backdrop');
    backdrop.id = 'pp-info-backdrop';
    backdrop.style.display = 'none';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) hideInfoModal();
    });

    const modal = el('div','pp-info-modal');

    const titleRow = el('div','pp-info-title-row');
    titleRow.appendChild(el('div','pp-info-title','POTAPlus Help'));

    const close = el('button','pp-info-close','X');
    close.title = 'Close';
    close.onclick = hideInfoModal;
    titleRow.appendChild(close);
    modal.appendChild(titleRow);

    const section1 = el('div','pp-info-section');
    section1.appendChild(el('div','pp-info-heading','POTAPlus NOW + ITU-R P.533-14'));
    const ul1 = el('ul','pp-info-list');
    [
      'Shows separate TX and RX POTAPlus NOW scores for the two directions of the QSO. Raw ITU-R P.533-14 remains underneath the NOW score. Hover a TX/RX bubble for the quick tooltip, or click the bubble to pin the full details open.',
      'The local ITU-R P.533-14 engine calculates the path twice: once at the mode decode threshold and again with a mode-specific robustness margin. PHONE uses +6 dB, CW +10 dB, and FT8/FT4/FT2 +15 dB. POTAPlus NOW uses that second result, then applies current NOAA Kp/A and GOES X-ray conditions. The raw P.533 number is never altered or hidden.',
      'Card colors use the POTAPlus NOW score: green is best, then yellow, orange, and red.',
      'My TX Power controls the outbound TX prediction. Assumed POTA Activator Power controls the return RX prediction; the default is 75 W. SFI/Kp/A/X-ray are shown directly in the panel. TX is shown at the upper-right, RX at the lower-right. The card color follows the lower NOW score. Click either bubble to open raw P.533, fade-margin P.533, SNR, Kp/A, X-ray class, and the live-condition reduction in a persistent popup beside that bubble.'
    ].forEach(t => ul1.appendChild(el('li',null,t)));
    section1.appendChild(ul1);
    modal.appendChild(section1);

    const bubbleHelp = el('div','pp-info-section');
    bubbleHelp.appendChild(el('div','pp-info-heading','HOW TO — Read the TX/RX prediction bubbles'));
    const bubbleList = el('ul','pp-info-list');
    [
      'For a quick look, hover over the black TX or RX percentage bubble. For a stable view, CLICK the bubble — the full prediction details open beside that bubble and stay there through redraws and POTA spot refreshes.',
      'TX is the predicted path from you to the activator. RX is the predicted path from the activator back to you.',
      'The popup shows the POTAPlus NOW score, raw ITU-R P.533 percentage, mode-specific fade-margin P.533 percentage, predicted SNR, power used, Kp/A, X-ray class, live-condition reduction, SFI, and SSN.',
      'The large percentage printed in the bubble is POTAPlus NOW. The raw P.533 result is kept separately inside the persistent popup.',
      'The popup stays open until you press its − button. Clicking another TX/RX bubble moves the popup to that path. It is independent of the POTAPlus panel, so it remains visible even when POTAPlus is minimized.',
      'The card color follows the lower of the TX and RX POTAPlus NOW scores, because a two-way QSO needs both directions to work.'
    ].forEach(t => bubbleList.appendChild(el('li',null,t)));
    bubbleHelp.appendChild(bubbleList);
    modal.appendChild(bubbleHelp);

    const section2 = el('div','pp-info-section');
    section2.appendChild(el('div','pp-info-heading','How to use POTAPlus'));
    const ul2 = el('ul','pp-info-list');
    [
      'Your callsign should fill automatically.',
      'Your Maidenhead grid should locate automatically.',
      'If you move campsites or operating locations, click Locate.',
      'Select the Band and Mode you want using POTA.app’s filters above the spot list. POTAPlus automatically uses the visible spots and each spot’s actual mode for its predictions; there are no separate POTAPlus mode buttons.',
      'Click − to collapse the panel.',
      'Click the green + to reopen it.',
      'POTA.app normally refreshes its spots every 60 seconds. If you pause POTA updates, the displayed list can remain unchanged for up to 300 seconds.',
      'POTAPlus uses the spots currently displayed by POTA.app. The Recalculate current spots button recalculates those visible cards; it does not force POTA.app to refresh.'
    ].forEach(t => ul2.appendChild(el('li',null,t)));
    section2.appendChild(ul2);
    modal.appendChild(section2);

    const footer = el('div','pp-info-footer');
    const ok = el('button','pp-info-ok','OK');
    ok.onclick = hideInfoModal;
    footer.appendChild(ok);
    modal.appendChild(footer);

    backdrop.appendChild(modal);
    return backdrop;
  }

  function setMinimized(value) {
    settings.minimized = !!value;
    renderState();
    save();
  }

  function buildUI() {
    document.getElementById(ID)?.remove();

    const root = el('div');
    root.id = ID;

    const mini = el('button','pp-mini','+');
    mini.title = 'Open POTAPlus';
    const openPanel = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      setMinimized(false);
    };
    mini.addEventListener('pointerdown', openPanel, true);
    mini.addEventListener('click', openPanel, true);
    root.appendChild(mini);

    const panel = el('div','pp-panel');
    root.appendChild(panel);

    const head = el('div','pp-head');
    head.appendChild(el('div','pp-title','POTAPlus Hunter Beta v0.36.6'));

    const minimize = el('button','pp-headbtn','−');
    minimize.title = 'Minimize';
    const closePanel = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      setMinimized(true);
    };
    minimize.addEventListener('pointerdown', closePanel, true);
    minimize.addEventListener('click', closePanel, true);
    head.appendChild(minimize);
    panel.appendChild(head);

    const body = el('div','pp-body');

    const callRow = el('div','pp-field');
    callRow.appendChild(el('label',null,'Your callsign'));
    const call = el('input','pp-input');
    call.id = 'pp-callsign';
    call.placeholder = 'N7OMI';
    call.value = settings.callsign || '';
    call.onchange = () => {
      settings.callsign = call.value.trim().toUpperCase();
      call.value = settings.callsign;
      save();
    };
    callRow.appendChild(call);
    body.appendChild(callRow);

    const gridRow = el('div','pp-field');
    gridRow.appendChild(el('label',null,'Current Maidenhead grid'));

    const gridWrap = el('div','pp-gridwrap');
    const grid = el('input','pp-input');
    grid.id = 'pp-grid';
    grid.placeholder = 'Auto locating…';
    grid.maxLength = 8;
    grid.value = settings.grid || '';
    grid.onchange = () => {
      settings.grid = grid.value.trim().toUpperCase();
      settings.gridSource = 'MANUAL';
      const manualPoint = maidenheadToLatLon(settings.grid);
      if (manualPoint) {
        settings.latitude = manualPoint.lat;
        settings.longitude = manualPoint.lon;
      }
      grid.value = settings.grid;
      save();
      apply();
    };
    gridWrap.appendChild(grid);

    const locate = el('button','pp-locate','Locate');
    locate.title = 'Use this device’s current location';
    locate.onclick = () => locateGrid(true);
    gridWrap.appendChild(locate);
    gridRow.appendChild(gridWrap);

    const gs = el('div','pp-small', settings.gridSource === 'CURRENT LOCATION' ? 'Current location' : '');
    gs.id = 'pp-grid-status';
    gridRow.appendChild(gs);
    body.appendChild(gridRow);

    const powerRow = el('div','pp-power-grid');
    const myPower = el('div','pp-field');
    myPower.appendChild(el('label',null,'My TX Power (W)'));
    const myPowerInput = el('input','pp-input');
    myPowerInput.type = 'number';
    myPowerInput.min = '0.1';
    myPowerInput.max = '2000';
    myPowerInput.step = '0.5';
    myPowerInput.value = String(settings.myTxPower ?? 100);
    myPowerInput.onchange = () => {
      const v = Math.min(2000, Math.max(0.1, Number(myPowerInput.value) || 100));
      settings.myTxPower = v;
      myPowerInput.value = String(v);
      save();
      apply();
    };
    myPower.appendChild(myPowerInput);
    powerRow.appendChild(myPower);

    const activatorPower = el('div','pp-field');
    activatorPower.appendChild(el('label',null,'Assumed POTA Activator (W)'));
    const activatorPowerInput = el('input','pp-input');
    activatorPowerInput.type = 'number';
    activatorPowerInput.min = '0.1';
    activatorPowerInput.max = '2000';
    activatorPowerInput.step = '0.5';
    activatorPowerInput.value = String(settings.assumedPotaPower ?? 75);
    activatorPowerInput.onchange = () => {
      const v = Math.min(2000, Math.max(0.1, Number(activatorPowerInput.value) || 75));
      settings.assumedPotaPower = v;
      activatorPowerInput.value = String(v);
      save();
      apply();
    };
    activatorPower.appendChild(activatorPowerInput);
    powerRow.appendChild(activatorPower);
    body.appendChild(powerRow);

    const live = el('div','pp-live-conditions','Live: waiting for first prediction…');
    live.id = 'pp-live-conditions';
    body.appendChild(live);
    renderLiveConditions();

    const filterInstruction = el('div','pp-note',
      'Select the Band and Mode you want in the POTA.app filters above. POTAPlus automatically uses the visible spots and each spot’s actual mode for its predictions.'
    );
    body.appendChild(filterInstruction);

    const voaRow = el('div','pp-voa-row');
    const lbl = el('div','pp-voa-label','POTAPlus NOW Path Prediction');
    const info = el('button','pp-info','i');
    info.title = 'Click for help';
    info.onclick = showInfoModal;
    voaRow.appendChild(lbl);
    voaRow.appendChild(info);
    const press = el('span','pp-press','← Press');
    voaRow.appendChild(press);
    body.appendChild(voaRow);

    const opts = el('div','pp-options');
    const c1 = el('label'); const cb1 = document.createElement('input');
    cb1.type='checkbox'; cb1.checked=!!settings.showColors;
    cb1.onchange=()=>{settings.showColors=cb1.checked; save(); apply();};
    c1.append(cb1, document.createTextNode(' Light card overlay + border'));
    opts.appendChild(c1);

    const c2 = el('label'); const cb2 = document.createElement('input');
    cb2.type='checkbox'; cb2.checked=!!settings.showPercent;
    cb2.onchange=()=>{settings.showPercent=cb2.checked; save(); apply();};
    c2.append(cb2, document.createTextNode(' Show TX/RX %'));
    opts.appendChild(c2);
    body.appendChild(opts);

    const legend = el('div','pp-legend');
    [
      ['pp-dot green','80–100%'],
      ['pp-dot yellow','50–79%'],
      ['pp-dot orange','25–49%'],
      ['pp-dot red','0–24%']
    ].forEach(([c,t]) => {
      const x = el('div','pp-legitem');
      x.appendChild(el('span',c));
      x.appendChild(document.createTextNode(t));
      legend.appendChild(x);
    });
    body.appendChild(legend);

    body.appendChild(el('div','pp-note',
      'v0.36.6 BUBBLE POPUP: propagation math is unchanged. Click a TX/RX bubble for a persistent popup beside the bubble; press − to close it. The popup remains visible even when POTAPlus is minimized.'
    ));

    const stat = el('div','pp-status');
    stat.id='pp-status';
    body.appendChild(stat);

    const refresh = el('button','pp-refresh','Recalculate current spots');
    refresh.onclick = apply;
    body.appendChild(refresh);

    panel.appendChild(body);
    root.appendChild(buildInfoModal());
    document.documentElement.appendChild(root);
    renderState();

    setTimeout(autoDetectCallsign, 500);
    if (!settings.grid || settings.gridSource !== 'CURRENT LOCATION') {
      setTimeout(() => locateGrid(false), 800);
    }
  }

  function renderState() {
    const root = document.getElementById(ID);
    if (!root) return;
    root.classList.toggle('is-minimized', !!settings.minimized);
  }

  let lastUrl = location.href;

  function mutationIsPotaplusOnly(mutation) {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target?.parentElement;

    if (target && target.closest && target.closest('#' + ID)) {
      return true;
    }

    const changedNodes = [
      ...(mutation.addedNodes || []),
      ...(mutation.removedNodes || [])
    ];

    if (!changedNodes.length) {
      return false;
    }

    return changedNodes.every(node => {
      if (!(node instanceof Element)) {
        return true;
      }

      return (
        node.id === ID ||
        node.classList.contains('pp-badge') ||
        node.classList.contains('pp-badge-tx') ||
        node.classList.contains('pp-badge-rx') ||
        !!node.closest('#' + ID)
      );
    });
  }

  const observer = new MutationObserver(mutations => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => { buildUI(); apply(); }, 700);
      return;
    }

    // Ignore DOM changes made by POTAPlus itself. The previous build
    // saw its own badge redraws as page changes, causing a refresh loop
    // about every 1.2 seconds and making the highlighted cards blink.
    const hasNativePotaChange = mutations.some(
      mutation => !mutationIsPotaplusOnly(mutation)
    );

    if (!hasNativePotaChange) {
      return;
    }

    clearTimeout(window.__ppScanTimer);
    window.__ppScanTimer = setTimeout(() => {
      autoDetectCallsign();
      apply();
    }, 1200);
  });

  load(() => {
    buildUI();
    apply();
    observer.observe(document.documentElement, {subtree:true, childList:true});
    setInterval(apply, 120000);
  });

})();
