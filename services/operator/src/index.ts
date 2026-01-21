import OperatorService from './operator-service';
import { createApp } from './http';

export { OperatorService };

if (process.env.RUN_HTTP_SERVER === 'true') {
  const port = parseInt(process.env.OPERATOR_HTTP_PORT || '4001', 10);
  const app = createApp();
  app.listen(port, () => {
    console.log(`Operator HTTP server listening on ${port}`);
  });
}
