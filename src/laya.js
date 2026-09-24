import { spawn } from 'node:child_process';
import { providerCredentials } from './config.js';

/**
 * Ensure a local laya.serve instance is answering. If nothing responds on the
 * configured host:port, spawn `<layaPython> -m laya.serve` detached (with
 * LAYA_PRELOAD=1 so checkpoints stay resident) and wait for it to come up.
 * Memoized per process so a dead server is only restarted once per run.
 */

let ensuring = null;

async function ping(baseURL) {
  try {
    await fetch(`${baseURL}/v1/models`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ensureLayaServer(cfg) {
  const { baseURL } = providerCredentials(cfg);
  ensuring ??= (async () => {
    if (await ping(baseURL)) return true;
    const host = process.env.LAYA_HOST || cfg.layaHost || '127.0.0.1';
    const port = String(process.env.LAYA_PORT || cfg.layaPort || 8080);
    try {
      const child = spawn(cfg.layaPython || 'python3', ['-m', 'laya.serve'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, LAYA_PRELOAD: '1', LAYA_HOST: host, LAYA_PORT: port },
      });
      child.unref();
    } catch {
      // fall through to the wait loop; the error below explains what to install
    }
    for (let i = 0; i < 40; i++) {
      if (await ping(baseURL)) return true;
      await sleep(1500);
    }
    throw new Error(
      `No laya.serve answering at ${baseURL}, and spawning '${cfg.layaPython || 'python3'} -m laya.serve' did not come up within 60s. ` +
      `Install and run one of:\n` +
      `  pip install 'laya[serve]' && python -m laya.serve   # any platform (torch)\n` +
      `  pip install laya-mlx && python -m laya.serve        # Apple Silicon (MLX)\n` +
      `  pip install laya-coreml && python -m laya.serve     # Apple Silicon (Core ML)\n` +
      `or point layaHost/layaPort (env LAYA_HOST/LAYA_PORT) at a running server.`,
    );
  })();
  return ensuring;
}
