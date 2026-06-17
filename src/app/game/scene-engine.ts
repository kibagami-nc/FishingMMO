import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
  private castT = 1; // cast animation progress (1 = idle): wind-up → throw → settle
  private castThrown = false; // whether this cast's throw impulse has fired
  private eHold = 0; // seconds the E key has been held
  private eFired = false; // whether the long-press fish already fired this hold

  private water?: THREE.Mesh;
  private waterBase?: Float32Array;
  private readonly waterY = -0.7;
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
  private readonly occluders: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly holeU = {
    center: { value: new THREE.Vector2() },
    viewZ: { value: 0 },
    radius: { value: 0.2 },
    aspect: { value: 1 },
    strength: { value: 0 }, // ramps to 1 only while an obstacle blocks the view
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.buildIsland();
    this.buildScenery();
    this.buildHouse();
    this.scene.add(this.character);
    this.buildCharacter();
    this.character.position.set(0, 0, 4.5); // spawn in front of the house, not inside it
    this.character.rotation.y = Math.PI;
    this.heading = Math.PI;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);

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

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xcfeaff, 0x4a6b3a, 1.0);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
    sun.position.set(12, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -16;
    c.right = 16;
    c.top = 16;
    c.bottom = -16;
    c.near = 1;
    c.far = 60;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
  }

  private waveAt(x: number, z: number, t: number): number {
    return Math.sin(x * 0.18 + t) * 0.25 + Math.cos(z * 0.22 + t * 0.8) * 0.2;
  }

  /** Height the bobber rests on at (x, z): grass island, wooden dock, or wavy water. */
  private support(x: number, z: number, t: number): number {
    if (Math.abs(x) <= 6.5 && Math.abs(z) <= 6.5) return 0.06; // grass island top
    if (Math.abs(x) <= 1.0 && z >= 6.0 && z <= 11.0) return 0.12; // wooden dock
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
    this.waterBase = Float32Array.from(geo.attributes['position'].array as Float32Array);

    // Wind-Waker-style toon water: an unlit, flat-coloured surface — the look comes
    // entirely from hard depth bands + animated white foam injected in the shader below.
    const mat = new THREE.MeshBasicMaterial({ color: 0x2b86c9, transparent: true, opacity: 0.92 });

    // Layer 2 (+ extra caustics): inject GLSL via onBeforeCompile so scene lights and
    // the island's cast shadow STILL affect the surface. A `uTime` uniform animates
    // moving caustic highlights; a second set of UVs (the same map, scrolled the other
    // way in-shader) gives the two-direction look without a second texture sampler.
    mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      shader.uniforms['uTime'] = this.waterUniforms.uTime;

      // --- vertex: pass world XZ so caustics tile in WORLD units (not stretched UVs) ---
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec2 vWaterWorld;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWaterWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;',
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
            // distance to the island AABB (half-extent 6.5): 0 at the shore, grows outward
            'vec2 q = abs( pw ) - vec2( 6.5 );',
            'float dShore = length( max( q, vec2( 0.0 ) ) );',
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
    mat.customProgramCacheKey = (): string => 'water-pixel-v7';

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
  private addCutout(material: THREE.Material | THREE.Material[]): void {
    const mats = Array.isArray(material) ? material : [material];
    for (const mat of mats) {
      mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
        shader.uniforms['uHoleCenter'] = this.holeU.center;
        shader.uniforms['uHoleViewZ'] = this.holeU.viewZ;
        shader.uniforms['uHoleRadius'] = this.holeU.radius;
        shader.uniforms['uHoleAspect'] = this.holeU.aspect;
        shader.uniforms['uHoleStrength'] = this.holeU.strength;
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
              '  float hole = ( 1.0 - smoothstep( 0.55, 1.0, length( hd ) / max( uHoleRadius, 0.001 ) ) ) * uHoleStrength;',
              '  float dith = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );',
              '  if ( hole > dith ) discard;', // ordered dither → clean soft-edged circle
              '}',
            ].join('\n'),
          );
      };
      mat.customProgramCacheKey = (): string => 'occluder-cutout-v2';
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
    const GRID = 13;
    const half = (GRID - 1) / 2;
    const greens = [0x6ab150, 0x5aa044];

    // checkerboard grass top — each tile is a cube (top face at y = 0)
    for (let ix = 0; ix < GRID; ix++) {
      for (let iz = 0; iz < GRID; iz++) {
        const cube = this.box(1, 1, 1, greens[(ix + iz) % 2]);
        cube.position.set(ix - half, -0.5, iz - half);
        cube.castShadow = false; // flat top surface — no need to cast
        this.scene.add(cube);
      }
    }

    // tapered dirt + rock underbelly → floating-island look
    const dirt = this.box(GRID, 2, GRID, 0x7a4a28);
    dirt.position.y = -2;
    const rock1 = this.box(GRID - 2, 2.2, GRID - 2, 0x6b7280);
    rock1.position.y = -4.1;
    const rock2 = this.box(GRID - 4.5, 2.4, GRID - 4.5, 0x586573);
    rock2.position.y = -6.2;
    this.scene.add(dirt, rock1, rock2);
  }

  private buildScenery(): void {
    // wooden dock reaching out over the water (decorative)
    const dock = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const plank = this.box(2, 0.18, 1, i % 2 ? 0xa9743f : 0x9c6a38);
      plank.position.set(0, 0, 6.5 + i);
      dock.add(plank);
    }
    for (const [px, pz] of [
      [-0.8, 7],
      [0.8, 7],
      [-0.8, 10],
      [0.8, 10],
    ] as const) {
      const post = this.box(0.18, 1.6, 0.18, 0x6f4a26);
      post.position.set(px, -0.7, pz);
      dock.add(post);
    }
    this.scene.add(dock);

    // scatter trees + rocks around the island (each registers its own collision)
    for (const [tx, tz] of [
      [-3, -3],
      [-5.2, -4.8],
      [4.8, -5],
      [-5.5, 1.5],
      [5.2, 3.8],
      [-2.5, -5.2],
    ] as const) {
      this.addTree(tx, tz);
    }
    for (const [rx, rz, rs] of [
      [3, -2.6, 0.95],
      [3.6, -1.8, 0.62],
      [-4.5, 4.2, 0.85],
      [5.5, -3.5, 0.7],
      [-5.8, -2, 1.0],
      [1.5, -5.5, 0.6],
      [-1.8, 5, 0.7],
      [5.8, 0.5, 0.8],
    ] as const) {
      this.addRock(rx, rz, rs);
    }
  }

  private addTree(x: number, z: number): void {
    const tree = new THREE.Group();
    const trunk = this.box(0.5, 1.6, 0.5, 0x6f4a26);
    trunk.position.y = 0.8;
    const leaves1 = this.box(1.8, 1.0, 1.8, 0x4f8f3a);
    leaves1.position.y = 2.0;
    const leaves2 = this.box(1.1, 0.9, 1.1, 0x5aa044);
    leaves2.position.y = 2.8;
    tree.add(trunk, leaves1, leaves2);
    tree.position.set(x, 0, z);
    this.scene.add(tree);
    this.occluders.push(tree);
    tree.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) this.addCutout(m.material);
    });
    this.obstacles.push({ x, z, r: 1.5 });
  }

  private addRock(x: number, z: number, s: number): void {
    const rock = this.box(s, s * 0.78, s * 0.9, s > 0.78 ? 0x8a8f98 : 0x767c85);
    rock.position.set(x, s * 0.39, z);
    this.scene.add(rock);
    this.occluders.push(rock);
    this.addCutout(rock.material);
    this.obstacles.push({ x, z, r: s * 0.55 + 0.32 });
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

    this.scene.add(h); // centred at island origin
    this.occluders.push(h);
    h.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) this.addCutout(m.material);
    });
  }

  private buildCharacter(): void {
    const skin = 0xf2c79b;
    const shirt = 0xd64545;
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
    const brim = this.box(0.82, 0.08, 0.82, straw);
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
    if (!this.equipped) {
      this.setEquipped(true);
      return;
    }
    // unequipping while the line is still out → reel it in first, stow once it's home
    if (this.isFishingBusy()) {
      this.fishing = false; // start the reel-in animation
      this.bobberAnchored = false; // release the float so it comes back to the rod
      this.pendingStow = true;
    } else {
      this.setEquipped(false);
    }
  }

  /** Long-press E or left-click: cast the line out / reel it back in. */
  private fishAction(): void {
    if (!this.equipped) return; // need the rod in hand
    const reelingInCatch = this.fishing && this.bobberAnchored; // line was out on the water
    this.fishing = !this.fishing;
    this.bobberAnchored = false; // unpin the float on each cast / reel
    if (this.fishing) {
      this.castT = 0; // play the arm animation only when casting out (not when reeling in)
      this.castThrown = false;
    } else if (reelingInCatch) {
      this.catchFish();
    }
  }

  /** Reeling a line in from the water lands a catch: coins, XP and the odd gem. */
  private catchFish(): void {
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
    const restRate = this.fishing ? 12 : 3; // deploy fast on cast, reel back in slowly
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
      // the first time it touches the water (after a cast), pin it there
      if (this.fishing && !this.bobberAnchored) {
        this.bobberAnchored = true;
        this.bobberAnchor.set(last.pos.x, 0, last.pos.z);
        if (surf < -0.1) this.triggerSplash(last.pos.x, surf, last.pos.z); // cubic splash on water
      }
      last.prev.x = last.pos.x - (last.pos.x - last.prev.x) * 0.5; // damp drift
      last.prev.z = last.pos.z - (last.pos.z - last.prev.z) * 0.5;
    }
    // while anchored, hold the float at its landing spot — only bob with the waves
    if (this.bobberAnchored) {
      last.pos.x = this.bobberAnchor.x;
      last.pos.z = this.bobberAnchor.z;
      last.pos.y = this.support(this.bobberAnchor.x, this.bobberAnchor.z, t);
      last.prev.set(last.pos.x, last.pos.y, last.pos.z);
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
    if (k === 'e' && !e.repeat) {
      this.eHold = 0; // start tracking the press (tap = equip, hold = fish)
      this.eFired = false;
    }
    if (k === 'shift' && !e.repeat) this.startRoll();
    this.keys.add(k);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === 'e' && !this.eFired && this.eHold < 0.4) this.toggleEquip(); // a tap toggles the rod
    this.keys.delete(k);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.fishAction(); // left click → fish
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
    const onIsland = Math.abs(x) <= 6.35 && Math.abs(z) <= 6.35;
    const onDock = Math.abs(x) <= 0.9 && z >= 6.0 && z <= 10.5;
    return onIsland || onDock;
  }

  private groundHeight(x: number, z: number): number {
    if (Math.abs(x) <= 1.0 && z >= 6.0 && z <= 11.0) return 0.09; // wooden dock surface
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

    if (this.keys.has('e')) {
      this.eHold += dt;
      if (!this.eFired && this.eHold >= 0.4 && this.equipped) {
        this.eFired = true;
        this.fishAction(); // long-press E → fish
      }
    }

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
    if (this.pendingStow && !this.isFishingBusy()) {
      this.pendingStow = false;
      this.setEquipped(false); // line fully reeled in → now stow the rod
    }
    this.animateWater(t);
    this.updateSplash(dt);

    // keep the camera centred on the player (same angle, follows them)
    this.camera.position.set(this.character.position.x + 15, 16, this.character.position.z + 15);
    this.controls.target.set(this.character.position.x, 1.2, this.character.position.z);
    this.controls.update();

    // circular reveal: only while an obstacle actually blocks the camera's view of the
    // player, dissolve a soft circle in whatever stands in front of them
    this.camera.updateMatrixWorld();
    this._cc.set(this.character.position.x, this.character.position.y + 1.1, this.character.position.z);
    // 1) is the camera→player line of sight blocked by an obstacle?
    this._cdir.copy(this._cc).sub(this.camera.position);
    const camDist = this._cdir.length();
    this._cdir.normalize();
    this.raycaster.set(this.camera.position, this._cdir);
    this.raycaster.far = camDist - 0.8;
    const occluded = this.raycaster.intersectObjects(this.occluders, true).length > 0;
    this.holeU.strength.value += ((occluded ? 1 : 0) - this.holeU.strength.value) * Math.min(1, dt * 10);
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
    });
  }

  private animateWater(t: number): void {
    if (!this.water || !this.waterBase) return;
    // --- unchanged: per-vertex wave displacement the bobber depends on ---
    const pos = this.water.geometry.attributes['position'] as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const base = this.waterBase;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] = this.waveAt(base[i], base[i + 2], t);
    }
    pos.needsUpdate = true;

    this.waterUniforms.uTime.value = t; // drives the foam + depth animation in the shader
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
