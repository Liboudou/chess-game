/**
 * chess.js — Complete Chess Engine
 *
 * Board representation: 8x8 array, board[row][col]
 *   row 0 = rank 8 (black's back rank), row 7 = rank 1 (white's back rank)
 *   col 0 = a-file, col 7 = h-file
 *
 * Pieces: uppercase = white (K Q R B N P), lowercase = black (k q r b n p)
 *   . = empty square
 *
 * Move object: { from, to, promotion, flags }
 *   from/to: algebraic squares e.g. "e2", "e4"
 *   promotion: piece char for promotion moves (q/r/b/n)
 *   flags: 'n' normal | 'c' capture | 'k' kingside castle | 'q' queenside castle
 *          | 'e' en passant | 'p' promotion | 'pc' promotion+capture
 *
 * FEN format: standard Forsyth–Edwards Notation
 *
 * External API (properties): game.turn, game.board, game.enPassant
 * External API (methods):    game.getLegalMoves(), game.getMovesFrom(sq),
 *                            game.makeMove(move), game.undo(),
 *                            game.isCheck(), game.isCheckmate(), game.isStalemate(),
 *                            game.isDraw(), game.isGameOver(), game.fen(),
 *                            game.load(fen), game.canCastleKingside(), etc.
 */

class Chess {
  // ─── Constructor & Initialization ────────────────────────────────────────

  constructor(fen) {
    this._board = Array(8).fill(null).map(() => Array(8).fill('.'));
    this._turn = 'w';
    this._castling = { K: false, Q: false, k: false, q: false };
    this._enPassant = null;
    this._halfMoveClock = 0;
    this._fullMoveNumber = 1;
    this._history = [];
    this._moveCount = 0;

    if (fen) {
      this.load(fen);
    } else {
      this.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    }
  }

  // ─── Getters (external API) ──────────────────────────────────────────────

  /** Which side to move: 'w' or 'b'. */
  get turn() { return this._turn; }

  /** Get a flat copy of the board. */
  get board() { return this._board.map(row => [...row]); }

  /** Current en passant target square, or null. */
  get enPassant() { return this._enPassant; }

  // ─── FEN ─────────────────────────────────────────────────────────────────

  /**
   * Load a position from FEN string.
   */
  load(fen) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) {
      throw new Error(`Invalid FEN: "${fen}" — need at least 4 parts`);
    }

    // --- Board position ---
    const rows = parts[0].split('/');
    if (rows.length !== 8) {
      throw new Error(`Invalid FEN: expected 8 ranks, got ${rows.length}`);
    }

    this._board = Array(8).fill(null).map(() => Array(8).fill('.'));
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') {
          c += parseInt(ch, 10);
        } else if ('KQRBNPkqrbnp'.includes(ch)) {
          this._board[r][c++] = ch;
        } else {
          throw new Error(`Invalid FEN: unexpected char "${ch}" in rank ${r + 1}`);
        }
      }
      if (c !== 8) {
        throw new Error(`Invalid FEN: rank ${r + 1} has ${c} files, expected 8`);
      }
    }

    // --- Active color ---
    if (parts[1] !== 'w' && parts[1] !== 'b') {
      throw new Error(`Invalid FEN: active color must be 'w' or 'b', got "${parts[1]}"`);
    }
    this._turn = parts[1];

    // --- Castling rights ---
    this._castling = { K: false, Q: false, k: false, q: false };
    if (parts[2] !== '-') {
      for (const ch of parts[2]) {
        if (ch === 'K') this._castling.K = true;
        else if (ch === 'Q') this._castling.Q = true;
        else if (ch === 'k') this._castling.k = true;
        else if (ch === 'q') this._castling.q = true;
      }
    }

    // --- En passant target ---
    this._enPassant = (parts[3] !== '-') ? parts[3] : null;

    // --- Halfmove clock ---
    this._halfMoveClock = parts.length > 4 ? parseInt(parts[4], 10) : 0;

    // --- Fullmove number ---
    this._fullMoveNumber = parts.length > 5 ? parseInt(parts[5], 10) : 1;

    // Reset history & move count
    this._history = [];
    this._moveCount = 0;
  }

  /**
   * Export current position as FEN string.
   */
  fen() {
    // --- Board ---
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this._board[r][c];
        if (p === '.') {
          empty++;
        } else {
          if (empty > 0) { row += empty; empty = 0; }
          row += p;
        }
      }
      if (empty > 0) row += empty;
      rows.push(row);
    }

    // --- Castling ---
    let castlingStr = '';
    if (this._castling.K) castlingStr += 'K';
    if (this._castling.Q) castlingStr += 'Q';
    if (this._castling.k) castlingStr += 'k';
    if (this._castling.q) castlingStr += 'q';
    if (castlingStr === '') castlingStr = '-';

    // --- En passant ---
    const epStr = this._enPassant || '-';

    return `${rows.join('/')} ${this._turn} ${castlingStr} ${epStr} ${this._halfMoveClock} ${this._fullMoveNumber}`;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Returns true if the given square is occupied by a piece of the given color.
   */
  _isPieceAt(sq, color) {
    const { r, c } = this._sqToRC(sq);
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    const p = this._board[r][c];
    if (p === '.') return false;
    return color === 'w' ? (p === p.toUpperCase()) : (p === p.toLowerCase());
  }

  /**
   * Returns true if it's legal for the current side to castle kingside.
   */
  canCastleKingside() {
    const key = this._turn === 'w' ? 'K' : 'k';
    return this._castling[key];
  }

  /**
   * Returns true if it's legal for the current side to castle queenside.
   */
  canCastleQueenside() {
    const key = this._turn === 'w' ? 'Q' : 'q';
    return this._castling[key];
  }

  /**
   * Get all legal moves for the current side.
   * Returns array of move objects.
   */
  getLegalMoves() {
    const pseudo = this._generatePseudoLegalMoves();
    return pseudo.filter(move => this._isLegalMove(move));
  }

  /**
   * Get legal moves from a specific square.
   */
  getMovesFrom(sq) {
    return this.getLegalMoves().filter(m => m.from === sq);
  }

  /**
   * Make a move.
   * Accepts either a move object or a UCI string ("e2e4", "e7e8q").
   * Returns the move object that was made, or null if the move was illegal.
   */
  makeMove(move) {
    if (typeof move === 'string') {
      move = this._parseUci(move);
    }
    if (!move) return null;

    const legalMoves = this.getLegalMoves();
    const found = legalMoves.find(m =>
      m.from === move.from && m.to === move.to &&
      (m.promotion || '') === (move.promotion || '')
    );
    if (!found) return null;

    // Save state for undo
    this._history.push({
      board: this._board.map(row => [...row]),
      turn: this._turn,
      castling: { ...this._castling },
      enPassant: this._enPassant,
      halfMoveClock: this._halfMoveClock,
      fullMoveNumber: this._fullMoveNumber,
      move: found
    });

    this._applyMove(found);

    // Switch turn
    this._turn = this._turn === 'w' ? 'b' : 'w';

    // Fullmove counter advances after black's move
    if (this._turn === 'w') {
      this._fullMoveNumber++;
    }

    this._moveCount++;

    return found;
  }

  /**
   * Apply a move to the board state (no legality check, no history).
   * Updates board, castling rights, en passant, halfmove clock.
   */
  _applyMove(move) {
    const from = this._sqToRC(move.from);
    const to = this._sqToRC(move.to);
    const piece = this._board[from.r][from.c];
    const captured = this._board[to.r][to.c];

    // Normal move
    this._board[to.r][to.c] = piece;
    this._board[from.r][from.c] = '.';

    // Promotion
    if (move.flags.includes('p')) {
      this._board[to.r][to.c] = move.promotion;
    }

    // En passant capture: remove the captured pawn
    if (move.flags.includes('e')) {
      const epR = (this._turn === 'w') ? to.r + 1 : to.r - 1;
      this._board[epR][to.c] = '.';
    }

    // Castling: move the rook
    if (move.flags.includes('k')) {
      const rank = move.from[1]; // same rank
      this._board[this._rankToRow(rank)][7] = '.';
      this._board[this._rankToRow(rank)][5] = (this._turn === 'w' ? 'R' : 'r');
    }
    if (move.flags.includes('q')) {
      const rank = move.from[1];
      this._board[this._rankToRow(rank)][0] = '.';
      this._board[this._rankToRow(rank)][3] = (this._turn === 'w' ? 'R' : 'r');
    }

    // Update en passant target
    this._enPassant = null;
    if (piece.toUpperCase() === 'P' && Math.abs(to.r - from.r) === 2) {
      // Double pawn push sets en passant target
      this._enPassant = this._rcToSq((from.r + to.r) / 2, from.c);
    }

    // Update halfmove clock
    const isCapture = move.flags.includes('c') || move.flags.includes('e') || captured !== '.';
    const isPawnMove = piece.toUpperCase() === 'P';
    if (isCapture || isPawnMove) {
      this._halfMoveClock = 0;
    } else {
      this._halfMoveClock++;
    }

    // Update castling rights
    this._updateCastlingRights(piece, move.from, move.to);
    if (captured !== '.') {
      if (captured === 'R') {
        if (move.to === 'h1') this._castling.K = false;
        if (move.to === 'a1') this._castling.Q = false;
      } else if (captured === 'r') {
        if (move.to === 'h8') this._castling.k = false;
        if (move.to === 'a8') this._castling.q = false;
      }
    }
  }

  /**
   * Undo the last move.
   * Returns the undone move object, or null if no moves to undo.
   */
  undo() {
    if (this._history.length === 0) return null;

    const state = this._history.pop();
    this._board = state.board;
    this._turn = state.turn;
    this._castling = state.castling;
    this._enPassant = state.enPassant;
    this._halfMoveClock = state.halfMoveClock;
    this._fullMoveNumber = state.fullMoveNumber;
    this._moveCount--;

    return state.move || null;
  }

  /**
   * Get a nice ASCII representation of the board.
   */
  ascii() {
    const lines = [];
    for (let r = 0; r < 8; r++) {
      const rank = 8 - r;
      const pieces = this._board[r].map(p => p === '.' ? '.' : p).join(' ');
      lines.push(`${rank}  ${pieces}`);
    }
    lines.push('    a b c d e f g h');
    return lines.join('\n');
  }

  /**
   * Print board to console.
   */
  print() {
    console.log(this.ascii());
    console.log(`Turn: ${this._turn === 'w' ? 'White' : 'Black'}`);
    console.log(`FEN: ${this.fen()}`);
  }

  // ─── Status Checks ────────────────────────────────────────────────────────

  /**
   * Is the current side's king in check?
   */
  isCheck() {
    return this._isKingInCheck(this._turn);
  }

  /**
   * Is the current side in checkmate?
   */
  isCheckmate() {
    return this.isCheck() && this.getLegalMoves().length === 0;
  }

  /**
   * Is the current side in stalemate?
   */
  isStalemate() {
    return !this.isCheck() && this.getLegalMoves().length === 0;
  }

  /**
   * Is the game a draw due to insufficient material?
   */
  isInsufficientMaterial() {
    const pieces = {};
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this._board[r][c];
        if (p !== '.') {
          pieces[p] = (pieces[p] || 0) + 1;
        }
      }
    }

    const totalNonKings = Object.entries(pieces)
      .filter(([k]) => k !== 'K' && k !== 'k')
      .reduce((sum, [, v]) => sum + v, 0);

    if (totalNonKings === 0) return true; // King vs king

    // King + minor piece vs king
    if (totalNonKings === 1) {
      const hasBishop = (pieces.B || 0) === 1 || (pieces.b || 0) === 1;
      const hasKnight = (pieces.N || 0) === 1 || (pieces.n || 0) === 1;
      if (hasBishop || hasKnight) return true;
    }

    // King + bishop vs king + bishop with same-colored bishops
    if (totalNonKings === 2 && (pieces.B || 0) === 1 && (pieces.b || 0) === 1) {
      let wBishopSq = null, bBishopSq = null;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (this._board[r][c] === 'B') wBishopSq = { r, c };
          if (this._board[r][c] === 'b') bBishopSq = { r, c };
        }
      }
      if (wBishopSq && bBishopSq) {
        const wColor = (wBishopSq.r + wBishopSq.c) % 2;
        const bColor = (bBishopSq.r + bBishopSq.c) % 2;
        if (wColor === bColor) return true;
      }
    }

    return false;
  }

  /**
   * Is a draw by the 50-move rule?
   */
  isFiftyMoveDraw() {
    return this._halfMoveClock >= 100;
  }

  /**
   * Is the game a draw (any draw condition)?
   */
  isDraw() {
    if (this.isStalemate()) return true;
    if (this.isInsufficientMaterial()) return true;
    if (this.isFiftyMoveDraw()) return true;
    return false;
  }

  /**
   * Is the game over?
   */
  isGameOver() {
    return this.isCheckmate() || this.isDraw();
  }

  // ─── Coordinate Helpers ───────────────────────────────────────────────────

  /**
   * Convert a square like "e4" to { r, c }.
   * row 0 = rank 8, row 7 = rank 1.
   */
  _sqToRC(sq) {
    if (!/^[a-h][1-8]$/.test(sq)) {
      return { r: -1, c: -1 };
    }
    return {
      c: sq.charCodeAt(0) - 97,     // 'a' → 0
      r: 8 - parseInt(sq[1], 10)     // '1' → 7, '8' → 0
    };
  }

  /**
   * Convert { r, c } to algebraic square.
   */
  _rcToSq(r, c) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    return String.fromCharCode(97 + c) + (8 - r);
  }

  /**
   * Convert a rank character ('1'-'8') to row index (7-0).
   */
  _rankToRow(rank) {
    return 8 - parseInt(rank, 10);
  }

  /**
   * Color of piece: 'w', 'b', or null for empty.
   */
  _colorOf(piece) {
    if (piece === '.') return null;
    return piece === piece.toUpperCase() ? 'w' : 'b';
  }

  // ─── Pseudo-legal Move Generation ─────────────────────────────────────────

  /**
   * Generate pseudo-legal moves (may leave king in check).
   */
  _generatePseudoLegalMoves() {
    const moves = [];
    const color = this._turn;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this._board[r][c];
        if (piece === '.' || this._colorOf(piece) !== color) continue;

        const sq = this._rcToSq(r, c);
        const type = piece.toUpperCase();

        switch (type) {
          case 'P': this._pawnMoves(r, c, color, moves); break;
          case 'N': this._knightMoves(r, c, color, moves); break;
          case 'B': this._slideMoves(r, c, color, moves, [[-1,-1],[-1,1],[1,-1],[1,1]]); break;
          case 'R': this._slideMoves(r, c, color, moves, [[-1,0],[1,0],[0,-1],[0,1]]); break;
          case 'Q': this._slideMoves(r, c, color, moves, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]); break;
          case 'K': this._kingMoves(r, c, color, moves); break;
        }
      }
    }

    return moves;
  }

  /**
   * Generate pawn moves from (r, c) for the given color.
   */
  _pawnMoves(r, c, color, moves) {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    const promoRow = color === 'w' ? 0 : 7;
    const opp = color === 'w' ? 'b' : 'w';
    const sq = this._rcToSq(r, c);

    // Forward one square
    const fwdR = r + dir;
    if (fwdR >= 0 && fwdR <= 7 && this._board[fwdR][c] === '.') {
      const toSq = this._rcToSq(fwdR, c);

      if (fwdR === promoRow) {
        const promos = color === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
        for (const promo of promos) {
          moves.push({ from: sq, to: toSq, promotion: promo, flags: 'p' });
        }
      } else {
        moves.push({ from: sq, to: toSq, flags: 'n' });
      }

      // Forward two squares (from starting position only)
      if (r === startRow) {
        const fwd2R = r + 2 * dir;
        if (this._board[fwd2R][c] === '.') {
          const toSq2 = this._rcToSq(fwd2R, c);
          moves.push({ from: sq, to: toSq2, flags: 'n' });
        }
      }
    }

    // Captures (diagonal)
    for (const dc of [-1, 1]) {
      const captC = c + dc;
      if (captC < 0 || captC > 7) continue;
      const captR = r + dir;
      if (captR < 0 || captR > 7) continue;

      const target = this._board[captR][captC];
      if (target !== '.' && this._colorOf(target) === opp) {
        const toSq = this._rcToSq(captR, captC);
        if (captR === promoRow) {
          const promos = color === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
          for (const promo of promos) {
            moves.push({ from: sq, to: toSq, promotion: promo, flags: 'pc' });
          }
        } else {
          moves.push({ from: sq, to: toSq, flags: 'c' });
        }
      }

      // En passant
      if (this._enPassant) {
        const ep = this._sqToRC(this._enPassant);
        if (ep.r === captR && ep.c === captC) {
          moves.push({ from: sq, to: this._enPassant, flags: 'e' });
        }
      }
    }
  }

  /**
   * Generate knight moves from (r, c).
   */
  _knightMoves(r, c, color, moves) {
    const sq = this._rcToSq(r, c);
    const offsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

    for (const [dr, dc] of offsets) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;

      const target = this._board[nr][nc];
      if (target !== '.' && this._colorOf(target) === color) continue;

      const toSq = this._rcToSq(nr, nc);
      const flags = (target !== '.') ? 'c' : 'n';
      moves.push({ from: sq, to: toSq, flags });
    }
  }

  /**
   * Generate sliding piece moves along the given direction vectors.
   */
  _slideMoves(r, c, color, moves, directions) {
    const sq = this._rcToSq(r, c);

    for (const [dr, dc] of directions) {
      let nr = r + dr, nc = c + dc;
      while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const target = this._board[nr][nc];
        if (target !== '.' && this._colorOf(target) === color) break;

        const toSq = this._rcToSq(nr, nc);
        const flags = (target !== '.') ? 'c' : 'n';
        moves.push({ from: sq, to: toSq, flags });

        if (target !== '.') break;
        nr += dr;
        nc += dc;
      }
    }
  }

  /**
   * Generate king moves from (r, c), including castling.
   */
  _kingMoves(r, c, color, moves) {
    const sq = this._rcToSq(r, c);
    const offsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

    for (const [dr, dc] of offsets) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;

      const target = this._board[nr][nc];
      if (target !== '.' && this._colorOf(target) === color) continue;

      const toSq = this._rcToSq(nr, nc);
      const flags = (target !== '.') ? 'c' : 'n';
      moves.push({ from: sq, to: toSq, flags });
    }

    // Castling — generated here, filtered by _isLegalMove
    const backRank = color === 'w' ? 7 : 0;

    if (r === backRank && c === 4) {
      const kingKey = color === 'w' ? 'K' : 'k';
      const queenKey = color === 'w' ? 'Q' : 'q';

      if (this._castling[kingKey] &&
          this._board[backRank][5] === '.' &&
          this._board[backRank][6] === '.') {
        moves.push({ from: sq, to: this._rcToSq(backRank, 6), flags: 'k' });
      }

      if (this._castling[queenKey] &&
          this._board[backRank][1] === '.' &&
          this._board[backRank][2] === '.' &&
          this._board[backRank][3] === '.') {
        moves.push({ from: sq, to: this._rcToSq(backRank, 2), flags: 'q' });
      }
    }
  }

  // ─── Legal Move Filtering ─────────────────────────────────────────────────

  /**
   * Is the king of the given color in check?
   */
  _isKingInCheck(color) {
    const king = color === 'w' ? 'K' : 'k';
    let kingR = -1, kingC = -1;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this._board[r][c] === king) {
          kingR = r;
          kingC = c;
          break;
        }
      }
      if (kingR >= 0) break;
    }

    if (kingR < 0) return false;
    return this._isSquareAttacked(kingR, kingC, color === 'w' ? 'b' : 'w');
  }

  /**
   * Is the square at (r, c) attacked by any piece of `byColor`?
   */
  _isSquareAttacked(r, c, byColor) {
    // Check pawn attacks
    const pawnDir = byColor === 'w' ? -1 : 1;
    for (const dc of [-1, 1]) {
      const pr = r + pawnDir;
      const pc = c + dc;
      if (pr >= 0 && pr <= 7 && pc >= 0 && pc <= 7) {
        const p = this._board[pr][pc];
        if (p !== '.' && this._colorOf(p) === byColor && p.toUpperCase() === 'P') {
          return true;
        }
      }
    }

    // Check knight attacks
    const knightOffsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dr, dc] of knightOffsets) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const p = this._board[nr][nc];
        if (p !== '.' && this._colorOf(p) === byColor && p.toUpperCase() === 'N') {
          return true;
        }
      }
    }

    // Check king attacks (adjacent squares)
    const kingOffsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dr, dc] of kingOffsets) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const p = this._board[nr][nc];
        if (p !== '.' && this._colorOf(p) === byColor && p.toUpperCase() === 'K') {
          return true;
        }
      }
    }

    // Diagonal slides (bishop / queen)
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let nr = r + dr, nc = c + dc;
      while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const p = this._board[nr][nc];
        if (p !== '.') {
          if (this._colorOf(p) === byColor && (p.toUpperCase() === 'B' || p.toUpperCase() === 'Q')) {
            return true;
          }
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    // Straight slides (rook / queen)
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let nr = r + dr, nc = c + dc;
      while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const p = this._board[nr][nc];
        if (p !== '.') {
          if (this._colorOf(p) === byColor && (p.toUpperCase() === 'R' || p.toUpperCase() === 'Q')) {
            return true;
          }
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    return false;
  }

  /**
   * Is the given pseudo-legal move actually legal?
   * (i.e., after making it, own king is not in check)
   * Also checks castling-specific constraints.
   */
  _isLegalMove(move) {
    // Save state
    const savedBoard = this._board.map(row => [...row]);
    const savedEP = this._enPassant;
    const savedCastling = { ...this._castling };

    // Apply move temporarily
    const from = this._sqToRC(move.from);
    const to = this._sqToRC(move.to);
    const piece = savedBoard[from.r][from.c];
    const captured = savedBoard[to.r][to.c];

    this._board[to.r][to.c] = piece;
    this._board[from.r][from.c] = '.';

    if (move.flags.includes('e')) {
      const epR = (this._turn === 'w') ? to.r + 1 : to.r - 1;
      this._board[epR][to.c] = '.';
    }

    if (move.flags.includes('p') || move.flags.includes('pc')) {
      this._board[to.r][to.c] = move.promotion;
    }

    if (move.flags.includes('k')) {
      this._board[from.r][5] = (this._turn === 'w' ? 'R' : 'r');
      this._board[from.r][7] = '.';
    }
    if (move.flags.includes('q')) {
      this._board[from.r][3] = (this._turn === 'w' ? 'R' : 'r');
      this._board[from.r][0] = '.';
    }

    this._enPassant = null;
    this._updateCastlingRights(piece, move.from, move.to);
    if (captured !== '.') {
      if (captured === 'R') {
        if (move.to === 'h1') this._castling.K = false;
        if (move.to === 'a1') this._castling.Q = false;
      } else if (captured === 'r') {
        if (move.to === 'h8') this._castling.k = false;
        if (move.to === 'a8') this._castling.q = false;
      }
    }

    const inCheck = this._isKingInCheck(this._turn);

    // Restore state
    this._board = savedBoard;
    this._enPassant = savedEP;
    this._castling = savedCastling;

    if (inCheck) return false;

    // For castling, verify squares are not attacked
    if (move.flags.includes('k')) {
      const opp = this._turn === 'w' ? 'b' : 'w';
      if (this._isSquareAttacked(from.r, 5, opp)) return false;
      if (this._isSquareAttacked(to.r, to.c, opp)) return false;
    }
    if (move.flags.includes('q')) {
      const opp = this._turn === 'w' ? 'b' : 'w';
      if (this._isSquareAttacked(from.r, 3, opp)) return false;
      if (this._isSquareAttacked(to.r, to.c, opp)) return false;
    }

    return true;
  }

  // ─── Update Castling Rights ───────────────────────────────────────────────

  _updateCastlingRights(piece, fromSq, toSq) {
    if (piece === 'K') {
      this._castling.K = false;
      this._castling.Q = false;
    }
    if (piece === 'k') {
      this._castling.k = false;
      this._castling.q = false;
    }

    if (piece === 'R') {
      if (fromSq === 'h1') this._castling.K = false;
      if (fromSq === 'a1') this._castling.Q = false;
    }
    if (piece === 'r') {
      if (fromSq === 'h8') this._castling.k = false;
      if (fromSq === 'a8') this._castling.q = false;
    }
  }

  // ─── UCI Parsing ──────────────────────────────────────────────────────────

  _parseUci(uci) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;

    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4].toLowerCase() : null;

    const fromRC = this._sqToRC(from);
    const toRC = this._sqToRC(to);
    const piece = this._board[fromRC.r][fromRC.c];

    if (piece === '.') return null;

    // Convert promotion to proper case (uppercase for white, lowercase for black)
    const color = this._colorOf(piece);
    const properPromotion = promotion
      ? (color === 'w' ? promotion.toUpperCase() : promotion.toLowerCase())
      : null;

    // Determine flags based on position
    const isEp = piece.toUpperCase() === 'P' && fromRC.c !== toRC.c &&
                 this._board[toRC.r][toRC.c] === '.' && this._enPassant === to;

    const isKing = piece.toUpperCase() === 'K';
    const isKingside = isKing && fromRC.c === 4 && toRC.c === 6;
    const isQueenside = isKing && fromRC.c === 4 && toRC.c === 2;

    const targetSquare = this._board[toRC.r][toRC.c];
    const isCapture = targetSquare !== '.' || isEp;

    let flags = '';
    if (isEp) flags = 'e';
    else if (isKingside) flags = 'k';
    else if (isQueenside) flags = 'q';
    else if (promotion && isCapture) flags = 'pc';
    else if (promotion) flags = 'p';
    else if (isCapture) flags = 'c';
    else flags = 'n';

    return { from, to, promotion: properPromotion, flags };
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Chess;
}
if (typeof window !== 'undefined') {
  window.Chess = Chess;
}