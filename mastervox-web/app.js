'use strict';

const element = id => document.getElementById(id);
const ui = Object.fromEntries(['preset','auto','file','track-name','track-info','wave','wave-empty','seek','play',
  'compare','mono','time','controls','peak','reduction','render','export','status']
  .map(id => [id, element(id)]));
const groups = [
  ['Entrée et égalisation', [
    ['input','Entrée',-24,24,'dB'], ['low','Graves',-9,9,'dB'],
    ['mid','Médiums',-9,9,'dB'], ['high','Aigus',-9,9,'dB']
  ]],
  ['Compresseur', [
    ['threshold','Seuil',-40,0,'dB'], ['ratio','Ratio',1,8,':1'],
    ['attack','Attaque',1,100,'ms'], ['release','Relâchement',20,500,'ms']
  ]],
  ['Saturation et stéréo', [
    ['drive','Saturation',0,100,'%'], ['width','Largeur',0,180,'%'],
    ['output','Sortie',-24,24,'dB']
  ]],
  ['Limiteur', [
    ['ceiling','Plafond',-12,0,'dBFS'], ['limitRelease','Relâchement',20,500,'ms']
  ]]
];
const presets = [
  [0,0,0,0,0,2,25,150,0,100,0,-1,90],
  [0,1.5,-.7,.5,-13,2,33,120,12,105,1.5,-1,100],
  [0,-.5,.4,1.4,-11,1.5,24,150,4,113,1,-1,90],
  [0,.4,-.4,.3,-18,2,20,180,6,100,2,-1,120]
];
const sliders = [];
const consolePanel = document.querySelector('.console');
const playbackPanel = document.querySelector('.studio');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let context, monitoring, analyzer, original, processed, source, activeWorker;
let generation = 0;
let revision = 0;
let renderedRevision = -1;
let playingSince = 0;
let offset = 0;
let comparing = false;
let automaticSettings;
let wavePeaks = [];
let filename = '';
let busy = false;
let analyzing = false;

for (const [title, fields] of groups) {
  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = title;
  const row = document.createElement('div');
  row.className = 'quantum-values';
  fieldset.append(legend, row);
  for (const [key, name, min, max, unit] of fields) {
    const label = document.createElement('label');
    const nameSpan = document.createElement('span');
    const slider = document.createElement('input');
    const suffix = document.createElement('span');
    label.className = 'quantum-value';
    nameSpan.textContent = name;
    suffix.textContent = unit;
    suffix.id = key + '-unit';
    slider.setAttribute('aria-label', name);
    slider.setAttribute('aria-describedby', suffix.id);
    Object.assign(slider, { type:'number', inputMode:'decimal', min, max, step:.1, id:key });
    let numericValue = min;
    const update = () => { numericValue = slider.valueAsNumber; quantum.invalidate(); };
    const edit = () => {
      const next = slider.valueAsNumber;
      if (!Number.isFinite(next) || next < min || next > max) return;
      update();
      ui.preset.value = '';
      settingsChanged();
    };
    slider.addEventListener('input', edit);
    slider.addEventListener('change', () => {
      const next = slider.valueAsNumber;
      slider.value = Number.isFinite(next) ? Math.min(max, Math.max(min, next)).toFixed(1) : numericValue;
      edit();
    });
    sliders.push({ key, name, unit, slider, update, value: () => numericValue });
    label.append(nameSpan, slider, suffix);
    row.append(label);
  }
  ui.controls.append(fieldset);
}

const quantum = createQuantumInterface({
  controls: sliders,
  panels: [...ui.controls.children],
  readAudio: () => source ? analyzer : null
});

function setPreset(index) {
  sliders.forEach(({ slider, update }, i) => {
    slider.value = presets[index][i];
    update();
  });
}
setPreset(0);
ui.preset.addEventListener('change', () => {
  if (ui.preset.value === 'auto') {
    if (original) render(true);
    return;
  }
  setPreset(Number(ui.preset.value));
  settingsChanged();
});

function settingsChanged() {
  revision++;
  refreshButtons();
  if (original && !busy) ui.status.textContent = 'Clique sur Appliquer pour écouter les nouveaux réglages.';
}

function refreshButtons() {
  const fresh = processed && revision === renderedRevision;
  consolePanel.dataset.phase = busy ? 'busy' : fresh ? 'ready' : 'idle';
  ui.preset.disabled = busy;
  sliders.forEach(({slider}) => { slider.disabled = analyzing; });
  ui.auto.disabled = !original || busy;
  ui.render.disabled = !original || busy || !!fresh;
  ui.export.disabled = busy || !fresh;
  quantum.invalidate();
  ui.play.disabled = !original;
  ui.compare.disabled = !processed;
  ui.seek.disabled = !original;
}

function formatTime(seconds) {
  const n = Math.floor(seconds);
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}

function readPosition() {
  return source ? Math.min(original.duration, offset + context.currentTime - playingSince) : offset;
}

function displayPosition(position) {
  ui.seek.value = position;
  ui.time.textContent = formatTime(position) + ' / ' + formatTime(original?.duration || 0);
}

function measureWave(buffer) {
  const channel = buffer.getChannelData(0);
  return Array.from({ length: 400 }, (_, i) => {
    const start = Math.floor(i * channel.length / 400);
    const end = Math.min(channel.length, Math.max(start + 1, Math.floor((i + 1) * channel.length / 400)));
    let peak = 0;
    for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(channel[index]));
    return peak;
  });
}

function drawWave() {
  const canvas = ui.wave;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (width < 1 || height < 1) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, width, height);
  ui['wave-empty'].hidden = Boolean(original);
  g.fillStyle = '#486883';
  g.fillRect(0, height / 2, width, ratio);
  const stride = width / wavePeaks.length;
  const played = original ? readPosition() / original.duration : 0;
  const waveform = g.createLinearGradient(0, 0, 0, height);
  waveform.addColorStop(0, '#ffdb9d');
  waveform.addColorStop(.5, '#b58cff');
  waveform.addColorStop(1, '#ffd18b');
  wavePeaks.forEach((peak, i) => {
    const distance = Math.abs(i - wavePeaks.length * played);
    const nearCursor = source && !reducedMotion.matches && distance < 10;
    const scale = nearCursor ? 1 + .25 * (1 - distance / 10) : 1;
    const bar = Math.max(ratio, Math.min(1, peak * scale) * height * .88);
    g.fillStyle = i < wavePeaks.length * played ? '#fff2d5' : waveform;
    g.fillRect(i * stride, (height - bar) / 2, Math.max(1, stride - ratio), bar);
  });
  if (original && played > 0) {
    g.fillStyle = '#fff2d5';
    g.shadowColor = '#ffbb68';
    g.shadowBlur = reducedMotion.matches ? 0 : 9 * ratio;
    g.fillRect(Math.min(width - ratio, played * width), 0, ratio, height);
    g.shadowBlur = 0;
  }
}
new ResizeObserver(drawWave).observe(ui.wave);

function newContext() {
  context = new AudioContext({ sampleRate: 48000 });
  monitoring = context.createGain();
  monitoring.channelCountMode = 'explicit';
  monitoring.channelCount = ui.mono.checked ? 1 : 2;
  monitoring.connect(context.destination);
  analyzer = context.createAnalyser();
  analyzer.fftSize = 512;
  analyzer.smoothingTimeConstant = .66;
  monitoring.connect(analyzer);
}
ui.mono.addEventListener('change', () => {
  if (monitoring) monitoring.channelCount = ui.mono.checked ? 1 : 2;
});

function stop() {
  if (source) {
    offset = readPosition();
    source.onended = null;
    source.stop();
    source.disconnect();
    source = null;
  }
  playbackPanel.dataset.playing = 'false';
  ui.play.textContent = 'Écouter';
  drawWave();
}

function start(position) {
  const node = context.createBufferSource();
  node.buffer = comparing ? original : (processed || original);
  node.connect(monitoring);
  offset = position >= original.duration ? 0 : position;
  playingSince = context.currentTime;
  node.start(0, offset);
  source = node;
  playbackPanel.dataset.playing = 'true';
  ui.play.textContent = 'Pause';
  node.onended = () => {
    if (source !== node) return;
    node.disconnect();
    source = null;
    playbackPanel.dataset.playing = 'false';
    offset = 0;
    ui.play.textContent = 'Écouter';
    displayPosition(0);
    drawWave();
  };
  requestAnimationFrame(function tick() {
    if (source !== node) return;
    displayPosition(readPosition());
    drawWave();
    requestAnimationFrame(tick);
  });
}
ui.play.addEventListener('click', async () => {
  if (source) {
    stop();
    return;
  }
  const track = original;
  try {
    await context.resume();
    if (track === original && !source) start(offset);
  } catch {
    ui.status.textContent = 'Le navigateur ne peut pas démarrer la lecture.';
  }
});
ui.seek.addEventListener('input', () => {
  const wasPlaying = !!source;
  stop();
  offset = Number(ui.seek.value);
  if (wasPlaying) start(offset);
  displayPosition(readPosition());
  drawWave();
});
ui.compare.addEventListener('click', () => {
  const wasPlaying = !!source;
  stop();
  comparing = !comparing;
  ui.compare.setAttribute('aria-pressed', String(comparing));
  wavePeaks = measureWave(comparing ? original : processed);
  if (wasPlaying) start(offset);
  drawWave();
});

function workerJob(task, buffer, parameters) {
  return new Promise((resolve, reject) => {
    const localWorkerUrl = location.protocol === 'file:'
      ? URL.createObjectURL(new Blob(["'use strict';\n\nconst dbToGain = db => Math.pow(10, db / 20);\nconst toDb = gain => 20 * Math.log10(Math.max(1e-5, gain));\n\nfunction equalizer(rate, kind, frequency, q, db) {\n  const omega = 2 * Math.PI * Math.min(frequency, rate * 0.45) / rate;\n  const c = Math.cos(omega);\n  const s = Math.sin(omega);\n  const a = dbToGain(db / 2);\n  const alpha = s / (2 * q);\n  const plus = a + 1;\n  const minus = a - 1;\n  const beta = s * Math.sqrt(a) / q;\n  let coefficients;\n  if (kind === 'peak') {\n    coefficients = [1 + alpha * a, -2 * c, 1 - alpha * a,\n      1 + alpha / a, -2 * c, 1 - alpha / a];\n  } else if (kind === 'low') {\n    coefficients = [a * (plus - minus * c + beta), 2 * a * (minus - plus * c),\n      a * (plus - minus * c - beta), plus + minus * c + beta,\n      -2 * (minus + plus * c), plus + minus * c - beta];\n  } else {\n    coefficients = [a * (plus + minus * c + beta), -2 * a * (minus + plus * c),\n      a * (plus + minus * c - beta), plus - minus * c + beta,\n      2 * (minus - plus * c), plus - minus * c - beta];\n  }\n  return biquad(coefficients);\n}\n\nfunction biquad([b0, b1, b2, a0, a1, a2]) {\n  const [b, m, n, p, q2] = [b0, b1, b2, a1, a2].map(value => value / a0);\n  let z1 = 0;\n  let z2 = 0;\n  return input => {\n    const output = b * input + z1;\n    z1 = m * input - p * output + z2;\n    z2 = n * input - q2 * output;\n    return output;\n  };\n}\n\nfunction loudnessFilters(rate) {\n  const shelf = Math.tan(Math.PI * 1681.974450955533 / rate);\n  const shelfQ = .7071752369554196;\n  const highGain = dbToGain(3.999843853973347);\n  const middleGain = highGain ** .4996667741545416;\n  const shelfA0 = 1 + shelf / shelfQ + shelf * shelf;\n  const highPass = Math.tan(Math.PI * 38.13547087602444 / rate);\n  const highPassQ = .5003270373238773;\n  const highPassA0 = 1 + highPass / highPassQ + highPass * highPass;\n  return [\n    biquad([highGain + middleGain * shelf / shelfQ + shelf * shelf,\n      2 * (shelf * shelf - highGain), highGain - middleGain * shelf / shelfQ + shelf * shelf,\n      shelfA0, 2 * (shelf * shelf - 1), 1 - shelf / shelfQ + shelf * shelf]),\n    biquad([1, -2, 1, 1, 2 * (highPass * highPass - 1) / highPassA0,\n      (1 - highPass / highPassQ + highPass * highPass) / highPassA0])\n  ];\n}\n\nfunction analyze(channels, rate) {\n  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));\n  const rounded = value => Math.round(value * 10) / 10;\n  const [left, right] = channels;\n  const defaults = { input:0, low:0, mid:0, high:0, threshold:0, ratio:1,\n    attack:25, release:150, drive:0, width:100, output:0, ceiling:-1, limitRelease:90 };\n  const weighted = channels.map(() => loudnessFilters(rate));\n  const lowSpeed = Math.exp(-2 * Math.PI * 180 / rate);\n  const highSpeed = Math.exp(-2 * Math.PI * 4000 / rate);\n  const windowSize = Math.max(1, Math.round(rate * .1));\n  const powerSlices = [];\n  const lowState = channels.map(() => 0);\n  const highState = channels.map(() => 0);\n  let weightedSum = 0, signal = 0, bass = 0, treble = 0;\n  let side = 0, center = 0, peak = 0;\n\n  for (let i = 0; i < left.length; i++) {\n    for (let ch = 0; ch < channels.length; ch++) {\n      const x = channels[ch][i];\n      lowState[ch] = x + lowSpeed * (lowState[ch] - x);\n      highState[ch] = x + highSpeed * (highState[ch] - x);\n      const top = x - highState[ch];\n      const filtered = weighted[ch][1](weighted[ch][0](x));\n      bass += lowState[ch] ** 2;\n      treble += top ** 2;\n      signal += x ** 2;\n      weightedSum += filtered ** 2;\n      peak = Math.max(peak, Math.abs(x));\n    }\n    if (right) {\n      center += (left[i] + right[i]) ** 2;\n      side += (left[i] - right[i]) ** 2;\n    }\n    if ((i + 1) % windowSize === 0) {\n      powerSlices.push(weightedSum / windowSize);\n      weightedSum = 0;\n    }\n  }\n  if (peak < .0001 || signal <= 0) return defaults;\n\n  const windows = [];\n  for (let i = 3; i < powerSlices.length; i++) {\n    windows.push((powerSlices[i] + powerSlices[i - 1] + powerSlices[i - 2] + powerSlices[i - 3]) / 4);\n  }\n  const count = left.length % windowSize;\n  if (!windows.length) {\n    const completed = powerSlices.reduce((sum, power) => sum + power * windowSize, 0);\n    windows.push((completed + (count ? weightedSum : 0)) / left.length);\n  }\n  const loudness = power => -.691 + 10 * Math.log10(Math.max(1e-12, power));\n  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;\n  const audible = windows.filter(power => loudness(power) >= -70);\n  if (!audible.length) return defaults;\n  const relativeGate = average(audible) / 10;\n  const level = loudness(average(audible.filter(power => power >= relativeGate)));\n  const rms = Math.sqrt(signal / (left.length * channels.length));\n  const peakDb = toDb(peak);\n  const crest = peakDb - toDb(rms);\n  const lowShare = bass / signal;\n  const highShare = treble / signal;\n  const sideShare = side / Math.max(1e-10, center + side);\n  const useCompression = crest > 13 && peakDb > -28;\n  const low = clamp((.57 - lowShare) * 7, -3, 2);\n  const high = clamp((.10 - highShare) * 12, -2.5, 2);\n  const gainByLoudness = -14 - level + (useCompression ? 1 : 0);\n  const gainByPeak = -1 - peakDb + (useCompression ? 3.5 : 2);\n\n  return {\n    ...defaults,\n    low: rounded(Math.abs(low) < .4 ? 0 : low),\n    mid: rounded(clamp((.24 - (1 - lowShare - highShare)) * 3, -1.5, 1)),\n    high: rounded(Math.abs(high) < .4 ? 0 : high),\n    threshold: useCompression ? rounded(clamp(peakDb - 9, -40, -6)) : 0,\n    ratio: useCompression ? rounded(clamp(1.4 + (crest - 13) * .1, 1.4, 2.5)) : 1,\n    drive: crest > 17 && peakDb > -18 ? 5 : 0,\n    width: sideShare > .42 ? rounded(clamp(100 - (sideShare - .42) * 135, 50, 100)) : 100,\n    output: rounded(clamp(Math.min(gainByLoudness, gainByPeak), -12, 12))\n  };\n}\n\nfunction master(channels, rate, p) {\n  const stereo = channels.length === 2;\n  const [left, right] = channels;\n  const filters = channels.map(() => [\n    equalizer(rate, 'low', 100, .707, p.low),\n    equalizer(rate, 'peak', 1100, .9, p.mid),\n    equalizer(rate, 'high', 8500, .707, p.high)\n  ]);\n  const filter = ([low, mid, high], x) => high(mid(low(x)));\n  const input = dbToGain(p.input);\n  const output = dbToGain(p.output);\n  const ceiling = dbToGain(p.ceiling);\n  const width = p.width / 100;\n  const drive = p.drive / 100;\n  const shape = 1 + drive * 3;\n  const speed = ms => Math.exp(-1000 / (rate * ms));\n  const attack = speed(p.attack);\n  const release = speed(p.release);\n  const limitRelease = speed(p.limitRelease);\n  const anticipation = Math.max(1, Math.round(rate * .005));\n  const peaks = new Float32Array(anticipation + 2);\n  const indices = new Int32Array(peaks.length);\n  const next = index => (index + 1) % peaks.length;\n  let head = 0;\n  let tail = 0;\n  let envelope = 0;\n  let limiter = 1;\n  let maxPeak = 0;\n  let minGain = 1;\n  const saturate = x => drive ? x + drive * (Math.tanh(x * shape) / shape - x) : x;\n\n  for (let index = 0; index < left.length + anticipation; index++) {\n    let peak = 0;\n    if (index < left.length) {\n      const l = filter(filters[0], left[index] * input);\n      const r = stereo ? filter(filters[1], right[index] * input) : l;\n      const detector = Math.max(Math.abs(l), Math.abs(r));\n      envelope = detector + (detector > envelope ? attack : release) * (envelope - detector);\n      const over = toDb(envelope) - p.threshold;\n      const knee = Math.abs(over) < 3 ? (over + 3) ** 2 / 12 : Math.max(0, over);\n      const compression = dbToGain(-knee * (1 - 1 / p.ratio));\n      const wetL = saturate(l * compression);\n      const wetR = saturate(r * compression);\n      const center = (wetL + wetR) * .5;\n      const side = (wetL - wetR) * .5 * width;\n      left[index] = (center + side) * output;\n      if (stereo) right[index] = (center - side) * output;\n      peak = stereo ? Math.max(Math.abs(left[index]), Math.abs(right[index])) : Math.abs(left[index]);\n    }\n\n    const delayed = index - anticipation;\n    while (head !== tail && indices[head] < delayed) head = next(head);\n    let previous = (tail + peaks.length - 1) % peaks.length;\n    while (head !== tail && peaks[previous] <= peak) {\n      tail = previous;\n      previous = (tail + peaks.length - 1) % peaks.length;\n    }\n    peaks[tail] = peak;\n    indices[tail] = index;\n    tail = next(tail);\n    limiter = Math.min(ceiling / Math.max(ceiling, peaks[head]), 1 + limitRelease * (limiter - 1));\n    if (delayed < 0) continue;\n    left[delayed] *= limiter;\n    if (stereo) right[delayed] *= limiter;\n    minGain = Math.min(minGain, limiter);\n    maxPeak = Math.max(maxPeak, Math.abs(left[delayed]), stereo ? Math.abs(right[delayed]) : 0);\n  }\n  return { peakDb: toDb(maxPeak), reductionDb: -toDb(minGain) };\n}\n\nfunction encodeWav(channels, rate) {\n  const frames = channels[0].length;\n  const trackCount = channels.length;\n  const bytesPerFrame = trackCount * 3;\n  const dataSize = frames * bytesPerFrame;\n  const padding = dataSize % 2;\n  const bytes = new ArrayBuffer(44 + dataSize + padding);\n  const view = new DataView(bytes);\n  const uint = (offset, value) => view.setUint32(offset, value, true);\n  const word = (offset, value) => view.setUint16(offset, value, true);\n  const label = (offset, value) => {\n    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));\n  };\n  label(0, 'RIFF'); uint(4, 36 + dataSize + padding); label(8, 'WAVE');\n  label(12, 'fmt '); uint(16, 16); word(20, 1); word(22, trackCount);\n  uint(24, rate); uint(28, rate * bytesPerFrame); word(32, bytesPerFrame); word(34, 24);\n  label(36, 'data'); uint(40, dataSize);\n  let offset = 44;\n  for (let frame = 0; frame < frames; frame++) {\n    for (const channel of channels) {\n      const sample = Math.max(-1, Math.min(1, channel[frame]));\n      const pcm = Math.round(sample * (sample < 0 ? 8388608 : 8388607));\n      view.setUint8(offset++, pcm & 255);\n      view.setUint8(offset++, (pcm >> 8) & 255);\n      view.setUint8(offset++, (pcm >> 16) & 255);\n    }\n  }\n  return bytes;\n}\n\nself.onmessage = ({ data: { task, channels, rate, parameters } }) => {\n  try {\n    if (task === 'export') {\n      const wav = encodeWav(channels, rate);\n      self.postMessage({ wav }, [wav]);\n    } else {\n      const settings = task === 'auto' && !parameters ? analyze(channels, rate) : parameters;\n      const meters = master(channels, rate, settings);\n      self.postMessage({ channels, meters, parameters: settings }, channels.map(channel => channel.buffer));\n    }\n  } catch (error) {\n    self.postMessage({ error: error.message });\n  }\n};\n"], { type: 'text/javascript' }))
      : null;
    let worker;
    try {
      worker = new Worker(localWorkerUrl || 'dsp.js');
    } catch (error) {
      if (localWorkerUrl) URL.revokeObjectURL(localWorkerUrl);
      reject(error);
      return;
    }
    const finish = callback => {
      worker.terminate();
      if (localWorkerUrl) URL.revokeObjectURL(localWorkerUrl);
      if (activeWorker?.worker === worker) activeWorker = null;
      callback();
    };
    activeWorker = { worker, cancel: () => finish(() => reject(new Error('Annulé'))) };
    worker.onmessage = ({ data }) => finish(() => data.error ? reject(new Error(data.error)) : resolve(data));
    worker.onerror = () => finish(() => reject(new Error('Le moteur audio ne répond pas.')));
    try {
      const channels = Array.from({length:buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i).slice());
      worker.postMessage({ task, channels, rate:buffer.sampleRate, parameters }, channels.map(channel => channel.buffer));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

ui.file.addEventListener('change', async () => {
  const file = ui.file.files[0];
  if (!file) return;
  ui.file.value = '';
  const id = ++generation;
  activeWorker?.cancel();
  stop();
  offset = 0;
  busy = analyzing = true;
  original = processed = automaticSettings = null;
  ui.preset.value = 'auto';
  comparing = false;
  ui.compare.setAttribute('aria-pressed', 'false');
  renderedRevision = -1;
  ui.peak.textContent = ui.reduction.textContent = '—';
  wavePeaks = [];
  drawWave();
  displayPosition(0);
  refreshButtons();
  ui['track-name'].textContent = file.name;
  ui['track-info'].textContent = 'Décodage audio…';
  ui.status.textContent = 'Ouverture du fichier…';
  try {
    if (file.size > 160 * 1024 ** 2) throw new Error('Choisis un fichier de 160 Mo maximum.');
    if (!context) newContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (id !== generation) return;
    if (buffer.numberOfChannels > 2 || buffer.duration > 600) {
      throw new Error('Choisis un fichier mono ou stéréo de 10 minutes maximum.');
    }
    original = buffer;
    filename = file.name.replace(/\.[^.]+$/, '');
    wavePeaks = measureWave(buffer);
    ui.seek.max = buffer.duration;
    ui['track-info'].textContent = formatTime(buffer.duration) + ' · ' + (buffer.numberOfChannels === 2 ? 'Stéréo' : 'Mono') + ' · 48 kHz';
    displayPosition(0);
    drawWave();
    await render(true);
  } catch (error) {
    if (id !== generation) return;
    ui['track-info'].textContent = 'Fichier illisible ou format audio non pris en charge.';
    ui.status.textContent = error.message;
    busy = analyzing = false;
    refreshButtons();
  }
});

async function render(automatic = false) {
  const id = generation;
  const settingsRevision = revision;
  busy = true;
  analyzing = automatic;
  refreshButtons();
  ui.status.textContent = automatic ? 'Analyse du mix et mastering automatique…' : 'Traitement du mix…';
  try {
    const settings = Object.fromEntries(sliders.map(({key, value}) => [key, value()]));
    const result = await workerJob(automatic ? 'auto' : 'master', original, automatic ? automaticSettings : settings);
    if (id !== generation) return;
    if (automatic) {
      automaticSettings = result.parameters;
      if (settingsRevision === revision) {
        sliders.forEach(({ key, slider, update }) => {
          slider.value = automaticSettings[key];
          update();
        });
        ui.preset.value = 'auto';
      }
    }
    const next = context.createBuffer(result.channels.length, original.length, original.sampleRate);
    result.channels.forEach((channel, index) => next.copyToChannel(channel, index));
    const wasPlaying = !!source;
    stop();
    processed = next;
    renderedRevision = settingsRevision;
    wavePeaks = measureWave(comparing ? original : processed);
    if (wasPlaying) start(offset);
    drawWave();
    ui.peak.textContent = result.meters.peakDb.toFixed(1) + ' dBFS';
    ui.reduction.textContent = result.meters.reductionDb.toFixed(1) + ' dB';
    ui.status.textContent = settingsRevision === revision ? (automatic ? 'Mastering automatique terminé. Écoute ou exporte ton master.' : 'Master prêt à écouter et à exporter.')
      : 'Les réglages ont changé. Clique sur Appliquer pour les prendre en compte.';
  } catch (error) {
    if (id === generation) ui.status.textContent = 'Rendu interrompu. ' + error.message;
  } finally {
    if (id === generation) {
      busy = analyzing = false;
      refreshButtons();
    }
  }
}

ui.render.addEventListener('click', () => render());
ui.auto.addEventListener('click', () => render(true));
ui.export.addEventListener('click', async () => {
  const id = generation;
  busy = true;
  refreshButtons();
  ui.status.textContent = 'Préparation du WAV 24 bits…';
  try {
    const { wav } = await workerJob('export', processed);
    if (id !== generation) return;
    const url = URL.createObjectURL(new Blob([wav], { type:'audio/wav' }));
    const download = document.createElement('a');
    download.href = url;
    download.download = filename + '-master-vox.wav';
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    ui.status.textContent = 'WAV 24 bits exporté à 48 kHz.';
  } catch (error) {
    if (id === generation) ui.status.textContent = 'Export interrompu. ' + error.message;
  } finally {
    if (id === generation) {
      busy = false;
      refreshButtons();
    }
  }
});

const advancedPanel = document.querySelector('.advanced');
advancedPanel.open = matchMedia('(min-width: 1051px)').matches;
document.querySelectorAll('[data-control]').forEach(button => {
  button.addEventListener('click', () => {
    advancedPanel.open = true;
    quantum.selectControl(button.dataset.control);
    const slider = element(button.dataset.control);
    slider.closest('fieldset').scrollIntoView({ block: 'nearest' });
    if (!slider.disabled) slider.focus({ preventScroll: true });
  });
});
