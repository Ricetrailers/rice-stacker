/* Minimal DXF (ASCII) -> polyline extractor.
   Supports: LINE, LWPOLYLINE (bulge), POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE,
   SPLINE (NURBS via de Boor, fit-point fallback), INSERT (block expansion).
   Output: { polylines: [[ [x,y], ... ], ...], bbox: {minX,minY,maxX,maxY} }
   Units: whatever the file uses (Rice files are inches). Y is up (DXF convention).
*/
(function (global) {
  'use strict';

  function tokenize(text) {
    var lines = text.split(/\r\n|\r|\n/);
    var pairs = [];
    for (var i = 0; i + 1 < lines.length; i += 2) {
      var code = parseInt(lines[i], 10);
      if (isNaN(code)) continue;
      pairs.push([code, lines[i + 1]]);
    }
    return pairs;
  }

  // Parse pairs into sections; return { blocks: {name: [entities]}, entities: [entities] }
  function parseStructure(pairs) {
    var i = 0, n = pairs.length;
    var blocks = {}, entities = [];

    function parseEntityList(stopNames) {
      // Reads consecutive entities until a (0, name) where name is in stopNames.
      var ents = [];
      while (i < n) {
        var p = pairs[i];
        if (p[0] === 0) {
          var name = p[1].trim();
          if (stopNames.indexOf(name) !== -1) return ents;
          // start new entity
          var ent = { type: name, groups: [] };
          i++;
          while (i < n && pairs[i][0] !== 0) { ent.groups.push(pairs[i]); i++; }
          // POLYLINE: swallow VERTEX..SEQEND as children
          if (name === 'POLYLINE') {
            ent.vertices = [];
            while (i < n && pairs[i][0] === 0) {
              var sub = pairs[i][1].trim();
              if (sub === 'VERTEX') {
                var v = { groups: [] }; i++;
                while (i < n && pairs[i][0] !== 0) { v.groups.push(pairs[i]); i++; }
                ent.vertices.push(v);
              } else if (sub === 'SEQEND') {
                i++;
                while (i < n && pairs[i][0] !== 0) i++;
                break;
              } else break;
            }
          }
          ents.push(ent);
        } else {
          i++;
        }
      }
      return ents;
    }

    while (i < n) {
      var p = pairs[i];
      if (p[0] === 0 && p[1].trim() === 'SECTION' && i + 1 < n && pairs[i + 1][0] === 2) {
        var secName = pairs[i + 1][1].trim();
        i += 2;
        if (secName === 'BLOCKS') {
          while (i < n) {
            if (pairs[i][0] === 0 && pairs[i][1].trim() === 'ENDSEC') { i++; break; }
            if (pairs[i][0] === 0 && pairs[i][1].trim() === 'BLOCK') {
              var bname = null;
              i++;
              while (i < n && pairs[i][0] !== 0) {
                if (pairs[i][0] === 2 && bname === null) bname = pairs[i][1].trim();
                i++;
              }
              var bents = parseEntityList(['ENDBLK', 'ENDSEC', 'BLOCK']);
              if (bname) blocks[bname] = bents;
              // consume ENDBLK groups
              if (i < n && pairs[i][0] === 0 && pairs[i][1].trim() === 'ENDBLK') {
                i++;
                while (i < n && pairs[i][0] !== 0) i++;
              }
            } else i++;
          }
        } else if (secName === 'ENTITIES') {
          entities = parseEntityList(['ENDSEC']);
          if (i < n && pairs[i][0] === 0 && pairs[i][1].trim() === 'ENDSEC') i++;
        } else {
          // skip section
          while (i < n && !(pairs[i][0] === 0 && pairs[i][1].trim() === 'ENDSEC')) i++;
          if (i < n) i++;
        }
      } else i++;
    }
    return { blocks: blocks, entities: entities };
  }

  function g(ent, code) { // first value for group code
    for (var k = 0; k < ent.groups.length; k++) if (ent.groups[k][0] === code) return ent.groups[k][1];
    return null;
  }
  function gf(ent, code, dflt) { var v = g(ent, code); return v === null ? dflt : parseFloat(v); }
  function gAll(ent, code) {
    var out = [];
    for (var k = 0; k < ent.groups.length; k++) if (ent.groups[k][0] === code) out.push(parseFloat(ent.groups[k][1]));
    return out;
  }

  var TAU = Math.PI * 2;

  function arcPoints(cx, cy, r, a0, a1, ccw) {
    // a0,a1 radians; sample proportional to sweep
    var sweep = a1 - a0;
    if (ccw) { while (sweep <= 0) sweep += TAU; }
    else { while (sweep >= 0) sweep -= TAU; }
    var steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    var pts = [];
    for (var s = 0; s <= steps; s++) {
      var a = a0 + sweep * (s / steps);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  function bulgeSeg(p0, p1, bulge) {
    if (!bulge) return [p0, p1];
    var theta = 4 * Math.atan(bulge);           // included angle, signed
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    var chord = Math.sqrt(dx * dx + dy * dy);
    if (chord < 1e-12) return [p0, p1];
    var r = chord / (2 * Math.sin(theta / 2));
    var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    var h = r * Math.cos(theta / 2);
    var ux = -dy / chord, uy = dx / chord;      // left normal of chord
    var cx = mx - ux * h, cy = my - uy * h;
    var a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
    var a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    // sweep direction follows sign of bulge (positive = CCW)
    var sweep = a1 - a0;
    if (bulge > 0) { while (sweep <= 0) sweep += TAU; }
    else { while (sweep >= 0) sweep -= TAU; }
    var steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
    var pts = [];
    for (var s = 0; s <= steps; s++) {
      var a = a0 + sweep * (s / steps);
      pts.push([cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)]);
    }
    return pts;
  }

  // de Boor for NURBS
  function splinePoints(degree, knots, ctrl, weights, samples) {
    if (!ctrl.length) return [];
    if (!weights || weights.length !== ctrl.length) weights = ctrl.map(function () { return 1; });
    var p = degree;
    var u0 = knots[p], u1 = knots[knots.length - 1 - p];
    var pts = [];
    for (var s = 0; s <= samples; s++) {
      var u = u0 + (u1 - u0) * (s / samples);
      if (s === samples) u = u1 - 1e-10 * (u1 - u0 || 1);
      // find span
      var k = p;
      for (var j = p; j < knots.length - p - 1; j++) { if (u >= knots[j] && u < knots[j + 1]) { k = j; break; } k = j; }
      // de Boor on homogeneous coords
      var d = [];
      for (var r0 = 0; r0 <= p; r0++) {
        var idx = k - p + r0;
        idx = Math.max(0, Math.min(ctrl.length - 1, idx));
        var w = weights[idx];
        d.push([ctrl[idx][0] * w, ctrl[idx][1] * w, w]);
      }
      for (var r = 1; r <= p; r++) {
        for (var jj = p; jj >= r; jj--) {
          var i2 = k - p + jj;
          var den = knots[i2 + p - r + 1] - knots[i2];
          var alpha = den === 0 ? 0 : (u - knots[i2]) / den;
          d[jj] = [
            (1 - alpha) * d[jj - 1][0] + alpha * d[jj][0],
            (1 - alpha) * d[jj - 1][1] + alpha * d[jj][1],
            (1 - alpha) * d[jj - 1][2] + alpha * d[jj][2]
          ];
        }
      }
      var w2 = d[p][2] || 1;
      pts.push([d[p][0] / w2, d[p][1] / w2]);
    }
    return pts;
  }

  function entityToPolylines(ent, blocks, depth) {
    var out = [];
    var t = ent.type;
    if (t === 'LINE') {
      out.push([[gf(ent, 10, 0), gf(ent, 20, 0)], [gf(ent, 11, 0), gf(ent, 21, 0)]]);
    } else if (t === 'LWPOLYLINE') {
      // ordered walk of 10/20/42 groups
      var verts = [], cur = null;
      for (var k = 0; k < ent.groups.length; k++) {
        var c = ent.groups[k][0], v = ent.groups[k][1];
        if (c === 10) { cur = { x: parseFloat(v), y: 0, b: 0 }; verts.push(cur); }
        else if (c === 20 && cur) cur.y = parseFloat(v);
        else if (c === 42 && cur) cur.b = parseFloat(v);
      }
      var closed = (parseInt(g(ent, 70) || '0', 10) & 1) === 1;
      if (verts.length >= 2) {
        var pts = [[verts[0].x, verts[0].y]];
        var m = closed ? verts.length : verts.length - 1;
        for (var q = 0; q < m; q++) {
          var a = verts[q], b = verts[(q + 1) % verts.length];
          var seg = bulgeSeg([a.x, a.y], [b.x, b.y], a.b);
          for (var s = 1; s < seg.length; s++) pts.push(seg[s]);
        }
        out.push(pts);
      }
    } else if (t === 'POLYLINE') {
      var vs = (ent.vertices || []).map(function (vv) {
        var e2 = { groups: vv.groups };
        return { x: gf(e2, 10, 0), y: gf(e2, 20, 0), b: gf(e2, 42, 0) };
      }).filter(function (vv) { return isFinite(vv.x) && isFinite(vv.y); });
      var closedP = (parseInt(g(ent, 70) || '0', 10) & 1) === 1;
      if (vs.length >= 2) {
        var pts2 = [[vs[0].x, vs[0].y]];
        var m2 = closedP ? vs.length : vs.length - 1;
        for (var q2 = 0; q2 < m2; q2++) {
          var a2 = vs[q2], b2 = vs[(q2 + 1) % vs.length];
          var seg2 = bulgeSeg([a2.x, a2.y], [b2.x, b2.y], a2.b);
          for (var s2 = 1; s2 < seg2.length; s2++) pts2.push(seg2[s2]);
        }
        out.push(pts2);
      }
    } else if (t === 'CIRCLE') {
      out.push(arcPoints(gf(ent, 10, 0), gf(ent, 20, 0), gf(ent, 40, 0), 0, TAU - 1e-9, true));
    } else if (t === 'ARC') {
      var sa = gf(ent, 50, 0) * Math.PI / 180, ea = gf(ent, 51, 0) * Math.PI / 180;
      out.push(arcPoints(gf(ent, 10, 0), gf(ent, 20, 0), gf(ent, 40, 0), sa, ea, true));
    } else if (t === 'ELLIPSE') {
      var ecx = gf(ent, 10, 0), ecy = gf(ent, 20, 0);
      var mx2 = gf(ent, 11, 0), my2 = gf(ent, 21, 0);
      var ratio = gf(ent, 40, 1), t0 = gf(ent, 41, 0), t1 = gf(ent, 42, TAU);
      var mlen = Math.sqrt(mx2 * mx2 + my2 * my2);
      var rot = Math.atan2(my2, mx2);
      var sweepE = t1 - t0; while (sweepE <= 0) sweepE += TAU;
      var stepsE = Math.max(8, Math.ceil(sweepE / (Math.PI / 24)));
      var ep = [];
      for (var se = 0; se <= stepsE; se++) {
        var tt = t0 + sweepE * (se / stepsE);
        var ex = mlen * Math.cos(tt), ey = mlen * ratio * Math.sin(tt);
        ep.push([ecx + ex * Math.cos(rot) - ey * Math.sin(rot), ecy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
      }
      out.push(ep);
    } else if (t === 'SPLINE') {
      var deg = parseInt(g(ent, 71) || '3', 10);
      var knots = gAll(ent, 40);
      // control points: ordered 10/20 pairs
      var cps = [], curc = null;
      for (var kk = 0; kk < ent.groups.length; kk++) {
        var cc = ent.groups[kk][0], vv2 = ent.groups[kk][1];
        if (cc === 10) { curc = [parseFloat(vv2), 0]; cps.push(curc); }
        else if (cc === 20 && curc) curc[1] = parseFloat(vv2);
      }
      var wts = gAll(ent, 41);
      var fits = [], curf = null;
      for (var kf = 0; kf < ent.groups.length; kf++) {
        var cf = ent.groups[kf][0], vf = ent.groups[kf][1];
        if (cf === 11) { curf = [parseFloat(vf), 0]; fits.push(curf); }
        else if (cf === 21 && curf) curf[1] = parseFloat(vf);
      }
      if (cps.length && knots.length >= cps.length + deg + 1) {
        out.push(splinePoints(deg, knots, cps, wts.length === cps.length ? wts : null, Math.max(16, cps.length * 4)));
      } else if (fits.length >= 2) {
        out.push(fits);
      } else if (cps.length >= 2) {
        out.push(cps);
      }
    } else if (t === 'INSERT' && depth < 5) {
      var bname2 = (g(ent, 2) || '').trim();
      var block = blocks[bname2];
      if (block) {
        var ix = gf(ent, 10, 0), iy = gf(ent, 20, 0);
        var sx = gf(ent, 41, 1), sy = gf(ent, 42, 1);
        var ang = gf(ent, 50, 0) * Math.PI / 180;
        var ca = Math.cos(ang), sn = Math.sin(ang);
        for (var be = 0; be < block.length; be++) {
          var sub2 = entityToPolylines(block[be], blocks, depth + 1);
          for (var pl = 0; pl < sub2.length; pl++) {
            out.push(sub2[pl].map(function (pt) {
              var x = pt[0] * sx, y = pt[1] * sy;
              return [ix + x * ca - y * sn, iy + x * sn + y * ca];
            }));
          }
        }
      }
    }
    return out;
  }

  // Ramer-Douglas-Peucker
  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    var keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1];
      var ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var maxD = -1, maxI = -1;
      for (var i = a + 1; i < b; i++) {
        var d;
        if (len2 === 0) { var ex = pts[i][0] - ax, ey = pts[i][1] - ay; d = ex * ex + ey * ey; }
        else {
          var t = ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          var px = ax + t * dx - pts[i][0], py = ay + t * dy - pts[i][1];
          d = px * px + py * py;
        }
        if (d > maxD) { maxD = d; maxI = i; }
      }
      if (maxD > eps * eps) { keep[maxI] = 1; stack.push([a, maxI]); stack.push([maxI, b]); }
    }
    var out = [];
    for (var j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j]);
    return out;
  }

  // Raw extraction: every entity as a polyline, original coordinates.
  function parseDXFRaw(text) {
    var struct = parseStructure(tokenize(text));
    var polys = [];
    for (var i = 0; i < struct.entities.length; i++) {
      var pls = entityToPolylines(struct.entities[i], struct.blocks, 0);
      for (var j = 0; j < pls.length; j++) {
        var p = pls[j].filter(function (pt) { return isFinite(pt[0]) && isFinite(pt[1]); });
        if (p.length >= 2) polys.push(p);
      }
    }
    return polys;
  }

  // Normalize a set of polylines into a profile: translate to origin, decimate.
  function finishProfile(polys, opts) {
    opts = opts || {};
    var eps = opts.tolerance != null ? opts.tolerance : 0.02;   // inches
    var minFeature = opts.minFeature != null ? opts.minFeature : 0; // drop tiny clutter
    // bbox + filter + decimate
    var minX = 1e30, minY = 1e30, maxX = -1e30, maxY = -1e30;
    polys.forEach(function (p) {
      p.forEach(function (pt) {
        if (pt[0] < minX) minX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] > maxY) maxY = pt[1];
      });
    });
    var kept = [];
    polys.forEach(function (p) {
      var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
      p.forEach(function (pt) {
        if (pt[0] < mnx) mnx = pt[0]; if (pt[1] < mny) mny = pt[1];
        if (pt[0] > mxx) mxx = pt[0]; if (pt[1] > mxy) mxy = pt[1];
      });
      var diag = Math.sqrt((mxx - mnx) * (mxx - mnx) + (mxy - mny) * (mxy - mny));
      if (diag < minFeature) return;
      var d = rdp(p, eps);
      if (d.length >= 2) kept.push(d);
    });
    // translate so min corner is (0,0), round to 0.005"
    var out = kept.map(function (p) {
      return p.map(function (pt) {
        return [Math.round((pt[0] - minX) * 200) / 200, Math.round((pt[1] - minY) * 200) / 200];
      });
    });
    return {
      polylines: out,
      width: Math.round((maxX - minX) * 100) / 100,
      height: Math.round((maxY - minY) * 100) / 100
    };
  }

  function parseDXF(text, opts) {
    return finishProfile(parseDXFRaw(text), opts);
  }

  var api = { parseDXF: parseDXF, parseDXFRaw: parseDXFRaw, finishProfile: finishProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DXF = api;
})(typeof window !== 'undefined' ? window : this);
