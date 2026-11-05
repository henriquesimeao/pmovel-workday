// Lista o nome de todos os funcionários via REST (common/v1/workers).
import { paginate } from './workday-rest.js';

const names = [];
const example = [];
for await (const worker of paginate('common/v1/{tenant}/workers')) {
  names.push(worker.descriptor);
  if (example.length < 2) {
    example.push(worker);
  }
}

names.sort((a, b) => a.localeCompare(b, 'pt-BR'));
names.forEach((name, i) => console.log(`${String(i + 1).padStart(3)}. ${name}`));
console.log(`\nTotal: ${names.length}`);
console.log(`\nExample: ${JSON.stringify(example)}`);
