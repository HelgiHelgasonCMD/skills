#!/usr/bin/env node
// Stand-in for `claude -p`: "upper x y" upper-cases those single-letter lines inside the region.
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const region = input.split('<<<REGION\n')[1].split('\nREGION>>>')[0];
  const request = input.split('Request: ')[1].trim();
  if (request === 'fail') {
    process.stdout.write(JSON.stringify({ is_error: true, result: 'Not logged in' }));
    process.exit(1);
  }
  const targets = request.replace(/^upper /, '').split(' ');
  const replacement = region.split('\n').map((l) => (targets.includes(l) ? l.toUpperCase() : l)).join('\n');
  process.stdout.write(JSON.stringify({ is_error: false, structured_output: { summary: `upper-cased ${targets.join(', ')}`, replacement } }));
});
