'use strict';

{
  const canvas = document.getElementById('backdrop-motion');
  const context = canvas.getContext('2d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 650px)');
  const assetWidth = 1536;
  const assetHeight = 1024;
  const bolts = [
    { period: 8.6, delay: 1.1, trunk: [[852,0],[873,47],[821,74],[849,106],[795,142],[814,174],[764,210]], branch: [[849,106],[893,128],[904,160],[952,184]] },
    { period: 11.2, delay: 4.0, trunk: [[1391,56],[1348,98],[1363,122],[1327,159],[1356,193],[1306,230]], branch: [[1327,159],[1285,171],[1266,200]] },
    { period: 9.8, delay: 6.2, trunk: [[681,57],[710,104],[688,129],[723,161],[697,188],[730,234]], branch: [[723,161],[759,171],[777,202]] }
  ];
  const rings = [
    { x: 1219, y: 178, rx: 501, ry: 105, tilt: -.215, speed: .53 },
    { x: 1212, y: 196, rx: 473, ry: 84, tilt: -.205, speed: -.69 }
  ];
  const falls = [
    [888, 539, 882, 593, 12], [909, 529, 904, 592, 13],
    [924, 517, 921, 550, 8], [943, 534, 941, 592, 18],
    [965, 544, 960, 592, 12], [1018, 553, 1016, 587, 11],
    [1276, 544, 1270, 592, 15], [1298, 539, 1292, 590, 18],
    [1321, 553, 1316, 588, 11]
  ];
  let frame = 0;

  function paint(now) {
    frame = requestAnimationFrame(paint);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const pixelRatio = Math.min(1.5, devicePixelRatio || 1);
    const backingWidth = Math.round(width * pixelRatio), backingHeight = Math.round(height * pixelRatio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    const scale = Math.max(width / assetWidth, height / assetHeight);
    context.translate((width - assetWidth * scale) * (narrow.matches ? .63 : .5), 0);
    context.scale(scale, scale);
    const time = now / 1000;

    drawStorm(time);
    drawRings(time);
    drawBeam(time);
    drawWaterfalls(time);
  }

  function drawPath(points) {
    context.beginPath();
    context.moveTo(...points[0]);
    for (const point of points.slice(1)) context.lineTo(...point);
    context.stroke();
  }

  function drawStorm(time) {
    for (const { period, delay, trunk, branch } of bolts) {
      const elapsed = (time + delay) % period;
      if (elapsed > .95) continue;
      const intensity = Math.sin(Math.PI * elapsed / .95) ** 2;
      context.save();
      context.globalAlpha = intensity * .72;
      context.lineJoin = 'round';
      context.shadowColor = '#a865ff';
      context.shadowBlur = 16;
      context.strokeStyle = '#b387ff';
      context.lineWidth = 5;
      drawPath(trunk);
      context.lineWidth = 2.5;
      drawPath(branch);
      context.strokeStyle = '#f2deff';
      context.lineWidth = 1.5;
      drawPath(trunk);
      context.restore();
    }
  }

  function drawRings(time) {
    context.save();
    context.lineCap = 'round';
    context.shadowColor = '#ffac58';
    context.shadowBlur = 11;
    for (const ring of rings) {
      for (let band = 0; band < 2; band++) {
        const start = time * ring.speed + band * Math.PI;
        for (let part = 0; part < 18; part++) {
          const end = start + part * .043;
          context.globalAlpha = .08 + .76 * (part / 17) ** 1.8;
          context.strokeStyle = part > 13 ? '#fff0be' : '#ffb664';
          context.lineWidth = part > 13 ? 2.7 : 1.7;
          context.beginPath();
          context.ellipse(ring.x, ring.y, ring.rx, ring.ry, ring.tilt, end, end + .047);
          context.stroke();
        }
      }
    }
    context.restore();
  }

  function drawBeam(time) {
    context.save();
    context.globalCompositeOperation = 'screen';
    const pulse = .17 + .18 * (.5 + .5 * Math.sin(time * 2.2));
    const light = context.createLinearGradient(1150, 0, 1228, 0);
    light.addColorStop(0, '#ff940000');
    light.addColorStop(.49, `rgba(255,196,100,${pulse})`);
    light.addColorStop(.57, `rgba(255,227,162,${pulse * 1.3})`);
    light.addColorStop(1, '#ff940000');
    context.beginPath();
    context.moveTo(1164, 327);
    context.lineTo(1217, 327);
    context.lineTo(1234, 583);
    context.lineTo(1144, 583);
    context.closePath();
    context.clip();
    context.fillStyle = light;
    context.fillRect(1144, 327, 90, 257);
    context.shadowColor = '#ffb160';
    context.shadowBlur = 7;
    for (let strand = 0; strand < 13; strand++) {
      const travel = (time * (.35 + (strand % 4) * .1) + strand * .117) % 1;
      const y = 338 + travel * 235;
      const x = 1163 + (strand * 17.13) % 51 + Math.sin(time + strand) * 4;
      context.fillStyle = `rgba(255,221,150,${Math.sin(Math.PI * travel) * .67})`;
      context.fillRect(x, y, 1.45, 8 + strand % 4 * 3);
    }
    context.restore();
  }

  function drawWaterfalls(time) {
    context.save();
    context.lineCap = 'round';
    for (const [index, [startX, startY, endX, endY, width]] of falls.entries()) {
      for (let strand = 0; strand < 5; strand++) {
        const across = (strand / 4 - .5) * width;
        for (let drop = 0; drop < 3; drop++) {
          const phase = (time * (.66 + strand * .05) + drop / 3 + index * .23) % 1;
          const tail = Math.max(0, phase - .23);
          const x = startX + (endX - startX) * phase + across;
          const y = startY + (endY - startY) * phase;
          const tailX = startX + (endX - startX) * tail + across;
          const tailY = startY + (endY - startY) * tail;
          if (y <= tailY) continue;
          context.globalAlpha = Math.sin(Math.PI * phase) * .72;
          const light = context.createLinearGradient(tailX, tailY, x, y);
          light.addColorStop(0, '#57eaff00');
          light.addColorStop(1, strand % 2 ? '#a9f5ff' : '#57dbff');
          context.strokeStyle = light;
          context.lineWidth = 1.35;
          context.beginPath();
          context.moveTo(tailX, tailY);
          context.lineTo(x, y);
          context.stroke();
        }
      }
      const lift = .5 + .5 * Math.sin(time * 2.2 + index);
      context.globalAlpha = .1 + lift * .11;
      const mist = context.createRadialGradient(endX, endY, 0, endX, endY, width);
      mist.addColorStop(0, '#a0efff');
      mist.addColorStop(1, '#79dfff00');
      context.fillStyle = mist;
      context.fillRect(endX - width, endY - width, width * 2, width * 2);
    }
    context.restore();
  }

  function update() {
    cancelAnimationFrame(frame);
    if (!context) return;
    if (!motion.matches && !document.hidden) {
      frame = requestAnimationFrame(paint);
    } else {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  motion.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  update();
}
