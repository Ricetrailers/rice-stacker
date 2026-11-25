/* Chain 2-pt segments into polylines, then cluster polylines into separate figures. */
(function (global) {
  'use strict';

  function key(pt) { return (Math.round(pt[0] * 50)) + ',' + (Math.round(pt[1] * 50)); }

  // Join polylines end-to-end where endpoints coincide (within 0.02")
  function chainPolylines(polys) {
    var open = [], closed = [];
    polys.forEach(function (p) {
      if (p.length >= 3 && key(p[0]) === key(p[p.length - 1])) closed.push(p);
      else open.push(p.slice());
    });
    var endMap = {}; // key -> list of {i, end:0|1}
    function addEnd(i, endIdx) {
      var p = open[i];
      var k = key(endIdx === 0 ? p[0] : p[p.length - 1]);
      (endMap[k] = endMap[k] || []).push({ i: i, e: endIdx });
    }
    for (var i = 0; i < open.length; i++) { addEnd(i, 0); addEnd(i, 1); }
    var used = new Uint8Array(open.length);
    var out = [];
    for (var s = 0; s < open.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      var chain = open[s].slice();
      var grew = true;
      while (grew) {
        grew = false;
        // extend at tail
        var kt = key(chain[chain.length - 1]);
        var cands = endMap[kt] || [];
        for (var c = 0; c < cands.length; c++) {
          var cd = cands[c];
          if (used[cd.i]) continue;
          var p2 = open[cd.i];
          used[cd.i] = 1;
          var add = cd.e === 0 ? p2.slice(1) : p2.slice(0, -1).reverse();
          chain = chain.concat(add);
          grew = true;
          break;
        }
        if (grew) continue;
        // extend at head
        var kh = key(chain[0]);
        var cands2 = endMap[kh] || [];
        for (var c2 = 0; c2 < cands2.length; c2++) {
          var cd2 = cands2[c2];
          if (used[cd2.i]) continue;
          var p3 = open[cd2.i];
          used[cd2.i] = 1;
          var add2 = cd2.e === 1 ? p3.slice(0, -1) : p3.slice(1).reverse();
          chain = add2.concat(chain);
          grew = true;
          break;
        }
      }
      out.push(chain);
    }
    return out.concat(closed);
  }

  // Cluster polylines whose bboxes (expanded by gap) touch. Union-find + sweep.
  function clusterPolylines(polys, gap) {
    var n = polys.length;
    var boxes = polys.map(function (p) {
      var mnx = 1e30, mny = 1e30, mxx = -1e30, mxy = -1e30;
      p.forEach(function (pt) {
        if (pt[0] < mnx) mnx = pt[0]; if (pt[1] < mny) mny = pt[1];
        if (pt[0] > mxx) mxx = pt[0]; if (pt[1] > mxy) mxy = pt[1];
      });
      return [mnx - gap / 2, mny - gap / 2, mxx + gap / 2, mxy + gap / 2];
    });
    var parent = new Int32Array(n);
    for (var i = 0; i < n; i++) parent[i] = i;
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function uni(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
    // grid hash on box corners for candidate pairs
    var cell = Math.max(gap * 4, 24);
    var grid = {};
    for (var j = 0; j < n; j++) {
      var b = boxes[j];
      var x0 = Math.floor(b[0] / cell), x1 = Math.floor(b[2] / cell);
      var y0 = Math.floor(b[1] / cell), y1 = Math.floor(b[3] / cell);
      for (var gx = x0; gx <= x1; gx++) for (var gy = y0; gy <= y1; gy++) {
        var k = gx + ':' + gy;
        var lst = grid[k] = grid[k] || [];
        for (var q = 0; q < lst.length; q++) {
          var o = lst[q], ob = boxes[o];
          if (b[0] <= ob[2] && ob[0] <= b[2] && b[1] <= ob[3] && ob[1] <= b[3]) uni(j, o);
        }
        lst.push(j);
      }
    }
    var groups = {};
    for (var m = 0; m < n; m++) {
      var r = find(m);
      (groups[r] = groups[r] || []).push(polys[m]);
    }
    return Object.keys(groups).map(function (k2) { return groups[k2]; });
  }

  var api = { chainPolylines: chainPolylines, clusterPolylines: clusterPolylines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DXFCluster = api;
})(typeof window !== 'undefined' ? window : this);
