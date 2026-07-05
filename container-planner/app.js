/* Containerplanner — three.js + Spark (gaussian splats)
 * Containers are Y-up meshes on a metric ground plane; the drone-scan splat
 * is a calibratable backdrop. All state lives in `state` and serializes to
 * the layout JSON (download / share-link / localStorage autosave).
 */
(() => {
  // ---------------------------------------------------------------- constants
  const TYPES = {
    "20ft": { L: 6.058, W: 2.438, H: 2.591, teu: 1 },
    "40ft": { L: 12.192, W: 2.438, H: 2.591, teu: 2 },
  };
  const H = 2.591;                 // all ISO containers share height
  const SNAP = 0.5;                // ground grid snap (m)
  const COLORS = ["#1f4e79", "#b63e36", "#2e6b4f", "#c7622b", "#6b6f76", "#8a6d3b"];
  const STORAGE_KEY = "containerplanner-layout";

  const state = {
    color: COLORS[0],
    maxStack: 4,
    splat: { url: "", pos: [0, 0, 0], rotDeg: [180, 0, 0], scale: 1, visible: true },
  };

  // ---------------------------------------------------------------- scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  document.getElementById("canvas").appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe7ee);
  scene.fog = new THREE.Fog(0xdfe7ee, 150, 400);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(28, 20, 28);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;

  // Spark needs its renderer node in the scene to draw SplatMeshes
  try { scene.add(new SparkRenderer({ renderer })); } catch (err) {
    console.warn("SparkRenderer init failed (splats disabled):", err);
  }

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
  sun.position.set(40, 60, 25);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0xcfd8e0, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);
  const grid = new THREE.GridHelper(120, 120, 0x9aa7b4, 0xb9c4cf);
  scene.add(grid);

  // ---------------------------------------------------------------- containers
  const containers = [];   // array of THREE.Group
  let selected = null;

  function makeContainer(type, colorHex) {
    const { L, W } = TYPES[type];
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex), roughness: 0.7, metalness: 0.15,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), mat);
    mesh.position.y = H / 2;
    group.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x22262c })
    );
    edges.position.y = H / 2;
    group.add(edges);
    group.userData = { isContainer: true, type, color: colorHex, rot: 0, mesh, edges };
    return group;
  }

  function setRotation(c, deg) {
    c.userData.rot = ((deg % 360) + 360) % 360;
    c.rotation.y = (c.userData.rot * Math.PI) / 180;
  }

  // ---- oriented-rectangle geometry (containers rotate freely, 45° snaps) ----
  // three.js Y-rotation maps a local point to a world offset via rot2(·, -rad);
  // the inverse (world -> local frame) is rot2(·, +rad).
  function rot2(px, pz, rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return { x: c * px - s * pz, z: s * px + c * pz };
  }
  const localToWorldOff = (lx, lz, rotDeg) => rot2(lx, lz, -rotDeg * Math.PI / 180);

  function cornersAt(c, x, z, rotDeg) {
    const { L, W } = TYPES[c.userData.type];
    const hx = L / 2, hz = W / 2;
    return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([lx, lz]) => {
      const o = localToWorldOff(lx, lz, rotDeg);
      return { x: x + o.x, z: z + o.z };
    });
  }
  const cornersOf = (c) => cornersAt(c, c.position.x, c.position.z, c.userData.rot);

  function pointInFootprint(px, pz, o, pad = 1e-6) {
    const d = rot2(px - o.position.x, pz - o.position.z, o.userData.rot * Math.PI / 180);
    const { L, W } = TYPES[o.userData.type];
    return Math.abs(d.x) <= L / 2 + pad && Math.abs(d.z) <= W / 2 + pad;
  }

  // Separating-axis overlap test for two oriented rectangles. Touching faces
  // (gap 0) count as NOT overlapping, so flush placement is allowed.
  function obbOverlap(A, B, epsM = 1e-3) {
    const axes = [];
    for (const poly of [A, B]) {
      for (let i = 0; i < 2; i++) {
        const p = poly[i], q = poly[i + 1];
        axes.push({ x: -(q.z - p.z), z: q.x - p.x });
      }
    }
    for (const ax of axes) {
      const len = Math.hypot(ax.x, ax.z) || 1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const c of A) { const d = c.x * ax.x + c.z * ax.z; if (d < minA) minA = d; if (d > maxA) maxA = d; }
      for (const c of B) { const d = c.x * ax.x + c.z * ax.z; if (d < minB) minB = d; if (d > maxB) maxB = d; }
      if (maxA < minB + epsM * len || maxB < minA + epsM * len) return false;
    }
    return true;
  }

  // Fraction of container c's footprint (at x,z,rot) that lies over o.
  function overlapRatioAt(c, x, z, rotDeg, o) {
    const { L, W } = TYPES[c.userData.type];
    const nx = 9, nz = 5;
    let inside = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = (-0.5 + (i + 0.5) / nx) * L;
      const lz = (-0.5 + (j + 0.5) / nz) * W;
      const off = localToWorldOff(lx, lz, rotDeg);
      if (pointInFootprint(x + off.x, z + off.z, o)) inside++;
    }
    return inside / (nx * nz);
  }

  // Where would container c land if dropped at (x, z) with the given rotation?
  function landingAt(c, x, z, rotDeg) {
    const corners = cornersAt(c, x, z, rotDeg);
    let y = 0, support = null;
    for (const o of containers) {
      if (o === c) continue;
      if (!obbOverlap(corners, cornersOf(o))) continue;
      if (overlapRatioAt(c, x, z, rotDeg, o) > 0.35) {
        const top = o.position.y + H;
        if (top > y) { y = top; support = o; }
      }
    }
    let valid = y + H <= state.maxStack * H + 0.01;
    if (valid) {
      for (const o of containers) {
        if (o === c) continue;
        if (!obbOverlap(corners, cornersOf(o))) continue;
        const oBase = o.position.y, oTop = oBase + H;
        if (y < oTop - 0.01 && y + H > oBase + 0.01) { valid = false; break; }
      }
    }
    return { y, valid, support };
  }
  const computeLanding = (c, x, z) => landingAt(c, x, z, c.userData.rot);

  // Snap the dragged container flush against neighbours on the same level.
  // Works in the dragged container's local frame, so it also snaps rows of
  // containers that are all rotated to the same (or a perpendicular) angle.
  const EDGE_SNAP = 0.7;
  function edgeSnap(c, x, z, y, rotDeg = c.userData.rot) {
    const rad = rotDeg * Math.PI / 180;
    const { L, W } = TYPES[c.userData.type];
    const hx = L / 2, hz = W / 2;
    const cl = rot2(x, z, rad);           // dragged center in local frame
    let dLx = null, dLz = null;
    for (const o of containers) {
      if (o === c || Math.abs(o.position.y - y) > 0.01) continue;
      const rel = (((o.userData.rot - rotDeg) % 90) + 90) % 90;
      if (Math.min(rel, 90 - rel) > 1) continue;        // only parallel / perpendicular
      const perp = Math.abs((((o.userData.rot - rotDeg) % 180) + 180) % 180 - 90) < 1;
      const od = TYPES[o.userData.type];
      const ohx = (perp ? od.W : od.L) / 2, ohz = (perp ? od.L : od.W) / 2;
      const ol = rot2(o.position.x, o.position.z, rad);
      const fp = { minX: cl.x - hx, maxX: cl.x + hx, minZ: cl.z - hz, maxZ: cl.z + hz };
      const of = { minX: ol.x - ohx, maxX: ol.x + ohx, minZ: ol.z - ohz, maxZ: ol.z + ohz };
      const xNear = fp.minX < of.maxX + EDGE_SNAP && fp.maxX > of.minX - EDGE_SNAP;
      const zNear = fp.minZ < of.maxZ + EDGE_SNAP && fp.maxZ > of.minZ - EDGE_SNAP;
      const xC = [of.maxX - fp.minX, of.minX - fp.maxX, of.minX - fp.minX, of.maxX - fp.maxX];
      const zC = [of.maxZ - fp.minZ, of.minZ - fp.maxZ, of.minZ - fp.minZ, of.maxZ - fp.maxZ];
      if (zNear) for (const d of xC) if (Math.abs(d) < EDGE_SNAP && (dLx === null || Math.abs(d) < Math.abs(dLx))) dLx = d;
      if (xNear) for (const d of zC) if (Math.abs(d) < EDGE_SNAP && (dLz === null || Math.abs(d) < Math.abs(dLz))) dLz = d;
    }
    if (dLx === null && dLz === null) return { x, z, snapped: false };
    const nw = rot2(cl.x + (dLx || 0), cl.z + (dLz || 0), -rad);   // back to world
    return { x: nw.x, z: nw.z, snapped: true };
  }

  // Corner handles on the selected container: drag one to place that exact
  // corner, snapping to corners of other containers or the grid.
  let handleGroup = null;
  function detachHandles() {
    if (handleGroup?.parent) handleGroup.parent.remove(handleGroup);
    handleGroup = null;
  }
  function attachHandles(c) {
    detachHandles();
    if (!c) return;
    const { L, W } = TYPES[c.userData.type];
    handleGroup = new THREE.Group();
    for (const [lx, lz] of [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]]) {
      const h = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 0.18, 24),
        new THREE.MeshBasicMaterial({ color: 0xffb300, depthTest: false, transparent: true, opacity: 0.92 })
      );
      h.position.set(lx, H + 0.05, lz);
      h.renderOrder = 10;
      h.userData = { isHandle: true, corner: [lx, lz] };
      handleGroup.add(h);
    }
    // rotation knob: sits beyond the "front" (+X) end; drag it to spin (45° snaps)
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0x2ea3ff, depthTest: false, transparent: true, opacity: 0.92 })
    );
    knob.position.set(L / 2 + 1.7, H + 0.05, 0);
    knob.renderOrder = 11;
    knob.userData = { isKnob: true };
    const mast = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(L / 2, H + 0.05, 0), new THREE.Vector3(L / 2 + 1.7, H + 0.05, 0)]),
      new THREE.LineBasicMaterial({ color: 0x2ea3ff, depthTest: false, transparent: true, opacity: 0.8 })
    );
    mast.renderOrder = 10;
    handleGroup.add(mast);
    handleGroup.add(knob);
    c.add(handleGroup);
  }

  function pickHandle(e) {
    if (!handleGroup) return null;
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      handleGroup.children.filter((h) => h.userData.isHandle || h.userData.isKnob));
    return hits.length ? hits[0].object : null;
  }

  // marker shown at the corner the grabbed corner will snap to
  const snapMarker = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.14, 12, 24),
    new THREE.MeshBasicMaterial({ color: 0x00e08a, depthTest: false, transparent: true, opacity: 0.95 })
  );
  snapMarker.rotation.x = Math.PI / 2;
  snapMarker.renderOrder = 12;
  snapMarker.visible = false;
  scene.add(snapMarker);

  function select(c) {
    if (selected) selected.userData.mesh.material.emissive.setHex(0x000000);
    selected = c;
    if (c) c.userData.mesh.material.emissive.setHex(0x3a3410);
    attachHandles(c);
    document.getElementById("sel").classList.toggle("open", !!c);
  }

  function removeContainer(c) {
    scene.remove(c);
    containers.splice(containers.indexOf(c), 1);
    if (selected === c) select(null);
    onChanged();
  }

  function addContainer(type) {
    const c = makeContainer(type, state.color);
    // find a free ground spot in expanding rings around the origin
    outer:
    for (let ring = 0; ring < 40; ring++) {
      for (let gx = -ring; gx <= ring; gx++) {
        for (let gz = -ring; gz <= ring; gz++) {
          if (Math.max(Math.abs(gx), Math.abs(gz)) !== ring) continue;
          const x = gx * 3, z = gz * 3.5;
          const land = computeLanding(c, x, z);
          if (land.valid && land.y === 0) { c.position.set(x, 0, z); break outer; }
        }
      }
    }
    scene.add(c);
    containers.push(c);
    select(c);
    onChanged();
  }

  // ---------------------------------------------------------------- dragging
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let drag = null; // { c, start: Vector3, valid }

  function pointerToGround(e) {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
  }

  function pickContainer(e) {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(containers.map((c) => c.userData.mesh));
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.isContainer) obj = obj.parent;
    return obj;
  }

  function setDragVisual(c, dragging, valid) {
    const m = c.userData.mesh.material;
    m.transparent = dragging;
    m.opacity = dragging ? 0.75 : 1;
    c.userData.edges.material.color.setHex(dragging && !valid ? 0xcc2222 : 0x22262c);
  }

  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const h = pickHandle(e);
    if (h && selected) {
      controls.enabled = false;
      if (h.userData.isKnob) {
        // rotation drag: spin the container, snapping to 45°
        h.material.color.setHex(0x0a66c2);
        drag = { c: selected, rotate: true, startRot: selected.userData.rot,
                 start: selected.position.clone(), valid: true, handle: h };
      } else {
        // corner drag: move the container by this exact corner
        h.material.color.setHex(0xff6d00);
        drag = { c: selected, start: selected.position.clone(), valid: true, corner: h.userData.corner, handle: h };
      }
      renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    const c = pickContainer(e);
    select(c);
    if (!c) return;
    controls.enabled = false;
    drag = { c, start: c.position.clone(), valid: true, corner: null };
    renderer.domElement.setPointerCapture(e.pointerId);
  });

  const CORNER_SNAP = 1.2;   // reach for grabbing another container's corner
  function moveByCorner(e) {
    const hit = pointerToGround(e);
    if (!hit) return;
    const c = drag.c;
    const o0 = localToWorldOff(drag.corner[0], drag.corner[1], c.userData.rot);
    const off = { x: o0.x, z: o0.z };
    // snap the grabbed corner to the nearest corner of another container…
    let cx = hit.x, cz = hit.z, best = null;
    for (const o of containers) {
      if (o === c) continue;
      for (const corner of cornersOf(o)) {
        const d = Math.hypot(corner.x - cx, corner.z - cz);
        if (d < CORNER_SNAP && (!best || d < best.d)) best = { x: corner.x, z: corner.z, d };
      }
    }
    if (best) { cx = best.x; cz = best.z; }
    else { cx = Math.round(cx / SNAP) * SNAP; cz = Math.round(cz / SNAP) * SNAP; }
    let x = cx - off.x, z = cz - off.z;
    let land = computeLanding(c, x, z);
    if (!land.valid && best) {
      // …but fall back to the grid when the snapped spot collides
      cx = Math.round(hit.x / SNAP) * SNAP;
      cz = Math.round(hit.z / SNAP) * SNAP;
      x = cx - off.x; z = cz - off.z;
      land = computeLanding(c, x, z);
      best = null;
    }
    c.position.set(x, land.y, z);
    drag.valid = land.valid;
    setDragVisual(c, true, land.valid);
    snapMarker.visible = !!best;
    if (best) snapMarker.position.set(best.x, land.y + 0.1, best.z);
  }

  function rotateByKnob(e) {
    const hit = pointerToGround(e);
    if (!hit) return;
    const c = drag.c;
    const ang = Math.atan2(hit.z - c.position.z, hit.x - c.position.x);   // world angle to pointer
    let deg = -ang * 180 / Math.PI;                    // front (+X local) faces the pointer
    deg = Math.round(deg / 45) * 45;                   // snap to 45°
    setRotation(c, deg);
    const land = landingAt(c, c.position.x, c.position.z, c.userData.rot);
    c.position.y = land.y;
    drag.valid = land.valid;
    setDragVisual(c, true, land.valid);
  }

  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.rotate) { rotateByKnob(e); return; }
    if (drag.corner) { moveByCorner(e); return; }
    const hit = pointerToGround(e);
    if (!hit) return;
    const gx = Math.round(hit.x / SNAP) * SNAP;
    const gz = Math.round(hit.z / SNAP) * SNAP;
    let x = gx, z = gz;
    const land = computeLanding(drag.c, hit.x, hit.z);
    if (land.support) {
      // magnetic stack alignment: same footprint directly on top
      const s = land.support;
      if (s.userData.type === drag.c.userData.type && s.userData.rot % 180 === drag.c.userData.rot % 180) {
        const near = Math.abs(s.position.x - x) < 1.5 && Math.abs(s.position.z - z) < 1.5;
        if (near) { x = s.position.x; z = s.position.z; }
      }
    } else {
      // edge/corner snapping against neighbours on this level
      const es = edgeSnap(drag.c, hit.x, hit.z, land.y);
      if (es.snapped) { x = es.x; z = es.z; }
    }
    let land2 = computeLanding(drag.c, x, z);
    if (!land2.valid && (x !== gx || z !== gz)) {
      // snapped spot collides — fall back to the plain grid position
      x = gx; z = gz;
      land2 = computeLanding(drag.c, x, z);
    }
    drag.c.position.set(x, land2.y, z);
    drag.valid = land2.valid;
    setDragVisual(drag.c, true, land2.valid);
  });

  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!drag) { controls.enabled = true; return; }
    if (!drag.valid) {
      if (drag.rotate) setRotation(drag.c, drag.startRot);
      drag.c.position.copy(drag.start);   // restore full pre-drag pose (incl. stack height)
    }
    if (drag.handle) drag.handle.material.color.setHex(drag.rotate ? 0x2ea3ff : 0xffb300);
    snapMarker.visible = false;
    setDragVisual(drag.c, false, true);
    drag = null;
    controls.enabled = true;
    onChanged();
  });

  addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (!selected) return;
    if (e.key === "r" || e.key === "R") rotateSelected(e.shiftKey ? -45 : 45);
    if (e.key === "Delete" || e.key === "Backspace") removeContainer(selected);
    if (e.key === "Escape") select(null);
  });

  function rotateSelected(delta = 45) {
    if (!selected) return;
    const c = selected;
    const prev = c.userData.rot;
    setRotation(c, prev + delta);
    const land = landingAt(c, c.position.x, c.position.z, c.userData.rot);
    if (!land.valid) setRotation(c, prev); // no room to rotate here
    else c.position.y = land.y;
    onChanged();
  }

  // ---------------------------------------------------------------- counts + autosave
  function updateCounts() {
    const n20 = containers.filter((c) => c.userData.type === "20ft").length;
    const n40 = containers.filter((c) => c.userData.type === "40ft").length;
    document.getElementById("c20").textContent = n20;
    document.getElementById("c40").textContent = n40;
    document.getElementById("cteu").textContent = n20 * TYPES["20ft"].teu + n40 * TYPES["40ft"].teu;
    document.getElementById("ctot").textContent = n20 + n40;
  }

  let saveTimer = null;
  function onChanged() {
    updateCounts();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize())); } catch {}
    }, 400);
  }

  // ---------------------------------------------------------------- layout (de)serialization
  function serialize() {
    return {
      version: 1,
      maxStack: state.maxStack,
      splat: {
        ...state.splat,
        url: /^https?:/.test(state.splat.url) ? state.splat.url : "",
        file: splatFileName,
      },
      containers: containers.map((c) => ({
        t: c.userData.type,
        x: +c.position.x.toFixed(3), y: +c.position.y.toFixed(3), z: +c.position.z.toFixed(3),
        r: c.userData.rot, c: c.userData.color,
      })),
    };
  }

  function deserialize(data, { skipSplat = false } = {}) {
    for (const c of [...containers]) removeContainer(c);
    state.maxStack = data.maxStack || 4;
    document.getElementById("maxstack").value = state.maxStack;
    if (data.splat) {
      state.splat = { ...state.splat, ...data.splat };
      syncCalibUI();
      // only http(s) urls can be re-fetched; local file names are informational
      if (!skipSplat && /^https?:/.test(state.splat.url)) loadSplat({ url: state.splat.url });
      else applySplatTransform();
    }
    for (const rec of data.containers || []) {
      const c = makeContainer(rec.t in TYPES ? rec.t : "20ft", rec.c || COLORS[0]);
      setRotation(c, rec.r || 0);
      c.position.set(rec.x || 0, rec.y || 0, rec.z || 0);
      scene.add(c);
      containers.push(c);
    }
    select(null);
    onChanged();
  }

  const b64encode = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64decode = (s) => new TextDecoder().decode(
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)));

  // ---------------------------------------------------------------- splat
  let splatMesh = null;
  let splatBytes = null;      // raw file bytes, kept for project-file export
  let splatFileName = "";
  let splatWatchdog = null;

  function sniffFormat(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const m = dv.getUint32(0, true);
    if ((m & 0xffffff) === 0x796c70) return "PLY";
    if ((m & 0xffff) === 0x8b1f) return "SPZ";
    if (m === 0x04034b50) return "ZIP-container";
    if (bytes.length % 32 === 0)
      return `.splat, ${(bytes.length / 32).toLocaleString("nl-NL")} splats`;
    return "onbekend formaat";
  }

  // Decode a few records as antimatter15 .splat and check they make sense;
  // tools ship all kinds of layouts under the same extension.
  function splatContentCheck(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const n = Math.floor(bytes.length / 32);
    const record = (i) => ({
      pos: [0, 4, 8].map((o) => dv.getFloat32(i * 32 + o, true)),
      scale: [12, 16, 20].map((o) => dv.getFloat32(i * 32 + o, true)),
    });
    let bad = 0;
    for (const i of [0, Math.floor(n / 2), n - 1]) {
      const r = record(i);
      const finite = [...r.pos, ...r.scale].every(Number.isFinite);
      const scaleOk = r.scale.every((s) => s > 1e-8 && s < 100);
      const posOk = r.pos.every((p) => Math.abs(p) < 1e6);
      if (!finite || !scaleOk || !posOk) bad++;
    }
    const s = record(0);
    const fmt = (a) => a.map((v) => Number.isFinite(v) ? +v.toPrecision(3) : String(v)).join(", ");
    return { bad, detail: `pos[${fmt(s.pos)}] schaal[${fmt(s.scale)}]` };
  }

  // Inspect a PLY header to tell a gaussian-splat PLY apart from a plain
  // mesh / point-cloud PLY (the usual reason a "splat" won't render).
  function plyHeaderInfo(bytes) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
    const end = head.indexOf("end_header");
    if (!head.startsWith("ply") || end < 0) return null;
    const lines = head.slice(0, end).split(/\r?\n/);
    let vertexCount = 0, inVertex = false;
    const props = [];
    let format = "";
    for (const ln of lines) {
      const t = ln.trim().split(/\s+/);
      if (t[0] === "format") format = t[1] || "";
      if (t[0] === "element") { inVertex = t[1] === "vertex"; if (inVertex) vertexCount = +t[2] || 0; }
      if (t[0] === "property" && inVertex) props.push(t[t.length - 1]);
    }
    const has = (re) => props.some((p) => re.test(p));
    const isGaussian = has(/^scale_/) && has(/^rot_/) && (has(/^f_dc_/) || has(/^opacity$/));
    return { format, vertexCount, props, isGaussian };
  }

  // Bounding box that ignores stray far-away splats (drone scans have them),
  // via 1..99 percentile of sampled splat centers.
  function robustSplatBox(mesh) {
    try {
      const xs = [], ys = [], zs = [];
      let count = 0;
      mesh.forEachSplat((i, center) => {
        count++;
        if (count % 7 === 0) { xs.push(center.x); ys.push(center.y); zs.push(center.z); }
      });
      if (xs.length < 100) throw new Error("too few samples");
      const pct = (arr, p) => {
        arr.sort((a, b) => a - b);
        return arr[Math.floor(p * (arr.length - 1))];
      };
      const box = new THREE.Box3(
        new THREE.Vector3(pct(xs, 0.01), pct(ys, 0.01), pct(zs, 0.01)),
        new THREE.Vector3(pct(xs, 0.99), pct(ys, 0.99), pct(zs, 0.99))
      );
      mesh.updateMatrixWorld(true);
      return box.applyMatrix4(mesh.matrixWorld);
    } catch {
      return splatWorldBox(mesh);
    }
  }

  function applySplatTransform() {
    if (!splatMesh) return;
    const s = state.splat;
    splatMesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
    splatMesh.rotation.set(
      THREE.MathUtils.degToRad(s.rotDeg[0]),
      THREE.MathUtils.degToRad(s.rotDeg[1]),
      THREE.MathUtils.degToRad(s.rotDeg[2])
    );
    splatMesh.scale.setScalar(s.scale);
    splatMesh.visible = s.visible;
  }

  async function loadSplat(source) {
    // normalize to bytes so the terrain can be embedded in project files
    if (source.url) {
      toast("Terrein downloaden…");
      try {
        const resp = await fetch(source.url);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        source = {
          fileBytes: new Uint8Array(await resp.arrayBuffer()),
          fileName: source.url.split(/[?#]/)[0].split("/").pop() || "terrain.splat",
        };
      } catch (err) {
        toast("Terrein-download mislukt: " + err.message);
        return;
      }
    }
    if (splatMesh) { scene.remove(splatMesh); splatMesh.dispose?.(); splatMesh = null; }
    const bytes = source.fileBytes instanceof Uint8Array
      ? source.fileBytes : new Uint8Array(source.fileBytes);
    source.fileBytes = bytes;
    const format = sniffFormat(bytes);
    toast(`Terrein laden… (${format}, ${(bytes.length / 1e6).toFixed(0)}MB)`);
    let contentNote = "";
    if (format === "PLY") {
      const info = plyHeaderInfo(bytes);
      window.__lastPlyInfo = info;
      if (info && !info.isGaussian) {
        clearTimeout(splatWatchdog);
        toast("Dit PLY-bestand is een mesh/pointcloud (eigenschappen: " +
          info.props.slice(0, 8).join(", ") + "…), geen gaussian-splat. " +
          "Exporteer als 3DGS-splat: een .ply mét scale_/rot_/f_dc_, of een .spz-bestand.", 16000);
        return;
      }
      if (info) contentNote = ` PLY: ${info.vertexCount.toLocaleString("nl-NL")} gaussians`;
    }
    if (format.startsWith(".splat")) {
      const chk = splatContentCheck(bytes);
      contentNote = " Eerste record: " + chk.detail;
      if (chk.bad > 0) {
        clearTimeout(splatWatchdog);
        toast("Dit bestand heeft de .splat-indeling niet (waarden onlogisch: " +
          chk.detail + "). Probeer de .ply- of .spz-export van je tool.", 15000);
        return;
      }
    }
    clearTimeout(splatWatchdog);
    splatWatchdog = setTimeout(() => toast(
      "Terrein laden blijft hangen — de inhoud wijkt af van het standaardformaat. " +
      "Probeer de .ply- of .spz-export van je tool." + contentNote, 15000), 12000);
    try {
      splatMesh = new SplatMesh({
        ...source,
        onProgress: (ev) => {
          if (ev.lengthComputable) toast(`Terrein laden… ${Math.round(ev.loaded / ev.total * 100)}%`);
        },
        onLoad: (mesh) => afterSplatLoad(mesh),
      });
    } catch (err) {
      toast("Laden mislukt: " + err.message);
      return;
    }
    splatMesh.initialized?.catch?.((err) => {
      clearTimeout(splatWatchdog);
      toast("Terrein kon niet gelezen worden — is dit een .ply/.splat/.spz/.ksplat? (" + err + ")");
    });
    splatBytes = bytes;
    splatFileName = source.fileName || "terrain.splat";
    applySplatTransform();
    scene.add(splatMesh);
    onChanged();
  }

  function splatWorldBox(mesh) {
    mesh.updateMatrixWorld(true);
    return mesh.getBoundingBox(true).clone().applyMatrix4(mesh.matrixWorld);
  }

  function frameTerrain() {
    if (!splatMesh) return;
    const box = robustSplatBox(splatMesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, 10);
    camera.far = Math.max(2000, radius * 20);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(0.75, 0.6, 0.75).multiplyScalar(radius * 0.9));
    controls.update();
  }

  function afterSplatLoad(mesh) {
    clearTimeout(splatWatchdog);
    // scans rarely sit at the origin; put them in view automatically
    // (robust bounds: stray far-away splats would skew centering and framing)
    const box = robustSplatBox(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const offOrigin = Math.hypot(center.x, center.z) > 25 || Math.abs(box.min.y) > 4;
    if (offOrigin) {
      state.splat.pos[0] -= center.x;
      state.splat.pos[1] -= box.min.y;
      state.splat.pos[2] -= center.z;
      syncCalibUI();
      applySplatTransform();
    }
    frameTerrain();
    const dims = [size.x, size.y, size.z].map((v) => v.toFixed(0)).join(" × ");
    toast(`Terrein geladen (${dims} m)` +
      (offOrigin ? " — automatisch gecentreerd" : "") +
      " — fijnafstelling via Kalibratie");
    onChanged();
  }

  function autoCenterSplat() {
    if (!splatMesh?.getBoundingBox) return;
    splatMesh.updateMatrixWorld(true);
    const box = splatMesh.getBoundingBox(true).applyMatrix4(splatMesh.matrixWorld);
    const c = box.getCenter(new THREE.Vector3());
    state.splat.pos[0] -= c.x;
    state.splat.pos[1] -= box.min.y;
    state.splat.pos[2] -= c.z;
    syncCalibUI();
    applySplatTransform();
    onChanged();
  }

  // ---------------------------------------------------------------- UI wiring
  const $ = (id) => document.getElementById(id);
  const toastEl = $("toast");
  let toastTimer = null;
  function toast(msg, duration = 2600) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), duration);
  }

  $("add20").onclick = () => addContainer("20ft");
  $("add40").onclick = () => addContainer("40ft");
  $("btn-rot-l").onclick = () => rotateSelected(-45);
  $("btn-rot-r").onclick = () => rotateSelected(45);
  $("btn-delete").onclick = () => selected && removeContainer(selected);
  $("maxstack").onchange = (e) => {
    state.maxStack = Math.max(1, Math.min(8, +e.target.value || 4));
    e.target.value = state.maxStack;
    onChanged();
  };

  const swatches = $("swatches");
  COLORS.forEach((hex, i) => {
    const el = document.createElement("div");
    el.className = "swatch" + (i === 0 ? " active" : "");
    el.style.background = hex;
    el.onclick = () => {
      state.color = hex;
      swatches.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
      el.classList.add("active");
      if (selected) {
        selected.userData.color = hex;
        selected.userData.mesh.material.color.set(hex);
        onChanged();
      }
    };
    swatches.appendChild(el);
  });

  // splat load + calibration
  $("btn-splat").onclick = () => $("file-splat").click();
  $("file-splat").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const bytes = await file.arrayBuffer();
    state.splat.url = file.name; // informational; not shareable
    loadSplat({ fileBytes: bytes, fileName: file.name });
  });
  $("btn-calib").onclick = () => $("calib").classList.toggle("open");
  $("k-center").onclick = autoCenterSplat;
  $("k-frame").onclick = frameTerrain;
  $("k-vis").onclick = (e) => {
    state.splat.visible = !state.splat.visible;
    e.target.textContent = state.splat.visible ? "Verberg terrein" : "Toon terrein";
    applySplatTransform();
    onChanged();
  };

  const calibMap = [
    ["k-px", "v-px", (v) => (state.splat.pos[0] = v), () => state.splat.pos[0], 1],
    ["k-py", "v-py", (v) => (state.splat.pos[1] = v), () => state.splat.pos[1], 2],
    ["k-pz", "v-pz", (v) => (state.splat.pos[2] = v), () => state.splat.pos[2], 1],
    ["k-rx", "v-rx", (v) => (state.splat.rotDeg[0] = v), () => state.splat.rotDeg[0], 1],
    ["k-ry", "v-ry", (v) => (state.splat.rotDeg[1] = v), () => state.splat.rotDeg[1], 1],
    ["k-rz", "v-rz", (v) => (state.splat.rotDeg[2] = v), () => state.splat.rotDeg[2], 1],
    ["k-s", "v-s", (v) => (state.splat.scale = v), () => state.splat.scale, 2],
  ];
  for (const [inputId, valId, set, get, decimals] of calibMap) {
    $(inputId).addEventListener("input", (e) => {
      set(+e.target.value);
      $(valId).textContent = (+e.target.value).toFixed(decimals);
      applySplatTransform();
      onChanged();
    });
  }
  function syncCalibUI() {
    for (const [inputId, valId, _set, get, decimals] of calibMap) {
      $(inputId).value = get();
      $(valId).textContent = (+get()).toFixed(decimals);
    }
  }

  // save / load / share
  // Project file: "CPLN1" + uint32-LE JSON length + layout JSON + raw splat bytes.
  // One file carries terrain + calibration + layout, so a client only needs
  // the app link and this file — no hosting or accounts.
  const PROJECT_MAGIC = "CPLN1";

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  $("btn-save").onclick = () => {
    const json = new TextEncoder().encode(JSON.stringify(serialize()));
    const header = new DataView(new ArrayBuffer(4));
    header.setUint32(0, json.length, true);
    const parts = [new TextEncoder().encode(PROJECT_MAGIC), header.buffer, json];
    if (splatBytes) parts.push(splatBytes);
    download(new Blob(parts, { type: "application/octet-stream" }), "indeling.containerplan");
    toast(splatBytes
      ? "Project opgeslagen (mét terrein) — deel dit ene bestand"
      : "Project opgeslagen (nog geen terrein geladen)");
  };

  async function loadProjectOrLayout(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const magic = new TextDecoder().decode(buf.slice(0, PROJECT_MAGIC.length));
    if (magic === PROJECT_MAGIC) {
      const jsonLen = new DataView(buf.buffer, buf.byteOffset).getUint32(PROJECT_MAGIC.length, true);
      const start = PROJECT_MAGIC.length + 4;
      const data = JSON.parse(new TextDecoder().decode(buf.slice(start, start + jsonLen)));
      deserialize(data, { skipSplat: true });
      const splat = buf.slice(start + jsonLen);
      if (splat.length) {
        await loadSplat({ fileBytes: splat, fileName: data.splat?.file || "terrain.splat" });
        applySplatTransform(); // saved calibration wins over load defaults
      }
      toast("Project geladen");
      return;
    }
    // fall back to plain layout JSON (older exports)
    deserialize(JSON.parse(new TextDecoder().decode(buf)));
    toast("Indeling geladen");
  }

  $("btn-load").onclick = () => $("file-layout").click();
  $("file-layout").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await loadProjectOrLayout(file); }
    catch { toast("Kon dit bestand niet lezen"); }
  });
  $("btn-share").onclick = async () => {
    const url = location.origin + location.pathname + location.search +
      "#l=" + b64encode(JSON.stringify(serialize()));
    try { await navigator.clipboard.writeText(url); toast("Deel-link gekopieerd naar klembord"); }
    catch { prompt("Kopieer deze link:", url); }
  };

  // export
  function capturePng() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  }
  $("btn-png").onclick = () => {
    const a = document.createElement("a");
    a.href = capturePng();
    a.download = "container-indeling.png";
    a.click();
  };
  $("btn-pdf").onclick = () => {
    const img = capturePng();
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    pdf.setFontSize(16);
    pdf.text("Containerindeling", 14, 16);
    pdf.setFontSize(10);
    pdf.setTextColor(110);
    pdf.text(new Date().toLocaleDateString("nl-NL"), pw - 14, 16, { align: "right" });
    const imgW = pw - 28, imgH = imgW * (innerHeight / innerWidth);
    const drawH = Math.min(imgH, ph - 48);
    pdf.addImage(img, "PNG", 14, 22, drawH * (innerWidth / innerHeight), drawH);
    const n20 = containers.filter((c) => c.userData.type === "20ft").length;
    const n40 = containers.filter((c) => c.userData.type === "40ft").length;
    pdf.setTextColor(30);
    pdf.text(
      `20ft: ${n20}    40ft: ${n40}    TEU: ${n20 + 2 * n40}    totaal: ${n20 + n40}`,
      14, ph - 12
    );
    pdf.save("container-indeling.pdf");
  };

  // ---------------------------------------------------------------- init
  function init() {
    const params = new URLSearchParams(location.search);
    const hashLayout = location.hash.startsWith("#l=") ? location.hash.slice(3) : null;
    if (hashLayout) {
      try { deserialize(JSON.parse(b64decode(hashLayout))); toast("Gedeelde indeling geladen"); }
      catch { toast("Deel-link kon niet gelezen worden"); }
    } else {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try { deserialize(JSON.parse(saved)); } catch {}
      }
    }
    if (params.get("splat")) {
      state.splat.url = params.get("splat");
      loadSplat({ url: state.splat.url });
    }
    syncCalibUI();
    updateCounts();
  }

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  (function tick() {
    requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  })();

  init();

  // expose a minimal hook for automated tests
  window.__planner = {
    containers, addContainer, serialize, deserialize, computeLanding, state,
    loadSplat, camera, scene, getSplatMesh: () => splatMesh, edgeSnap,
    landingAt, cornersOf, cornersAt, obbOverlap, rotateSelected, setRotation,
    plyHeaderInfo, select: (i) => select(containers[i]),
  };
})();
