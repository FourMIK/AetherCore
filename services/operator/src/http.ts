import express from 'express';
import OperatorService, { DeployRequest } from './operator-service';

const operatorService = new OperatorService();

export function ensureOperatorAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const operatorId = req.header('x-operator-id') || '';
  if (!operatorId) {
    return res.status(401).json({ error: 'missing operator id header' });
  }
  (req as any).operatorId = operatorId;
  next();
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.post('/api/operator/deploy', ensureOperatorAuth, async (req, res) => {
    try {
      const operatorId = (req as any).operatorId as string;
      const body = req.body as Partial<DeployRequest>;
      if (!body || !body.strategy) {
        return res.status(400).json({ error: 'strategy is required' });
      }

      if (body.strategy === 'pi-ssh' && !body.targetHost) {
        return res.status(400).json({ error: 'targetHost required for pi-ssh' });
      }
      if (body.strategy === 'k8s' && !body.manifestPath) {
        return res.status(400).json({ error: 'manifestPath required for k8s' });
      }

      const request: DeployRequest = {
        operatorId,
        strategy: body.strategy as DeployRequest['strategy'],
        targetHost: body.targetHost,
        targetUser: body.targetUser,
        manifestPath: body.manifestPath,
        imageTag: body.imageTag,
        genesisBundle: body.genesisBundle,
        reason: body.reason,
      };

      const { jobId } = await operatorService.deployCodeRalphie(request);
      return res.status(202).json({ jobId });
    } catch (err: any) {
      console.error('deploy handler error', err);
      return res.status(500).json({ error: String(err.message ?? err) });
    }
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}
