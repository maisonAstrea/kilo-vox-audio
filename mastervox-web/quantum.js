'use strict';

function createQuantumInterface({ controls, panels, readAudio }) {
  const stage = document.getElementById('quantum-stage');
  const canvas = stage.querySelector('canvas');
  const panel = stage.closest('.advanced');
  const framePaths = panel.querySelectorAll('.advanced-frame path');
  new ResizeObserver(() => {
    const width = panel.clientWidth, height = panel.clientHeight;
    framePaths.forEach((path, i) => {
      const a = 1 + i * 4, cut = Math.min(15 - i * 3, height / 4);
      const right = width - a, bottom = height - a;
      path.setAttribute('d', `M${a+cut} ${a}H${right-cut}L${right} ${a+cut}V${bottom-cut}L${right-cut} ${bottom}H${a+cut}L${a} ${bottom-cut}V${a+cut}Z`);
    });
  }).observe(panel);
  const ctx = canvas.getContext('2d', { alpha: true });
  const toolbar = document.querySelector('.quantum-switch');
  const handles = stage.querySelector('.quantum-handles');
  const lite = document.getElementById('quantum-lite');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 650px)');
  const settings = Object.fromEntries(controls.map(control => [control.key, control]));
  const modules = [
    { title:'Frequency Universe', keys:['input','low','mid','high'], nodes:[['low',.22],['mid',.50],['high',.78]] },
    { title:'Quantum Reactor', keys:['threshold','ratio','attack','release'], nodes:[['threshold',.20],['ratio',.80]] },
    { title:'Galaxy Engine', keys:['drive','width','output'], nodes:[['drive',.20],['width',.80]] },
    { title:'Crystal Core', keys:['ceiling','limitRelease'], nodes:[['ceiling',.79]] }
  ];
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const read = key => settings[key].value();
  const fraction = key => {
    const {slider} = settings[key];
    return (read(key) - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
  };
  const set = (key, value) => {
    const {slider} = settings[key];
    if (slider.disabled) return;
    const next = clamp(Math.round(value * 10) / 10, Number(slider.min), Number(slider.max));
    if (slider.valueAsNumber === next) return;
    slider.value = next.toFixed(1);
    slider.dispatchEvent(new Event('input', { bubbles:true }));
  };
  const buttons = [];
  const nodeList = [];
  const spectrum = new Uint8Array(256);
  const signal = new Uint8Array(512).fill(128);
  const particles = Array.from({length:320}, (_, i) => {
    const r = .18 + 1.7 * ((i * .618034) % 1);
    const angle = (i % 4) * Math.PI / 2 + r * 2.1 + Math.sin(i * 74.7) * .35;
    return { r, angle, height:Math.sin(i * 27.9) * .14, core:i % 3 === 0 };
  });
  let active = 0, frame = 0, last = -Infinity, transition = 0;
  let onscreen = false, dirty = true;

  function invalidate() {
    dirty = true;
    if (!frame && onscreen && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function select(index) {
    active = index;
    transition = performance.now();
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    panels.forEach((panel, i) => { panel.hidden = i !== index; });
    nodeList.forEach(node => { node.button.hidden = node.module !== index; });
    stage.dataset.module = modules[index].title;
    syncHandles();
    invalidate();
  }

  function syncHandles() {
    for (const {button, valueLabel, key, x, module} of nodeList) {
      if (module !== active) continue;
      const {slider, unit} = settings[key];
      const text = read(key).toFixed(1) + (unit === ':1' ? unit : ' ' + unit);
      button.style.left = x * 100 + '%';
      button.style.top = (module === 3 ? ceilingHeight() : .68 - fraction(key) * .37) * 100 + '%';
      valueLabel.textContent = text;
      button.disabled = slider.disabled;
      button.setAttribute('aria-valuenow', String(read(key)));
      button.setAttribute('aria-valuetext', text);
    }
  }

  modules.forEach(({title, nodes}, index) => {
    const tab = document.createElement('button');
    Object.assign(tab, {type:'button', textContent:title});
    tab.setAttribute('aria-controls', stage.id);
    tab.addEventListener('click', () => select(index));
    buttons.push(tab);
    toolbar.append(tab);
    for (const [key, x] of nodes) {
      const {name, slider} = settings[key];
      const button = document.createElement('button');
      const point = document.createElement('span');
      const caption = document.createElement('span');
      const nameLabel = document.createElement('span');
      const valueLabel = document.createElement('span');
      nameLabel.textContent = name;
      caption.append(nameLabel, valueLabel);
      button.type = 'button';
      button.className = 'quantum-handle';
      button.setAttribute('role', 'slider');
      button.setAttribute('aria-label', name);
      button.setAttribute('aria-orientation', 'vertical');
      button.setAttribute('aria-valuemin', slider.min);
      button.setAttribute('aria-valuemax', slider.max);
      button.append(point, caption);
      handles.append(button);
      nodeList.push({button, valueLabel, key, x, module:index});

      let drag = null;
      button.addEventListener('pointerdown', event => {
        if (button.disabled || event.button !== 0) return;
        drag = { id:event.pointerId, y:event.clientY, value:read(key) };
        button.focus({preventScroll:true});
        button.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      button.addEventListener('pointermove', event => {
        if (drag?.id !== event.pointerId) return;
        const range = Number(slider.max) - Number(slider.min);
        set(key, drag.value + (drag.y - event.clientY) / (stage.clientHeight * (index === 3 ? .33 : .37)) * range);
      });
      button.addEventListener('lostpointercapture', () => { drag = null; });
      button.addEventListener('keydown', event => {
        const step = event.shiftKey ? 1 : .1;
        const actions = {ArrowUp:read(key)+step, ArrowRight:read(key)+step,
          ArrowDown:read(key)-step, ArrowLeft:read(key)-step, Home:Number(slider.min), End:Number(slider.max)};
        if (!Object.hasOwn(actions, event.key)) return;
        event.preventDefault();
        set(key, actions[event.key]);
      });
    }
  });

  function ceilingHeight() { return .64 - fraction('ceiling') * .33; }

  function draw(now) {
    frame = 0;
    const animate = !lite.checked && !motion.matches;
    if (!onscreen || document.hidden) return;
    if (animate) frame = requestAnimationFrame(draw);
    if (!dirty && (!animate || now - last < (narrow.matches ? 45 : 30))) return;
    dirty = false;
    last = now;
    if (!ctx) return;

    const width = canvas.clientWidth, height = canvas.clientHeight;
    const dpr = Math.min(lite.checked || narrow.matches ? 1 : 1.45, devicePixelRatio || 1);
    const bw = Math.round(width * dpr), bh = Math.round(height * dpr);
    if (!bw || !bh) return;
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const audio = animate ? readAudio() : null;
    if (audio) {
      audio.getByteFrequencyData(spectrum);
      audio.getByteTimeDomainData(signal);
    }
    let peak = 0;
    if (audio) for (const point of signal) peak = Math.max(peak, Math.abs(point - 128) / 128);
    const blend = animate ? clamp((now - transition) / 550, 0, 1) : 1;
    const scale = Math.min(width / 8.1, height / 4.05) * (1 - .13 * (1 - blend) ** 3);
    const time = animate ? now / 1000 : 0;

    // Perspective projection from a camera above the scene, looking toward the origin.
    function project(x, y, z) {
      const depth = .94 * z - .34 * y;
      const perspective = 7.1 / (7.1 + depth);
      return [width / 2 + x * scale * perspective, height * .46 - (.94 * y + .34 * z) * scale * perspective];
    }
    function trace(points, color, weight = 1, close = false, fill) {
      ctx.beginPath();
      points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
      if (close) ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = color;
      ctx.lineWidth = weight;
      ctx.stroke();
    }
    function ellipse(rx, rz, y, color, weight = 1) {
      const points = Array.from({length:41}, (_, i) => {
        const a = i / 40 * Math.PI * 2;
        return project(Math.cos(a) * rx,y,Math.sin(a) * rz);
      });
      trace(points, color, weight);
    }
    ctx.globalAlpha = .35 + .65 * blend;
    for (let i = -4; i <= 4; i++) trace([project(i,-1.32,-2), project(i,-1.32,4)], '#a78be52c');
    for (let z = -2; z <= 4; z += .6) trace([project(-4,-1.32,z), project(4,-1.32,z)], '#a78be52c');

    if (active === 0) {
      const gains = ['low','mid','high'].map(key => read(key) / 9);
      const depthSteps = lite.checked ? 7 : 15;
      const columns = lite.checked ? 20 : 44;
      for (let row = depthSteps; row >= 0; row--) {
        const z = .95 - row / depthSteps * 3.1;
        const ridge = [];
        for (let i = 0; i <= columns; i++) {
          const x = (i / columns - .5) * 7;
          const u = i / columns;
          const gain = gains.reduce((sum, value, j) => sum + value * Math.exp(-((u - (.19 + j * .31)) ** 2) / .018), 0);
          const bin = Math.min(110, Math.floor(1 + 110 * u ** 2.7));
          const tone = audio ? spectrum[bin] / 255 : 0;
          const hill = .23 + .38 * Math.sin(u * 21 + z * 2.4 - time * .65) ** 2;
          ridge.push(project(x, -.87 + hill + gain * .6 + tone * 1.12, z));
        }
        trace(ridge, row === 0 ? '#ffd19e' : row % 3 ? '#9661d47b' : '#dba4f8b0', row === 0 ? 2 : 1);
      }
    } else if (active === 1) {
      const compression = fraction('ratio') * (1 - fraction('threshold'));
      const length = 3.05 - compression * 1.5;
      const radius = .86 + peak * .18 - compression * .16;
      const rim = x => Array.from({length:41}, (_,i) => {
        const a = i / 40 * Math.PI * 2;
        return project(x, Math.sin(a) * radius, Math.cos(a) * radius);
      });
      trace(rim(-length), '#ca8eff', 2);
      trace(rim(length), '#ffcb8c', 2);
      for (let i = 0; i < 12; i++) {
        const angle = i / 12 * Math.PI * 2;
        const y = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
        trace([project(-length,y,z),project(length,y,z)], i % 3 ? '#a87de35a' : '#ffd09b99');
      }
      const waveform = Array.from({length:96}, (_, i) => {
        const u = i / 95;
        const magnitude = audio ? (signal[i * 5] - 128) / 128 : Math.sin(u * 63 - time * 4) * .23;
        return project((u * 2 - 1) * length, magnitude * (1 - .48 * compression), 0);
      });
      trace(waveform, '#f8a1ff65', 6);
      trace(waveform, '#fff1ba', 1.5);
    } else if (active === 2) {
      const spread = .67 + fraction('width') * .84;
      const power = fraction('drive');
      ellipse(2.1 * spread, 1.15, -.17, '#ac7ddb76');
      ellipse(1.3 * spread, .74, -.07, '#ffd481a6');
      const count = lite.checked ? 95 : particles.length;
      for (let i = 0; i < count; i++) {
        const p = particles[i];
        const a = p.angle + time * (.16 + .075 / p.r);
        const [x,y] = project(Math.cos(a) * p.r * spread, p.height + peak * .16, Math.sin(a) * p.r * .8);
        ctx.fillStyle = p.core ? `rgba(255,211,146,${.44 + power * .51})` : `rgba(194,132,255,${.31 + power * .58})`;
        const size = 1.2 + power * 2.3 + peak;
        ctx.fillRect(x,y,size,size);
      }
    } else {
      const float = Math.sin(time * 1.8) * .12;
      const spin = time * .49;
      const center = Array.from({length:6}, (_, i) => {
        const a = spin + i / 6 * Math.PI * 2;
        return project(Math.cos(a) * (.79 + peak * .22), float, Math.sin(a) * (.79 + peak * .22));
      });
      const top = project(0, 1.28 + float + peak * .36, 0), bottom = project(0,-1.14 + float,0);
      const faces = center.map((point,i) => ({point,next:center[(i+1)%6],depth:Math.sin(spin + (i+.5) * Math.PI / 3)}));
      faces.sort((a,b) => b.depth - a.depth);
      for (const {point,next,depth} of faces) {
        const fill = depth > 0 ? '#4c24886b' : '#9248cbab';
        trace([top, point, next], '#f6cbff', 1, true, fill);
        trace([bottom, point, next], '#ab7cff', 1, true, '#562aa477');
      }
      ellipse(1.34, .87, -.9, '#d99aff99');
      const fieldY = height * ceilingHeight();
      const nearCeiling = peak >= 10 ** (read('ceiling') / 20);
      ctx.fillStyle = nearCeiling ? '#ffb57c42' : '#a57cdd25';
      ctx.fillRect(width * .11, fieldY - 8, width * .78, 16);
      trace([[width*.11,fieldY],[width*.89,fieldY]], nearCeiling ? '#fff0a4' : '#d5a8ff', 1.7);
    }
    ctx.globalAlpha = 1;
  }

  const observer = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) invalidate();
    else { cancelAnimationFrame(frame); frame = 0; }
  });
  observer.observe(stage);
  new ResizeObserver(invalidate).observe(stage);
  lite.checked = !ctx || motion.matches || narrow.matches;
  lite.disabled = !ctx;
  lite.addEventListener('change', invalidate);
  motion.addEventListener('change', invalidate);
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame);
    frame = 0;
    invalidate();
  });
  select(0);
  return {
    invalidate() { syncHandles(); invalidate(); },
    selectControl(key) {
      const index = modules.findIndex(module => module.keys.includes(key));
      if (index >= 0) select(index);
    }
  };
}
