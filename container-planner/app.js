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

  function footprintAt(c, x, z) {
    const { L, W } = TYPES[c.userData.type];
    const swap = c.userData.rot % 180 !== 0;
    const hx = (swap ? W : L) / 2, hz = (swap ? L : W) / 2;
    return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
  }
  const fpOf = (c) => footprintAt(c, c.position.x, c.position.z);
  const fpArea = (f) => (f.maxX - f.minX) * (f.maxZ - f.minZ);
  const overlapArea = (a, b) =>
    Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) *
    Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));

  // Where would container c land if dropped at (x, z)?
  function computeLanding(c, x, z) {
    const fp = footprintAt(c, x, z);
    const area = fpArea(fp);
    let y = 0, support = null;
    for (const o of containers) {
      if (o === c) continue;
      if (overlapArea(fp, fpOf(o)) > 0.35 * area) {
        const top = o.position.y + H;
        if (top > y) { y = top; support = o; }
      }
    }
    let valid = y + H <= state.maxStack * H + 0.01;
    for (const o of containers) {
      if (o === c) continue;
      if (overlapArea(fp, fpOf(o)) > 0.02 * area) {
        const oBase = o.position.y, oTop = oBase + H;
        if (y < oTop - 0.01 && y + H > oBase + 0.01) { valid = false; break; }
      }
    }
    return { y, valid, support };
  }

  function select(c) {
    if (selected) selected.userData.mesh.material.emissive.setHex(0x000000);
    selected = c;
    if (c) c.userData.mesh.material.emissive.setHex(0x3a3410);
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
    const c = pickContainer(e);
    select(c);
    if (!c) return;
    controls.enabled = false;
    drag = { c, start: c.position.clone(), valid: true };
    renderer.domElement.setPointerCapture(e.pointerId);
  });

  renderer.domElement.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const hit = pointerToGround(e);
    if (!hit) return;
    let x = Math.round(hit.x / SNAP) * SNAP;
    let z = Math.round(hit.z / SNAP) * SNAP;
    const land = computeLanding(drag.c, x, z);
    // magnetic stack alignment: same footprint directly on top
    if (land.support) {
      const s = land.support;
      if (s.userData.type === drag.c.userData.type && s.userData.rot % 180 === drag.c.userData.rot % 180) {
        const near = Math.abs(s.position.x - x) < 1.5 && Math.abs(s.position.z - z) < 1.5;
        if (near) { x = s.position.x; z = s.position.z; }
      }
    }
    const land2 = computeLanding(drag.c, x, z);
    drag.c.position.set(x, land2.y, z);
    drag.valid = land2.valid;
    setDragVisual(drag.c, true, land2.valid);
  });

  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!drag) { controls.enabled = true; return; }
    if (!drag.valid) drag.c.position.copy(drag.start);
    setDragVisual(drag.c, false, true);
    drag = null;
    controls.enabled = true;
    onChanged();
  });

  addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (!selected) return;
    if (e.key === "r" || e.key === "R") rotateSelected();
    if (e.key === "Delete" || e.key === "Backspace") removeContainer(selected);
    if (e.key === "Escape") select(null);
  });

  function rotateSelected() {
    if (!selected) return;
    const c = selected;
    const prev = c.userData.rot;
    setRotation(c, prev + 90);
    const land = computeLanding(c, c.position.x, c.position.z);
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
      splat: { ...state.splat, url: /^https?:/.test(state.splat.url) ? state.splat.url : "" },
      containers: containers.map((c) => ({
        t: c.userData.type,
        x: +c.position.x.toFixed(3), y: +c.position.y.toFixed(3), z: +c.position.z.toFixed(3),
        r: c.userData.rot, c: c.userData.color,
      })),
    };
  }

  function deserialize(data) {
    for (const c of [...containers]) removeContainer(c);
    state.maxStack = data.maxStack || 4;
    document.getElementById("maxstack").value = state.maxStack;
    if (data.splat) {
      state.splat = { ...state.splat, ...data.splat };
      syncCalibUI();
      // only http(s) urls can be re-fetched; local file names are informational
      if (/^https?:/.test(state.splat.url)) loadSplat({ url: state.splat.url });
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

  function loadSplat(source) {
    if (splatMesh) { scene.remove(splatMesh); splatMesh.dispose?.(); splatMesh = null; }
    toast("Terrein laden…");
    try {
      splatMesh = new SplatMesh({
        ...source,
        onLoad: () => { toast("Terrein geladen — gebruik Kalibratie om het uit te lijnen"); },
      });
    } catch (err) {
      toast("Laden mislukt: " + err.message);
      return;
    }
    applySplatTransform();
    scene.add(splatMesh);
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
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  $("add20").onclick = () => addContainer("20ft");
  $("add40").onclick = () => addContainer("40ft");
  $("btn-rotate").onclick = rotateSelected;
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
  $("btn-save").onclick = () => {
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "container-layout.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("btn-load").onclick = () => $("file-layout").click();
  $("file-layout").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { deserialize(JSON.parse(await file.text())); toast("Indeling geladen"); }
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
    loadSplat, camera, scene, getSplatMesh: () => splatMesh,
  };
})();
