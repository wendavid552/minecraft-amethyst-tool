import * as THREE from 'three';
import { p, parseP, Point, SchematicReader, SchematicWriter } from './litematic';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

const STONE_BUTTON = new THREE.MeshStandardMaterial({ color: '#888' });

const TEXTURES: Record<string, THREE.Material | undefined> = {
  'minecraft:budding_amethyst': new THREE.MeshStandardMaterial({ color: 'purple' }),
  'minecraft:obsidian': new THREE.MeshStandardMaterial({ color: '#120d1d' }),
  'minecraft:slime_block': new THREE.MeshStandardMaterial({ color: '#0f0', opacity: 0.5, transparent: true }),
  'minecraft:calcite': new THREE.MeshStandardMaterial({ color: '#aaa' }),
  'minecraft:smooth_basalt': new THREE.MeshStandardMaterial({ color: '#333' }),
  'minecraft:amethyst_block': new THREE.MeshStandardMaterial({ color: '#bf40bf' }),
  'minecraft:stone_button[face=ceiling,facing=north]': STONE_BUTTON,
  'minecraft:stone_button[face=floor,facing=north]': STONE_BUTTON,
  'minecraft:stone_button[face=wall,facing=north]': STONE_BUTTON,
  'minecraft:stone_button[face=wall,facing=south]': STONE_BUTTON,
  'minecraft:stone_button[face=wall,facing=east]': STONE_BUTTON,
  'minecraft:stone_button[face=wall,facing=west]': STONE_BUTTON,
  'default': new THREE.MeshStandardMaterial({ color: '#777' }),
};

const MODELS: Record<string, THREE.BufferGeometry> = {
  'default': new THREE.BoxGeometry(1, 1, 1),
  'minecraft:stone_button[face=ceiling,facing=north]':
    new THREE.BoxGeometry(6 / 16, 2 / 16, 4 / 16)
      .translate(0, 7 / 16, 0),
  'minecraft:stone_button[face=floor,facing=north]':
    new THREE.BoxGeometry(6 / 16, 2 / 16, 4 / 16)
      .translate(0, -7 / 16, 0),
  'minecraft:stone_button[face=wall,facing=north]':
    new THREE.BoxGeometry(6 / 16, 4 / 16, 2 / 16)
      .translate(0, 0, 7 / 16),
  'minecraft:stone_button[face=wall,facing=south]':
    new THREE.BoxGeometry(6 / 16, 4 / 16, 2 / 16)
      .translate(0, 0, -7 / 16),
  'minecraft:stone_button[face=wall,facing=west]':
    new THREE.BoxGeometry(2 / 16, 4 / 16, 6 / 16)
      .translate(7 / 16, 0, 0),
  'minecraft:stone_button[face=wall,facing=east]':
    new THREE.BoxGeometry(2 / 16, 4 / 16, 6 / 16)
      .translate(-7 / 16, 0, 0),
};

export class Renderer {
  allBlockStates: Record<Point, string | undefined> = {};
  allBlocks: Record<Point, THREE.Mesh | undefined> = {};

  renderRequested = false;
  renderer: THREE.Renderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  directionalLight: THREE.DirectionalLight;
  ambientLight: THREE.AmbientLight;
  pointLight: THREE.PointLight;

  constructor(cssQuery: string) {
    const canvas = document.querySelector(cssQuery) as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas });


    const scene = new THREE.Scene();
    scene.background = new THREE.Color('lightblue');

    this.directionalLight = new THREE.DirectionalLight(0xFFFFFF, 1);
    this.directionalLight.position.set(-1, 2, 4);
    scene.add(this.directionalLight);

    this.ambientLight = new THREE.AmbientLight(0x888888);
    scene.add(this.ambientLight);

    this.pointLight = new THREE.PointLight('#ffb900', 0.2, 0, 2);
    scene.add(this.pointLight);
    this.scene = scene;

    const fov = 75;
    const aspect = 2;  // the canvas default
    const near = 0.1;
    const far = 1000;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);

    const controls = new OrbitControls(this.camera, canvas);
    controls.update();
    controls.minDistance = 1;
    controls.maxDistance = 100;
    // controls.autoRotate = true;
    // controls.autoRotateSpeed = 20;
    this.controls = controls;

    controls.addEventListener('change', () => this.requestRenderIfNotRequested());
    window.addEventListener('resize', () => this.requestRenderIfNotRequested());
    this.render();
  }

  setBlockState(x: number, y: number, z: number, blockState: string) {
    const point = p(x, y, z);
    if (this.allBlockStates[point] !== blockState) {
      this.allBlockStates[point] = blockState;
      this.allBlocks[point] && this.scene.remove(this.allBlocks[point]!);
      this.allBlocks[point] = undefined;
      if (blockState !== 'minecraft:air') {
        const newMesh = new THREE.Mesh(MODELS[blockState] ?? MODELS['default'], TEXTURES[blockState] ?? TEXTURES['default']);
        newMesh.position.set(x, y, z);
        this.allBlocks[point] = newMesh;
        this.scene.add(newMesh);
      }
    }
  }

  getBlockState(x: number, y: number, z: number): string {
    return this.allBlockStates[p(x, y, z)] ?? 'minecraft:air';
  }

  getBlockMesh(x: number, y: number, z: number): THREE.Mesh | undefined {
    return this.allBlocks[p(x, y, z)];
  }

  resizeRendererToDisplaySize() {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      this.renderer.setSize(width, height, false);
    }
    return needResize;
  }

  render() {
    this.renderRequested = false;

    if (this.resizeRendererToDisplaySize()) {
      const canvas = this.renderer.domElement;
      this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
      this.camera.updateProjectionMatrix();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  requestRenderIfNotRequested() {
    if (!this.renderRequested) {
      this.renderRequested = true;
      requestAnimationFrame(() => this.render());
    }
  }

  /**
   * Calls the callback nFrames times with the current frame number,
   * rendering if the callback returns true.
   */
  animate(nFrames: number, framesPerCall: number, cb: (frame: number) => boolean) {
    const that = this;
    let i = 0;
    let frame = 0;
    requestAnimationFrame(function recurse() {
      if (frame % framesPerCall === 0) {
        if (cb(i)) {
          that.requestRenderIfNotRequested();
        }
        i++;
      }
      frame++;

      if (nFrames === -1 || i < nFrames) {
        requestAnimationFrame(recurse);
      }
    });
  }

  toSchematic(): SchematicWriter {
    const writer = new SchematicWriter('schematic', 'russellsprouts');
    for (const point of Object.keys(this.allBlockStates) as Point[]) {
      const [x, y, z] = parseP(point);
      writer.setBlock(x, y, z, this.allBlockStates[point] ?? 'minecraft:air');
    }
    return writer;
  }
}