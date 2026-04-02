import { execSync } from 'child_process';

describe('existing test suite', () => {
  it('unit tests pass', () => {
    execSync('npx jest tests/unit/', { encoding: 'utf8', stdio: 'inherit' });
  });

  it('integration tests pass', () => {
    execSync('npx jest tests/integration/', { encoding: 'utf8', stdio: 'inherit' });
  });
});