const lines = [
  'ProjectX local workflow',
  '',
  'Core commands',
  '  pnpm setup   # one-time bootstrap on a machine',
  '  pnpm dev     # run server + client for daily work',
  '  pnpm verify  # default local quality gate before push',
  '',
  'Optional',
  '  pnpm quick   # faster local confidence loop',
  '  pnpm verify:strict # aspirational strict gate (format + full typecheck)',
  '  pnpm guide   # print this command reference',
  '  pnpm typecheck:client:baseline:update # refresh accepted client TS baseline',
  '  pnpm doctor  # environment health checks',
  '  pnpm coverage # coverage reports for server + client',
  '',
  'Database helpers',
  '  pnpm db:up',
  '  pnpm db:migrate',
  '  pnpm db:reset',
  '  pnpm db:seed',
];

process.stdout.write(`${lines.join('\n')}\n`);
