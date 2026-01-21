import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type DeployStrategy = 'pi-ssh' | 'k8s' | 'local-compose';

export interface DeployRequest {
  operatorId: string;
  targetHost?: string;
  targetUser?: string;
  strategy: DeployStrategy;
  imageTag?: string;
  manifestPath?: string;
  genesisBundle?: string;
  reason?: string;
}

const LOG_PATH = process.env.OPERATOR_AUDIT_LOG_PATH || '/var/log/aethercore/operator-deploy.log';
const SSH_KEY = process.env.OPERATOR_SSH_KEY_PATH || '/home/operator/.ssh/id_rsa';
const CODE_RALPHIE_PATH = process.env.CODE_RALPHIE_PATH || '/opt/code-ralphie';
const KUBECONFIG = process.env.OPERATOR_KUBECONFIG || '/etc/kubernetes/admin.conf';
const WHITELIST_K8S_OVERLAY_DIR = path.resolve(process.cwd(), 'infra/k8s/overlays');

async function audit(record: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
  try {
    await fs.appendFile(LOG_PATH, line, { mode: 0o600 });
  } catch (err) {
    console.error('operator audit append failed', err);
  }
}

function sanitizeHost(host: string) {
  if (!/^[a-zA-Z0-9.\-:\[\]]+$/.test(host)) throw new Error('invalid host');
  return host;
}

function runCmd(cmd: string, args: string[], opts = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        reject({ err, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
        return;
      }
      resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
    });
  });
}

export class OperatorService {
  constructor() {}

  async deployCodeRalphie(req: DeployRequest): Promise<{ jobId: string }> {
    const allowed = (process.env.ALLOWED_OPERATOR_IDS || '').split(',').filter(Boolean);
    if (!allowed.includes(req.operatorId)) {
      await audit({ operatorId: req.operatorId, action: 'deploy_attempt', allowed: false, strategy: req.strategy });
      throw new Error('operator not allowed to deploy');
    }

    const jobId = `deploy-${Date.now()}-${randomUUID()}`;
    await audit({ jobId, operatorId: req.operatorId, action: 'deploy_queued', strategy: req.strategy, targetHost: req.targetHost });

    try {
      if (req.strategy === 'pi-ssh') {
        if (!req.targetHost) throw new Error('targetHost required for pi-ssh');
        const host = sanitizeHost(req.targetHost);
        const user = req.targetUser || 'pi';

        await audit({ jobId, step: 'ssh_exec_start', ssh: { host } });

        const sshArgs = [
          '-i', SSH_KEY,
          '-o', 'StrictHostKeyChecking=yes',
          `${user}@${host}`,
          `sudo bash -lc 'cd ${escapePosix(CODE_RALPHIE_PATH)} && ./raspberry-pi/deploy-ralphie.sh'`
        ];

        const { stdout, stderr } = await runCmd('ssh', sshArgs);
        await audit({ jobId, step: 'ssh_exec_done', stdout: stdout.slice(0, 8192), stderr: stderr.slice(0, 8192) });
        return { jobId };
      }

      if (req.strategy === 'k8s') {
        if (!req.manifestPath) throw new Error('manifestPath required for k8s strategy');
        const manifest = path.resolve(process.cwd(), req.manifestPath);
        if (!manifest.startsWith(WHITELIST_K8S_OVERLAY_DIR)) throw new Error('manifest path not allowed');

        await audit({ jobId, step: 'k8s_apply_start', manifest: req.manifestPath });

        const { stdout, stderr } = await runCmd('kubectl', ['--kubeconfig', KUBECONFIG, 'apply', '-f', manifest]);
        await audit({ jobId, step: 'k8s_apply_done', stdout: stdout.slice(0, 8192), stderr: stderr.slice(0, 8192) });
        return { jobId };
      }

      if (req.strategy === 'local-compose') {
        await audit({ jobId, step: 'compose_start' });
        const composeFile = path.resolve(process.cwd(), 'infra/docker/docker-compose.yml');
        const { stdout, stderr } = await runCmd('docker-compose', ['-f', composeFile, 'up', '-d']);
        await audit({ jobId, step: 'compose_done', stdout: stdout.slice(0, 8192), stderr: stderr.slice(0, 8192) });
        return { jobId };
      }

      throw new Error('unknown strategy');
    } catch (e) {
      await audit({ jobId, operatorId: req.operatorId, action: 'deploy_failed', error: (e as any).toString() });
      throw e;
    }
  }
}

function escapePosix(p: string) {
  return p.replace(/'/g, "'\\''");
}

export default OperatorService;
