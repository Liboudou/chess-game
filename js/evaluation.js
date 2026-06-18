/**
 * evaluation.js — Chess Position Evaluator
 *
 * Evaluates a ChessEngine position and returns a score in centipawns.
 * Positive scores favor White, negative scores favor Black.
 *
 * Score = material score + positional score (piece-square tables)
 *
 * Usage:
 *   const Chess = require('./chess.js');
 *   const evaluate = require('./evaluation.js');
 *   const game = new Chess();
 *   const score = evaluate(game);
 */

// ─── Piece values in centipawns ──────────────────────────────────────────────

const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// ─── Piece-Square Tables (from White's perspective) ──────────────────────────
//
// Board indexing: board[r][c]
//   r=0 = rank 8 (top), r=7 = rank 1 (bottom)
//   c=0 = a-file, c=7 = h-file
//
// PST rows are from rank 8 (top, r=0) to rank 1 (bottom, r=7).
// For white:   use PST[r][c] as-is (white starts at bottom, wants center control)
// For black:   use PST[7-r][7-c] (flip vertically AND horizontally)
//              or PST[7-r][c] (flip vertically only — more common for symmetrical tables)

// Pawn PST — encourages center control and advancement
const PST_PAWN = [
  [  0,  0,  0,  0,  0,  0,  0,  0 ],
  [ 50, 50, 50, 50, 50, 50, 50, 50 ],
  [ 10, 10, 20, 30, 30, 20, 10, 10 ],
  [  5,  5, 10, 25, 25, 10,  5,  5 ],
  [  0,  0,  0, 20, 20,  0,  0,  0 ],
  [  5, -5,-10,  0,  0,-10, -5,  5 ],
  [  5, 10, 10,-20,-20, 10, 10,  5 ],
  [  0,  0,  0,  0,  0,  0,  0,  0 ],
];

// Knight PST — favors center outposts
const PST_KNIGHT = [
  [-50,-40,-30,-30,-30,-30,-40,-50 ],
  [-40,-20,  0,  0,  0,  0,-20,-40 ],
  [-30,  0, 10, 15, 15, 10,  0,-30 ],
  [-30,  5, 15, 20, 20, 15,  5,-30 ],
  [-30,  0, 15, 20, 20, 15,  0,-30 ],
  [-30,  5, 10, 15, 15, 10,  5,-30 ],
  [-40,-20,  0,  5,  5,  0,-20,-40 ],
  [-50,-40,-30,-30,-30,-30,-40,-50 ],
];

// Bishop PST — favors center and long diagonals
const PST_BISHOP = [
  [-20,-10,-10,-10,-10,-10,-10,-20 ],
  [-10,  0,  0,  0,  0,  0,  0,-10 ],
  [-10,  0,  5, 10, 10,  5,  0,-10 ],
  [-10,  5,  5, 10, 10,  5,  5,-10 ],
  [-10,  0, 10, 10, 10, 10,  0,-10 ],
  [-10, 10, 10, 10, 10, 10, 10,-10 ],
  [-10,  5,  0,  0,  0,  0,  5,-10 ],
  [-20,-10,-10,-10,-10,-10,-10,-20 ],
];

// Rook PST — favors center files and 7th rank
const PST_ROOK = [
  [  0,  0,  0,  0,  0,  0,  0,  0 ],
  [  5, 10, 10, 10, 10, 10, 10,  5 ],
  [ -5,  0,  0,  0,  0,  0,  0, -5 ],
  [ -5,  0,  0,  0,  0,  0,  0, -5 ],
  [ -5,  0,  0,  0,  0,  0,  0, -5 ],
  [ -5,  0,  0,  0,  0,  0,  0, -5 ],
  [ -5,  0,  0,  0,  0,  0,  0, -5 ],
  [  0,  0,  0,  5,  5,  0,  0,  0 ],
];

// Queen PST — slight center preference
const PST_QUEEN = [
  [-20,-10,-10, -5, -5,-10,-10,-20 ],
  [-10,  0,  0,  0,  0,  0,  0,-10 ],
  [-10,  0,  5,  5,  5,  5,  0,-10 ],
  [ -5,  0,  5,  5,  5,  5,  0, -5 ],
  [  0,  0,  5,  5,  5,  5,  0, -5 ],
  [-10,  5,  5,  5,  5,  5,  0,-10 ],
  [-10,  0,  5,  0,  0,  0,  0,-10 ],
  [-20,-10,-10, -5, -5,-10,-10,-20 ],
];

// King PST — encourages castling (middlegame)
const PST_KING_MIDDLE = [
  [-30,-40,-40,-50,-50,-40,-40,-30 ],
  [-30,-40,-40,-50,-50,-40,-40,-30 ],
  [-30,-40,-40,-50,-50,-40,-40,-30 ],
  [-30,-40,-40,-50,-50,-40,-40,-30 ],
  [-20,-30,-30,-40,-40,-30,-30,-20 ],
  [-10,-20,-20,-20,-20,-20,-20,-10 ],
  [ 20, 20,  0,  0,  0,  0, 20, 20 ],
  [ 20, 30, 10,  0,  0, 10, 30, 20 ],
];

// King PST — endgame (king becomes active, moves toward center)
const PST_KING_END = [
  [-50,-40,-30,-20,-20,-30,-40,-50 ],
  [-30,-20,-10,  0,  0,-10,-20,-30 ],
  [-30,-10, 20, 30, 30, 20,-10,-30 ],
  [-30,-10, 30, 40, 40, 30,-10,-30 ],
  [-30,-10, 30, 40, 40, 30,-10,-30 ],
  [-30,-10, 20, 30, 30, 20,-10,-30 ],
  [-30,-30,  0,  0,  0,  0,-30,-30 ],
  [-50,-30,-30,-30,-30,-30,-30,-50 ],
];

// Map piece char → PST
const PST_MAP = {
  P: PST_PAWN,
  N: PST_KNIGHT,
  B: PST_BISHOP,
  R: PST_ROOK,
  Q: PST_QUEEN,
  K: PST_KING_MIDDLE,
};

// ─── Material counting helpers ───────────────────────────────────────────────

/**
 * Count total non-pawn material on the board for a given color.
 * Returns sum of piece values (excluding pawns and kings).
 */
function countNonPawnMaterial(board, color) {
  let total = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === '.') continue;
      const pColor = (p === p.toUpperCase()) ? 'w' : 'b';
      if (pColor !== color) continue;
      const type = p.toUpperCase();
      if (type !== 'P' && type !== 'K') {
        total += PIECE_VALUES[type];
      }
    }
  }
  return total;
}

// ─── Main evaluation function ────────────────────────────────────────────────

/**
 * Evaluate a ChessEngine position.
 *
 * @param {object} game — Instance of Chess class
 * @returns {number} Score in centipawns (positive = white advantage)
 */
function evaluate(game) {
  const board = game.board;
  let materialScore = 0;
  let positionalScore = 0;

  // Determine game phase for king PST selection
  const totalNonPawnMaterial = countNonPawnMaterial(board, 'w') + countNonPawnMaterial(board, 'b');
  const isEndgame = totalNonPawnMaterial <= 2600; // approx rook + minor piece each

  const kingPst = isEndgame ? PST_KING_END : PST_KING_MIDDLE;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece === '.') continue;

      const color = (piece === piece.toUpperCase()) ? 'w' : 'b';
      const type = piece.toUpperCase();
      const sign = (color === 'w') ? 1 : -1;
      const pst = (type === 'K') ? kingPst : PST_MAP[type];

      // Material score
      materialScore += sign * (PIECE_VALUES[type] || 0);

      // Positional score
      if (pst) {
        // For white: use PST[r][c] as-is
        // For black: mirror vertically (7-r) since black pieces start at top
        const pstRow = (color === 'w') ? r : (7 - r);
        const pstCol = c; // horizontal flips are less common; keep natural
        positionalScore += sign * pst[pstRow][pstCol];
      }
    }
  }

  return materialScore + positionalScore;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = evaluate;
}
if (typeof window !== 'undefined') {
  window.evaluate = evaluate;
}