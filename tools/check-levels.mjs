/**
 * Level self-check: generate every level, print an ASCII maze and verify with
 * BFS that the start can always reach the door. Usage: node tools/check-levels.mjs
 */
import { LEVELS, generateLevel, reachable, FLOOR, WALL, HOLE, VOID } from '../src/levels.js';

const CHAR = { [VOID]: ' ', [FLOOR]: '·', [WALL]: '█', [HOLE]: 'O' };

let ok = true;
for (const cfg of LEVELS) {
  const lv = generateLevel(cfg);
  const { cols, rows, grid, start, door } = lv;
  const can = reachable(grid, cols, rows, start, door);
  if (!can) ok = false;

  // shortest path length (steps) as a difficulty indicator
  const dist = new Int32Array(cols * rows).fill(-1);
  const q = [start.row * cols + start.col];
  dist[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    const c = cur % cols;
    const r = (cur / cols) | 0;
    for (const [nc, nr] of [
      [c - 1, r],
      [c + 1, r],
      [c, r - 1],
      [c, r + 1],
    ]) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (dist[ni] >= 0 || grid[ni] !== FLOOR) continue;
      dist[ni] = dist[cur] + 1;
      q.push(ni);
    }
  }
  const shortest = dist[door.row * cols + door.col];
  const floors = grid.reduce((a, v) => a + (v === FLOOR ? 1 : 0), 0);

  console.log(`\n=== ${cfg.name}  ${cols}x${rows}  floor ${floors}  holes ${lv.holeCells.length}  shortest ${shortest} steps  connected ${can ? '✔' : '✘'} ===`);
  const art = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      if (c === start.col && r === start.row) line += 'S';
      else if (c === door.col && r === door.row) line += 'D';
      else line += CHAR[grid[r * cols + c]];
    }
    art.push(line);
  }
  console.log(art.join('\n'));
  if (shortest < 20) {
    console.log('  ! short route: consider a bigger board or fewer loops');
  }
}

console.log(ok ? '\nAll levels connected ✔' : '\nSome levels are unsolvable ✘');
process.exit(ok ? 0 : 1);
