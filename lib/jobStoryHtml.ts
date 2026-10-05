import { CREA_WORDMARK_PATH, CREA_WORDMARK_VIEWBOX } from '@/lib/creaWordmark'

export type JobStoryFields = {
  jobTitle: string
  company: string
  /** Already a data URL, or omitted when the logo could not be loaded. */
  logoDataUrl?: string | null
  budget: string
  location: string
  description: string
}

const CANVAS_SCRIPT = `
(function () {
  var W = 1080;
  var H = 1920;
  var PAD_X = 108;
  var PAD_TOP_MIN = 140;
  var GAP_ABOVE_WORDMARK = 96;
  var STORY_DESC_MAX_LINES = 16;
  var STORY_DESC_PARA_GAP_FACTOR = 0.9;
  var BG = '#262626';
  var TEXT = '#ffffff';
  var BODY = 'rgba(255,255,255,0.68)';
  var SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  var LOGO_MAX_W = 280;
  var LOGO_MAX_H = 168;
  var GAP_AFTER_LOGO = 76;
  var GAP_AFTER_TITLE = 40;
  var GAP_AFTER_META = 68;
  var WORDMARK_W = 220;
  var WORDMARK_BOTTOM = 156;
  var DESC_GAP_MARKER = '\\u0000';
  var BODY_SIZE = 34;
  var BODY_LH = 50;
  var CHUNK = 180000;

  function post(msg) {
    try {
      var payload = JSON.stringify(msg);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload);
      }
    } catch (e) {}
  }

  function postPng(dataUrl) {
    var b64 = String(dataUrl).replace(/^data:image\\/png;base64,/, '');
    var parts = Math.max(1, Math.ceil(b64.length / CHUNK));
    var id = String(Date.now());
    for (var i = 0; i < parts; i++) {
      post({
        ok: true,
        id: id,
        i: i,
        n: parts,
        chunk: b64.slice(i * CHUNK, (i + 1) * CHUNK)
      });
    }
  }

  function colorDist(r, g, b, bg) {
    var dr = r - bg.r;
    var dg = g - bg.g;
    var db = b - bg.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function rasterSize(src) {
    if (src instanceof HTMLCanvasElement) return { w: src.width, h: src.height };
    return { w: src.naturalWidth, h: src.naturalHeight };
  }

  function sampleEdgePixels(data, w, h) {
    var pts = [];
    var step = Math.max(1, Math.floor(Math.min(w, h) / 28));
    function push(x, y) {
      var i = (y * w + x) * 4;
      pts.push({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] });
    }
    for (var x = 0; x < w; x += step) {
      push(x, 0);
      push(x, h - 1);
    }
    for (var y = step; y < h - 1; y += step) {
      push(0, y);
      push(w - 1, y);
    }
    return pts;
  }

  function dominantEdgeColor(edge) {
    var opaque = edge.filter(function (p) { return p.a >= 20; });
    if (opaque.length < 8) return null;
    var buckets = {};
    for (var n = 0; n < opaque.length; n++) {
      var p = opaque[n];
      var key = (p.r >> 4) + ',' + (p.g >> 4) + ',' + (p.b >> 4);
      var cur = buckets[key] || { n: 0, r: 0, g: 0, b: 0 };
      cur.n += 1;
      cur.r += p.r;
      cur.g += p.g;
      cur.b += p.b;
      buckets[key] = cur;
    }
    var best = null;
    for (var k in buckets) {
      if (!best || buckets[k].n > best.n) best = buckets[k];
    }
    if (!best || best.n / opaque.length < 0.62) return null;
    return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
  }

  function keyOutBackground(data, w, h, bg) {
    var original = new Uint8ClampedArray(data);
    var hard = 42;
    var soft = 78;
    var count = w * h;
    var seen = new Uint8Array(count);
    var stack = [];
    function seed(x, y) {
      var p = y * w + x;
      if (seen[p]) return;
      var i = p * 4;
      if (data[i + 3] < 8) {
        seen[p] = 1;
        return;
      }
      if (colorDist(data[i], data[i + 1], data[i + 2], bg) > soft) return;
      stack.push(p);
    }
    for (var x = 0; x < w; x++) {
      seed(x, 0);
      if (h > 1) seed(x, h - 1);
    }
    for (var y = 1; y < h - 1; y++) {
      seed(0, y);
      if (w > 1) seed(w - 1, y);
    }
    var opaque = 0;
    for (var a = 3; a < data.length; a += 4) {
      if (data[a] >= 8) opaque += 1;
    }
    var removed = 0;
    while (stack.length > 0) {
      var p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      var i = p * 4;
      var alpha = data[i + 3];
      if (alpha < 8) continue;
      var dist = colorDist(data[i], data[i + 1], data[i + 2], bg);
      if (dist > soft) continue;
      if (dist <= hard) {
        data[i + 3] = 0;
        removed += 1;
      } else {
        var keep = (dist - hard) / (soft - hard);
        data[i + 3] = Math.round(alpha * keep);
        removed += 1 - keep;
      }
      var px = p % w;
      var py = (p - px) / w;
      if (px > 0) stack.push(p - 1);
      if (px + 1 < w) stack.push(p + 1);
      if (py > 0) stack.push(p - w);
      if (py + 1 < h) stack.push(p + w);
    }
    if (opaque > 0 && opaque - removed < opaque * 0.02) data.set(original);
  }

  function whitenDarkMonochrome(data) {
    var n = 0;
    var lum = 0;
    var chroma = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 24) continue;
      var r = data[i];
      var g = data[i + 1];
      var b = data[i + 2];
      n += 1;
      lum += (r + g + b) / 3;
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
    }
    if (n < 12) return false;
    if (lum / n > 96 || chroma / n > 32) return false;
    for (var j = 0; j < data.length; j += 4) {
      if (data[j + 3] < 8) continue;
      data[j] = 255;
      data[j + 1] = 255;
      data[j + 2] = 255;
    }
    return true;
  }

  function opaqueBounds(data, w, h) {
    var minX = w;
    var minY = h;
    var maxX = -1;
    var maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] < 24) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function isolateLogo(img) {
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    if (w < 2 || h < 2) return img;
    var maxEdge = 720;
    if (w > maxEdge || h > maxEdge) {
      var scale = maxEdge / Math.max(w, h);
      var scaled = document.createElement('canvas');
      scaled.width = Math.max(2, Math.round(w * scale));
      scaled.height = Math.max(2, Math.round(h * scale));
      var sctx = scaled.getContext('2d');
      if (!sctx) return img;
      sctx.drawImage(img, 0, 0, scaled.width, scaled.height);
      img = scaled;
      w = scaled.width;
      h = scaled.height;
    }
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0);
    var image;
    try {
      image = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      return img;
    }
    var data = image.data;
    var edge = sampleEdgePixels(data, w, h);
    var transparentEdge = edge.filter(function (p) { return p.a < 20; }).length / edge.length;
    var edited = false;
    if (transparentEdge < 0.7) {
      var bg = dominantEdgeColor(edge);
      if (bg) {
        keyOutBackground(data, w, h, bg);
        edited = true;
      }
    }
    if (whitenDarkMonochrome(data)) edited = true;
    var bounds = opaqueBounds(data, w, h);
    if (!bounds) return img;
    var cropped = document.createElement('canvas');
    cropped.width = bounds.w;
    cropped.height = bounds.h;
    var out = cropped.getContext('2d');
    if (!out) return img;
    if (edited) ctx.putImageData(image, 0, 0);
    out.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    return cropped;
  }

  function wrapLines(ctx, text, maxWidth, maxLines) {
    var words = String(text || '').trim().split(/\\s+/).filter(Boolean);
    if (words.length === 0) return [''];
    var lines = [];
    var i = 0;
    while (i < words.length && lines.length < maxLines) {
      var line = words[i];
      i += 1;
      while (i < words.length) {
        var test = line + ' ' + words[i];
        if (ctx.measureText(test).width <= maxWidth) {
          line = test;
          i += 1;
        } else break;
      }
      lines.push(line);
    }
    if (i < words.length && lines.length > 0) {
      var last = lines[lines.length - 1];
      var elided = last;
      while (elided.length > 4 && ctx.measureText(elided + '…').width > maxWidth) {
        elided = elided.slice(0, -1);
      }
      lines[lines.length - 1] = elided + '…';
    }
    return lines;
  }

  function storyMetaLine(location, budget) {
    var parts = ['Freelance'];
    var place = String(location || '').trim();
    var money = String(budget || '').trim();
    if (place && place !== '—') parts.push(place);
    if (money && money !== '—') parts.push(money);
    return parts.join(' | ');
  }

  function hasStoryDescription(text) {
    var t = String(text || '').trim();
    return t !== '' && t !== '—';
  }

  function buildDescriptionLayoutLines(ctx, text, maxWidth, maxLines) {
    var normalized = String(text || '').replace(/\\r\\n/g, '\\n');
    if (!hasStoryDescription(normalized)) return [];
    ctx.font = '400 ' + BODY_SIZE + 'px ' + SANS;
    var hardParts = normalized.split('\\n');
    var lines = [];
    for (var p = 0; p < hardParts.length; p++) {
      if (lines.length >= maxLines) break;
      var part = hardParts[p];
      if (part.trim() === '') {
        if (lines.length > 0 && lines[lines.length - 1] !== DESC_GAP_MARKER) lines.push(DESC_GAP_MARKER);
        continue;
      }
      var remaining = maxLines - lines.length;
      var wrapped = wrapLines(ctx, part.trim(), maxWidth, remaining);
      for (var n = 0; n < wrapped.length; n++) {
        if (lines.length >= maxLines) break;
        lines.push(wrapped[n]);
      }
    }
    return lines;
  }

  function descriptionBlockHeight(lines) {
    var h = 0;
    for (var i = 0; i < lines.length; i++) {
      h += lines[i] === DESC_GAP_MARKER ? BODY_LH * STORY_DESC_PARA_GAP_FACTOR : BODY_LH;
    }
    return h;
  }

  function layoutTitle(ctx, title, maxWidth) {
    var text = String(title || '').trim().toUpperCase() || 'JOB';
    var slashParts = text.split(/\\s*\\/\\s*/).map(function (part) { return part.trim(); }).filter(Boolean);
    if (slashParts.length >= 2 && slashParts.length <= 3) {
      var fontSize = 58;
      while (fontSize >= 42) {
        ctx.font = '700 ' + fontSize + 'px ' + SANS;
        var lines = slashParts.map(function (part, index) {
          return index < slashParts.length - 1 ? part + ' /' : part;
        });
        var fits = lines.every(function (line) { return ctx.measureText(line).width <= maxWidth; });
        if (fits) {
          var lineHeight = fontSize * 1.16;
          return { fontSize: fontSize, lines: lines, lineHeight: lineHeight, height: lines.length * lineHeight };
        }
        fontSize -= 2;
      }
    }
    var size = 58;
    var minSize = 40;
    var wrapped = [];
    while (size >= minSize) {
      ctx.font = '700 ' + size + 'px ' + SANS;
      wrapped = wrapLines(ctx, text, maxWidth, 5);
      if (wrapped.length <= 3) break;
      size -= 2;
    }
    var lh = size * 1.16;
    return { fontSize: size, lines: wrapped, lineHeight: lh, height: wrapped.length * lh };
  }

  function layoutMeta(ctx, meta, maxWidth) {
    var fontSize = 34;
    var lines = [meta];
    while (fontSize >= 26) {
      ctx.font = '400 ' + fontSize + 'px ' + SANS;
      lines = wrapLines(ctx, meta, maxWidth, 2);
      if (lines.length === 1 || fontSize === 26) break;
      fontSize -= 2;
    }
    var lineHeight = fontSize * 1.3;
    return { fontSize: fontSize, lines: lines, height: lines.length * lineHeight };
  }

  function companyNameBlockHeight(ctx, company, maxWidth) {
    var label = String(company || '').trim();
    if (!label) return 0;
    ctx.font = '700 40px ' + SANS;
    return wrapLines(ctx, label, maxWidth, 2).length * 48;
  }

  function containedSize(img, maxW, maxH) {
    var size = rasterSize(img);
    var scale = Math.min(maxW / size.w, maxH / size.h);
    return { w: size.w * scale, h: size.h * scale };
  }

  function wordmarkMetrics(viewBox) {
    var parts = String(viewBox || '').split(/[\\s,]+/).map(Number);
    var x = parts[0];
    var y = parts[1];
    var w = parts[2];
    var h = parts[3];
    var drawW = WORDMARK_W;
    var drawH = (h / w) * drawW;
    return { x: x, y: y, w: w, h: h, drawW: drawW, drawH: drawH };
  }

  function drawCreaWordmark(ctx, centerX, path, viewBox) {
    var vb = wordmarkMetrics(viewBox);
    var left = centerX - vb.drawW / 2;
    var top = H - WORDMARK_BOTTOM - vb.drawH;
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(vb.drawW / vb.w, vb.drawH / vb.h);
    ctx.translate(-vb.x, -vb.y);
    ctx.fillStyle = TEXT;
    ctx.fill(new Path2D(path));
    ctx.restore();
  }

  function measureStory(ctx, details, contentW, logoImg) {
    var logoH = logoImg
      ? containedSize(logoImg, LOGO_MAX_W, LOGO_MAX_H).h
      : companyNameBlockHeight(ctx, details.company, contentW);
    var title = layoutTitle(ctx, details.jobTitle, contentW);
    var meta = layoutMeta(ctx, storyMetaLine(details.location, details.budget), contentW);
    var descLines = hasStoryDescription(details.description)
      ? buildDescriptionLayoutLines(ctx, details.description, contentW, STORY_DESC_MAX_LINES)
      : [];
    var descH = descriptionBlockHeight(descLines);
    var height = 0;
    if (logoH > 0) height += logoH + GAP_AFTER_LOGO;
    height += title.height + GAP_AFTER_TITLE + meta.height;
    if (descH > 0) height += GAP_AFTER_META + descH;
    return { logoH: logoH, title: title, meta: meta, descLines: descLines, descH: descH, height: height };
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      if (!url) { resolve(null); return; }
      var img = new Image();
      img.onload = function () { resolve(img.naturalWidth > 0 ? img : null); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  function readPayload() {
    var node = document.getElementById('crea-story-payload');
    if (!node || !node.textContent) throw new Error('Missing story payload');
    return JSON.parse(node.textContent);
  }

  async function render() {
    var details = readPayload();
    var loadedLogo = details.logoDataUrl ? await loadImage(details.logoDataUrl) : null;
    var logoImg = loadedLogo ? isolateLogo(loadedLogo) : null;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    var contentW = W - PAD_X * 2;
    var cx = W / 2;
    var layout = measureStory(ctx, details, contentW, logoImg);
    var mark = wordmarkMetrics(details.wordmarkViewBox);
    var contentBottom = H - WORDMARK_BOTTOM - mark.drawH - GAP_ABOVE_WORDMARK;
    var y = Math.max(PAD_TOP_MIN, Math.round((contentBottom - layout.height) / 2));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    if (logoImg && layout.logoH > 0) {
      var size = containedSize(logoImg, LOGO_MAX_W, LOGO_MAX_H);
      ctx.drawImage(logoImg, cx - size.w / 2, y + (layout.logoH - size.h) / 2, size.w, size.h);
      y += layout.logoH + GAP_AFTER_LOGO;
    } else {
      var label = String(details.company || '').trim();
      if (label) {
        ctx.fillStyle = TEXT;
        ctx.font = '700 40px ' + SANS;
        var nameLines = wrapLines(ctx, label, contentW, 2);
        for (var n = 0; n < nameLines.length; n++) {
          ctx.fillText(nameLines[n], cx, y);
          y += 48;
        }
        y += GAP_AFTER_LOGO;
      }
    }

    ctx.fillStyle = TEXT;
    ctx.font = '700 ' + layout.title.fontSize + 'px ' + SANS;
    for (var t = 0; t < layout.title.lines.length; t++) {
      ctx.fillText(layout.title.lines[t], cx, y);
      y += layout.title.lineHeight;
    }
    y += GAP_AFTER_TITLE;

    ctx.fillStyle = TEXT;
    ctx.font = '400 ' + layout.meta.fontSize + 'px ' + SANS;
    var metaLh = layout.meta.fontSize * 1.3;
    for (var m = 0; m < layout.meta.lines.length; m++) {
      ctx.fillText(layout.meta.lines[m], cx, y);
      y += metaLh;
    }

    if (layout.descLines.length > 0) {
      y += GAP_AFTER_META;
      ctx.fillStyle = BODY;
      ctx.font = '400 ' + BODY_SIZE + 'px ' + SANS;
      for (var d = 0; d < layout.descLines.length; d++) {
        var line = layout.descLines[d];
        if (line === DESC_GAP_MARKER) {
          y += BODY_LH * STORY_DESC_PARA_GAP_FACTOR;
          if (y > contentBottom) break;
          continue;
        }
        if (y + BODY_LH > contentBottom) break;
        ctx.fillText(line, cx, y);
        y += BODY_LH;
      }
    }

    drawCreaWordmark(ctx, cx, details.wordmarkPath, details.wordmarkViewBox);
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    document.body.appendChild(canvas);
    return canvas.toDataURL('image/png');
  }

  render().then(postPng).catch(function (err) {
    post({ ok: false, error: err && err.message ? err.message : 'Story image failed' });
  });
})();
`

export function buildJobStoryHtml(fields: JobStoryFields): string {
  const payload = {
    jobTitle: fields.jobTitle,
    company: fields.company,
    logoDataUrl: fields.logoDataUrl?.startsWith('data:image/') ? fields.logoDataUrl : null,
    budget: fields.budget || '—',
    location: fields.location || '—',
    description: (fields.description || '—').slice(0, 4000),
    wordmarkPath: CREA_WORDMARK_PATH,
    wordmarkViewBox: CREA_WORDMARK_VIEWBOX,
  }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;background:#262626;">
  <script type="application/json" id="crea-story-payload">${json}</script>
  <script>${CANVAS_SCRIPT}</script>
</body>
</html>`
}
