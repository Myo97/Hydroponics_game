/**
 * Browser performance harness.
 *
 * Boots the production build in headless Chrome, optionally fills every NFT
 * table, and reports renderer draw calls/triangles for a cached-shadow frame and
 * a full shadow-update frame. Uses only Node's built-in fetch/WebSocket and the
 * Chrome DevTools Protocol; no extra npm dependency is required.
 *
 * Run `npm run measure`. VERDE_SW=1 forces SwiftShader, VERDE_TIMING=1 adds
 * rAF frame-time samples, and VERDE_SCREENSHOT=path.png captures the view.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.VERDE_PORT ?? 4173);
const debugPort = Number(process.env.VERDE_CDP_PORT ?? 9222);
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  join(process.env.LOCALAPPDATA ?? '', 'ms-playwright/chromium-1254/chrome-win64/chrome.exe'),
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chromePath) throw new Error('Chrome/Edge was not found; set CHROME_PATH.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      // Already gone.
    }
  }
}

async function waitFor(url, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return response.json();
    } catch (error) {
      // Server is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForServer(url, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch (error) {
      // Vite is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

console.error('[measure] starting Vite preview');
const userDir = await mkdtemp(join(tmpdir(), 'verde-chrome-'));
const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const preview = spawn(
  process.execPath,
  [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port)],
  { stdio: 'ignore' },
);
await waitForServer(`http://127.0.0.1:${port}/`);
console.error(`[measure] preview ready; launching ${chromePath}`);
const chrome = spawn(
  chromePath,
  [
    ...(process.env.VERDE_HEADFUL ? [] : ['--headless=new']),
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    ...(process.env.VERDE_SW
      ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader-webgl']
      : ['--use-angle=d3d11', '--ignore-gpu-blocklist']),
    '--window-size=1280,720',
    `http://127.0.0.1:${port}/`,
  ],
  { stdio: 'ignore' },
);

let ws;
try {
  const targets = await waitFor(`http://127.0.0.1:${debugPort}/json/list`);
  console.error('[measure] Chrome DevTools endpoint ready');
  const page = targets.find((entry) => entry.type === 'page');
  if (!page) throw new Error('No Chrome page target');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.text ?? 'exception');
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(
        message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '),
      );
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(500);

  const evaluate = async (expression, awaitPromise = true) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'Evaluation failed');
    }
    return result.result.value;
  };

  await evaluate(
    `new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.verdeGame?.running) { clearInterval(timer); resolve(true); }
        if (Date.now() - started > 60000) { clearInterval(timer); resolve(false); }
      }, 250);
    })`,
  );


  const measureTiming = Boolean(process.env.VERDE_TIMING);
  const result = await evaluate(`(async () => {
    const game = window.verdeGame;
    game.player.teleport(0, 0, Math.PI);
    game.player.syncCamera();
    const empty = game.measureRenderStats({ shadow: false });
    const emptyShadow = game.measureRenderStats({ shadow: true });
    // One mature table exercises the full NFT crop layer; filling every gully
    // at this detail level is only needed for the streaming/timing probes.
    {
      const table = game.equipment.tables[0];
      game.plants.transplantTray({
        tableId: table.id,
        cropName: 'Green Coral Lettuce',
        germinated: 320,
        startDay: 14,
      });
    }
    // Grow past the 17-day NFT window so the harvest lighting is on screen.
    for (let day = 2; day <= 19; day += 1) game.plants.advanceDay(day);
    game.equipment.updateCrops(0, game.player.position);
    game.equipment.cropLayer.refresh(true);
    game.player.teleport(0, 0, Math.PI);
    game.player.syncCamera();
    const full = game.measureRenderStats({ shadow: false });
    const fullShadow = game.measureRenderStats({ shadow: true });
    const cachedAfter = game.measureRenderStats({ shadow: false });
    for (const batch of game.staticBatchManager?.batches ?? []) batch.visible = false;
    const withoutBatches = game.measureRenderStats({ shadow: false });
    for (const batch of game.staticBatchManager?.batches ?? []) batch.visible = true;
    for (const entry of game.equipment.cropLayer.batches.values()) entry.mesh.visible = false;
    const withoutCrops = game.measureRenderStats({ shadow: false });
    let noCropTiming = null;
    if (${measureTiming}) {
      noCropTiming = await new Promise((resolve) => {
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          if (frames < 60) {
            requestAnimationFrame(tick);
            return;
          }
          const elapsed = performance.now() - started;
          resolve({ frames, elapsedMs: elapsed, fps: (frames * 1000) / elapsed });
        };
        requestAnimationFrame(tick);
      });
    }
    for (const entry of game.equipment.cropLayer.batches.values()) entry.mesh.visible = true;
    const groupObjects = {};
    for (const [name, object] of Object.entries({
      greenhouse: game.greenhouse?.group,
      nursery: game.nursery?.group,
      equipment: game.equipment?.group,
    })) {
      if (!object) continue;
      const counts = { meshes: 0, instanced: 0, batches: 0, visible: 0, materials: new Set() };
      object.traverse((child) => {
        if (child.isMesh) counts.meshes += 1;
        if (child.isInstancedMesh) counts.instanced += 1;
        if (child.isBatchedMesh) counts.batches += 1;
        if (child.isMesh && child.material && !Array.isArray(child.material)) {
          counts.materials.add(child.material.uuid);
        }
        if (child.isMesh && child.visible) counts.visible += 1;
      });
      counts.materials = counts.materials.size;
      counts.children = object.children.map((child) => {
        let meshes = 0;
        child.traverse((node) => {
          if (node.isMesh) meshes += 1;
        });
        return { name: child.name, meshes };
      });
      groupObjects[name] = counts;
    }
    const groupCalls = {};
    for (const [name, object] of Object.entries({
      greenhouse: game.greenhouse?.group,
      nursery: game.nursery?.group,
      equipment: game.equipment?.group,
      storage: game.storage?.group,
      bluelab: game.bluelab?.group,
      irrigation: game.irrigationPanel?.group,
      weather: game.weatherPanel?.group,
      exterior: game.environment?.exteriorGroup,
    })) {
      if (!object) continue;
      const previous = object.visible;
      object.visible = false;
      const stats = game.measureRenderStats({ shadow: false });
      object.visible = previous;
      groupCalls[name] = cachedAfter.calls - stats.calls;
    }
    let meshes = 0;
    let instanced = 0;
    let batches = 0;
    game.scene.traverse((object) => {
      if (object.isMesh) meshes += 1;
      if (object.isInstancedMesh) instanced += 1;
      if (object.isBatchedMesh) batches += 1;
    });
    for (const entry of game.equipment.cropLayer.tableGroups.values()) {
      entry.transitionElapsed = entry.transitionDuration;
    }
    game.equipment.cropLayer.activeTransitions = false;
    game.renderer.shadowMap.needsUpdate = false;
    let frameTiming = null;
    if (${measureTiming}) {
      frameTiming = await new Promise((resolve) => {
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          if (frames < 120) {
            requestAnimationFrame(tick);
            return;
          }
          const elapsed = performance.now() - started;
          resolve({ frames, elapsedMs: elapsed, fps: (frames * 1000) / elapsed });
        };
        requestAnimationFrame(tick);
      });
    }
    let halfResTiming = null;
    if (${measureTiming}) {
      const originalDpr = game.renderer.getPixelRatio();
      game.renderer.setPixelRatio(0.6);
      halfResTiming = await new Promise((resolve) => {
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          if (frames < 90) {
            requestAnimationFrame(tick);
            return;
          }
          const elapsed = performance.now() - started;
          resolve({ frames, elapsedMs: elapsed, fps: (frames * 1000) / elapsed });
        };
        requestAnimationFrame(tick);
      });
      game.renderer.setPixelRatio(originalDpr);
    }
    const gl = game.renderer.getContext();
    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      gpu: gl.getParameter(gl.RENDERER),
      unmaskedGpu: rendererInfo
        ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
        : null,
      frameTiming,
      halfResTiming,
      noCropTiming,
      empty,
      emptyShadow,
      full,
      fullShadow,
      cachedAfter,
      withoutBatches,
      withoutCrops,
      groupCalls,
      groupObjects,
      meshes,
      instanced,
      batches,
      cropBuckets: game.equipment.cropLayer.batches.size,
      cropBatchDetail: [...game.equipment.cropLayer.batches.values()].map((batch) => ({
        count: batch.items.length,
        detailed: batch.geometry.userData?.lettuce?.detailed,
        tris: batch.geometry.index ? batch.geometry.index.count / 3 : 0,
        name: batch.mesh.name,
      })),
      tableDistances: game.equipment.tables.map((table) => ({
        id: table.id,
        d: Math.hypot(game.player.position.x - table.centerX, game.player.position.z - table.centerZ),
        near: game.equipment.cropLayer.tableGroups.get(table.id)?.lodFull,
      })),
      plants: game.plants.transplantedPlantCount,
      staticBatchStats: game.staticBatchManager?.stats ?? null,
      batchRaycast: (() => {
        const raycaster = game.interaction.raycaster;
        const directions = [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 0, 1],
          [0, 0, -1],
          [0, 1, 0],
        ];
        for (const batch of game.staticBatchManager?.batches ?? []) {
          for (let instanceId = 0; instanceId < batch.instanceCount; instanceId += 1) {
            const box = batch.userData.resolveHighlightBox?.(instanceId);
            if (!box || box.isEmpty()) continue;
            const centre = box.getCenter(game.camera.position.clone());
            for (const [dx, dy, dz] of directions) {
              const origin = centre.clone().addScaledVector(
                game.camera.position.clone().set(dx, dy, dz),
                1.2,
              );
              raycaster.set(origin, centre.clone().sub(origin).normalize());
              const hit = raycaster.intersectObject(batch, false)[0];
              if (hit?.batchId == null) continue;
              const resolved = batch.userData.resolveInteractable?.(hit.batchId)?.id ?? null;
              if (!resolved) continue;
              return {
                batchId: hit.batchId,
                resolved,
                distance: hit.distance,
              };
            }
          }
        }
        return null;
      })(),
      batchMaterials: (() => {
        const counts = {};
        for (const batch of game.staticBatchManager?.batches ?? []) {
          const name = batch.material?.name || 'unnamed';
          counts[name] = (counts[name] ?? 0) + 1;
        }
        return counts;
      })(),
    };
  })()`);

  if (process.env.VERDE_SCREENSHOT) {
    // The still is rendered straight from a forced pose: the headless page never
    // receives the boot click, so the walkthrough loop is not running and would
    // otherwise leave the harvest pool at its zero-fade first frame.
    await evaluate(`(() => {
      const game = window.verdeGame;
      document.getElementById('boot-screen')?.classList.add('is-hidden');
      game.ui.showHud();
      const table = game.equipment.tables[0];
      game.droneView = true;
      game.drone.active = true;
      game.player.setEnabled(false);
      const hideLeaves = ${Boolean(process.env.VERDE_HIDE_LEAVES)};
      game.drone.position.set(
        table.centerX,
        hideLeaves ? 1.0 : 1.3,
        table.startZ + (hideLeaves ? 0.35 : -0.6),
      );
      game.drone.yaw = Math.PI;
      game.drone.pitch = hideLeaves ? -0.36 : -0.42;
      game.drone.syncCamera();
      game.setFov(38);
      if (hideLeaves) {
        for (const entry of game.equipment.cropLayer.batches.values()) entry.mesh.visible = false;
      }
      const fadeAttr = game.equipment.cropLayer.harvestGlow.fadeAttribute;
      if (fadeAttr) {
        fadeAttr.array.fill(1);
        fadeAttr.needsUpdate = true;
      }
      game.renderer.shadowMap.needsUpdate = true;
      game.renderer.render(game.scene, game.droneCamera);
    })()`);
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.VERDE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  console.log(JSON.stringify({ result, consoleErrors }, null, 2));
} finally {
  ws?.close();
  killTree(chrome.pid);
  killTree(preview.pid);
  await sleep(500);
  await rm(userDir, { recursive: true, force: true }).catch(() => {});
}

