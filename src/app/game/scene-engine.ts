import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** One stack of an item sitting in an inventory slot. */
export interface ItemStack {
  id: string;
  icon: string;
  name: string;
  count: number;
}

/** Live state pushed to the HUD each frame. */
export interface HudState {
  rollCd: number;
  rollCdMax: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpToNext: number;
  coins: number;
  gems: number;
  px: number;
  pz: number;
  heading: number;
  bx: number;
  bz: number;
  casting: boolean;
  equipped: boolean;
  selectedHotbar: number;
  invOpen: boolean;
  invVersion: number;
}

/**
 * Framework-agnostic three.js engine: a "cubic" fishing-island diorama seen
 * top-down at a fixed angle, with a blocky character you can walk around with
 * ZQSD / arrow keys. It has walking animations, a dodge roll on Shift (a forward
 * somersault), and a fishing rod you equip / stow with "E". When equipped, the
 * line + bobber are simulated as a Verlet rope with gravity, and the bobber
 * floats on the (wavy) water surface.
 *
 * Rendering note: start() renders one frame *synchronously* so a static image
 * exists even where requestAnimationFrame is throttled (e.g. a backgrounded
 * tab). The live animation runs in a normal rAF loop when the tab is visible.
 */
export class SceneEngine {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();

  private readonly character = new THREE.Group();
  private readonly keys = new Set<string>();

  // limb pivots (rotate around hip / shoulder for the walk cycle)
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private rig!: THREE.Group; // holds all body parts so they can somersault during a roll

  // roll / dodge
  private rolling = false;
  private rollT = 0;
  private rollCooldown = 0;
  private readonly rollCooldownMax = 3; // seconds to wait between rolls
  private readonly rollDuration = 0.55;
  private readonly rollDir = new THREE.Vector3();

  // fishing gear
  private rodGroup!: THREE.Group;
  private rodTip!: THREE.Object3D;
  private line!: THREE.Line;
  private linePos!: Float32Array;
  private bobber!: THREE.Group;
  private equipped = false; // spawn empty-handed; press E to take the rod out
  private rodReveal = 0; // 0 = hidden, 1 = fully out; drives the equip "pop" animation
  private readonly rope: { pos: THREE.Vector3; prev: THREE.Vector3 }[] = [];
  private bobberAnchored = false; // pin the float where it lands so it doesn't drift back to us
  private readonly bobberAnchor = new THREE.Vector3();
  private readonly ropeN = 9;
  private readonly ropeRest = 0.1; // idle line length (reeled in) — kept short
  private readonly ropeRestCast = 0.65; // line let out when fishing
  private ropeRestCur = 0.1; // animates between reeled-in and cast-out
  private fishing = false; // line cast into the water
  private pendingStow = false; // unequip asked while the line is out → reel in first, then stow
  private retractFast = false; // float hit land → reel back in quickly (not the slow normal reel)
  private castT = 1; // cast animation progress (1 = idle): wind-up → throw → settle
  private castThrown = false; // whether this cast's throw impulse has fired
  // bite mechanic: once the float is anchored on water, a fish bites after a random wait;
  // reeling in DURING the bite window lands the catch, otherwise it gets away
  private biteTimer = 0; // seconds until the next bite (counts down while anchored, no bite)
  private biting = false; // a fish is currently tugging the float
  private biteWindow = 0; // seconds left to react during a bite
  private biteSplashT = 0; // throttles the water splashes while a fish thrashes
  private biteMarker?: THREE.Group; // red "!" that pops above the float during a bite
  // Inventory: 45 slots laid out as a 5×9 grid — row 0 (slots [0..8]) is also the hotbar.
  // Each slot holds a stack or null; items are dragged between slots from the HUD.
  private readonly slots: (ItemStack | null)[] = new Array(45).fill(null);
  private selectedHotbar = 0; // active hotbar slot (its item is "in hand")
  private invOpen = false;
  private held: ItemStack | null = null; // stack picked up by the cursor while dragging
  private heldFrom = -1; // slot the held stack came from (to return / swap)
  private invVersion = 0; // bumps on any inventory change so the HUD re-renders
  private readonly fishKinds: ItemStack[] = [
    { id: 'sardine', icon: '/sprites/sardine.png', name: 'Sardine', count: 1 },
    { id: 'dorade', icon: '/sprites/dorade.png', name: 'Dorade', count: 1 },
    { id: 'globe', icon: '🐡', name: 'Poisson-globe', count: 1 }, // TODO sprite (quota épuisé)
    { id: 'crabe', icon: '🦀', name: 'Crabe', count: 1 }, // TODO sprite
    { id: 'calmar', icon: '🦑', name: 'Calmar', count: 1 }, // TODO sprite
  ];

  private water?: THREE.Mesh;
  private readonly waterY = -0.7;
  // base radius of the (organic, NON-square) island; the coastline wobbles around it
  private readonly islandR = 17;
  // stepped sandy seabed config: sand fills `sandReach` units beyond the shoreline
  private readonly seabed = { sandReach: 13, stepWidth: 3, drop: 0.5, baseTop: -1.2 };
  // swaying seaweed + swimming fish placed on the sand, animated each frame
  private readonly seaweed: { mesh: THREE.Group; phase: number; bend: number }[] = [];
  private readonly fish: { mesh: THREE.Group; cx: number; cz: number; r: number; y: number; speed: number; phase: number }[] = [];
  // pet cat that wanders the island: static core merged to one mesh; the legs + tail are
  // separate groups so the walk cycle and tail sway can animate them
  private cat?: THREE.Group;
  private catTail?: THREE.Group;
  private catLegs: { g: THREE.Group; o: number }[] = [];
  private catTargetX = 0;
  private catTargetZ = 0;
  private catPauseT = 0;
  private catHeading = 0;
  private catWalkPhase = 0;
  private catStuck = 0;
  // shared time uniform driving the animated caustics in the water shader
  private readonly waterUniforms: { uTime: { value: number } } = { uTime: { value: 0 } };
  // procedural shimmer texture scrolled across the surface (two layers, opposite drift)
  private waterShimmer?: THREE.CanvasTexture;
  // cubic splash burst when the bobber hits the water
  private readonly splash: { mesh: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private readonly splashLife = 0.55;

  // circular collision footprints in XZ (radius includes the character's size); filled in buildScenery
  private readonly obstacles: { x: number; z: number; r: number }[] = [];
  // the house is rectangular, so it gets an axis-aligned box collision (centred at origin)
  private readonly houseHalf = { x: 2.8, z: 2.4 }; // footprint half-extents + character radius
  // circular see-through: a soft dither hole opens in obstacles that hide the player
  // each occluder carries its OWN strength so only the object actually on the
  // camera→player line fades — neighbours that merely overlap on screen stay solid
  private readonly occluders: {
    object: THREE.Object3D;
    strength: { value: number };
    cx: number; // logical XZ centre (merged props sit at the origin) for broad-phase culling
    cz: number;
  }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly holeU = {
    center: { value: new THREE.Vector2() },
    viewZ: { value: 0 },
    radius: { value: 0.2 },
    aspect: { value: 1 },
  };
  private readonly _cc = new THREE.Vector3();
  private readonly _cdir = new THREE.Vector3();
  private heading = 0; // facing angle around Y (radians)
  private walkPhase = 0; // walk-cycle accumulator

  // progression / HUD stats
  private hp = 100;
  private maxHp = 100;
  private level = 1;
  private xp = 0;
  private xpToNext = 100;
  private coins = 0;
  private gems = 0;

  // scratch vectors reused each frame (avoid per-frame allocation)
  private readonly _tmp = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _move = new THREE.Vector3();

  private frame = 0;
  private running = false;
  private readonly ro: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly onState?: (s: HudState) => void,
  ) {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // --- renderer ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // cap DPR: above ~1.5 the extra fragments cost a lot for little visible gain
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    // VSM (variance) shadows for a genuinely SMOOTH penumbra. PCFSoftShadowMap is
    // deprecated in three r184 and silently downgrades to hard PCFShadowMap, so the
    // soft look has to come from VSM's blurred variance map (see buildLights()).
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    // --- world background + atmosphere ---
    this.scene.background = new THREE.Color(0x9fd3e8);
    this.scene.fog = new THREE.Fog(0x9fd3e8, 38, 120);

    // --- fixed camera: top-down but angled (the "cubic diorama" view) ---
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 500);
    this.camera.position.set(15, 16, 15);

    // OrbitControls kept only to aim the camera — all interaction disabled,
    // so the camera can neither be rotated, panned nor zoomed.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.2, 0);
    this.controls.enableRotate = false;
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.update();

    this.buildLights();
    this.buildWater();
    this.buildSplash();
    this.buildBiteMarker();
    this.buildIsland();
    this.buildSeabed();
    this.buildSeaLife();
    this.buildScenery();
    this.buildHouse();
    this.buildVegetation();
    this.buildCat();
    this.scene.add(this.character);
    this.buildCharacter();
    this.character.position.set(0, 0, 4.5); // spawn in front of the house, not inside it
    this.character.rotation.y = Math.PI;
    this.heading = Math.PI;
    this.initInventory();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('wheel', this.onWheel, { passive: true });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);

    // Debug hook: lets a headless check drive a frame and inspect / toggle state
    // even when rAF is throttled (backgrounded preview tabs).
    (window as unknown as { __game?: unknown }).__game = {
      engine: this,
      scene: this.scene,
      renderer: this.renderer,
      camera: this.camera,
      renderOnce: () => this.renderOnce(),
      step: (dt: number) => {
        this.update(dt);
        this.renderOnce();
      },
      toggleEquip: () => this.toggleEquip(),
    };
  }

  // ---------------------------------------------------------------- builders

  private box(
    w: number,
    h: number,
    d: number,
    color: number,
    opts: { rough?: number; metal?: number } = {},
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.92,
      metalness: opts.metal ?? 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** A limb that hangs below a pivot placed at the hip / shoulder, so it swings. */
  private limb(x: number, pivotY: number, w: number, h: number, d: number, color: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const mesh = this.box(w, h, d, color);
    mesh.position.set(0, -h / 2, 0);
    pivot.add(mesh);
    return pivot;
  }

  /**
   * Collapse a pile of static meshes into ONE mesh per distinct material — each
   * cube's transform is baked in, so dozens of draw calls become a handful. The
   * source materials are reused as-is (glass, emissive, etc. stay intact).
   */
  private mergeByMaterial(meshes: THREE.Mesh[]): THREE.Mesh[] {
    const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const key = `${mat.color.getHexString()}|${mat.roughness}|${mat.metalness}|${mat.emissive?.getHexString() ?? ''}|${mat.emissiveIntensity}|${mat.side}|${mat.transparent}`;
      let entry = groups.get(key);
      if (!entry) entry = (groups.set(key, { mat, geos: [] }), groups.get(key)!);
      const g = (mesh.geometry as THREE.BufferGeometry).clone();
      if (g.getAttribute('uv')) g.deleteAttribute('uv'); // normalise attributes so they merge
      g.applyMatrix4(mesh.matrixWorld); // bake the world transform into the verts
      entry.geos.push(g);
    }
    const out: THREE.Mesh[] = [];
    for (const { mat, geos } of groups.values()) {
      const merged = geos.length === 1 ? geos[0] : (mergeGeometries(geos, false) ?? geos[0]);
      for (const g of geos) if (g !== merged) g.dispose();
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      out.push(m);
    }
    return out;
  }

  /**
   * Merge meshes into a SINGLE vertex-coloured mesh (one draw call, one material),
   * baking each source colour into the verts. Used for matte props like trees.
   */
  private mergeColored(meshes: THREE.Mesh[]): THREE.Mesh {
    const geos: THREE.BufferGeometry[] = [];
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const g = (mesh.geometry as THREE.BufferGeometry).clone();
      if (g.getAttribute('uv')) g.deleteAttribute('uv');
      g.applyMatrix4(mesh.matrixWorld);
      const c = (mesh.material as THREE.MeshStandardMaterial).color;
      const n = g.attributes['position'].count;
      const carr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        carr[i * 3] = c.r;
        carr[i * 3 + 1] = c.g;
        carr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(carr, 3));
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false) ?? geos[0];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xcfeaff, 0x4a6b3a, 1.0);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
    sun.position.set(12, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // soft-shadow blur: VSM honours these (PCF would ignore radius). Higher samples
    // keep the wide penumbra free of banding.
    sun.shadow.radius = 4;
    sun.shadow.blurSamples = 16;
    const c = sun.shadow.camera;
    // tighten the frustum around the island: ~46 texels/unit instead of ~34, so the
    // shadow map stays crisp under the blur rather than going chunky.
    c.left = -24;
    c.right = 24;
    c.top = 24;
    c.bottom = -24;
    c.near = 2;
    c.far = 70;
    // VSM compares depth moments, so it needs far less depth bias than PCF; lean on a
    // small normalBias to keep the flat grass acne-free without peter-panning the cubes.
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
  }

  private waveAt(x: number, z: number, t: number): number {
    return Math.sin(x * 0.18 + t) * 0.25 + Math.cos(z * 0.22 + t * 0.8) * 0.2;
  }

  /**
   * Radius of the island's coastline in the direction of (x, z) — a low-frequency
   * lumpy curve around islandR, giving an organic (non-square) shore. Periodic in
   * angle (integer harmonics) so there's no seam. The SAME formula is mirrored in
   * the water shader so foam/depth bands hug the real shoreline.
   */
  private islandReach(x: number, z: number): number {
    const a = Math.atan2(z, x);
    return (
      this.islandR +
      2.4 * Math.sin(3 * a + 0.6) +
      1.4 * Math.sin(5 * a + 2.2) +
      1.7 * Math.sin(2 * a - 1.1)
    );
  }

  /** Distance of (x, z) beyond the shore: <0 on land, 0 at the water's edge, >0 at sea. */
  private beyondShore(x: number, z: number): number {
    return Math.hypot(x, z) - this.islandReach(x, z);
  }

  /** Z of the last grass-cube row on the +Z shore — the dock starts flush here. */
  private get dockBase(): number {
    return Math.floor(this.islandReach(0, 1));
  }
  private readonly dockLen = 6; // number of planks reaching out over the water

  /** Height the bobber rests on at (x, z): grass island, wooden dock, or wavy water. */
  private support(x: number, z: number, t: number): number {
    if (this.beyondShore(x, z) <= 0) return 0.06; // grass island top
    if (Math.abs(x) <= 1.0 && z >= this.dockBase - 0.5 && z <= this.dockBase + this.dockLen - 0.5)
      return 0.12; // dock
    return this.waterY + this.waveAt(x, z, t); // open (wavy) water
  }

  /**
   * Procedural "shimmer" tile drawn into a canvas → CanvasTexture. Chunky blocky
   * cells (fits the low-poly art) with a few brighter speckles, wrapped so it tiles
   * seamlessly. Used as the material's diffuse map and scrolled each frame.
   */
  private makeShimmerTexture(): THREE.CanvasTexture {
    const N = 64; // texel grid; small + nearest filtering → crisp cubic look
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    // base blocky cells: a coarse value-noise lattice tinted toward sea blue
    const cells = 8; // 8x8 chunky blocks across the tile
    const step = N / cells;
    // deterministic hash so the tile is stable (no flicker between rebuilds)
    const hash = (ix: number, iy: number): number => {
      const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const v = hash(cx, cy);
        // bias toward mid/dark blue with the odd light tile (foam glints)
        const light = 150 + Math.floor(v * 95); // 150..245
        const r = Math.floor(light * 0.55);
        const g = Math.floor(light * 0.82);
        const b = Math.min(255, light + 10);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(Math.round(cx * step), Math.round(cy * step), Math.ceil(step), Math.ceil(step));
      }
    }
    // sparse bright speckles for sun glint on top of the blocks
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 26; i++) {
      const gx = Math.floor(hash(i + 1, i * 3 + 7) * cells) * step;
      const gy = Math.floor(hash(i * 5 + 2, i + 9) * cells) * step;
      const s = step * 0.34;
      ctx.fillRect(Math.round(gx + step * 0.33), Math.round(gy + step * 0.33), Math.ceil(s), Math.ceil(s));
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter; // blocky, no smoothing
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildWater(): void {
    const size = 240;
    const seg = 48; // chunkier facets for the cartoon-cubic look
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2); // lay flat in the XZ plane

    // Wind-Waker-style toon water: an unlit, flat-coloured surface — the look comes
    // entirely from hard depth bands + animated white foam injected in the shader below.
    const mat = new THREE.MeshBasicMaterial({ color: 0x2b86c9, transparent: true, opacity: 0.84 });

    // Layer 2 (+ extra caustics): inject GLSL via onBeforeCompile so scene lights and
    // the island's cast shadow STILL affect the surface. A `uTime` uniform animates
    // moving caustic highlights; a second set of UVs (the same map, scrolled the other
    // way in-shader) gives the two-direction look without a second texture sampler.
    mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      shader.uniforms['uTime'] = this.waterUniforms.uTime;

      // --- vertex: displace the wave ON THE GPU (was a per-frame CPU loop + buffer
      //     upload) and pass world XZ so caustics tile in WORLD units ---
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nvarying vec2 vWaterWorld;',
        )
        .replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            'vec2 wWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;',
            // same curve as waveAt() on the CPU, so the bobber rides the visible waves
            'transformed.y += sin( wWorld.x * 0.18 + uTime ) * 0.25 + cos( wWorld.y * 0.22 + uTime * 0.8 ) * 0.2;',
            'vWaterWorld = wWorld;',
          ].join('\n'),
        );

      // --- fragment: add animated caustic highlights into diffuseColor BEFORE lighting ---
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          [
            '#include <common>',
            'uniform float uTime;',
            'varying vec2 vWaterWorld;',
            // layered sine "caustics": cheap, animated, tiles by construction
            'float waterCaustic( vec2 p, float t ) {',
            '  float c = 0.0;',
            '  c += sin( p.x * 1.7 + t * 1.30 ) * sin( p.y * 1.3 - t * 1.10 );',
            '  c += sin( ( p.x + p.y ) * 1.1 - t * 0.90 ) * 0.7;',
            '  c += sin( ( p.x - p.y ) * 0.9 + t * 1.50 ) * 0.6;',
            '  c = c * 0.5 + 0.5;',          // -> 0..~1
            '  return pow( clamp( c, 0.0, 1.0 ), 2.2 );', // sharpen into ridges
            '}',
          ].join('\n'),
        )
        .replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            // snap world XZ onto a coarse grid → blocky, pixelated water
            'float px = 0.5;',
            'vec2 pw = floor( vWaterWorld / px ) * px;',
            // distance beyond the ORGANIC coastline (same lumpy radial curve as the
            // CPU islandReach()): 0 at the shore, grows out to sea
            'float ang = atan( pw.y, pw.x );',
            `float reach = ${this.islandR.toFixed(1)} + 2.4 * sin( 3.0 * ang + 0.6 ) + 1.4 * sin( 5.0 * ang + 2.2 ) + 1.7 * sin( 2.0 * ang - 1.1 );`,
            'float dShore = max( 0.0, length( pw ) - reach );',
            // pixel depth: hard bands from light shallows to deep blue
            'float depthT = floor( clamp( dShore / 20.0, 0.0, 1.0 ) * 4.0 ) / 4.0;',
            'diffuseColor.rgb = mix( vec3( 0.10, 0.30, 0.48 ), vec3( 0.03, 0.15, 0.34 ), depthT );',
            // wavy animated offset so the foam edges ripple (in grid space)
            'float wob = sin( ( pw.x + pw.y ) * 1.4 + uTime * 2.0 ) * 0.28 + sin( ( pw.x - pw.y ) * 1.1 - uTime * 1.5 ) * 0.22;',
            // white foam band hugging the shore + a thin outer ripple ring
            'float shoreFoam = 1.0 - step( 1.0 + wob, dShore );',
            'float ring = step( 1.5 + wob, dShore ) - step( 1.95 + wob, dShore );',
            'float foam = max( shoreFoam, ring * 0.7 );',
            'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.99, 1.0 ), foam );',
          ].join('\n'),
        );
    };
    mat.customProgramCacheKey = (): string => 'water-pixel-v10';

    const water = new THREE.Mesh(geo, mat);
    water.position.y = this.waterY;
    water.receiveShadow = false; // unlit toon water — no cast shadow
    this.scene.add(water);
    this.water = water;
  }

  // pool of little cubes that burst up when the bobber hits the water
  private buildSplash(): void {
    for (let i = 0; i < 12; i++) {
      const c = this.box(0.15, 0.15, 0.15, 0xcdeefb);
      c.castShadow = false;
      c.visible = false;
      this.scene.add(c);
      this.splash.push({ mesh: c, v: new THREE.Vector3(), life: 0 });
    }
  }

  private triggerSplash(x: number, y: number, z: number): void {
    for (const p of this.splash) {
      p.life = this.splashLife * (0.7 + Math.random() * 0.5);
      p.mesh.visible = true;
      p.mesh.position.set(x, y + 0.05, z);
      p.mesh.scale.setScalar(1);
      const a = Math.random() * Math.PI * 2;
      const out = 0.6 + Math.random() * 0.9;
      p.v.set(Math.cos(a) * out, 1.7 + Math.random() * 1.3, Math.sin(a) * out);
    }
  }

  /** Punches a soft circular dither hole in an obstacle where it covers the player. */
  private addCutout(
    material: THREE.Material | THREE.Material[],
    strength: { value: number },
  ): void {
    const mats = Array.isArray(material) ? material : [material];
    for (const mat of mats) {
      mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
        shader.uniforms['uHoleCenter'] = this.holeU.center;
        shader.uniforms['uHoleViewZ'] = this.holeU.viewZ;
        shader.uniforms['uHoleRadius'] = this.holeU.radius;
        shader.uniforms['uHoleAspect'] = this.holeU.aspect;
        shader.uniforms['uHoleStrength'] = strength;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nvarying vec2 vHoleNdc;\nvarying float vHoleViewZ;',
          )
          .replace(
            '#include <project_vertex>',
            '#include <project_vertex>\nvHoleNdc = gl_Position.xy / gl_Position.w;\nvHoleViewZ = -mvPosition.z;',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            [
              '#include <common>',
              'varying vec2 vHoleNdc;',
              'varying float vHoleViewZ;',
              'uniform vec2 uHoleCenter;',
              'uniform float uHoleViewZ;',
              'uniform float uHoleRadius;',
              'uniform float uHoleAspect;',
              'uniform float uHoleStrength;',
              // true ORDERED (Bayer) dither — a hash gives clumpy colour noise on big
              // surfaces like the house roof/walls; ordered gives a clean stipple. Use
              // 8x8 (64 levels) so the open/close ramp is smooth, not stepped
              'float _bayer2( vec2 a ) { a = floor( a ); return fract( a.x * 0.5 + a.y * a.y * 0.75 ); }',
              'float _bayer4( vec2 a ) { return _bayer2( 0.5 * a ) * 0.25 + _bayer2( a ); }',
              'float _bayer8( vec2 a ) { return _bayer4( 0.5 * a ) * 0.25 + _bayer2( a ); }',
            ].join('\n'),
          )
          .replace(
            '#include <clipping_planes_fragment>',
            [
              '#include <clipping_planes_fragment>',
              // carve a hole only while the player is hidden, and only in the parts of
              // obstacles standing IN FRONT of them
              'if ( uHoleStrength > 0.001 && vHoleViewZ < uHoleViewZ - 0.25 ) {',
              '  vec2 hd = ( vHoleNdc - uHoleCenter ) * vec2( uHoleAspect, 1.0 );',
              '  float hole = ( 1.0 - smoothstep( 0.72, 1.0, length( hd ) / max( uHoleRadius, 0.001 ) ) ) * uHoleStrength;',
              '  float dith = _bayer8( gl_FragCoord.xy );',
              '  if ( hole > dith ) discard;', // ordered dither → clean soft-edged circle
              '}',
            ].join('\n'),
          );
      };
      mat.customProgramCacheKey = (): string => 'occluder-cutout-v4';
      mat.needsUpdate = true;
    }
  }

  private updateSplash(dt: number): void {
    for (const p of this.splash) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.v.y -= 7 * dt; // gravity
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.scale.setScalar(Math.max(0.05, p.life / this.splashLife));
      p.mesh.rotation.x += dt * 5;
      p.mesh.rotation.y += dt * 4;
    }
  }

  private buildIsland(): void {
    const greenA = new THREE.Color(0x6ab150);
    const greenB = new THREE.Color(0x5aa044);

    // checkerboard grass top — only cubes inside the organic coastline, so the
    // outline is lumpy while every tile stays a cube. One InstancedMesh.
    const reach = Math.ceil(this.islandR + 6); // worst-case coastline bulge
    const cells: [number, number][] = [];
    for (let ix = -reach; ix <= reach; ix++) {
      for (let iz = -reach; iz <= reach; iz++) {
        if (this.beyondShore(ix, iz) <= 0) cells.push([ix, iz]);
      }
    }
    const grass = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
      cells.length,
    );
    const m = new THREE.Matrix4();
    cells.forEach(([x, z], idx) => {
      m.makeTranslation(x, -0.5, z);
      grass.setMatrixAt(idx, m);
      grass.setColorAt(idx, (x + z) & 1 ? greenA : greenB);
    });
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    grass.castShadow = false;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // tapered dirt + rock underbelly that follows the same outline, shrunk inward
    // at each lower layer → a cubic "floating island" underside (no square corners)
    this.buildIslandLayer(1.0, -2.0, 2.0, 0x7a4a28); // dirt
    this.buildIslandLayer(0.84, -4.0, 2.6, 0x6b7280); // upper rock
    this.buildIslandLayer(0.6, -6.4, 3.2, 0x586573); // lower rock

    this.buildMountains();
  }

  /** One instanced cube layer shaped like the island, scaled inward by `shrink`. */
  private buildIslandLayer(shrink: number, y: number, h: number, color: number): void {
    const reach = Math.ceil(this.islandR + 6);
    const cells: [number, number][] = [];
    for (let ix = -reach; ix <= reach; ix++) {
      for (let iz = -reach; iz <= reach; iz++) {
        // inset = shrink the coastline toward the centre for the taper
        if (Math.hypot(ix, iz) <= this.islandReach(ix, iz) * shrink) cells.push([ix, iz]);
      }
    }
    if (!cells.length) return;
    const layer = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, h, 1),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 }),
      cells.length,
    );
    const m = new THREE.Matrix4();
    cells.forEach(([x, z], idx) => {
      m.makeTranslation(x, y, z);
      layer.setMatrixAt(idx, m);
    });
    layer.instanceMatrix.needsUpdate = true;
    layer.castShadow = false;
    layer.receiveShadow = false; // underground — shadows here are never seen
    this.scene.add(layer);
  }

  /**
   * Voxel mountains: a per-column heightfield (smooth radial dome + deterministic
   * noise, quantised to 1-unit steps) gives an organic blocky silhouette. Columns
   * are coloured by height into concentric grass → rock → snow-cap bands. Each peak
   * is merged into ONE vertex-coloured mesh that is ALSO a see-through occluder, so
   * the dither circle opens through a mountain when it hides the player. A circular
   * collision per peak makes the player walk around it.
   */
  private buildMountains(): void {
    const grass = new THREE.Color(0x5aa044);
    const rock = new THREE.Color(0x7c828c);
    const rockDk = new THREE.Color(0x5f6670);
    const snow = new THREE.Color(0xeef3f7);
    // [centreX, centreZ, radius, peakHeight] — kept well inside the coastline
    const peaks: [number, number, number, number][] = [
      [-9, -8, 6, 7],
      [8, -8, 6.5, 10],
      [-12, 8, 5, 6],
      [11, 9, 6, 8],
      [2, -12, 4, 5],
      [-11, -2, 3.5, 5],
    ];
    const c = new THREE.Color();
    for (const [mx, mz, R, peakH] of peaks) {
      const cols: THREE.Mesh[] = [];
      const Ri = Math.ceil(R);
      for (let ix = -Ri; ix <= Ri; ix++) {
        for (let iz = -Ri; iz <= Ri; iz++) {
          if (this.beyondShore(mx + ix, mz + iz) > 0) continue; // clip at the shore
          const d = Math.sqrt(ix * ix + iz * iz) / R;
          if (d > 1) continue;
          const dome = Math.cos(d * Math.PI) * 0.5 + 0.5; // 1 at the centre → 0 at the rim
          const noise = this.det((mx + ix) * 0.7 + (mz + iz) * 1.9);
          let h = peakH * Math.pow(dome, 1.35) * (0.78 + 0.5 * noise);
          h = Math.round(h); // 1-unit blocky terraces
          if (h < 1) continue;
          const t = h / peakH;
          if (t < 0.28) c.copy(grass).lerp(rock, t / 0.28);
          else if (t < 0.72) c.copy(rock).lerp(rockDk, ((t - 0.28) / 0.44) * 0.6);
          else c.copy(rock).lerp(snow, (t - 0.72) / 0.28);
          const col = this.box(1, h, 1, c.getHex());
          col.position.set(mx + ix, h / 2, mz + iz);
          cols.push(col);
        }
      }
      this.obstacles.push({ x: mx, z: mz, r: R * 0.85 });
      if (!cols.length) continue;
      // one merged mesh per peak → its own cutout strength + broad-phase centre
      const peak = this.mergeColored(cols);
      for (const col of cols) (col.geometry as THREE.BufferGeometry).dispose();
      this.scene.add(peak);
      const strength = { value: 0 };
      this.occluders.push({ object: peak, strength, cx: mx, cz: mz });
      this.addCutout(peak.material, strength);
    }
  }

  /**
   * Sandy seabed: a belt of cubes hugging the organic coastline that steps DOWN
   * the farther it sits from shore, so the sand slopes into ever-deeper water and
   * fades to a darker, murkier tone with depth. One InstancedMesh (one draw call).
   */
  /** Top surface Y of the sand at a world cell, or null if (x,z) isn't on the shelf. */
  private seabedTopAt(x: number, z: number): number | null {
    const s = this.seabed;
    const beyond = this.beyondShore(Math.round(x), Math.round(z));
    if (beyond <= 0 || beyond > s.sandReach) return null; // on land or past the shelf
    const terrace = Math.floor(beyond / s.stepWidth);
    return s.baseTop - terrace * s.drop;
  }

  private buildSeabed(): void {
    const s = this.seabed;
    const sandLt = new THREE.Color(0xe6d49a); // bright, shallow sand
    const sandDk = new THREE.Color(0x6f6c48); // dark, deep, murky sand

    const cells: { x: number; z: number; beyond: number }[] = [];
    const reach = Math.ceil(this.islandR + 6 + s.sandReach);
    for (let cx = -reach; cx <= reach; cx++) {
      for (let cz = -reach; cz <= reach; cz++) {
        const beyond = this.beyondShore(cx, cz);
        if (beyond <= 0 || beyond > s.sandReach) continue;
        cells.push({ x: cx, z: cz, beyond });
      }
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const H = 2; // each cube is tall so the terraces overlap into a solid floor
    cells.forEach((c, i) => {
      const topY = this.seabedTopAt(c.x, c.z) ?? s.baseTop;
      m.makeScale(1, H, 1);
      m.setPosition(c.x, topY - H / 2, c.z);
      mesh.setMatrixAt(i, m);
      col.copy(sandLt).lerp(sandDk, Math.min(1, c.beyond / s.sandReach));
      if ((c.x + c.z) & 1) col.multiplyScalar(0.9); // faint checker so it still reads as cubes
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false; // submerged sand — shadows barely read through the water
    this.scene.add(mesh);
  }

  /** Deterministic [0,1) pseudo-noise — fixed per seed, so the scene never shuffles. */
  private det(n: number): number {
    const s = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
    return s - Math.floor(s);
  }

  /** A blocky tuft of seaweed: a stack of leaf cubes that sways from the base. */
  private makeSeaweed(seed: number): THREE.Group {
    const g = new THREE.Group();
    const greens = [0x2f8f4e, 0x3aa85c, 0x277a42];
    const blades = 2 + Math.floor(this.det(seed) * 3);
    for (let b = 0; b < blades; b++) {
      const blade = new THREE.Group();
      const segs = 3 + Math.floor(this.det(seed + b * 2.3) * 3);
      const col = greens[b % greens.length];
      for (let s = 0; s < segs; s++) {
        const leaf = this.box(0.18, 0.42, 0.1, col);
        leaf.position.y = 0.21 + s * 0.36; // stack upward
        leaf.castShadow = false;
        blade.add(leaf);
      }
      blade.position.set(
        (this.det(seed + b + 0.7) - 0.5) * 0.5,
        0,
        (this.det(seed + b + 1.9) - 0.5) * 0.5,
      );
      blade.rotation.y = this.det(seed + b + 3.3) * Math.PI;
      g.add(blade);
    }
    return g;
  }

  /** A small cubic fish: fat body + a wagging tail fin. */
  private makeFish(colorIdx: number): THREE.Group {
    const palette = [0xff8c42, 0xffd23f, 0xef476f, 0x4cc9f0, 0xb5179e, 0xe0e0e0];
    const col = palette[colorIdx % palette.length];
    const g = new THREE.Group();
    const body = this.box(0.5, 0.32, 0.24, col);
    body.castShadow = false;
    const tail = this.box(0.16, 0.26, 0.06, col);
    tail.position.set(-0.33, 0, 0); // behind the body (fish swims toward +x)
    tail.castShadow = false;
    const topFin = this.box(0.18, 0.14, 0.06, col);
    topFin.position.set(0.02, 0.22, 0);
    topFin.castShadow = false;
    // a tiny dark eye
    const eye = this.box(0.06, 0.06, 0.06, 0x10131a);
    eye.position.set(0.2, 0.05, 0.13);
    g.add(body, tail, topFin, eye);
    return g;
  }

  /** A big clam: two angled half-shells with a ribbed pink interior. */
  private makeShell(scale: number, variant: number): THREE.Group {
    const g = new THREE.Group();
    const shellCol = variant % 2 === 0 ? 0xf3d9c8 : 0xe9c6d6;
    const lower = this.box(0.9, 0.34, 0.7, shellCol);
    lower.position.y = 0.17;
    lower.castShadow = false;
    const upper = this.box(0.9, 0.34, 0.7, shellCol);
    upper.position.set(0, 0.46, -0.16);
    upper.rotation.x = -0.55; // gape the clam open
    upper.castShadow = false;
    // ribs on top so it reads as a shell, not a box
    for (let i = 0; i < 3; i++) {
      const rib = this.box(0.16, 0.06, 0.72, 0xcf9fb4);
      rib.position.set(-0.28 + i * 0.28, 0.35, 0);
      rib.castShadow = false;
      g.add(rib);
    }
    g.add(lower, upper);
    g.scale.setScalar(scale);
    return g;
  }

  /**
   * Place swaying seaweed, swimming fish and big clams on the sand belt. Items are
   * laid out at FIXED angles around the island, each pushed just past the (organic)
   * shore by a deterministic offset, so they always land on the sand and follow the
   * real coastline. Same layout on every load.
   */
  private buildSeaLife(): void {
    const s = this.seabed;
    // a cell on the sand belt at angle `a`, `off` units beyond the shore
    const at = (a: number, off: number): { x: number; z: number; top: number } | null => {
      const dirX = Math.cos(a);
      const dirZ = Math.sin(a);
      // step out from the shore until we land on a sand cell (the shore is lumpy)
      const r0 = this.islandReach(dirX, dirZ);
      const x = Math.round(dirX * (r0 + off));
      const z = Math.round(dirZ * (r0 + off));
      const top = this.seabedTopAt(x, z);
      return top == null ? null : { x, z, top };
    };

    // seaweed — rooted on the sand, swaying in update()
    const WEED = 14;
    for (let i = 0; i < WEED; i++) {
      const c = at((i / WEED) * Math.PI * 2 + 0.15, 1.2 + this.det(i + 0.5) * (s.sandReach - 3));
      if (!c) continue;
      const w = this.makeSeaweed(i + 1);
      w.position.set(c.x, c.top, c.z);
      w.scale.setScalar(0.42 + this.det(i + 0.3) * 0.3);
      this.scene.add(w);
      this.seaweed.push({ mesh: w, phase: i * 0.7, bend: 0.12 + this.det(i + 0.8) * 0.12 });
    }

    // big clams resting on the sand
    const SHELLS = 7;
    for (let i = 0; i < SHELLS; i++) {
      const c = at((i / SHELLS) * Math.PI * 2 + 1.0, 1.5 + this.det(i + 4.0) * (s.sandReach - 4));
      if (!c) continue;
      const shell = this.makeShell(0.42 + this.det(i + 5.1) * 0.28, i);
      shell.position.set(c.x, c.top, c.z);
      shell.rotation.y = this.det(i + 2.2) * Math.PI * 2;
      this.scene.add(shell);
    }

    // fish circling lazily a little above the seabed
    const FISH = 12;
    for (let i = 0; i < FISH; i++) {
      const c = at((i / FISH) * Math.PI * 2 + 0.5, 2.5 + this.det(i + 8.0) * (s.sandReach - 4));
      if (!c) continue;
      const f = this.makeFish(i);
      const y = Math.min(this.waterY - 0.35, c.top + 0.7 + this.det(i + 9.4) * 0.5); // submerged
      f.position.set(c.x, y, c.z);
      this.scene.add(f);
      this.fish.push({
        mesh: f,
        cx: c.x,
        cz: c.z,
        r: 0.8 + this.det(i + 6.6) * 1.4,
        y,
        speed: (i % 2 === 0 ? 1 : -1) * (0.4 + this.det(i + 7.7) * 0.45),
        phase: i * 0.9,
      });
    }
  }

  /** Sway the seaweed and swim the fish in gentle loops just above the sand. */
  private animateSeaLife(t: number): void {
    for (const w of this.seaweed) {
      const sway = Math.sin(t * 1.5 + w.phase) * w.bend;
      w.mesh.rotation.z = sway;
      w.mesh.rotation.x = Math.cos(t * 1.2 + w.phase) * w.bend * 0.6;
    }
    for (const f of this.fish) {
      const a = f.phase + t * f.speed;
      const x = f.cx + Math.cos(a) * f.r;
      const z = f.cz + Math.sin(a) * f.r;
      f.mesh.position.set(x, f.y + Math.sin(t * 2 + f.phase) * 0.08, z);
      // face the direction of travel (tangent to the circle)
      f.mesh.rotation.y = -a - (f.speed >= 0 ? Math.PI / 2 : -Math.PI / 2);
      // wag the whole body slightly as it swims
      f.mesh.rotation.z = Math.sin(t * 6 + f.phase) * 0.12;
    }
  }

  private buildScenery(): void {
    // wooden dock — first plank sits flush ON the grass-edge cube, then reaches out
    const base = this.dockBase;
    const dock = new THREE.Group();
    for (let i = 0; i < this.dockLen; i++) {
      const plank = this.box(2, 0.18, 1, i % 2 ? 0xa9743f : 0x9c6a38);
      plank.position.set(0, 0, base + i);
      dock.add(plank);
    }
    for (const [px, pz] of [
      [-0.8, base + 2],
      [0.8, base + 2],
      [-0.8, base + this.dockLen - 1],
      [0.8, base + this.dockLen - 1],
    ] as const) {
      const post = this.box(0.18, 1.6, 0.18, 0x6f4a26);
      post.position.set(px, -0.7, pz);
      dock.add(post);
    }
    this.scene.add(dock);

    // scatter trees + rocks around the bigger island (each registers its own collision)
    for (const [tx, tz] of [
      [-3, -3], [-5.2, -4.8], [4.8, -5], [-5.5, 1.5], [5.2, 3.8], [-2.5, -5.2],
      [-9, -2], [8, 2], [-7, 6], [7, -8], [10, 5], [-12, 3], [4, 9], [-4, 11],
      [12, -3], [-8, -13], [14, 13], [-15, 13], [15, -10], [-2, 14],
    ] as const) {
      this.addTree(tx, tz);
    }
    for (const [rx, rz, rs] of [
      [3, -2.6, 0.95], [3.6, -1.8, 0.62], [-4.5, 4.2, 0.85], [5.5, -3.5, 0.7],
      [-5.8, -2, 1.0], [1.5, -5.5, 0.6], [-1.8, 5, 0.7], [5.8, 0.5, 0.8],
      [-10, 6, 1.1], [9, -4, 0.9], [13, 4, 1.2], [-14, -6, 1.0], [6, 13, 0.8],
      [-7, -8, 0.7], [16, 1, 0.9], [0, 16, 1.0],
    ] as const) {
      this.addRock(rx, rz, rs);
    }
  }

  /** True if (x,z) within `r` would overlap something already placed (e.g. a mountain). */
  private blocked(x: number, z: number, r: number): boolean {
    for (const o of this.obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < (o.r + r) * (o.r + r)) return true;
    }
    return false;
  }

  private addTree(x: number, z: number): void {
    if (this.beyondShore(x, z) > -0.8) return; // must be safely inland, not over the water
    if (this.blocked(x, z, 1.5)) return; // don't sprout inside a mountain or another prop
    const trunk = this.box(0.5, 1.6, 0.5, 0x6f4a26);
    trunk.position.set(x, 0.8, z);
    const leaves1 = this.box(1.8, 1.0, 1.8, 0x4f8f3a);
    leaves1.position.set(x, 2.0, z);
    const leaves2 = this.box(1.1, 0.9, 1.1, 0x5aa044);
    leaves2.position.set(x, 2.8, z);
    // 3 cubes → 1 vertex-coloured mesh (a single draw call per tree)
    const tree = this.mergeColored([trunk, leaves1, leaves2]);
    for (const s of [trunk, leaves1, leaves2]) (s.geometry as THREE.BufferGeometry).dispose();
    this.scene.add(tree);
    const strength = { value: 0 };
    this.occluders.push({ object: tree, strength, cx: x, cz: z });
    this.addCutout(tree.material, strength);
    this.obstacles.push({ x, z, r: 1.5 });
  }

  private addRock(x: number, z: number, s: number): void {
    if (this.beyondShore(x, z) > -0.6) return; // keep rocks on land, not in the surf
    if (this.blocked(x, z, s * 0.55 + 0.32)) return; // skip if it would clip a mountain/prop
    const rock = this.box(s, s * 0.78, s * 0.9, s > 0.78 ? 0x8a8f98 : 0x767c85);
    rock.position.set(x, s * 0.39, z);
    this.scene.add(rock);
    const strength = { value: 0 };
    this.occluders.push({ object: rock, strength, cx: x, cz: z });
    this.addCutout(rock.material, strength);
    this.obstacles.push({ x, z, r: s * 0.55 + 0.32 });
  }

  /** Scatter decorative land plants — leafy bushes, flower clumps, grass tufts — across
   *  the island grass. Purely visual (no collision); each clump is merged to one mesh. */
  private buildVegetation(): void {
    for (const [x, z, s] of [
      [-3.5, 3.2, 1.0], [3.2, 2.4, 0.9], [-6, -1, 1.1], [6.5, -1.5, 1.0],
      [-2, 6.5, 0.85], [4.5, 6, 1.0], [-9, 3, 1.1], [9, 3.5, 0.9],
      [2.6, -3.2, 0.8], [-4.5, -6, 1.0], [11, -2, 1.0], [-11, -5, 0.95],
    ] as const) {
      this.addBush(x, z, s);
    }
    [
      [-2.2, 2.6], [2.2, 3.8], [-4, 1.2], [4.4, 1.0], [-1.6, 5.6], [3.4, 5.2],
      [-7, 1], [7, 1.6], [1.2, -2.6], [-3, -4.6], [5.6, 4.6], [-6.6, 5],
    ].forEach(([x, z], i) => this.addFlowerClump(x, z, i + 1));
    [
      [-1.2, 3], [1.6, 2.0], [-3.2, 4.6], [3.9, 3.0], [-5, 2.6], [5.3, 2.2],
      [0.8, 5.9], [-2.8, 6.3], [6, 4.2], [-8, 1.6], [8.6, 1], [-1, -3.4],
      [2.9, -4], [-5.6, -3], [10, 2.2], [-10, 1.4],
    ].forEach(([x, z], i) => this.addGrassTuft(x, z, i + 1));
  }

  /** A rounded leafy bush: a clump of green cubes merged into one vertex-coloured mesh. */
  private addBush(x: number, z: number, s: number): void {
    if (this.beyondShore(x, z) > -0.8) return; // keep on land
    if (this.blocked(x, z, s * 0.6)) return; // not inside a tree/rock/mountain
    const greens = [0x4f8f3a, 0x5aa044, 0x437d31];
    const blobs: [number, number, number, number][] = [
      [0, 0.3, 0, 0.66], [-0.26, 0.46, 0.08, 0.48], [0.28, 0.44, -0.06, 0.5],
      [0.04, 0.58, 0.16, 0.44], [-0.1, 0.64, -0.16, 0.38],
    ];
    const cubes = blobs.map((b, i) => {
      const c = this.box(b[3], b[3], b[3], greens[i % greens.length]);
      c.position.set(b[0], b[1], b[2]);
      return c;
    });
    const bush = this.mergeColored(cubes);
    for (const c of cubes) (c.geometry as THREE.BufferGeometry).dispose();
    bush.position.set(x, 0, z);
    bush.scale.setScalar(s);
    this.scene.add(bush);
  }

  /** A little clump of stemmed flowers in mixed colours (one merged mesh, no shadow). */
  private addFlowerClump(x: number, z: number, seed: number): void {
    if (this.beyondShore(x, z) > -0.6) return;
    if (this.blocked(x, z, 0.5)) return;
    const cols = [0xe8556d, 0xf2c14e, 0xe87fb0, 0xf4f4f4, 0x9b6fd0, 0xff8c42];
    const cubes: THREE.Mesh[] = [];
    const n = 3 + Math.floor(this.det(seed + 0.3) * 3);
    for (let f = 0; f < n; f++) {
      const fx = (this.det(seed + f) - 0.5) * 0.7;
      const fz = (this.det(seed + f + 9) - 0.5) * 0.7;
      const h = 0.2 + this.det(seed + f + 3) * 0.18;
      const stem = this.box(0.05, h, 0.05, 0x4f8f3a);
      stem.position.set(fx, h / 2, fz);
      const bloom = this.box(0.13, 0.12, 0.13, cols[(seed + f) % cols.length]);
      bloom.position.set(fx, h + 0.04, fz);
      cubes.push(stem, bloom);
    }
    const clump = this.mergeColored(cubes);
    for (const c of cubes) (c.geometry as THREE.BufferGeometry).dispose();
    clump.castShadow = false; // tiny — skip the shadow cost/noise
    clump.position.set(x, 0, z);
    this.scene.add(clump);
  }

  /** A tuft of leaning grass blades (one merged mesh, no shadow). */
  private addGrassTuft(x: number, z: number, seed: number): void {
    if (this.beyondShore(x, z) > -0.5) return;
    if (this.blocked(x, z, 0.4)) return;
    const greens = [0x6ab150, 0x5aa044, 0x7cc25a];
    const cubes: THREE.Mesh[] = [];
    const n = 3 + Math.floor(this.det(seed + 1.1) * 3);
    for (let b = 0; b < n; b++) {
      const bx = (this.det(seed + b) - 0.5) * 0.4;
      const bz = (this.det(seed + b + 5) - 0.5) * 0.4;
      const h = 0.28 + this.det(seed + b + 2) * 0.22;
      const blade = this.box(0.07, h, 0.07, greens[b % greens.length]);
      blade.position.set(bx, h / 2, bz);
      blade.rotation.x = (this.det(seed + b + 7) - 0.5) * 0.3; // gentle lean
      cubes.push(blade);
    }
    const tuft = this.mergeColored(cubes);
    for (const c of cubes) (c.geometry as THREE.BufferGeometry).dispose();
    tuft.castShadow = false;
    tuft.position.set(x, 0, z);
    this.scene.add(tuft);
  }

  /**
   * A ginger-tabby cat that wanders the island. Its static core (torso, head, face, ears,
   * stripes) is merged into ONE vertex-coloured mesh; the four legs and the tail are kept
   * as separate groups so animateCat() can drive a walk cycle and a swaying tail. The cat
   * strolls between random grass points chosen by pickCatTarget().
   */
  private buildCat(): void {
    const fur = 0xe0903f, furDk = 0xb5651d, belly = 0xf6e3cb, pink = 0xe88a96,
      eye = 0x9ed04a, dark = 0x221a13;
    const cat = new THREE.Group();

    // static core (torso + head + face), merged to one mesh
    const core: THREE.Mesh[] = [];
    const B = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, rotZ = 0): void => {
      const m = this.box(w, h, d, c);
      m.position.set(x, y, z);
      if (rotZ) m.rotation.z = rotZ;
      core.push(m);
    };
    B(0.3, 0.3, 0.62, fur, 0, 0.54, 0); // torso
    B(0.24, 0.12, 0.52, belly, 0, 0.44, 0); // cream belly underside
    B(0.22, 0.22, 0.16, fur, 0, 0.6, 0.32); // neck
    B(0.34, 0.32, 0.32, fur, 0, 0.7, 0.46); // head
    B(0.2, 0.14, 0.12, belly, 0, 0.64, 0.62); // muzzle
    B(0.07, 0.05, 0.05, pink, 0, 0.67, 0.68); // nose
    B(0.08, 0.09, 0.04, eye, -0.09, 0.76, 0.61);
    B(0.08, 0.09, 0.04, eye, 0.09, 0.76, 0.61);
    B(0.03, 0.06, 0.05, dark, -0.09, 0.76, 0.625);
    B(0.03, 0.06, 0.05, dark, 0.09, 0.76, 0.625);
    B(0.15, 0.15, 0.07, fur, -0.11, 0.9, 0.42, Math.PI / 4); // pointed ears (diamonds)
    B(0.15, 0.15, 0.07, fur, 0.11, 0.9, 0.42, Math.PI / 4);
    B(0.07, 0.07, 0.05, pink, -0.11, 0.88, 0.45, Math.PI / 4); // pink inner ear
    B(0.07, 0.07, 0.05, pink, 0.11, 0.88, 0.45, Math.PI / 4);
    B(0.32, 0.06, 0.1, furDk, 0, 0.69, -0.12); // back stripes
    B(0.3, 0.06, 0.1, furDk, 0, 0.69, 0.12);
    B(0.24, 0.05, 0.08, furDk, 0, 0.86, 0.46); // head stripe
    const coreMesh = this.mergeColored(core);
    for (const m of core) (m.geometry as THREE.BufferGeometry).dispose();
    cat.add(coreMesh);

    // four legs as separate pivots so they swing in the walk cycle
    const makeLeg = (x: number, z: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.4, z);
      const leg = this.box(0.12, 0.4, 0.13, fur);
      leg.position.set(0, -0.2, 0);
      const paw = this.box(0.13, 0.1, 0.17, belly);
      paw.position.set(0, -0.35, 0.03);
      leg.castShadow = true;
      paw.castShadow = true;
      pivot.add(leg, paw);
      cat.add(pivot);
      return pivot;
    };
    // diagonal gait: front-left & back-right swing together, the other pair opposite
    this.catLegs = [
      { g: makeLeg(-0.11, 0.22), o: 0 },
      { g: makeLeg(0.11, 0.22), o: Math.PI },
      { g: makeLeg(-0.11, -0.22), o: Math.PI },
      { g: makeLeg(0.11, -0.22), o: 0 },
    ];

    // tail: a raised, curling chain kept separate so it can sway
    const tail = new THREE.Group();
    tail.position.set(0, 0.58, -0.32);
    const tcol = [fur, fur, fur, furDk];
    const tpos: [number, number, number][] = [[0, 0.02, -0.08], [0, 0.1, -0.2], [0, 0.22, -0.28], [0, 0.34, -0.3]];
    tpos.forEach((p, i) => {
      const seg = this.box(i < 3 ? 0.12 : 0.1, 0.13, 0.14, tcol[i]);
      seg.position.set(p[0], p[1], p[2]);
      seg.castShadow = true;
      tail.add(seg);
    });
    cat.add(tail);
    this.catTail = tail;

    cat.position.set(2.0, 0, 4.8);
    this.catHeading = Math.PI / 4;
    cat.rotation.y = this.catHeading;
    this.catTargetX = 2.0;
    this.catTargetZ = 4.8;
    this.catPauseT = 1.5; // settle a moment before the first stroll
    this.scene.add(cat);
    this.cat = cat;
  }

  /** Pick a fresh wander target on the grass — on land, clear of the house and props. */
  private pickCatTarget(): void {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 7.5;
      const x = Math.cos(a) * r;
      const z = 1 + Math.sin(a) * r; // wander centred a little in front of the house
      if (this.beyondShore(x, z) > -1.5) continue; // keep well clear of the shore
      if (Math.abs(x) < 2.9 && Math.abs(z) < 2.9) continue; // not into the house
      if (this.blocked(x, z, 0.45)) continue; // not into a tree / rock / mountain
      this.catTargetX = x;
      this.catTargetZ = z;
      return;
    }
    this.catPauseT = 1; // nowhere good this time — wait and retry
  }

  /** Wander the cat between idle pauses: walk to the target, swing the legs, sway the tail. */
  private animateCat(dt: number, t: number): void {
    const cat = this.cat;
    if (!cat) return;
    let moving = false;
    if (this.catPauseT > 0) {
      this.catPauseT -= dt;
      if (this.catPauseT <= 0) this.pickCatTarget();
    } else {
      const dx = this.catTargetX - cat.position.x;
      const dz = this.catTargetZ - cat.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.12) {
        this.catPauseT = 1.5 + Math.random() * 3; // arrived → sit a while
      } else {
        moving = true;
        const desired = Math.atan2(dx, dz);
        this.catHeading += this.shortestAngle(this.catHeading, desired) * Math.min(1, dt * 6);
        cat.rotation.y = this.catHeading;
        const step = Math.min(dist, 1.4 * dt);
        let nx = cat.position.x + Math.sin(this.catHeading) * step;
        let nz = cat.position.z + Math.cos(this.catHeading) * step;
        // collide with props + the house so the cat never walks through objects — it
        // slides along them, exactly like the player does in resolveMove()
        for (const o of this.obstacles) {
          const ox = nx - o.x;
          const oz = nz - o.z;
          const d2 = ox * ox + oz * oz;
          if (d2 < o.r * o.r) {
            const d = Math.sqrt(d2) || 1e-4;
            nx = o.x + (ox / d) * o.r;
            nz = o.z + (oz / d) * o.r;
          }
        }
        if (Math.abs(nx) < this.houseHalf.x && Math.abs(nz) < this.houseHalf.z) {
          const penX = this.houseHalf.x - Math.abs(nx);
          const penZ = this.houseHalf.z - Math.abs(nz);
          if (penX <= penZ) nx = (nx < 0 ? -1 : 1) * this.houseHalf.x;
          else nz = (nz < 0 ? -1 : 1) * this.houseHalf.z;
        }
        const intoWater = this.beyondShore(nx, nz) > -0.3;
        const advanced = intoWater ? 0 : Math.hypot(nx - cat.position.x, nz - cat.position.z);
        if (!intoWater) {
          cat.position.x = nx;
          cat.position.z = nz;
        }
        // wedged against something (or the shore)? give up and stroll somewhere else
        if (advanced < step * 0.4) {
          this.catStuck += dt;
          if (this.catStuck > 0.4) {
            this.catStuck = 0;
            this.pickCatTarget();
          }
        } else {
          this.catStuck = 0;
        }
        this.catWalkPhase += dt * 10;
      }
    }
    // legs: swing while walking, ease back to standing when idle
    const k = Math.min(1, dt * 10);
    for (const leg of this.catLegs) {
      const tgt = moving ? Math.sin(this.catWalkPhase + leg.o) * 0.5 : 0;
      leg.g.rotation.x += (tgt - leg.g.rotation.x) * k;
    }
    // body bounce while walking; a gentle breathing scale while idle
    const bob = moving ? Math.abs(Math.sin(this.catWalkPhase)) * 0.03 : 0;
    cat.position.y += (bob - cat.position.y) * k;
    cat.scale.y = 1 + (moving ? 0 : Math.sin(t * 2.2) * 0.02);
    // tail always sways, livelier on the move
    if (this.catTail) {
      this.catTail.rotation.y = Math.sin(t * (moving ? 3 : 1.6)) * (moving ? 0.3 : 0.22);
      this.catTail.rotation.x = Math.sin(t * 1.1 + 0.5) * 0.08;
    }
  }

  /** A flat triangle mesh (used for the gable ends of the roof). */
  private triangle(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    color: number,
  ): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildHouse(): void {
    // palette
    const stone = 0x9aa0a6;
    const stoneDk = 0x848b92;
    const stoneLt = 0xacb2b8;
    const plaster = 0xeee4cf;
    const timber = 0x5b3d22;
    const timberDk = 0x4a3019;
    const roofCol = 0x7a4a2c;
    const roofDk = 0x5f3a22;
    const glass = 0xbfe6f5;
    const iron = 0x2c2018;
    const glow = 0xffd27a;

    const baseW = 4.8;
    const baseD = 4.0;
    const wallTop = 3.1;
    const h = new THREE.Group();

    // stone base with coursed-rubble bands
    const stoneBody = this.box(baseW, 0.9, baseD, stone);
    stoneBody.position.set(0, 0.45, 0);
    h.add(stoneBody);
    for (const band of [
      [0.22, stoneDk],
      [0.45, stoneLt],
      [0.68, stoneDk],
    ]) {
      const by = band[0];
      const col = band[1];
      const bF = this.box(baseW + 0.04, 0.16, 0.02, col);
      bF.position.set(0, by, baseD / 2 + 0.01);
      const bB = this.box(baseW + 0.04, 0.16, 0.02, col);
      bB.position.set(0, by, -baseD / 2 - 0.01);
      const bL = this.box(0.02, 0.16, baseD + 0.04, col);
      bL.position.set(-baseW / 2 - 0.01, by, 0);
      const bR = this.box(0.02, 0.16, baseD + 0.04, col);
      bR.position.set(baseW / 2 + 0.01, by, 0);
      h.add(bF, bB, bL, bR);
    }

    // plaster upper + sill band
    const upper = this.box(baseW - 0.1, 2.2, baseD - 0.1, plaster);
    upper.position.set(0, 2.0, 0);
    h.add(upper);
    const sill = this.box(baseW + 0.12, 0.16, baseD + 0.12, timber);
    sill.position.set(0, 0.9, 0);
    h.add(sill);

    // timber corner posts + studs
    for (const c of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const post = this.box(0.22, 3.12, 0.22, timber);
      post.position.set(c[0] * (baseW / 2 - 0.08), 1.56, c[1] * (baseD / 2 - 0.08));
      h.add(post);
    }
    for (const sx of [-0.78, 0.78]) {
      const sF = this.box(0.12, 1.9, 0.02, timber);
      sF.position.set(sx, 2.05, baseD / 2 - 0.03);
      const sB = this.box(0.12, 1.9, 0.02, timber);
      sB.position.set(sx, 2.05, -(baseD / 2 - 0.03));
      h.add(sF, sB);
    }

    // steep gable roof (ridge along X), pitch atan(1.9/2.0) ≈ 0.7598 rad
    const ang = 0.7598;
    const apexY = 5.0;
    const slabLen = 3.3793;
    const slabW = baseW + 0.7;
    const slabT = 0.28;
    const slopeA = this.box(slabW, slabT, slabLen, roofCol);
    slopeA.position.set(0, 3.8363, 1.225);
    slopeA.rotation.x = ang;
    const slopeB = this.box(slabW, slabT, slabLen, roofCol);
    slopeB.position.set(0, 3.8363, -1.225);
    slopeB.rotation.x = -ang;
    h.add(slopeA, slopeB);
    const ridge = this.box(slabW + 0.04, 0.22, 0.34, roofDk);
    ridge.position.set(0, apexY + 0.04, 0);
    h.add(ridge);

    // filled gable ends (±X) + half-timber king post & braces
    const gx = baseW / 2;
    h.add(this.triangle([gx, wallTop, -baseD / 2], [gx, wallTop, baseD / 2], [gx, apexY, 0], plaster));
    h.add(this.triangle([-gx, wallTop, -baseD / 2], [-gx, wallTop, baseD / 2], [-gx, apexY, 0], plaster));
    const gableDetail = (sx: number): void => {
      const x = sx * (gx + 0.03);
      const king = this.box(0.02, apexY - wallTop, 0.16, timberDk);
      king.position.set(x, (wallTop + apexY) / 2, 0);
      h.add(king);
      for (const sz of [-1, 1]) {
        const brace = this.box(0.02, 0.16, 1.7, timberDk);
        brace.position.set(x, 4.05, sz * 0.62);
        brace.rotation.x = sz * 0.6;
        h.add(brace);
      }
    };
    gableDetail(1);
    gableDetail(-1);

    // brick chimney
    const chimney = this.box(0.6, 2.2, 0.6, 0x9c4a36);
    chimney.position.set(1.35, 4.0, -0.95);
    const chimCap = this.box(0.74, 0.18, 0.74, stoneDk);
    chimCap.position.set(1.35, 5.12, -0.95);
    h.add(chimney, chimCap);

    // front door (+Z)
    const doorFace = baseD / 2 + 0.02;
    const doorFrame = this.box(1.12, 1.92, 0.12, timber);
    doorFrame.position.set(0, 0.96, doorFace);
    const door = this.box(0.86, 1.7, 0.14, 0x6f4a26);
    door.position.set(0, 0.86, doorFace + 0.02);
    const doorSplit = this.box(0.08, 1.6, 0.16, timberDk);
    doorSplit.position.set(0, 0.86, doorFace + 0.03);
    const knob = this.box(0.1, 0.1, 0.12, 0xffd45e);
    knob.position.set(0.28, 0.92, doorFace + 0.08);
    h.add(doorFrame, door, doorSplit, knob);

    // pitched door awning on brackets
    const awnZ = baseD / 2 + 0.45;
    const awnA = this.box(1.5, 0.12, 0.62, roofDk);
    awnA.position.set(0, 2.14, awnZ - 0.28);
    awnA.rotation.x = ang;
    const awnB = this.box(1.5, 0.12, 0.62, roofDk);
    awnB.position.set(0, 2.14, awnZ - 0.62);
    awnB.rotation.x = ang;
    h.add(awnA, awnB);
    for (const sx of [-0.6, 0.6]) {
      const bracket = this.box(0.1, 0.7, 0.1, timber);
      bracket.position.set(sx, 1.62, baseD / 2 + 0.18);
      bracket.rotation.x = -0.5;
      h.add(bracket);
    }

    // front windows with flower boxes
    const winFace = baseD / 2 + 0.02;
    const addWindow = (x: number): void => {
      const fr = this.box(0.92, 0.92, 0.12, timber);
      fr.position.set(x, 1.78, winFace);
      const gl = this.box(0.64, 0.64, 0.14, glass, { rough: 0.15, metal: 0.1 });
      gl.position.set(x, 1.78, winFace);
      const mv = this.box(0.08, 0.72, 0.16, timber);
      mv.position.set(x, 1.78, winFace);
      const mh = this.box(0.72, 0.08, 0.16, timber);
      mh.position.set(x, 1.78, winFace);
      h.add(fr, gl, mv, mh);
      const fbY = 1.18;
      const fb = this.box(0.96, 0.22, 0.26, timberDk);
      fb.position.set(x, fbY, winFace + 0.12);
      const soil = this.box(0.86, 0.08, 0.18, 0x4a3320);
      soil.position.set(x, fbY + 0.13, winFace + 0.12);
      h.add(fb, soil);
      const cols = [0xe8556d, 0xf2c14e, 0xe87fb0, 0xf2c14e, 0xe8556d];
      cols.forEach((col: number, i: number) => {
        const fx = x - 0.34 + i * 0.17;
        const stem = this.box(0.04, 0.16, 0.04, 0x4f8f3a);
        stem.position.set(fx, fbY + 0.25, winFace + 0.12);
        const bloom = this.box(0.12, 0.12, 0.12, col);
        bloom.position.set(fx, fbY + 0.36, winFace + 0.12);
        h.add(stem, bloom);
      });
    };
    addWindow(-1.4);
    addWindow(1.4);

    // side windows
    const addSideWindow = (sx: number, z: number): void => {
      const fr = this.box(0.12, 0.92, 0.92, timber);
      fr.position.set(sx * (baseW / 2 + 0.02), 1.78, z);
      const gl = this.box(0.14, 0.64, 0.64, glass, { rough: 0.15, metal: 0.1 });
      gl.position.set(sx * (baseW / 2 + 0.02), 1.78, z);
      const mv = this.box(0.16, 0.72, 0.08, timber);
      mv.position.set(sx * (baseW / 2 + 0.02), 1.78, z);
      const mh = this.box(0.16, 0.08, 0.72, timber);
      mh.position.set(sx * (baseW / 2 + 0.02), 1.78, z);
      h.add(fr, gl, mv, mh);
    };
    addSideWindow(-1, 0);
    addSideWindow(1, 0.9);
    addSideWindow(1, -0.9);

    // doorstep
    const step = this.box(1.3, 0.18, 0.5, stoneLt);
    step.position.set(0, 0.09, baseD / 2 + 0.22);
    h.add(step);

    // hanging lantern beside the door
    const lampX = 0.95;
    const lampZ = baseD / 2 + 0.02;
    const armV = this.box(0.06, 0.5, 0.06, iron);
    armV.position.set(lampX, 2.35, lampZ + 0.04);
    const armH = this.box(0.06, 0.06, 0.34, iron);
    armH.position.set(lampX, 2.58, lampZ + 0.18);
    const chain = this.box(0.03, 0.18, 0.03, iron);
    chain.position.set(lampX, 2.46, lampZ + 0.33);
    h.add(armV, armH, chain);
    const lz = lampZ + 0.33;
    const lanternCap = this.box(0.26, 0.07, 0.26, iron);
    lanternCap.position.set(lampX, 2.35, lz);
    const lanternBase = this.box(0.22, 0.06, 0.22, iron);
    lanternBase.position.set(lampX, 2.0, lz);
    h.add(lanternCap, lanternBase);
    // glowing glass body — emissive so it reads as lit (it used to be hidden inside a dark box → looked black)
    const lanternGlow = this.box(0.2, 0.27, 0.2, glow);
    lanternGlow.position.set(lampX, 2.17, lz);
    const glowMat = lanternGlow.material as THREE.MeshStandardMaterial;
    glowMat.emissive = new THREE.Color(0xffc46a);
    glowMat.emissiveIntensity = 2.2;
    h.add(lanternGlow);
    // thin iron cage bars at the glass corners
    for (const [cx, cz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const bar = this.box(0.03, 0.31, 0.03, iron);
      bar.position.set(lampX + cx * 0.1, 2.17, lz + cz * 0.1);
      h.add(bar);
    }
    // the lantern actually casts a warm pool of light by the door
    const lampLight = new THREE.PointLight(0xffb24d, 24, 6, 2);
    lampLight.position.set(lampX, 2.16, lampZ + 0.42);
    h.add(lampLight);

    // a fishing rod leaning on the -X side wall
    const rodLen = 3.2;
    const rodLean = 0.3;
    const rodBaseX = -(baseW / 2 + 0.22);
    const rodBaseZ = -0.9;
    const rod = this.box(0.06, rodLen, 0.06, 0x5a3a1e);
    rod.position.set(rodBaseX - (Math.sin(rodLean) * rodLen) / 2, (Math.cos(rodLean) * rodLen) / 2, rodBaseZ);
    rod.rotation.z = rodLean;
    const reel = this.box(0.14, 0.14, 0.12, iron);
    reel.position.set(rodBaseX - Math.sin(rodLean) * 0.7, Math.cos(rodLean) * 0.7, rodBaseZ + 0.09);
    h.add(rod, reel);

    // collapse the ~100 house cubes into a handful of merged meshes (keeps the
    // lantern's PointLight, which isn't a mesh), then wire up the see-through cutout
    const meshes: THREE.Mesh[] = [];
    h.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const merged = this.mergeByMaterial(meshes);
    for (const mesh of meshes) {
      mesh.removeFromParent();
      (mesh.geometry as THREE.BufferGeometry).dispose();
    }
    for (const mm of merged) h.add(mm);

    this.scene.add(h); // centred at island origin
    const strength = { value: 0 };
    this.occluders.push({ object: h, strength, cx: 0, cz: 0 });
    for (const mm of merged) this.addCutout(mm.material, strength);
  }

  private buildCharacter(): void {
    const skin = 0xf2c79b;
    const shirt = 0x3f7ed1; // blue t-shirt
    const pants = 0x33485a;
    const straw = 0xe3c878;
    const ch = this.character;
    const rig = new THREE.Group(); // all visual parts live here so they can somersault
    this.rig = rig;

    // legs swing from the hip (pivot at y = 0.7), arms from the shoulder (y = 1.42)
    this.legL = this.limb(-0.16, 0.7, 0.26, 0.7, 0.28, pants);
    this.legR = this.limb(0.16, 0.7, 0.26, 0.7, 0.28, pants);
    this.armL = this.limb(-0.45, 1.42, 0.2, 0.7, 0.26, shirt);
    this.armR = this.limb(0.45, 1.42, 0.2, 0.7, 0.26, shirt);

    const torso = this.box(0.7, 0.72, 0.4, shirt);
    torso.position.set(0, 1.06, 0);
    const head = this.box(0.56, 0.56, 0.56, skin);
    head.position.set(0, 1.7, 0);
    const eyeL = this.box(0.08, 0.1, 0.04, 0x222222);
    eyeL.position.set(-0.13, 1.74, 0.28);
    const eyeR = this.box(0.08, 0.1, 0.04, 0x222222);
    eyeR.position.set(0.13, 1.74, 0.28);
    const brim = this.box(0.82, 0.08, 0.82, 0xd4b878); // darker straw → a value step below the crown
    brim.position.set(0, 1.99, 0);
    const crown = this.box(0.5, 0.26, 0.5, straw);
    crown.position.set(0, 2.15, 0);
    rig.add(this.legL, this.legR, torso, this.armL, this.armR, head, eyeL, eyeR, brim, crown);
    ch.add(rig);

    // fishing rod, held in the right hand (child of the right-arm pivot so it
    // follows the hand). rodTip marks the world anchor for the line.
    this.rodGroup = new THREE.Group();
    this.rodGroup.position.set(0, -0.62, 0.12);
    this.rodGroup.rotation.x = -0.1;
    const rod = this.box(0.045, 0.045, 2.2, 0x8a5a2b);
    rod.position.set(0, 0, 1.1);
    const reel = this.box(0.12, 0.12, 0.1, 0x222222);
    reel.position.set(0, -0.08, 0.35);
    this.rodTip = new THREE.Object3D();
    this.rodTip.position.set(0, 0, 2.2);
    this.rodGroup.add(rod, reel, this.rodTip);
    this.armR.add(this.rodGroup);

    this.addCharacterDetail();

    ch.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });

    // --- fishing line (Verlet rope) + bobber, simulated in world space ---
    const lineArr = new Float32Array(this.ropeN * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lineArr, 3));
    this.linePos = lineArr;
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x14110d }));
    this.line.frustumCulled = false;
    this.scene.add(this.line);

    this.bobber = new THREE.Group();
    const bobLow = this.box(0.16, 0.1, 0.16, 0xe23b3b);
    bobLow.position.y = -0.02;
    const bobTop = this.box(0.16, 0.09, 0.16, 0xf4f4f4);
    bobTop.position.y = 0.07;
    this.bobber.add(bobLow, bobTop);
    this.bobber.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    this.scene.add(this.bobber);

    for (let i = 0; i < this.ropeN; i++) {
      this.rope.push({
        pos: new THREE.Vector3(0, -i * this.ropeRest, 0),
        prev: new THREE.Vector3(0, -i * this.ropeRest, 0),
      });
    }

    this.setEquipped(this.equipped);
  }

  /**
   * Extra detail layered onto the blocky fisherman so he reads as a character, not a
   * mannequin: a face (nose, mouth, brows), brown hair under the straw hat, a hat band
   * with a little fishing-fly tucked in, an open olive vest with pockets over the red
   * shirt, a leather belt, rolled-up sleeves with bare hands, and rubber boots.
   *
   * Each part is parented to match how the body moves: hands + rolled sleeves ride the
   * arm pivots (so they swing and grip the rod), boots ride the leg pivots (so they
   * walk), and everything else hangs off `rig` so it somersaults with the body during a
   * roll. Nothing here touches legL/legR/armL/armR/rig/rodGroup, so the walk, roll and
   * cast animations are unchanged — this is purely additive geometry.
   */
  private addCharacterDetail(): void {
    const skin = 0xf2c79b;
    const skinDk = 0xe3b083;
    const shirt = 0x3f7ed1; // blue t-shirt (matches the torso)
    const hair = 0x5a3a22;
    const hairLt = 0x6e4a2c; // lighter strands to break up the hair
    const boot = 0x4a3a2e; // lightened so the darker cuff reads as a separate step from above
    const bootCuff = 0x2a221d;
    const beltC = 0x4a3320;
    const buckle = 0xd4b24a;
    const bandC = 0x7a4a2c;
    const lure = 0xef476f;
    const feather = 0xf4f4f4;
    const mouthC = 0x9c5446;

    const add = (
      parent: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      color: number,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const m = this.box(w, h, d, color);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };

    // neck: bridges the torso top (y≈1.42) and head so the head isn't a floating cube
    add(this.rig, 0.24, 0.18, 0.24, skin, 0, 1.45, 0);

    // face — the head front sits at z≈0.28; the existing eyes are at y1.74
    add(this.rig, 0.12, 0.12, 0.1, skinDk, 0, 1.64, 0.3); // nose
    add(this.rig, 0.22, 0.05, 0.04, mouthC, 0, 1.55, 0.285); // mouth
    add(this.rig, 0.13, 0.04, 0.05, hair, -0.13, 1.8, 0.285); // brow L (just above the eyes)
    add(this.rig, 0.13, 0.04, 0.05, hair, 0.13, 1.8, 0.285); // brow R

    // hair: SHORT and irregular. A thin ring just under the brim (y1.74→1.94) still wraps
    // every head corner (the L/R pieces reach z±0.31, the back reaches x±0.31), so no bare
    // corner shows; the look comes from uneven tufts of VARIED length hanging below it — a
    // jagged hairline, not a straight slab. Tops stay ≤1.94 (brim is 1.95) and inner faces
    // embed ~0.03 into the head, so nothing is coplanar (no z-fighting).
    add(this.rig, 0.1, 0.2, 0.62, hair, -0.3, 1.84, 0); // ring: left (front+back corners)
    add(this.rig, 0.1, 0.2, 0.62, hair, 0.3, 1.84, 0); // ring: right
    add(this.rig, 0.62, 0.2, 0.1, hair, 0, 1.84, -0.3); // ring: back (both back corners)
    add(this.rig, 0.13, 0.18, 0.12, hair, -0.26, 1.73, -0.26); // tuft back-left (long)
    add(this.rig, 0.11, 0.12, 0.13, hairLt, -0.31, 1.77, 0.06); // tuft left (short)
    add(this.rig, 0.12, 0.14, 0.11, hairLt, 0.26, 1.76, -0.27); // tuft back-right (short)
    add(this.rig, 0.1, 0.2, 0.14, hair, 0.31, 1.72, 0.06); // tuft right (long)
    add(this.rig, 0.14, 0.1, 0.08, hair, -0.1, 1.89, 0.27); // irregular fringe
    add(this.rig, 0.1, 0.06, 0.08, hairLt, 0.04, 1.91, 0.27);
    add(this.rig, 0.12, 0.12, 0.08, hair, 0.16, 1.88, 0.27);

    // hat band + a fishing fly tucked into it (the crown base is ~y2.04)
    add(this.rig, 0.54, 0.09, 0.54, bandC, 0, 2.05, 0);
    add(this.rig, 0.09, 0.09, 0.07, lure, 0.17, 2.07, 0.28);
    const fly = add(this.rig, 0.05, 0.13, 0.04, feather, 0.17, 2.16, 0.27);
    fly.rotation.z = 0.3;
    // a lighter, sun-hit cap stepped onto the crown top — the hat is the biggest shape
    // the top-down camera sees, so a value step there reads more than any face cube
    add(this.rig, 0.42, 0.08, 0.42, 0xf0d99a, 0, 2.3, 0);

    // leather belt at the waist with a brass buckle
    add(this.rig, 0.76, 0.13, 0.45, beltC, 0, 0.72, 0);
    add(this.rig, 0.13, 0.13, 0.05, buckle, 0, 0.72, 0.23);

    // rolled sleeves + bare hands on each arm pivot (pivot-local: shoulder = y0, the arm
    // hangs to y≈-0.7). The right hand sits a touch forward to grip the rod.
    for (const [arm, handZ] of [
      [this.armL, 0.02],
      [this.armR, 0.05],
    ] as const) {
      add(arm, 0.22, 0.36, 0.28, skin, 0, -0.54, 0); // bare forearm
      add(arm, 0.25, 0.08, 0.3, shirt, 0, -0.34, 0); // rolled-sleeve cuff
      add(arm, 0.2, 0.18, 0.26, skin, 0, -0.74, handZ); // hand
    }

    // rubber boots on each leg pivot (pivot-local: hip = y0, foot ≈ y-0.7), toe forward
    for (const leg of [this.legL, this.legR]) {
      add(leg, 0.3, 0.26, 0.44, boot, 0, -0.58, 0.07); // boot
      add(leg, 0.31, 0.08, 0.31, bootCuff, 0, -0.45, 0); // boot cuff
    }
  }

  // ---------------------------------------------------------------- fishing

  private setEquipped(on: boolean): void {
    this.equipped = on;
    this.fishing = false; // taking out / stowing the rod resets any cast
    if (on) {
      this.rodGroup.visible = true; // grows back in via updateEquipAnim()
    } else {
      this.line.visible = false; // line + bobber vanish immediately when stowing
      this.bobber.visible = false;
    }
  }

  private toggleEquip(): void {
    if (!this.equipped) this.setEquipped(true);
    else this.stowRod();
  }

  /** Reel the line in if it's out, then stow the rod (shared by the hotbar + debug hook). */
  private stowRod(): void {
    if (this.isFishingBusy()) {
      this.fishing = false; // start the reel-in animation
      this.bobberAnchored = false; // release the float so it comes back to the rod
      this.pendingStow = true;
    } else {
      this.setEquipped(false);
    }
  }

  // ------------------------------------------------------------- inventory

  /** Seed the starting inventory: a rod in hotbar slot 0, a stack of bait beside it. */
  private initInventory(): void {
    this.slots[0] = { id: 'rod', icon: '/sprites/rod.png', name: 'Canne à pêche', count: 1 };
    this.slots[1] = { id: 'bait', icon: '/sprites/bait.png', name: 'Vers', count: 12 };
    this.refreshEquip();
  }

  /** The rod is "in hand" (equipped) exactly when the selected hotbar slot holds it. */
  private refreshEquip(): void {
    const wantRod = this.slots[this.selectedHotbar]?.id === 'rod';
    if (wantRod && !this.equipped) this.setEquipped(true);
    else if (!wantRod && this.equipped) this.stowRod();
  }

  /** Add one of an item to the inventory: stack onto a matching slot, else first empty. */
  private addItem(stack: ItemStack): void {
    const existing = this.slots.find((s) => s?.id === stack.id);
    if (existing) existing.count += stack.count;
    else {
      const empty = this.slots.findIndex((s) => !s);
      if (empty >= 0) this.slots[empty] = { ...stack };
    }
    this.invVersion++;
  }

  /** Select hotbar slot n (0..8); its item becomes the one in hand. */
  selectHotbar(n: number): void {
    if (n < 0 || n > 8) return;
    this.selectedHotbar = n;
    this.refreshEquip();
    this.invVersion++;
  }

  /** Show / hide the inventory grid (E or I). Returns any held stack when closing. */
  toggleInventory(): void {
    this.invOpen = !this.invOpen;
    if (!this.invOpen && this.held) this.returnHeld();
    this.invVersion++;
  }

  /** Lift the stack out of slot i onto the cursor (start of a drag). */
  pickUp(i: number): void {
    if (this.held || i < 0 || i >= this.slots.length || !this.slots[i]) return;
    this.held = this.slots[i];
    this.heldFrom = i;
    this.slots[i] = null;
    this.invVersion++;
  }

  /** Drop the cursor stack onto slot j: fill empty, merge same kind, or swap. */
  placeAt(j: number): void {
    if (!this.held || j < 0 || j >= this.slots.length) return;
    const target = this.slots[j];
    if (!target) {
      this.slots[j] = this.held;
    } else if (target.id === this.held.id) {
      target.count += this.held.count; // merge stacks
    } else {
      this.slots[j] = this.held; // swap: displaced item goes back to the origin slot
      this.slots[this.heldFrom] = target;
    }
    this.held = null;
    this.heldFrom = -1;
    this.refreshEquip();
    this.invVersion++;
  }

  /** Put the cursor stack back where it came from (drop outside any slot). */
  returnHeld(): void {
    if (!this.held) return;
    if (this.heldFrom >= 0 && !this.slots[this.heldFrom]) this.slots[this.heldFrom] = this.held;
    else {
      const empty = this.slots.findIndex((s) => !s);
      if (empty >= 0) this.slots[empty] = this.held;
    }
    this.held = null;
    this.heldFrom = -1;
    this.refreshEquip();
    this.invVersion++;
  }

  /** Read-only view of all 36 slots for the HUD to render. */
  getSlots(): readonly (ItemStack | null)[] {
    return this.slots;
  }

  /** The stack currently held on the cursor (for the floating drag icon), or null. */
  getHeld(): ItemStack | null {
    return this.held;
  }

  /** Left-click on the canvas: cast the line out / reel it back in. */
  private fishAction(): void {
    if (!this.equipped) return; // need the rod in hand
    const caught = this.fishing && this.bobberAnchored && this.biting; // reeled in mid-bite
    this.fishing = !this.fishing;
    this.bobberAnchored = false; // unpin the float on each cast / reel
    this.biting = false; // any reel/cast clears the current bite
    this.biteWindow = 0;
    this.retractFast = false; // a manual cast/reel uses the normal speeds
    if (this.fishing) {
      this.castT = 0; // play the arm animation only when casting out (not when reeling in)
      this.castThrown = false;
    } else if (caught) {
      this.catchFish();
    }
  }

  /** Reeling a line in from the water lands a catch: coins, XP and the odd gem. */
  private catchFish(): void {
    // land a fish into the inventory, biased toward the common kinds
    const kind = this.fishKinds[Math.floor(Math.pow(Math.random(), 1.8) * this.fishKinds.length)];
    this.addItem(kind);
    this.coins += 3 + Math.floor(Math.random() * 10); // +3..12 coins
    this.xp += 8 + Math.floor(Math.random() * 11); // +8..18 xp
    if (Math.random() < 0.2) this.gems += 1; // occasional gem
    if (Math.random() < 0.35) {
      this.hp = Math.max(1, this.hp - (6 + Math.floor(Math.random() * 10))); // a fish that fights back
    }
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext = Math.round(this.xpToNext * 1.4);
      this.maxHp += 10;
      this.hp = this.maxHp; // heal on level up
    }
  }

  /**
   * Drives the bite cycle once the float is anchored on water: count down to a bite, then
   * open a short window (the float plunges + the water splashes) during which reeling in
   * lands the fish; let it lapse and the fish slips off and we wait for the next one.
   */
  private updateBite(dt: number): void {
    if (!this.fishing || !this.bobberAnchored) return;
    if (this.biting) {
      this.biteWindow -= dt;
      // keep the water churning while the fish thrashes
      this.biteSplashT -= dt;
      if (this.biteSplashT <= 0) {
        const surf = this.support(this.bobberAnchor.x, this.bobberAnchor.z, this.clock.elapsedTime);
        this.triggerSplash(this.bobberAnchor.x, surf, this.bobberAnchor.z);
        this.biteSplashT = 0.5;
      }
      if (this.biteWindow <= 0) {
        this.biting = false; // the fish got away — try again
        this.biteTimer = 2 + Math.random() * 4;
      }
    } else {
      this.biteTimer -= dt;
      if (this.biteTimer <= 0) {
        this.biting = true; // a fish is on the hook!
        this.biteWindow = 2.2; // seconds to react and reel in
        this.biteSplashT = 0;
      }
    }
  }

  /** A blocky red "!" (stroke + dot) that floats above the float while a fish is biting. */
  private buildBiteMarker(): void {
    const g = new THREE.Group();
    const part = (w: number, h: number, d: number, y: number): void => {
      const m = this.box(w, h, d, 0xff2b2b);
      m.position.set(0, y, 0);
      m.castShadow = false;
      m.receiveShadow = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive = new THREE.Color(0xff3b3b);
      mat.emissiveIntensity = 1.1; // glows so it pops against the blue water
      g.add(m);
    };
    part(0.16, 0.4, 0.16, 0.48); // stroke (small gap above the dot)
    part(0.16, 0.15, 0.16, 0); // dot below
    g.visible = false;
    this.scene.add(g);
    this.biteMarker = g;
  }

  /** Advances the cast: a wind-up then a forward whip that flings the line out. */
  private updateCast(dt: number): void {
    if (this.castT >= 1) return;
    this.castT = Math.min(1, this.castT + dt / 0.55);
    if (!this.castThrown && this.castT >= 0.6) {
      this.castThrown = true;
      if (this.fishing) {
        // fling the bobber out at the moment the arm whips forward
        const last = this.rope[this.rope.length - 1];
        last.prev.x -= Math.sin(this.heading) * 0.5;
        last.prev.z -= Math.cos(this.heading) * 0.5;
        last.prev.y -= 0.4;
      }
    }
  }

  private initRope(): void {
    this.ropeRestCur = this.ropeRest; // start reeled in
    this.rodTip.updateWorldMatrix(true, false);
    const tip = this.rodTip.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < this.ropeN; i++) {
      this.rope[i].pos.set(tip.x, tip.y - i * this.ropeRestCur, tip.z);
      this.rope[i].prev.copy(this.rope[i].pos);
    }
  }

  private updateRope(dt: number, t: number): void {
    const pts = this.rope;
    const restTarget = this.fishing && this.castThrown ? this.ropeRestCast : this.ropeRest;
    // deploy fast on cast (12), reel back in slowly (3) — but snap back quickly (16) when
    // the float landed on land/dock instead of water
    const restRate = this.fishing ? 12 : this.retractFast ? 16 : 3;
    this.ropeRestCur += (restTarget - this.ropeRestCur) * Math.min(1, dt * restRate);
    this.rodTip.updateWorldMatrix(true, false);
    const tip = this.rodTip.getWorldPosition(this._tmp);

    // Verlet integration with gravity (point 0 is pinned to the rod tip)
    const grav = -28 * dt * dt;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const vx = (p.pos.x - p.prev.x) * 0.96;
      const vy = (p.pos.y - p.prev.y) * 0.96;
      const vz = (p.pos.z - p.prev.z) * 0.96;
      p.prev.copy(p.pos);
      p.pos.x += vx;
      p.pos.y += vy + grav;
      p.pos.z += vz;
    }

    // satisfy fixed segment lengths
    for (let k = 0; k < 16; k++) {
      pts[0].pos.copy(tip);
      if (this.bobberAnchored) {
        pts[pts.length - 1].pos.x = this.bobberAnchor.x; // float held where it landed
        pts[pts.length - 1].pos.z = this.bobberAnchor.z;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i].pos;
        const b = pts[i + 1].pos;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
        const diff = (d - this.ropeRestCur) / d;
        if (i === 0) {
          b.x -= dx * diff;
          b.y -= dy * diff;
          b.z -= dz * diff;
        } else {
          const hx = dx * diff * 0.5;
          const hy = dy * diff * 0.5;
          const hz = dz * diff * 0.5;
          a.x += hx;
          a.y += hy;
          a.z += hz;
          b.x -= hx;
          b.y -= hy;
          b.z -= hz;
        }
      }
    }

    // buoyancy: the bobber can't sink — it rests on the wavy surface
    const last = pts[pts.length - 1];
    const surf = this.support(last.pos.x, last.pos.z, t);
    if (last.pos.y < surf) {
      last.pos.y = surf;
      last.prev.y = surf; // kill vertical velocity
      // the first time the cast lands: pin the float ONLY if it hit water (surf < -0.1).
      // Grass (0.06) and dock (0.12) aren't water → reel the line straight back in.
      if (this.fishing && !this.bobberAnchored) {
        if (surf < -0.1) {
          this.bobberAnchored = true;
          this.bobberAnchor.set(last.pos.x, 0, last.pos.z);
          this.triggerSplash(last.pos.x, surf, last.pos.z); // cubic splash on water
          this.biteTimer = 2.5 + Math.random() * 3.5; // a fish bites after a short wait
          this.biting = false;
        } else {
          this.fishing = false; // landed on land/dock — retract immediately, no catch
          this.retractFast = true; // snap the line back in quickly
        }
      }
      last.prev.x = last.pos.x - (last.pos.x - last.prev.x) * 0.5; // damp drift
      last.prev.z = last.pos.z - (last.pos.z - last.prev.z) * 0.5;
    }
    // while anchored, hold the float at its landing spot — only bob with the waves.
    // During a bite the float is yanked under with a quick stutter + side jitter.
    if (this.bobberAnchored) {
      const surfA = this.support(this.bobberAnchor.x, this.bobberAnchor.z, t);
      let bx = this.bobberAnchor.x;
      let bz = this.bobberAnchor.z;
      let by = surfA;
      if (this.biting) {
        const pull = Math.max(0, Math.sin(t * 16)); // 0..1, rapid downward tugs
        by = surfA - 0.32 * pull - 0.06; // plunge under the surface
        bx += Math.sin(t * 23) * 0.03; // nervous side jitter
        bz += Math.cos(t * 19) * 0.03;
      }
      last.pos.set(bx, by, bz);
      last.prev.set(bx, by, bz);
    }

    // push positions to the line geometry + place the bobber
    const arr = this.linePos;
    for (let i = 0; i < pts.length; i++) {
      arr[i * 3] = pts[i].pos.x;
      arr[i * 3 + 1] = pts[i].pos.y;
      arr[i * 3 + 2] = pts[i].pos.z;
    }
    (this.line.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
    this.bobber.position.copy(last.pos);
  }

  // ------------------------------------------------------------------- input

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === 'shift' && !e.repeat) this.startRoll();
    // hotbar shortcuts on ANY layout: match the physical number row by e.code
    // (Digit1-9 / Numpad1-9), with the literal AZERTY characters &é"'(-è_ç as a fallback
    if (!e.repeat) {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      const slot = m ? +m[1] - 1 : '&é"\'(-è_ç'.indexOf(e.key);
      if (slot >= 0 && slot <= 8) {
        this.selectHotbar(slot);
        e.preventDefault(); // e.g. stop the browser's quick-find on " ' "
      }
    }
    if ((k === 'e' || k === 'i') && !e.repeat) this.toggleInventory(); // open/close inventory
    this.keys.add(k);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    // only the canvas fishes — clicks on the HUD (hotbar, inventory) must not cast
    if (e.button === 0 && e.target === this.renderer.domElement) this.fishAction();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    // mouse wheel cycles the selected hotbar slot (Minecraft-style)
    const dir = e.deltaY > 0 ? 1 : -1;
    this.selectHotbar((this.selectedHotbar + dir + 9) % 9);
  };

  // ------------------------------------------------------------------ update

  private shortestAngle(from: number, to: number): number {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  private easeOutBack(x: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
  }

  /** Animates the rod "popping" in / out (scale with overshoot) on (un)equip. */
  private updateEquipAnim(dt: number): void {
    const target = this.equipped ? 1 : 0;
    const rate = dt / (this.equipped ? 0.32 : 0.16); // grow with a pop, stow quickly
    this.rodReveal =
      target > this.rodReveal
        ? Math.min(target, this.rodReveal + rate)
        : Math.max(target, this.rodReveal - rate);

    // overshoot while appearing, plain shrink while stowing
    const s = this.equipped ? this.easeOutBack(this.rodReveal) : this.rodReveal;
    this.rodGroup.scale.setScalar(Math.max(1e-3, s));
    this.rodGroup.visible = this.rodReveal > 1e-3;

    // the line + bobber drop in once the rod is mostly out
    const lineOut = this.equipped && this.rodReveal > 0.55;
    if (lineOut && !this.line.visible) {
      this.initRope();
      this.line.visible = true;
      this.bobber.visible = true;
    } else if (!this.equipped) {
      this.line.visible = false;
      this.bobber.visible = false;
    }
    if (lineOut) {
      const p = Math.min(1, (this.rodReveal - 0.55) / 0.45);
      this.bobber.scale.setScalar(Math.max(1e-3, this.easeOutBack(p)));
    }
  }

  private animateLimbs(moving: boolean, dt: number, t: number): void {
    if (this.rolling) {
      // tuck the limbs in while rolling
      const kk = Math.min(1, dt * 22);
      const tuckLeg = -1.5; // knees curl up toward the chest, into the roll (forward = -x)
      const tuckArm = -1.2; // arms tuck forward
      this.legL.rotation.x += (tuckLeg - this.legL.rotation.x) * kk;
      this.legR.rotation.x += (tuckLeg - this.legR.rotation.x) * kk;
      this.armL.rotation.x += (tuckArm - this.armL.rotation.x) * kk;
      this.armR.rotation.x += (tuckArm - this.armR.rotation.x) * kk;
      const grounded = this.groundHeight(this.character.position.x, this.character.position.z);
      this.character.position.y += (grounded - this.character.position.y) * kk;
      return;
    }
    const k = Math.min(1, dt * 12); // smoothing toward targets
    const legAmp = 0.7;
    const armAmp = 0.5;
    const hold = -0.5; // right-arm pose while holding the rod

    let tgtLegL = 0;
    let tgtLegR = 0;
    let tgtArmL: number;
    let tgtArmR: number;
    let tgtArmLz = 0;
    let tgtArmRz = 0;

    if (moving) {
      tgtLegL = Math.sin(this.walkPhase) * legAmp;
      tgtLegR = Math.sin(this.walkPhase + Math.PI) * legAmp;
      tgtArmL = Math.sin(this.walkPhase + Math.PI) * armAmp;
      tgtArmR = Math.sin(this.walkPhase) * armAmp;
    } else {
      const idle = Math.sin(t * 1.8) * 0.05;
      tgtArmL = idle;
      tgtArmR = idle;
    }

    // when the rod is equipped, the right arm holds it fairly steady
    if (this.equipped) {
      tgtArmR = hold + (moving ? Math.sin(this.walkPhase) * 0.12 : Math.sin(t * 1.8) * 0.04);
    }

    // two-handed grip while fishing: bring the rod to centre and the left hand onto it
    if (this.isFishingBusy()) {
      tgtArmL = -1.3; // reach a bit higher up the rod than the right hand
      tgtArmLz = 0.6; // swing the empty left hand inward onto the rod
      if (this.castT >= 1) {
        tgtArmR = -1.0;
        tgtArmRz = -0.7; // bring the rod to centre (skipped during the overhead cast)
      }
    }

    this.legL.rotation.x += (tgtLegL - this.legL.rotation.x) * k;
    this.legR.rotation.x += (tgtLegR - this.legR.rotation.x) * k;
    this.armL.rotation.x += (tgtArmL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (tgtArmR - this.armR.rotation.x) * k;
    this.armL.rotation.z += (tgtArmLz - this.armL.rotation.z) * k;
    this.armR.rotation.z += (tgtArmRz - this.armR.rotation.z) * k;

    // cast overrides the right arm directly: rear it UP & back OVER the shoulder
    // (decreasing angle goes up-and-over, not through the bottom), then whip forward
    if (this.castT < 1) {
      const p = this.castT;
      if (p < 0.45) this.armR.rotation.x = hold + (-3.7 - hold) * (p / 0.45); // up & back over the shoulder
      else if (p < 0.62) this.armR.rotation.x = -3.7 + (-1.4 - -3.7) * ((p - 0.45) / 0.17); // whip forward over the top
      else this.armR.rotation.x = -1.4 + (hold - -1.4) * ((p - 0.62) / 0.38); // settle to hold
    }

    // body bob (added on top of the ground height, so the dock surface is respected)
    const base = this.groundHeight(this.character.position.x, this.character.position.z);
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : Math.sin(t * 2.2) * 0.02;
    this.character.position.y += (base + bob - this.character.position.y) * k;
  }

  /** True while a cast is in progress, the line is out, or it's reeling back in. */
  private isFishingBusy(): boolean {
    return this.equipped && (this.fishing || this.castT < 1 || this.ropeRestCur > this.ropeRest + 0.05);
  }

  private inRegion(x: number, z: number): boolean {
    // Walkable only where a real grass cube sits under the player's centre cell. The grass
    // is built per integer cell (a cube exists where beyondShore(cell) <= 0), so test that
    // SAME cell instead of a fuzzy continuous margin — otherwise the player walks a little
    // past the lumpy shore onto cells that have no cube and floats over the water.
    const onIsland = this.beyondShore(Math.round(x), Math.round(z)) <= 0;
    const onDock = Math.abs(x) <= 0.9 && z >= this.dockBase - 0.5 && z <= this.dockBase + this.dockLen - 0.5;
    return onIsland || onDock;
  }

  private groundHeight(x: number, z: number): number {
    if (Math.abs(x) <= 1.0 && z >= this.dockBase - 0.5 && z <= this.dockBase + this.dockLen - 0.5)
      return 0.09; // dock surface
    return 0;
  }

  /** Move by (dx, dz), sliding along the walkable region's edges and around obstacles. */
  private resolveMove(dx: number, dz: number): void {
    const p = this.character.position;
    let nx = p.x + dx;
    let nz = p.z + dz;

    // stay inside the walkable region (island + dock), sliding along walls
    if (!this.inRegion(nx, nz)) {
      if (this.inRegion(nx, p.z)) nz = p.z;
      else if (this.inRegion(p.x, nz)) nx = p.x;
      else {
        nx = p.x;
        nz = p.z;
      }
    }

    // push out of solid obstacles (tree, rocks)
    for (const o of this.obstacles) {
      const ox = nx - o.x;
      const oz = nz - o.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < o.r * o.r) {
        const d = Math.sqrt(d2) || 1e-4;
        nx = o.x + (ox / d) * o.r;
        nz = o.z + (oz / d) * o.r;
      }
    }
    // rectangular collision for the house at the island centre — slide along the flat walls
    if (Math.abs(nx) < this.houseHalf.x && Math.abs(nz) < this.houseHalf.z) {
      const penX = this.houseHalf.x - Math.abs(nx);
      const penZ = this.houseHalf.z - Math.abs(nz);
      if (penX <= penZ) nx = (nx < 0 ? -1 : 1) * this.houseHalf.x;
      else nz = (nz < 0 ? -1 : 1) * this.houseHalf.z;
    }
    if (!this.inRegion(nx, nz)) return; // a push-out that leaves the region → stay put

    p.x = nx;
    p.z = nz;
  }

  private startRoll(): void {
    if (this.rolling || this.rollCooldown > 0 || this.isFishingBusy()) return; // no dodging while fishing
    this.rolling = true;
    this.rollT = 0;
    this.rollDir.set(Math.sin(this.heading), 0, Math.cos(this.heading)); // roll where we face
  }

  /** Advances the dodge roll: a forward burst + one full somersault of the rig. */
  private updateRoll(dt: number): void {
    this.rollT += dt / this.rollDuration;
    if (this.rollT >= 1) {
      this.rolling = false;
      this.rollCooldown = this.rollCooldownMax;
      this.rig.rotation.x = 0;
      this.rig.position.set(0, 0, 0);
      return;
    }
    const speed = 16 * (1 - this.rollT); // decelerating forward burst
    this.resolveMove(this.rollDir.x * speed * dt, this.rollDir.z * speed * dt);
    const ang = this.rollT * Math.PI * 2; // one full flip
    const dip = Math.sin(this.rollT ** 4 * Math.PI) * 0.55; // sink into the ground, peaking near the end
    this.rig.rotation.x = ang;
    this.rig.position.set(0, 1 - Math.cos(ang) - dip, -Math.sin(ang)); // pivot ~body center, dipped
  }

  private update(dt: number): void {
    dt = Math.min(dt, 0.05); // guard against big jumps after the tab was idle
    const t = this.clock.elapsedTime;

    if (this.rollCooldown > 0) this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 8 * dt); // slow HP regen

    let moving = false;
    if (this.rolling) {
      this.updateRoll(dt);
    } else if (!this.isFishingBusy()) {
      // movement relative to the (fixed) camera orientation — locked while fishing
      this.camera.getWorldDirection(this._fwd);
      this._fwd.y = 0;
      this._fwd.normalize();
      this._right.crossVectors(this._fwd, this._up).normalize();

      const move = this._move.set(0, 0, 0);
      if (this.keys.has('z') || this.keys.has('arrowup')) move.add(this._fwd);
      if (this.keys.has('s') || this.keys.has('arrowdown')) move.sub(this._fwd);
      if (this.keys.has('d') || this.keys.has('arrowright')) move.add(this._right);
      if (this.keys.has('q') || this.keys.has('arrowleft')) move.sub(this._right);

      moving = move.lengthSq() > 0;
      if (moving) {
        move.normalize();
        this.resolveMove(move.x * 3.6 * dt, move.z * 3.6 * dt);
        this.heading = Math.atan2(move.x, move.z);
        this.walkPhase += dt * 9;
      }
    }

    this.character.rotation.y +=
      this.shortestAngle(this.character.rotation.y, this.heading) * Math.min(1, dt * 10);

    this.updateCast(dt);
    this.animateLimbs(moving, dt, t);
    this.updateEquipAnim(dt);
    if (this.equipped) this.updateRope(dt, t);
    this.updateBite(dt);
    if (this.biteMarker) {
      // the red "!" shows only during a bite, floating above the float's spot
      this.biteMarker.visible = this.biting && this.bobberAnchored;
      if (this.biteMarker.visible) {
        const surf = this.support(this.bobberAnchor.x, this.bobberAnchor.z, t);
        this.biteMarker.position.set(
          this.bobberAnchor.x,
          surf + 0.85 + Math.sin(t * 6) * 0.05,
          this.bobberAnchor.z,
        );
      }
    }
    if (this.pendingStow && !this.isFishingBusy()) {
      this.pendingStow = false;
      this.setEquipped(false); // line fully reeled in → now stow the rod
    }
    this.animateWater(t);
    this.animateSeaLife(t);
    this.animateCat(dt, t);
    this.updateSplash(dt);

    // keep the camera centred on the player (same angle, follows them)
    this.camera.position.set(this.character.position.x + 15, 16, this.character.position.z + 15);
    this.controls.target.set(this.character.position.x, 1.2, this.character.position.z);
    this.controls.update();

    // circular reveal: only while an obstacle actually blocks the camera's view of the
    // player, dissolve a soft circle in whatever stands in front of them
    this.camera.updateMatrixWorld();
    this._cc.set(this.character.position.x, this.character.position.y + 1.1, this.character.position.z);
    // 1) which obstacles actually block the camera→player line of sight? ramp each
    //    occluder's own strength independently so only the ones on the ray fade —
    //    a tree merely overlapping the player on screen stays solid
    this._cdir.copy(this._cc).sub(this.camera.position);
    const camDist = this._cdir.length();
    this._cdir.normalize();
    this.raycaster.set(this.camera.position, this._cdir);
    this.raycaster.far = camDist - 0.8;
    const k = Math.min(1, dt * 10);
    const px = this.character.position.x;
    const pz = this.character.position.z;
    for (const occ of this.occluders) {
      // broad-phase: only props near the player can sit on the camera→player line,
      // so skip the raycast for the rest (they ramp back to solid)
      const dx = occ.cx - px;
      const dz = occ.cz - pz;
      // within ~11 units (covers the widest mountain footprint) → do the precise ray
      const blocking =
        dx * dx + dz * dz < 121 && this.raycaster.intersectObject(occ.object, true).length > 0;
      occ.strength.value += ((blocking ? 1 : 0) - occ.strength.value) * k;
    }
    // 2) track the player's screen position + view depth so the hole follows them
    this._cdir.copy(this._cc).project(this.camera);
    this.holeU.center.value.set(this._cdir.x, this._cdir.y);
    this._cc.applyMatrix4(this.camera.matrixWorldInverse);
    this.holeU.viewZ.value = -this._cc.z;
    this.holeU.aspect.value = this.camera.aspect;
    this.onState?.({
      rollCd: this.rollCooldown,
      rollCdMax: this.rollCooldownMax,
      hp: this.hp,
      maxHp: this.maxHp,
      level: this.level,
      xp: this.xp,
      xpToNext: this.xpToNext,
      coins: this.coins,
      gems: this.gems,
      px: this.character.position.x,
      pz: this.character.position.z,
      heading: this.heading,
      bx: this.bobber.position.x,
      bz: this.bobber.position.z,
      casting: this.fishing || this.bobberAnchored,
      equipped: this.equipped,
      selectedHotbar: this.selectedHotbar,
      invOpen: this.invOpen,
      invVersion: this.invVersion,
    });
  }

  private animateWater(t: number): void {
    // waves + foam are now fully GPU-side; just advance the shader clock
    this.waterUniforms.uTime.value = t;
  }

  // --------------------------------------------------------------- lifecycle

  renderOnce(): void {
    this.renderer.render(this.scene, this.camera);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.scene.updateMatrixWorld(true);
    if (this.equipped) this.initRope();
    this.updateEquipAnim(0); // sync rod visibility (hidden when spawning empty-handed)
    this.renderOnce(); // eager first frame (survives throttled rAF)
    const loop = (): void => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(loop);
      this.update(this.clock.getDelta());
      this.renderOnce();
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderOnce();
  }

  dispose(): void {
    this.stop();
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('wheel', this.onWheel);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const geo = (o as THREE.Mesh).geometry;
      const mat = (o as THREE.Mesh).material;
      if (geo) geo.dispose();
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete (window as unknown as { __game?: unknown }).__game;
  }
}
