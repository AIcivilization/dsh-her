// Sample the body's total CPU (main + GPU + renderer + utility processes)
// once a second for N seconds and print the average and peak, as a share of
// one core. macOS / Linux only (uses ps).
//
//   node scripts/measure-cpu.mjs [seconds=60]
import { execFileSync } from 'node:child_process'

const seconds = Number(process.argv[2] ?? 60)
const match = /dsh-her\/body\/node_modules\/electron\/dist/

function sample() {
  const rows = execFileSync('ps', ['-axo', 'pcpu=,command='], { encoding: 'utf8' }).split('\n')
  return rows.filter(row => match.test(row)).reduce((sum, row) => sum + Number.parseFloat(row.trim().split(/\s+/)[0] ?? '0'), 0)
}

const values = []
for (let i = 0; i < seconds; i++) {
  values.push(sample())
  await new Promise(resolve => setTimeout(resolve, 1000))
}
const average = values.reduce((a, b) => a + b, 0) / values.length
console.log(`body CPU over ${seconds}s: average ${average.toFixed(1)}%, peak ${Math.max(...values).toFixed(1)}% (100% = one core)`)
