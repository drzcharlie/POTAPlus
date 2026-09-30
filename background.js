'use strict';

import createP533Module from './p533.mjs';

// POTAPlus v0.35.2 — mode-calibrated LOCAL ITU-R P.533-14 + live-condition NOW score.
// Propagation math runs in the bundled p533.wasm inside this extension.
// The current month's official coefficient tables are downloaded as DATA only
// from OpenHamClock's P.533 data proxy and cached by the browser.

const NOAA_F107_URL = 'https://services.swpc.noaa.gov/json/f107_cm_flux.json';
const NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const NOAA_XRAY_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json';
const P533_DATA_BASE = 'https://openhamclock.com/api/p533-data/';
const P533_DATA_VERSION = 'v14.3';
const DECILE_NAME = 'P1239-3 Decile Factors.txt';

const parkCache = new Map();
const propCache = new Map();
const monthDataCache = new Map();
let decileCache = null;
let solarCache = null;
let liveSpaceWeatherCache = null;
let engineQueue = Promise.resolve();

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function pickNumber(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      const n = Number(obj[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function maidenheadToLatLon(grid) {
  if (!grid || grid.length < 4) return null;
  const g = String(grid).trim().toUpperCase();
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

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw new Error(`Unexpected non-JSON response (HTTP ${response.status})`); }
    if (!response.ok) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url, timeoutMs = 30000) {
  const cacheName = `potaplus-p533-data-${P533_DATA_VERSION}`;
  let cache = null;
  try {
    cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit?.ok) return new Uint8Array(await hit.arrayBuffer());
  } catch {}

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`P.533 coefficient data unavailable: HTTP ${response.status}`);
    try { if (cache) await cache.put(url, response.clone()); } catch {}
    return new Uint8Array(await response.arrayBuffer());
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('P.533 coefficient data download timed out');
    if (/Failed to fetch|NetworkError/i.test(String(err?.message || err))) {
      throw new Error('P.533 coefficient data could not be downloaded');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support gzip decompression required by local P.533');
  }
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dataUrl(asset) {
  return `${P533_DATA_BASE}${asset}?v=${encodeURIComponent(P533_DATA_VERSION)}`;
}

async function loadCompressedAsset(asset) {
  return gunzip(await fetchBytes(dataUrl(asset)));
}

async function getCoefficientFiles(month) {
  const mm = String(month).padStart(2, '0');
  if (!monthDataCache.has(mm)) {
    monthDataCache.set(mm, Promise.all([
      loadCompressedAsset(`ionos${mm}.bin.gz`),
      loadCompressedAsset(`COEFF${mm}W.txt.gz`)
    ]).then(([ionos, coeff]) => [
      { name: `ionos${mm}.bin`, bytes: ionos },
      { name: `COEFF${mm}W.txt`, bytes: coeff }
    ]).catch(err => {
      monthDataCache.delete(mm);
      throw err;
    }));
  }

  if (!decileCache) {
    decileCache = loadCompressedAsset('P1239-3-Decile-Factors.txt.gz')
      .then(bytes => ({ name: DECILE_NAME, bytes }))
      .catch(err => {
        decileCache = null;
        throw err;
      });
  }

  const [monthly, decile] = await Promise.all([monthDataCache.get(mm), decileCache]);
  return [...monthly, decile];
}

async function getPark(reference) {
  const ref = String(reference || '').toUpperCase();
  if (!ref) throw new Error('Missing park reference');

  const cached = parkCache.get(ref);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return cached.data;

  const data = await fetchJson(`https://api.pota.app/park/${encodeURIComponent(ref)}`, {}, 10000);
  let lat = pickNumber(data, ['latitude', 'lat', 'parkLatitude', 'parkLat']);
  let lon = pickNumber(data, ['longitude', 'lon', 'lng', 'parkLongitude', 'parkLon']);

  if (lat === null || lon === null) {
    const p = maidenheadToLatLon(data.grid6 || data.grid || data.grid4 || data.maidenhead || '');
    if (p) { lat = p.lat; lon = p.lon; }
  }

  if (lat === null || lon === null) throw new Error(`No park coordinates returned for ${ref}`);

  const out = { reference: ref, lat, lon, name: data.name || data.parkName || '' };
  parkCache.set(ref, { at: Date.now(), data: out });
  return out;
}

function requiredSnrForMode(mode) {
  const m = String(mode || '').trim().toUpperCase();
  if (m === 'FT8') return -19;
  if (m === 'FT4' || m === 'FT2') return -15;
  if (m === 'CW') return 5;
  return 15; // PHONE / SSB
}

function robustMarginForMode(mode) {
  const m = String(mode || '').trim().toUpperCase();
  if (m === 'FT8' || m === 'FT4' || m === 'FT2') return 15;
  if (m === 'CW') return 10;
  return 6; // PHONE / SSB remains at the v0.35.1 calibration
}

async function getCurrentSolar() {
  const now = Date.now();
  if (solarCache && now - solarCache.at < 30 * 60 * 1000) return solarCache.data;

  let sfi = 150;
  let ssn = 100;
  let source = 'default SSN 100';
  try {
    const data = await fetchJson(NOAA_F107_URL, { cache: 'no-store' }, 7000);
    if (Array.isArray(data) && data.length) {
      const latest = data.reduce((best, row) => {
        const t = String(row?.time_tag || '');
        return t > String(best?.time_tag || '') ? row : best;
      }, null);
      const flux = Number(latest?.flux);
      if (Number.isFinite(flux) && flux > 0) {
        sfi = Math.round(flux);
        ssn = Math.max(0, Math.round((sfi - 67) / 0.97));
        source = 'NOAA SWPC F10.7';
      }
    }
  } catch {}

  const out = { sfi, ssn, source };
  solarCache = { at: now, data: out };
  return out;
}


function latestByTime(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.reduce((best, row) => {
    const t = String(row?.time_tag || row?.time || '');
    return t > String(best?.time_tag || best?.time || '') ? row : best;
  }, null);
}

function xrayClassFromFlux(flux) {
  const f = Number(flux);
  if (!Number.isFinite(f) || f <= 0) return 'A';
  if (f >= 1e-4) return 'X';
  if (f >= 1e-5) return 'M';
  if (f >= 1e-6) return 'C';
  if (f >= 1e-7) return 'B';
  return 'A';
}

function geomagneticPenalty(kp, aIndex) {
  const k = Number(kp);
  const a = Number(aIndex);
  let kpPenalty = 0;
  if (Number.isFinite(k)) {
    if (k >= 6) kpPenalty = 35;
    else if (k >= 5) kpPenalty = 25;
    else if (k >= 4) kpPenalty = 15;
    else if (k >= 3) kpPenalty = 8;
    else if (k >= 2) kpPenalty = 3;
  }
  let aPenalty = 0;
  if (Number.isFinite(a)) {
    if (a >= 50) aPenalty = 25;
    else if (a >= 30) aPenalty = 15;
    else if (a >= 16) aPenalty = 8;
    else if (a >= 8) aPenalty = 3;
  }
  return Math.max(kpPenalty, aPenalty);
}

function xrayPenalty(xrayClass) {
  if (xrayClass === 'X') return 30;
  if (xrayClass === 'M') return 12;
  if (xrayClass === 'C') return 2;
  return 0;
}

async function getLiveSpaceWeather() {
  const now = Date.now();
  if (liveSpaceWeatherCache && now - liveSpaceWeatherCache.at < 5 * 60 * 1000) {
    return liveSpaceWeatherCache.data;
  }

  let kp = null;
  let aIndex = null;
  let xrayFlux = null;
  let xrayClass = 'A';
  const sources = [];

  try {
    const rows = await fetchJson(NOAA_KP_URL, { cache: 'no-store' }, 7000);
    const latest = latestByTime(rows);
    if (latest) {
      const k = Number(latest.Kp ?? latest.kp);
      const a = Number(latest.a_running ?? latest.a_index ?? latest.A);
      if (Number.isFinite(k)) kp = k;
      if (Number.isFinite(a)) aIndex = a;
      sources.push('NOAA Kp/A');
    }
  } catch {}

  try {
    const rows = await fetchJson(NOAA_XRAY_URL, { cache: 'no-store' }, 7000);
    if (Array.isArray(rows)) {
      const longChannel = rows.filter(row => {
        const energy = String(row?.energy || row?.channel || row?.band || '').toLowerCase();
        return energy.includes('0.1-0.8') || energy.includes('0.1 - 0.8') || energy.includes('long');
      });
      const latest = latestByTime(longChannel.length ? longChannel : rows);
      const f = Number(latest?.flux);
      if (Number.isFinite(f) && f > 0) {
        xrayFlux = f;
        xrayClass = xrayClassFromFlux(f);
      }
      sources.push('NOAA GOES X-ray');
    }
  } catch {}

  const geomagPenalty = geomagneticPenalty(kp, aIndex);
  const flarePenalty = xrayPenalty(xrayClass);
  const livePenalty = clamp(geomagPenalty + flarePenalty, 0, 45);
  const out = { kp, aIndex, xrayFlux, xrayClass, geomagPenalty, flarePenalty, livePenalty, source: sources.join(' + ') || 'live data unavailable' };
  liveSpaceWeatherCache = { at: now, data: out };
  return out;
}

function normalizedFrequencyMHz(frequencyMHz) {
  const f = Number(frequencyMHz);
  if (!Number.isFinite(f)) throw new Error('Frequency is missing');
  if (f > 30) throw new Error('ITU-R P.533 supports HF frequencies up to 30 MHz');
  return Math.max(2.0, f);
}

function buildInputConfig(p) {
  const hour = p.hour === 0 ? 24 : p.hour;
  return `PathName "POTAPlus"
PathTXName "TX"
Path.L_tx.lat ${p.txLat.toFixed(4)}
Path.L_tx.lng ${p.txLon.toFixed(4)}
TXAntFilePath "ISOTROPIC"
TXGOS 0.0
PathRXName "RX"
Path.L_rx.lat ${p.rxLat.toFixed(4)}
Path.L_rx.lng ${p.rxLon.toFixed(4)}
RXAntFilePath "ISOTROPIC"
RXGOS 0.0
AntennaOrientation "TX2RX"
Path.year ${p.year}
Path.month ${p.month}
Path.hour ${hour}
Path.SSN ${p.ssn}
Path.frequency ${p.frequency.toFixed(3)}
Path.txpower ${(10 * Math.log10(Math.max(1, p.txPower) / 1000)).toFixed(1)}
Path.BW 3000
Path.SNRr ${p.requiredSNR}
Path.SNRXXp 90
Path.ManMadeNoise "RESIDENTIAL"
Path.Modulation ANALOG
Path.SorL SHORTPATH
LL.lat ${p.rxLat.toFixed(4)}
LL.lng ${p.rxLon.toFixed(4)}
LR.lat ${p.rxLat.toFixed(4)}
LR.lng ${p.rxLon.toFixed(4)}
UL.lat ${p.rxLat.toFixed(4)}
UL.lng ${p.rxLon.toFixed(4)}
UR.lat ${p.rxLat.toFixed(4)}
UR.lng ${p.rxLon.toFixed(4)}
DataFilePath "/data/"
RptFilePath "/tmp/"
RptFileFormat "RPT_PR | RPT_SNR | RPT_BCR"
`;
}

function parseReport(text, requestedFrequency) {
  const lines = String(text || '').split('\n');
  let inData = false;
  let best = null;
  let bestDelta = Infinity;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.includes('Calculated Parameters') && !line.includes('End')) {
      inData = true;
      continue;
    }
    if (!inData) continue;
    if (line.includes('End Calculated')) break;
    if (!line || line.startsWith('*') || line.startsWith('-') || line.startsWith('Column')) continue;

    const parts = line.split(',').map(x => x.trim());
    if (parts.length < 6) continue;
    const freq = Number(parts[2]);
    const sdbw = Number(parts[3]);
    const snr = Number(parts[4]);
    const reliability = Number(parts[5]);
    if (!Number.isFinite(freq) || !Number.isFinite(reliability)) continue;

    const delta = Math.abs(freq - requestedFrequency);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = { freq, sdbw, snr, reliability };
    }
  }

  if (!best) throw new Error('Local P.533 produced no frequency result');
  return best;
}

async function runLocalPrediction(params) {
  const dataFiles = await getCoefficientFiles(params.month);
  let stdout = '';
  let stderr = '';

  const Module = await createP533Module({
    noInitialRun: true,
    noExitRuntime: true,
    locateFile: path => chrome.runtime.getURL(path),
    print: t => { stdout += String(t) + '\n'; },
    printErr: t => { stderr += String(t) + '\n'; }
  });

  const FS = Module.FS;
  try { FS.mkdirTree('/data'); } catch {}
  try { FS.mkdirTree('/tmp'); } catch {}

  for (const file of dataFiles) FS.writeFile(`/data/${file.name}`, file.bytes);
  FS.writeFile('/input.txt', buildInputConfig(params));
  try { FS.unlink('/tmp/output.txt'); } catch {}

  const rc = Module.callMain(['/input.txt', '/tmp/output.txt']);
  if (rc !== 0) throw new Error(`Local P.533 returned code ${rc}${stderr ? ': ' + stderr.slice(-180) : ''}`);

  let report;
  try { report = new TextDecoder().decode(FS.readFile('/tmp/output.txt')); }
  catch { throw new Error('Local P.533 did not create a report'); }

  return parseReport(report, params.frequency);
}

function serializeEngineJob(fn) {
  const run = engineQueue.then(fn, fn);
  engineQueue = run.catch(() => {});
  return run;
}

async function getRealPrediction(args) {
  const txLat = Number(args.txLat);
  const txLon = Number(args.txLon);
  const rxLat = Number(args.rxLat);
  const rxLon = Number(args.rxLon);
  for (const [name, value] of Object.entries({ txLat, txLon, rxLat, rxLon })) {
    if (!Number.isFinite(value)) throw new Error(`Invalid ${name}`);
  }

  const frequency = normalizedFrequencyMHz(args.frequencyMHz);
  const txPower = Math.min(2000, Math.max(0.1, Number(args.power) || 100));
  const requiredSNR = requiredSnrForMode(args.mode);
  const now = new Date();
  const solar = await getCurrentSolar();
  const month = now.getUTCMonth() + 1;

  const key = [
    txLat.toFixed(2), txLon.toFixed(2), rxLat.toFixed(2), rxLon.toFixed(2),
    String(args.mode || '').toUpperCase(), txPower.toFixed(1), frequency.toFixed(3),
    now.getUTCFullYear(), month, now.getUTCDate(), now.getUTCHours(), solar.ssn
  ].join('|');

  const cached = propCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;

  const fadeMarginDb = robustMarginForMode(args.mode);
  const robustRequiredSNR = requiredSNR + fadeMarginDb;
  const live = await getLiveSpaceWeather();

  // ITURHFProp expects Path.txpower in dB(kW), with -30 dB(kW) as its
  // documented lower limit (1 W). For sub-1 W QRP, run at 1 W and raise
  // the required SNR by the equivalent power deficit; this preserves the
  // link-budget effect without feeding the engine an out-of-range value.
  const engineTxPower = Math.max(1, txPower);
  const subWattDeficitDb = txPower < 1 ? 10 * Math.log10(1 / txPower) : 0;
  const engineRequiredSNR = requiredSNR + subWattDeficitDb;
  const engineRobustRequiredSNR = robustRequiredSNR + subWattDeficitDb;

  const [rawRow, robustRow] = await Promise.all([
    serializeEngineJob(() => runLocalPrediction({
      txLat, txLon, rxLat, rxLon,
      year: now.getUTCFullYear(), month, hour: now.getUTCHours(),
      ssn: solar.ssn, txPower: engineTxPower, requiredSNR: engineRequiredSNR, frequency
    })),
    serializeEngineJob(() => runLocalPrediction({
      txLat, txLon, rxLat, rxLon,
      year: now.getUTCFullYear(), month, hour: now.getUTCHours(),
      ssn: solar.ssn, txPower: engineTxPower, requiredSNR: engineRobustRequiredSNR, frequency
    }))
  ]);

  if (subWattDeficitDb > 0) {
    if (Number.isFinite(rawRow.snr)) rawRow.snr -= subWattDeficitDb;
    if (Number.isFinite(robustRow.snr)) robustRow.snr -= subWattDeficitDb;
  }

  const rawReliability = clamp(Math.round(rawRow.reliability), 0, 99);
  const robustReliability = clamp(Math.round(robustRow.reliability), 0, 99);
  const nowReliability = clamp(robustReliability - live.livePenalty, 0, 99);

  const out = {
    reliability: nowReliability,
    nowReliability,
    rawReliability,
    robustReliability,
    model: 'ITU-R P.533-14',
    engine: 'LOCAL ITURHFProp WASM',
    requiredSNR,
    robustRequiredSNR,
    fadeMarginDb,
    frequency: rawRow.freq,
    requestedFrequency: Number(args.frequencyMHz),
    txPowerWatts: txPower,
    sdbw: Number.isFinite(rawRow.sdbw) ? rawRow.sdbw : null,
    snr: Number.isFinite(rawRow.snr) ? rawRow.snr : null,
    robustSnr: Number.isFinite(robustRow.snr) ? robustRow.snr : null,
    ssn: solar.ssn,
    sfi: solar.sfi,
    solarSource: solar.source,
    kp: live.kp,
    aIndex: live.aIndex,
    xrayFlux: live.xrayFlux,
    xrayClass: live.xrayClass,
    geomagPenalty: live.geomagPenalty,
    flarePenalty: live.flarePenalty,
    livePenalty: live.livePenalty,
    liveSource: live.source,
    calculation: 'local browser WASM + live NOAA conditions'
  };
  propCache.set(key, { at: Date.now(), data: out });
  return out;
}

async function getP533Health() {
  const now = new Date();
  await getCoefficientFiles(now.getUTCMonth() + 1);
  return {
    ok: true,
    model: 'ITU-R P.533-14',
    engine: 'LOCAL ITURHFProp WASM',
    wasm: chrome.runtime.getURL('p533.wasm'),
    coefficientMonth: now.getUTCMonth() + 1
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'POTAPLUS_GET_PARK') {
        sendResponse({ ok: true, data: await getPark(msg.reference) });
        return;
      }
      if (msg?.type === 'POTAPLUS_P533') {
        sendResponse({ ok: true, data: await getRealPrediction({
          txLat: msg.txLat ?? msg.deLat,
          txLon: msg.txLon ?? msg.deLon,
          rxLat: msg.rxLat ?? msg.dxLat,
          rxLon: msg.rxLon ?? msg.dxLon,
          mode: msg.mode,
          power: msg.power,
          frequencyMHz: msg.frequencyMHz
        }) });
        return;
      }
      if (msg?.type === 'POTAPLUS_P533_HEALTH') {
        sendResponse({ ok: true, data: await getP533Health() });
        return;
      }
      sendResponse({ ok: false, error: 'Unknown request' });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});
