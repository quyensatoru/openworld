#!/usr/bin/env node
// Stands in for wrangler in scripts/deploy-test.mjs: `deployments list --json` and `deploy`.
//   FAKE_DEPLOY=fail → the deploy itself fails · FAKE_LIST=fail → no deployment list
const args = process.argv.slice(2).join(' ');
if (args.startsWith('deployments list')) {
  if (process.env.FAKE_LIST === 'fail') {
    console.error('✘ [ERROR] Not logged in.');
    process.exit(1);
  }
  console.log(JSON.stringify([
    { id: 'd-old', created_on: '2026-11-01T10:00:00Z', versions: [{ version_id: 'aaaaaaaa-0000-0000-0000-000000000001', percentage: 100 }] },
    { id: 'd-cur', created_on: '2026-11-12T10:00:00Z', versions: [{ version_id: 'bbbbbbbb-0000-0000-0000-000000000002', percentage: 100 }] },
  ]));
  process.exit(0);
}
if (args === 'deploy') {
  if (process.env.FAKE_DEPLOY === 'fail') {
    console.error('✘ [ERROR] A request to the Cloudflare API failed.');
    process.exit(1);
  }
  console.log('Uploaded office (3.2 sec)\nDeployed office triggers (0.4 sec)\n  https://office.fake.invalid\nCurrent Version ID: cccccccc-0000-0000-0000-000000000003');
  process.exit(0);
}
console.error(`fake wrangler: unknown command ${args}`);
process.exit(2);
