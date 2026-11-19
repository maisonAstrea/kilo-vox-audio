'use strict';

const dbToGain = db => Math.pow(10, db / 20);
const toDb = gain => 20 * Math.log10(Math.max(1e-5, gain));

function equalizer(rate, kind, frequency, q, db) {
  const omega = 2 * Math.PI * Math.min(frequency, rate * 0.45) / rate;
  const c = Math.cos(omega);
  const s = Math.sin(omega);
  const a = dbToGain(db / 2);
  const alpha = s / (2 * q);
  const plus = a + 1;
  const minus = a - 1;
  const beta = s * Math.sqrt(a) / q;
  let coefficients;
  if (kind === 'peak') {
    coefficients = [1 + alpha * a, -2 * c, 1 - alpha * a,
      1 + alpha / a, -2 * c, 1 - alpha / a];
  } else if (kind === 'low') {
    coefficients = [a * (plus - minus * c + beta), 2 * a * (minus - plus * c),
      a * (plus - minus * c - beta), plus + minus * c + beta,
      -2 * (minus + plus * c), plus + minus * c - beta];
  } else {
    coefficients = [a * (plus + minus * c + beta), -2 * a * (minus + plus * c),
      a * (plus + minus * c - beta), plus - minus * c + beta,
      2 * (minus - plus * c), plus - minus * c - beta];
  }
  return biquad(coefficients);
}

function biquad([b0, b1, b2, a0, a1, a2]) {
  const [b, m, n, p, q2] = [b0, b1, b2, a1, a2].map(value => value / a0);
  let z1 = 0;
  let z2 = 0;
  return input => {
    const output = b * input + z1;
    z1 = m * input - p * output + z2;
    z2 = n * input - q2 * output;
    return output;
  };
}

function loudnessFilters(rate) {
  const shelf = Math.tan(Math.PI * 1681.974450955533 / rate);
  const shelfQ = .7071752369554196;
  const highGain = dbToGain(3.999843853973347);
  const middleGain = highGain ** .4996667741545416;
  const shelfA0 = 1 + shelf / shelfQ + shelf * shelf;
  const highPass = Math.tan(Math.PI * 38.13547087602444 / rate);
  const highPassQ = .5003270373238773;
  const highPassA0 = 1 + highPass / highPassQ + highPass * highPass;
  return [
    biquad([highGain + middleGain * shelf / shelfQ + shelf * shelf,
      2 * (shelf * shelf - highGain), highGain - middleGain * shelf / shelfQ + shelf * shelf,
      shelfA0, 2 * (shelf * shelf - 1), 1 - shelf / shelfQ + shelf * shelf]),
    biquad([1, -2, 1, 1, 2 * (highPass * highPass - 1) / highPassA0,
      (1 - highPass / highPassQ + highPass * highPass) / highPassA0])
  ];
}

function analyze(channels, rate) {
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const rounded = value => Math.round(value * 10) / 10;
  const [left, right] = channels;
  const defaults = { input:0, low:0, mid:0, high:0, threshold:0, ratio:1,
    attack:25, release:150, drive:0, width:100, output:0, ceiling:-1, limitRelease:90 };
  const weighted = channels.map(() => loudnessFilters(rate));
  const lowSpeed = Math.exp(-2 * Math.PI * 180 / rate);
  const highSpeed = Math.exp(-2 * Math.PI * 4000 / rate);
  const windowSize = Math.max(1, Math.round(rate * .1));
  const powerSlices = [];
  const lowState = channels.map(() => 0);
  const highState = channels.map(() => 0);
  let weightedSum = 0, signal = 0, bass = 0, treble = 0;
  let side = 0, center = 0, peak = 0;

  for (let i = 0; i < left.length; i++) {
    for (let ch = 0; ch < channels.length; ch++) {
      const x = channels[ch][i];
      lowState[ch] = x + lowSpeed * (lowState[ch] - x);
      highState[ch] = x + highSpeed * (highState[ch] - x);
      const top = x - highState[ch];
      const filtered = weighted[ch][1](weighted[ch][0](x));
      bass += lowState[ch] ** 2;
      treble += top ** 2;
      signal += x ** 2;
      weightedSum += filtered ** 2;
      peak = Math.max(peak, Math.abs(x));
    }
    if (right) {
      center += (left[i] + right[i]) ** 2;
      side += (left[i] - right[i]) ** 2;
    }
    if ((i + 1) % windowSize === 0) {
      powerSlices.push(weightedSum / windowSize);
      weightedSum = 0;
    }
  }
  if (peak < .0001 || signal <= 0) return defaults;

  const windows = [];
  for (let i = 3; i < powerSlices.length; i++) {
    windows.push((powerSlices[i] + powerSlices[i - 1] + powerSlices[i - 2] + powerSlices[i - 3]) / 4);
  }
  const count = left.length % windowSize;
  if (!windows.length) {
    const completed = powerSlices.reduce((sum, power) => sum + power * windowSize, 0);
    windows.push((completed + (count ? weightedSum : 0)) / left.length);
  }
  const loudness = power => -.691 + 10 * Math.log10(Math.max(1e-12, power));
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const audible = windows.filter(power => loudness(power) >= -70);
  if (!audible.length) return defaults;
  const relativeGate = average(audible) / 10;
  const level = loudness(average(audible.filter(power => power >= relativeGate)));
  const rms = Math.sqrt(signal / (left.length * channels.length));
  const peakDb = toDb(peak);
  const crest = peakDb - toDb(rms);
  const lowShare = bass / signal;
  const highShare = treble / signal;
  const sideShare = side / Math.max(1e-10, center + side);
  const useCompression = crest > 13 && peakDb > -28;
  const low = clamp((.57 - lowShare) * 7, -3, 2);
  const high = clamp((.10 - highShare) * 12, -2.5, 2);
  const gainByLoudness = -14 - level + (useCompression ? 1 : 0);
  const gainByPeak = -1 - peakDb + (useCompression ? 3.5 : 2);

  return {
    ...defaults,
    low: rounded(Math.abs(low) < .4 ? 0 : low),
    mid: rounded(clamp((.24 - (1 - lowShare - highShare)) * 3, -1.5, 1)),
    high: rounded(Math.abs(high) < .4 ? 0 : high),
    threshold: useCompression ? rounded(clamp(peakDb - 9, -40, -6)) : 0,
    ratio: useCompression ? rounded(clamp(1.4 + (crest - 13) * .1, 1.4, 2.5)) : 1,
    drive: crest > 17 && peakDb > -18 ? 5 : 0,
    width: sideShare > .42 ? rounded(clamp(100 - (sideShare - .42) * 135, 50, 100)) : 100,
    output: rounded(clamp(Math.min(gainByLoudness, gainByPeak), -12, 12))
  };
}

function master(channels, rate, p) {
  const stereo = channels.length === 2;
  const [left, right] = channels;
  const filters = channels.map(() => [
    equalizer(rate, 'low', 100, .707, p.low),
    equalizer(rate, 'peak', 1100, .9, p.mid),
    equalizer(rate, 'high', 8500, .707, p.high)
  ]);
  const filter = ([low, mid, high], x) => high(mid(low(x)));
  const input = dbToGain(p.input);
  const output = dbToGain(p.output);
  const ceiling = dbToGain(p.ceiling);
  const width = p.width / 100;
  const drive = p.drive / 100;
  const shape = 1 + drive * 3;
  const speed = ms => Math.exp(-1000 / (rate * ms));
  const attack = speed(p.attack);
  const release = speed(p.release);
  const limitRelease = speed(p.limitRelease);
  const anticipation = Math.max(1, Math.round(rate * .005));
  const peaks = new Float32Array(anticipation + 2);
  const indices = new Int32Array(peaks.length);
  const next = index => (index + 1) % peaks.length;
  let head = 0;
  let tail = 0;
  let envelope = 0;
  let limiter = 1;
  let maxPeak = 0;
  let minGain = 1;
  const saturate = x => drive ? x + drive * (Math.tanh(x * shape) / shape - x) : x;

  for (let index = 0; index < left.length + anticipation; index++) {
    let peak = 0;
    if (index < left.length) {
      const l = filter(filters[0], left[index] * input);
      const r = stereo ? filter(filters[1], right[index] * input) : l;
      const detector = Math.max(Math.abs(l), Math.abs(r));
      envelope = detector + (detector > envelope ? attack : release) * (envelope - detector);
      const over = toDb(envelope) - p.threshold;
      const knee = Math.abs(over) < 3 ? (over + 3) ** 2 / 12 : Math.max(0, over);
      const compression = dbToGain(-knee * (1 - 1 / p.ratio));
      const wetL = saturate(l * compression);
      const wetR = saturate(r * compression);
      const center = (wetL + wetR) * .5;
      const side = (wetL - wetR) * .5 * width;
      left[index] = (center + side) * output;
      if (stereo) right[index] = (center - side) * output;
      peak = stereo ? Math.max(Math.abs(left[index]), Math.abs(right[index])) : Math.abs(left[index]);
    }

    const delayed = index - anticipation;
    while (head !== tail && indices[head] < delayed) head = next(head);
    let previous = (tail + peaks.length - 1) % peaks.length;
    while (head !== tail && peaks[previous] <= peak) {
      tail = previous;
      previous = (tail + peaks.length - 1) % peaks.length;
    }
    peaks[tail] = peak;
    indices[tail] = index;
    tail = next(tail);
    limiter = Math.min(ceiling / Math.max(ceiling, peaks[head]), 1 + limitRelease * (limiter - 1));
    if (delayed < 0) continue;
    left[delayed] *= limiter;
    if (stereo) right[delayed] *= limiter;
    minGain = Math.min(minGain, limiter);
    maxPeak = Math.max(maxPeak, Math.abs(left[delayed]), stereo ? Math.abs(right[delayed]) : 0);
  }
  return { peakDb: toDb(maxPeak), reductionDb: -toDb(minGain) };
}

function encodeWav(channels, rate) {
  const frames = channels[0].length;
  const trackCount = channels.length;
  const bytesPerFrame = trackCount * 3;
  const dataSize = frames * bytesPerFrame;
  const padding = dataSize % 2;
  const bytes = new ArrayBuffer(44 + dataSize + padding);
  const view = new DataView(bytes);
  const uint = (offset, value) => view.setUint32(offset, value, true);
  const word = (offset, value) => view.setUint16(offset, value, true);
  const label = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  label(0, 'RIFF'); uint(4, 36 + dataSize + padding); label(8, 'WAVE');
  label(12, 'fmt '); uint(16, 16); word(20, 1); word(22, trackCount);
  uint(24, rate); uint(28, rate * bytesPerFrame); word(32, bytesPerFrame); word(34, 24);
  label(36, 'data'); uint(40, dataSize);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame]));
      const pcm = Math.round(sample * (sample < 0 ? 8388608 : 8388607));
      view.setUint8(offset++, pcm & 255);
      view.setUint8(offset++, (pcm >> 8) & 255);
      view.setUint8(offset++, (pcm >> 16) & 255);
    }
  }
  return bytes;
}

self.onmessage = ({ data: { task, channels, rate, parameters } }) => {
  try {
    if (task === 'export') {
      const wav = encodeWav(channels, rate);
      self.postMessage({ wav }, [wav]);
    } else {
      const settings = task === 'auto' && !parameters ? analyze(channels, rate) : parameters;
      const meters = master(channels, rate, settings);
      self.postMessage({ channels, meters, parameters: settings }, channels.map(channel => channel.buffer));
    }
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
