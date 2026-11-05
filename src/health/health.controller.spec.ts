import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('retorna status ok com timestamp ISO', () => {
    const controller = new HealthController();
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
