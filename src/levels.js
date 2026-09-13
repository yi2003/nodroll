/**
 * Level data + maze generation.
 * A recursive backtracker carves a perfect maze on odd cells (so start and door
 * are always connected), extra walls are knocked out to create loops, and holes
 * are only punched where a BFS check still finds a route to the door.
 */

export const LEVELS = [
    {
    // Hand-authored 20 s tutorial. Two long lanes end in a wall (roll in fast,
    // feel the bounce, then steer into the side opening), then a pit cluster you
    // have to hug the bottom edge to survive.
    name: '01 · First Tilt',
    cols: 13,
    rows: 15,
    wallH: 0.62,
    seed: 1337,
    par: 20,
    art: [
      '#############', //  0
      '#S.........##', //  1  start, long lane -> wall at col 11
      '##########.##', //  2  turn down at col 10
      '##########.##', //  3
      '##########.##', //  4
      '##########.##', //  5
      '##########.##', //  6
      '#..........##', //  7  long lane back -> wall at col 0
      '#.###########', //  8  turn down at col 1
      '#.###########', //  9
      '#.###########', // 10
      '#.###########', // 11
      '#....OOO...##', // 12  pit cluster: hug row 13
      '#..........D#', // 13  green door at col 11
      '#############', // 14
    ],
    hints: [
      { col: 6.0, row: 1.6, text: 'roll in — the wall bounces you' },
      { col: 6.0, row: 12.6, text: 'steer around the pits' },
      { col: 10.9, row: 14.0, text: 'green door = clear' },
    ],
  },
  { name: '02 · Corridors', cols: 13, rows: 15, knock: 0.14, holes: 2, wallH: 0.62, seed: 20240, par: 30 },
  { name: '03 · Pitfalls', cols: 15, rows: 15, knock: 0.16, holes: 4, wallH: 0.6, seed: 777, par: 36 },
  { name: '04 · Honeycomb', cols: 15, rows: 17, knock: 0.20, holes: 6, wallH: 0.6, seed: 90210, par: 44 },
  { name: '05 · Abyss', cols: 17, rows: 19, knock: 0.22, holes: 9, wallH: 0.58, seed: 4242, par: 52 },
];

export const CELL = 1.6;
export const FLOOR_T = 0.7; // board thickness
export const BALL_R = 0.42;

export const VOID = 0;
export const FLOOR = 1;
export const WALL = 2;
export const HOLE = 3;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a level from a hand-authored ASCII map */
function fromArt(cfg) {
  const art = cfg.art;
  const rows = art.length;
  const cols = Math.max(...art.map((r) => r.length));
  const idx = (c, r) => r * cols + c;
  const grid = new Uint8Array(cols * rows).fill(WALL);
  const holeCells = [];
  let start = { col: 1, row: 1 };
  let door = { col: cols - 2, row: rows - 2 };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = art[r][c] ?? ' ';
      const i = idx(c, r);
      if (ch === '#') grid[i] = WALL;
      else if (ch === 'O') {
        grid[i] = HOLE;
        holeCells.push({ col: c, row: r });
      } else {
        grid[i] = FLOOR;
        if (ch === 'S') start = { col: c, row: r };
        else if (ch === 'D') door = { col: c, row: r };
      }
    }
  }
  return { cfg, cols, rows, grid, start, door, holeCells, idx, authored: true };
}

/** Generate the grid data for one level */
export function generateLevel(cfg) {
  if (cfg.art) return fromArt(cfg);
  const { cols, rows } = cfg;
  const rnd = mulberry32(cfg.seed);
  const idx = (c, r) => r * cols + c;
  const grid = new Uint8Array(cols * rows).fill(WALL);

  // --- 1. recursive backtracker: carve between odd-coordinate "rooms" ---
  const stack = [[1, 1]];
  grid[idx(1, 1)] = FLOOR;
  const dirs = [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ];
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const order = dirs.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    let moved = false;
    for (const [dc, dr] of order) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc > 0 && nc < cols - 1 && nr > 0 && nr < rows - 1 && grid[idx(nc, nr)] === WALL) {
        grid[idx(c + dc / 2, r + dr / 2)] = FLOOR;
        grid[idx(nc, nr)] = FLOOR;
        stack.push([nc, nr]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }

  // --- 2. knock out extra walls to create loops (more routes, more fun) ---
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[idx(c, r)] !== WALL) continue;
      if (rnd() > cfg.knock) continue;
      const horiz = grid[idx(c - 1, r)] === FLOOR && grid[idx(c + 1, r)] === FLOOR;
      const vert = grid[idx(c, r - 1)] === FLOOR && grid[idx(c, r + 1)] === FLOOR;
      if (horiz || vert) grid[idx(c, r)] = FLOOR;
    }
  }

  const start = { col: 1, row: 1 };
  // put the door in one of the farthest rooms so the route stays long
  const door = pickDoor(grid, cols, rows, start, rnd);

  // --- 3. punch holes, but only where connectivity survives ---
  const holeCells = [];
  if (cfg.holes > 0) {
    const cand = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (grid[idx(c, r)] !== FLOOR) continue;
        if (Math.abs(c - start.col) + Math.abs(r - start.row) < 4) continue;
        if (c === door.col && r === door.row) continue;
        // require >= 2 open neighbours so a corridor is never sealed off
        const openN = [
          grid[idx(c - 1, r)],
          grid[idx(c + 1, r)],
          grid[idx(c, r - 1)],
          grid[idx(c, r + 1)],
        ].filter((v) => v === FLOOR).length;
        if (openN >= 2) cand.push({ col: c, row: r });
      }
    }
    // shuffle
    for (let i = cand.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    for (const cell of cand) {
      if (holeCells.length >= cfg.holes) break;
      grid[idx(cell.col, cell.row)] = HOLE;
      if (!reachable(grid, cols, rows, start, door)) {
        grid[idx(cell.col, cell.row)] = FLOOR; // would cut the route: revert
      } else {
        holeCells.push(cell);
      }
    }
  }

  return { cfg, cols, rows, grid, start, door, holeCells, idx };
}

/** Pick the farthest room from the start as the door */
function pickDoor(grid, cols, rows, start, rnd) {
  const best = [];
  let maxD = -1;
  for (let r = 1; r < rows - 1; r += 2) {
    for (let c = 1; c < cols - 1; c += 2) {
      if (grid[r * cols + c] !== FLOOR) continue;
      const d = Math.abs(c - start.col) + Math.abs(r - start.row);
      if (d > maxD) {
        maxD = d;
        best.length = 0;
        best.push({ col: c, row: r });
      } else if (d === maxD) {
        best.push({ col: c, row: r });
      }
    }
  }
  return best.length ? best[(rnd() * best.length) | 0] : { col: cols - 2, row: rows - 2 };
}

/** BFS connectivity check */
export function reachable(grid, cols, rows, start, door) {
  const seen = new Uint8Array(cols * rows);
  const q = [start.row * cols + start.col];
  seen[q[0]] = 1;
  const goal = door.row * cols + door.col;
  while (q.length) {
    const cur = q.shift();
    if (cur === goal) return true;
    const c = cur % cols;
    const r = (cur / cols) | 0;
    const nb = [
      [c - 1, r],
      [c + 1, r],
      [c, r - 1],
      [c, r + 1],
    ];
    for (const [nc, nr] of nb) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (seen[ni]) continue;
      const v = grid[ni];
      if (v === FLOOR) {
        seen[ni] = 1;
        q.push(ni);
      }
    }
  }
  return false;
}
